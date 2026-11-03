/**
 * Event channels of the bot (scheduled events: bot/scheduledEvents.js).
 */
const { EmbedBuilder, PermissionsBitField, ChannelType } = require('discord.js');
const { db, collection, doc, getDoc, getDocs, updateDoc, query, where } = require('../firebaseAdmin');
const { buildEventUrl } = require('../utils/eventUrl');
const { client, state } = require('./client');
const { TIMEZONE } = require('./constants');

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
            },
            // The @everyone deny hits the bot too: without its own overwrite it could
            // neither post the welcome embed, nor add participants, nor delete the channel
            // ("Missing Access" 50001). Only rights of the invite (utils/botPermissions.js).
            {
                id: client.user.id,
                allow: [
                    PermissionsBitField.Flags.ViewChannel,
                    PermissionsBitField.Flags.SendMessages,
                    PermissionsBitField.Flags.Connect,
                    PermissionsBitField.Flags.ReadMessageHistory,
                    PermissionsBitField.Flags.EmbedLinks
                ]
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
 * Delete one event channel. A channel the bot cannot reach ("Missing Access"
 * 50001, e.g. created before the bot kept access to its own channels) never
 * becomes deletable for it -> logged for manual deletion and treated as done,
 * so the clean-up (B-10) does not retry it forever. Other errors are thrown.
 *
 * @param {Object} guild -> The fetched guild.
 * @param {string|null} channelId -> Stored channel id.
 * @returns {Promise<void>}
 */
async function deleteChannel(guild, channelId) {
    if (!channelId) return;
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel) return;
    try {
        await channel.delete();
    } catch (err) {
        if (err?.code !== 50001) throw err;
        console.warn(`⚠️ Kein Zugriff auf Event-Channel ${channelId} – bitte in Discord von Hand löschen (Missing Access).`);
    }
}

/**
 * Delete the event channels and forget their ids.
 *
 * @param {string} eventId -> Event document id.
 * @returns {Promise<boolean>} -> False while offline, without channels or on an error (ids kept for a later try).
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

        await deleteChannel(guild, event.discordChannelId);
        await deleteChannel(guild, event.discordTextChannelId);

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
    createEventChannels,
    addParticipantToEventChannels,
    removeParticipantFromEventChannels,
    deleteEventChannels
};
