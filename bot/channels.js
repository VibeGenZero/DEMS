/**
 * Event channels and Discord scheduled events of the bot.
 */
const { EmbedBuilder, PermissionsBitField, ChannelType } = require('discord.js');
const { db, collection, doc, getDoc, getDocs, updateDoc, query, where } = require('../firebaseAdmin');
const { buildEventUrl } = require('../utils/eventUrl');
const { bannerForDiscord } = require('../utils/bannerStore');
const { client, state } = require('./client');
const { TIMEZONE } = require('./constants');

/**
 * Get all scheduled events from the guild
 */
async function getGuildScheduledEvents(guildId) {
    if (!state.isReady) return [];
    try {
        const guild = await client.guilds.fetch(guildId);
        const events = await guild.scheduledEvents.fetch();
        return events.map(e => ({
            id: e.id,
            name: e.name,
            description: e.description,
            scheduledStartTimestamp: e.scheduledStartTimestamp,
            scheduledEndTimestamp: e.scheduledEndTimestamp,
            image: e.coverImageURL({ size: 1024 }),
            location: e.entityMetadata?.location || 'Discord',
            url: e.url
        }));
    } catch (err) {
        console.error('Failed to fetch guild scheduled events:', err.message);
        return [];
    }
}

/**
 * Create a native Discord Scheduled Event
 */
async function createScheduledEvent(event) {
    if (!state.isReady) return null;
    try {
        const guildId = process.env.DISCORD_GUILD_ID;
        const guild = await client.guilds.fetch(guildId);

        let entityType = 3; // GuildScheduledEventEntityType.External
        let channelId = null;
        let entityMetadata = { location: 'TBD' };

        if (event.discordChannelId) {
            entityType = 2; // GuildScheduledEventEntityType.Voice
            channelId = event.discordChannelId;
            entityMetadata = undefined;
        }

        const scheduledStartTime = event.startDate ? new Date(event.startDate) : new Date(Date.now() + 60 * 60 * 1000);
        let scheduledEndTime = event.endDate ? new Date(event.endDate) : new Date(scheduledStartTime.getTime() + 2 * 60 * 60 * 1000);

        // Ensure end time is strictly after start time
        if (scheduledEndTime <= scheduledStartTime) {
            scheduledEndTime = new Date(scheduledStartTime.getTime() + 2 * 60 * 60 * 1000);
        }

        const scheduledEvent = await guild.scheduledEvents.create({
            name: event.title.substring(0, 100),
            scheduledStartTime,
            scheduledEndTime,
            privacyLevel: 2, // GUILD_ONLY
            entityType,
            channel: channelId,
            entityMetadata,
            description: (event.description || '').substring(0, 1000),
            reason: 'DEMS Sync'
        });

        // Set Image: an uploaded banner (W-12) as the file itself, so it works
        // without a public BASE_URL; an external one as its URL
        const banner = bannerForDiscord(event.bannerUrl);
        if (banner.file || banner.url) {
            try {
                await scheduledEvent.setImage(banner.file || banner.url);
            } catch (e) {
                console.warn('Could not set banner image for scheduled event:', e.message);
            }
        }

        console.log(`✅ Scheduled Event created: ${scheduledEvent.name} (${scheduledEvent.id})`);
        return scheduledEvent.id;
    } catch (err) {
        console.error('Failed to create scheduled event:', err);
        return null;
    }
}

/**
 * Create private voice and/or text channels for an event
 */
async function createEventChannels(event) {
    if (!state.isReady) return null;
    try {
        const guildId = process.env.DISCORD_GUILD_ID;
        if (!guildId) return null;

        const guild = await client.guilds.fetch(guildId);
        if (!guild) return null;

        // Check if event already has a channel
        if (event.discordChannelId || event.discordTextChannelId) {
            return { voiceId: event.discordChannelId, textId: event.discordTextChannelId };
        }

        const categoryId = process.env.DISCORD_EVENT_CATEGORY_ID;
        const config = event.channelConfig || {};
        const type = config.type || 'voice'; // 'voice', 'text', 'both'

        const vName = (config.voiceName || `⏳ ${event.title}`).substring(0, 100);
        const tName = (config.textName || `💬-${event.title.replace(/\s+/g, '-').toLowerCase()}`).substring(0, 100);

        let createdVoiceChannel = null;
        let createdTextChannel = null;

        const baseOverwrites = [
            {
                id: guild.id, // @everyone role
                deny: [PermissionsBitField.Flags.ViewChannel],
            }
        ];

        if (type === 'voice' || type === 'both') {
            createdVoiceChannel = await guild.channels.create({
                name: vName,
                type: ChannelType.GuildVoice,
                parent: categoryId || null,
                permissionOverwrites: baseOverwrites
            });
        }

        if (type === 'text' || type === 'both') {
            createdTextChannel = await guild.channels.create({
                name: tName,
                type: ChannelType.GuildText,
                parent: categoryId || null,
                permissionOverwrites: baseOverwrites
            });
        }

        // Add access for users that already have accepted status
        const regQ = query(
            collection(db, 'registrations'),
            where('eventId', '==', event.id),
            where('status', '==', 'accepted')
        );
        const regs = await getDocs(regQ);
        for (const r of regs.docs) {
            const data = r.data();
            if (createdVoiceChannel) {
                await createdVoiceChannel.permissionOverwrites.create(data.userId, { ViewChannel: true, Connect: true }).catch(console.error);
            }
            if (createdTextChannel) {
                await createdTextChannel.permissionOverwrites.create(data.userId, { ViewChannel: true, SendMessages: true }).catch(console.error);
            }
        }

        // Send an Embed to the text channel (or internal voice text chat)
        const targetChannel = createdTextChannel || createdVoiceChannel;
        if (targetChannel) {
            const embed = new EmbedBuilder()
                .setTitle(`🎉 Event: ${event.title}`)
                .setColor(0x8b5cf6)
                .setDescription(event.description ? event.description.substring(0, 1000) : 'Keine Beschreibung.')
                .addFields(
                    { name: '📅 Start', value: event.startDate ? new Date(event.startDate).toLocaleString('de-DE', { timeZone: TIMEZONE, dateStyle: 'long', timeStyle: 'short' }) + ' Uhr' : 'TBD', inline: true },
                    { name: '🔗 Link', value: `[Zur Event-Seite](${buildEventUrl(event.id)})`, inline: true }
                )
                .setFooter({ text: 'Automatisierter Event Channel' });

            await targetChannel.send({ embeds: [embed] }).catch(console.error);
        }

        // Save channel IDs to event
        await updateDoc(doc(db, 'events', event.id), {
            discordChannelId: createdVoiceChannel ? createdVoiceChannel.id : null,
            discordTextChannelId: createdTextChannel ? createdTextChannel.id : null
        });

        console.log(`✅ Event channels created for: ${event.title}`);
        return {
            voiceId: createdVoiceChannel ? createdVoiceChannel.id : null,
            textId: createdTextChannel ? createdTextChannel.id : null
        };
    } catch (err) {
        console.error('Failed to create event channel:', err);
        return null;
    }
}

/**
 * Add a participant to the event channels
 */
async function addParticipantToEventChannels(event, userId) {
    if (!state.isReady || (!event.discordChannelId && !event.discordTextChannelId)) return false;
    try {
        const guildId = process.env.DISCORD_GUILD_ID;
        const guild = await client.guilds.fetch(guildId);

        if (event.discordChannelId) {
            const channel = await guild.channels.fetch(event.discordChannelId).catch(() => null);
            if (channel) await channel.permissionOverwrites.create(userId, { ViewChannel: true, Connect: true });
        }

        if (event.discordTextChannelId) {
            const textChannel = await guild.channels.fetch(event.discordTextChannelId).catch(() => null);
            if (textChannel) await textChannel.permissionOverwrites.create(userId, { ViewChannel: true, SendMessages: true });
        }
        return true;
    } catch (err) {
        console.error('Failed to add participant to channels:', err);
        return false;
    }
}

/**
 * Remove a participant from the event channels
 */
async function removeParticipantFromEventChannels(event, userId) {
    if (!state.isReady || (!event.discordChannelId && !event.discordTextChannelId)) return false;
    try {
        const guildId = process.env.DISCORD_GUILD_ID;
        const guild = await client.guilds.fetch(guildId);

        if (event.discordChannelId) {
            const channel = await guild.channels.fetch(event.discordChannelId).catch(() => null);
            if (channel) await channel.permissionOverwrites.delete(userId);
        }

        if (event.discordTextChannelId) {
            const textChannel = await guild.channels.fetch(event.discordTextChannelId).catch(() => null);
            if (textChannel) await textChannel.permissionOverwrites.delete(userId);
        }
        return true;
    } catch (err) {
        console.error('Failed to remove participant from channels:', err);
        return false;
    }
}

/**
 * Delete event channels
 */
async function deleteEventChannels(eventId) {
    if (!state.isReady) return false;
    try {
        const eventSnap = await getDoc(doc(db, 'events', eventId));
        if (!eventSnap.exists()) return false;

        const event = eventSnap.data();
        if (!event.discordChannelId && !event.discordTextChannelId) return false;

        const guildId = process.env.DISCORD_GUILD_ID;
        const guild = await client.guilds.fetch(guildId);

        if (event.discordChannelId) {
            const channel = await guild.channels.fetch(event.discordChannelId).catch(() => null);
            if (channel) await channel.delete();
        }

        if (event.discordTextChannelId) {
            const textChannel = await guild.channels.fetch(event.discordTextChannelId).catch(() => null);
            if (textChannel) await textChannel.delete();
        }

        console.log(`🗑️ Event channels deleted for eventId: ${eventId}`);

        // Remove ID from db
        await updateDoc(doc(db, 'events', eventId), {
            discordChannelId: null,
            discordTextChannelId: null
        });

        return true;
    } catch (err) {
        console.error('Failed to delete event channels:', err);
        return false;
    }
}

module.exports = {
    getGuildScheduledEvents,
    createScheduledEvent,
    createEventChannels,
    addParticipantToEventChannels,
    removeParticipantFromEventChannels,
    deleteEventChannels
};
