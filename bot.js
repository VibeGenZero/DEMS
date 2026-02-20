const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder, PermissionsBitField, ChannelType } = require('discord.js');
const { db, collection, doc, getDoc, getDocs, addDoc, updateDoc, query, where, orderBy } = require('./firebaseAdmin');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildScheduledEvents
    ]
});

let isReady = false;

client.once('ready', async () => {
    console.log(`🤖 Bot logged in as ${client.user.tag}`);
    isReady = true;
    await registerSlashCommands();
    logBotInviteUrl();
});

client.on('error', (err) => {
    console.error('🤖 Bot error:', err.message);
});

/**
 * Register slash commands
 */
async function registerSlashCommands() {
    try {
        const commands = [
            new SlashCommandBuilder()
                .setName('events')
                .setDescription('Zeigt aktive Events an'),
            new SlashCommandBuilder()
                .setName('register')
                .setDescription('Registriere dich für ein Event')
                .addStringOption(opt => opt
                    .setName('event')
                    .setDescription('Name des Events')
                    .setRequired(true)
                    .setAutocomplete(true)
                ),
            new SlashCommandBuilder()
                .setName('unregister')
                .setDescription('Melde dich von einem Event ab')
                .addStringOption(opt => opt
                    .setName('event')
                    .setDescription('Name des Events')
                    .setRequired(true)
                    .setAutocomplete(true)
                )
        ];

        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
        await rest.put(
            Routes.applicationGuildCommands(client.user.id, process.env.DISCORD_GUILD_ID),
            { body: commands.map(c => c.toJSON()) }
        );
        console.log('✅ Slash Commands registriert');
    } catch (err) {
        console.error('❌ Slash Command Registration Error:', err.message);
    }
}

/**
 * Handle slash command interactions
 */
client.on('interactionCreate', async (interaction) => {
    // Handle autocomplete
    if (interaction.isAutocomplete()) {
        // Show events for /register autocomplete (for choosing which event link to get)
        if (interaction.commandName === 'register') {
            try {
                const q = query(collection(db, 'events'), where('status', '==', 'active'));
                const snapshot = await getDocs(q);
                const focused = interaction.options.getFocused().toLowerCase();
                const choices = [];
                snapshot.forEach(d => {
                    const ev = d.data();
                    if (ev.title.toLowerCase().includes(focused)) {
                        choices.push({ name: ev.title.substring(0, 100), value: d.id });
                    }
                });
                await interaction.respond(choices.slice(0, 25));
            } catch {
                await interaction.respond([]);
            }
        }
        if (interaction.commandName === 'unregister') {
            try {
                const userId = interaction.user.id;
                // Find events the user is registered for
                const regQ = query(collection(db, 'registrations'), where('userId', '==', userId));
                const regSnapshot = await getDocs(regQ);
                const eventIds = new Set();
                regSnapshot.forEach(regDoc => {
                    eventIds.add(regDoc.data().eventId);
                });

                if (eventIds.size === 0) {
                    return interaction.respond([]);
                }

                // Get event details
                const focused = interaction.options.getFocused().toLowerCase();
                const choices = [];
                for (const eventId of eventIds) {
                    const eventSnap = await getDoc(doc(db, 'events', eventId));
                    if (eventSnap.exists()) {
                        const ev = eventSnap.data();
                        if (ev.title.toLowerCase().includes(focused)) {
                            choices.push({ name: ev.title.substring(0, 100), value: eventId });
                        }
                    }
                }
                await interaction.respond(choices.slice(0, 25));
            } catch {
                await interaction.respond([]);
            }
        }
        return;
    }

    if (!interaction.isChatInputCommand()) return;

    // /events command
    if (interaction.commandName === 'events') {
        try {
            // Fetch active events without orderBy to avoid composite index
            const q = query(collection(db, 'events'), where('status', '==', 'active'));
            const snapshot = await getDocs(q);

            if (snapshot.empty) {
                return interaction.reply({ content: '📭 Keine aktiven Events vorhanden.', ephemeral: true });
            }

            // Convert to array and sort by startDate in memory
            const events = [];
            snapshot.forEach(d => {
                events.push({ id: d.id, ...d.data() });
            });
            events.sort((a, b) => {
                const dateA = a.startDate || '';
                const dateB = b.startDate || '';
                return dateA.localeCompare(dateB);
            });

            const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
            const embeds = [];
            const maxEmbeds = Math.min(events.length, 10); // Max 10 embeds per message

            for (let i = 0; i < maxEmbeds; i++) {
                const ev = events[i];
                const embed = new EmbedBuilder()
                    .setTitle(ev.title)
                    .setColor(0x8b5cf6)
                    .setDescription((ev.description || '').substring(0, 200))
                    .addFields(
                        { name: '📅 Datum', value: ev.startDate ? new Date(ev.startDate).toLocaleString('de-DE') : 'TBD', inline: true },
                        { name: '👥 Plätze', value: ev.maxParticipants > 0 ? `${ev.currentParticipants || 0}/${ev.maxParticipants}` : 'Unbegrenzt', inline: true },
                        { name: '🔗 Link', value: `[Zur Anmeldung](${baseUrl}/#events/${ev.id})`, inline: true }
                    );
                if (ev.category) embed.setFooter({ text: ev.category });
                embeds.push(embed);
            }

            await interaction.reply({ embeds, ephemeral: false });
        } catch (err) {
            console.error('Slash /events error:', err);
            await interaction.reply({ content: '❌ Fehler beim Laden der Events.', ephemeral: true });
        }
    }

    // /register command - DISABLED: Redirect to website for security
    if (interaction.commandName === 'register') {
        try {
            const eventId = interaction.options.getString('event');
            const eventSnap = await getDoc(doc(db, 'events', eventId));

            if (!eventSnap.exists()) {
                return interaction.reply({ content: '❌ Event nicht gefunden.', ephemeral: true });
            }

            const event = eventSnap.data();
            const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
            const registrationUrl = `${baseUrl}/#event/${eventId}`;

            const embed = new EmbedBuilder()
                .setTitle('🌐 Registrierung über Website erforderlich')
                .setColor(0x8b5cf6)
                .setDescription(
                    `Um dich für **${event.title}** anzumelden, besuche bitte die Website.\n\n` +
                    `Dies stellt sicher, dass alle erforderlichen Informationen korrekt ausgefüllt werden.`
                )
                .addFields({ name: '🔗 Zur Anmeldung', value: `[Hier klicken](${registrationUrl})` })
                .setFooter({ text: 'DEMS — Event Management' })
                .setTimestamp();

            await interaction.reply({ embeds: [embed], ephemeral: true });
        } catch (err) {
            console.error('Slash /register error:', err);
            await interaction.reply({ content: '❌ Fehler.', ephemeral: true });
        }
    }

    // /unregister command
    if (interaction.commandName === 'unregister') {
        try {
            const eventId = interaction.options.getString('event');
            const userId = interaction.user.id;

            // Get event details
            const eventSnap = await getDoc(doc(db, 'events', eventId));
            if (!eventSnap.exists()) {
                return interaction.reply({ content: '❌ Event nicht gefunden.', ephemeral: true });
            }

            const event = eventSnap.data();

            // Find user's registration
            const regQ = query(
                collection(db, 'registrations'),
                where('eventId', '==', eventId),
                where('userId', '==', userId)
            );
            const regSnapshot = await getDocs(regQ);

            if (regSnapshot.empty) {
                return interaction.reply({ content: '⚠️ Du bist für dieses Event nicht angemeldet.', ephemeral: true });
            }

            const regDoc = regSnapshot.docs[0];
            const regData = regDoc.data();
            const wasAccepted = regData.status === 'accepted';

            // Delete registration
            await deleteDoc(doc(db, 'registrations', regDoc.id));

            // Remove role if user was accepted
            if (wasAccepted && event.assignRoleId) {
                await removeRole(userId, event.assignRoleId, process.env.DISCORD_GUILD_ID);
            }

            // Promote from waitlist if a spot opened up
            if (wasAccepted || regData.status === 'pending') {
                const { promoteFromWaitlist } = require('./utils/eventUtils');
                await promoteFromWaitlist(eventId, event);
            }

            const embed = new EmbedBuilder()
                .setTitle('✅ Abmeldung erfolgreich')
                .setColor(0x22c55e)
                .setDescription(`Du wurdest erfolgreich von **${event.title}** abgemeldet.`)
                .setTimestamp();

            await interaction.reply({ embeds: [embed], ephemeral: true });
        } catch (err) {
            console.error('Slash /unregister error:', err);
            await interaction.reply({ content: '❌ Fehler bei der Abmeldung.', ephemeral: true });
        }
    }
});

/**
 * Send a DM to a user
 */
async function sendDM(userId, message) {
    if (!isReady) {
        console.warn('Bot not ready yet, cannot send DM');
        return false;
    }
    try {
        const user = await client.users.fetch(userId);
        await user.send(message);
        console.log(`📩 DM sent to ${user.tag}`);
        return true;
    } catch (err) {
        console.error(`Failed to send DM to ${userId}:`, err.message);
        return false;
    }
}

/**
 * Send a rich embed message to a Discord channel
 * @param {string} channelId
 * @param {EmbedBuilder} embed
 * @param {Object} [options] - Additional options
 * @param {string} [options.text] - Text content above the embed
 * @param {string[]} [options.roleIds] - Role IDs to mention
 * @param {boolean} [options.pingEveryone] - Whether to mention @everyone
 */
async function sendChannelMessage(channelId, embed, options = {}) {
    if (!isReady) {
        console.warn('Bot not ready yet, cannot send channel message');
        return false;
    }
    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel || !channel.send) {
            console.error('Channel not found or not a text channel:', channelId);
            return false;
        }

        // Build content string with mentions
        let contentParts = [];

        // Role pings
        if (options.roleIds && options.roleIds.length > 0) {
            const roleMentions = options.roleIds.map(id => `<@&${id}>`).join(' ');
            contentParts.push(roleMentions);
        }

        // @everyone ping
        if (options.pingEveryone) {
            contentParts.push('@everyone');
        }

        // Custom text
        if (options.text && options.text.trim()) {
            contentParts.push(options.text.trim());
        }

        const content = contentParts.length > 0 ? contentParts.join('\n') : undefined;

        await channel.send({
            content,
            embeds: [embed],
            allowedMentions: {
                parse: options.pingEveryone ? ['everyone', 'roles'] : ['roles'],
                roles: options.roleIds || []
            }
        });
        console.log(`📢 Announcement sent to channel ${channelId}`);
        return true;
    } catch (err) {
        console.error(`Failed to send channel message:`, err.message);
        return false;
    }
}

/**
 * Build an event announcement embed
 * @param {Object} event - Event data
 * @param {string} [registrationLink] - Optional link to the registration page
 */
function buildEventEmbed(event, registrationLink) {
    const embed = new EmbedBuilder()
        .setColor(0x8b5cf6)
        .setTitle(`🎉 ${event.title}`)
        .setDescription(event.description || 'Keine Beschreibung.')
        .addFields(
            { name: '🗓️ Datum', value: event.startDate ? new Date(event.startDate).toLocaleString('de-DE') : 'TBA', inline: true },
            { name: '👥 Teilnehmer', value: event.maxParticipants > 0 ? `Max. ${event.maxParticipants}` : 'Unbegrenzt', inline: true },
            { name: '🔓 Zugang', value: event.accessMode === 'open' ? 'Offen für alle' : 'Rollen-Requirement', inline: true }
        )
        .setFooter({ text: 'DEMS — Event Management' })
        .setTimestamp();

    if (event.bannerUrl) {
        embed.setImage(event.bannerUrl);
    }

    if (event.category) {
        embed.addFields({ name: '🏷️ Kategorie', value: event.category, inline: true });
    }

    // Add registration link
    if (registrationLink) {
        embed.addFields({ name: '📋 Anmeldung', value: `[Hier anmelden](${registrationLink})`, inline: false });
    }

    return embed;
}

/**
 * Assign a role to a user in the configured guild
 */
async function assignRole(userId, roleId, guildId) {
    if (!isReady) {
        console.warn('Bot not ready yet, cannot assign role');
        return false;
    }
    try {
        const guild = await client.guilds.fetch(guildId);
        const member = await guild.members.fetch(userId);
        await member.roles.add(roleId);
        console.log(`🎭 Role ${roleId} assigned to ${member.user.tag}`);
        return true;
    } catch (err) {
        console.error(`Failed to assign role to ${userId}:`, err.message);
        return false;
    }
}

/**
 * Remove a role from a user in the configured guild
 */
async function removeRole(userId, roleId, guildId) {
    if (!isReady) {
        console.warn('Bot not ready yet, cannot remove role');
        return false;
    }
    try {
        const guild = await client.guilds.fetch(guildId);
        const member = await guild.members.fetch(userId);
        await member.roles.remove(roleId);
        console.log(`🎭 Role ${roleId} removed from ${member.user.tag}`);
        return true;
    } catch (err) {
        console.error(`Failed to remove role from ${userId}:`, err.message);
        return false;
    }
}

/**
 * Get a user's roles in the guild
 */
async function getUserRoles(userId, guildId) {
    if (!isReady) return [];
    try {
        const guild = await client.guilds.fetch(guildId);
        const member = await guild.members.fetch(userId);
        return member.roles.cache.map(r => ({ id: r.id, name: r.name, color: r.hexColor }));
    } catch (err) {
        console.error(`Failed to get roles for ${userId}:`, err.message);
        return [];
    }
}

/**
 * Check if user is a member of the guild
 */
async function isGuildMember(userId, guildId) {
    if (!isReady) return false;
    try {
        const guild = await client.guilds.fetch(guildId);
        await guild.members.fetch(userId);
        return true;
    } catch {
        return false;
    }
}

/**
 * Get the guild/server name
 */
async function getGuildName(guildId) {
    if (!isReady) return '';
    try {
        const guild = await client.guilds.fetch(guildId);
        return guild.name || '';
    } catch (err) {
        console.error('Failed to get guild name:', err.message);
        return '';
    }
}

/**
 * Get all roles from the guild (for admin dropdown)
 */
async function getGuildRoles(guildId) {
    if (!isReady) return [];
    try {
        const guild = await client.guilds.fetch(guildId);
        const roles = await guild.roles.fetch();
        return roles
            .filter(r => r.name !== '@everyone')
            .sort((a, b) => b.position - a.position)
            .map(r => ({ id: r.id, name: r.name, color: r.color, managed: r.managed }));
    } catch (err) {
        console.error('Failed to get guild roles:', err.message);
        return [];
    }
}

/**
 * Replace template variables in bot messages
 */
function parseTemplate(template, variables) {
    let result = template;
    for (const [key, value] of Object.entries(variables)) {
        result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
    }
    return result;
}

/**
 * Reminder scheduler — checks every 5 min for events starting soon
 * Sends DM reminders to accepted participants
 */
let reminderInterval = null;
const sentReminders = new Map(); // key -> eventStartTime, for cleanup

async function checkReminders() {
    try {
        const now = new Date();

        // Cleanup: remove entries for events that have already started
        for (const [key, startTime] of sentReminders.entries()) {
            if (now > startTime) {
                sentReminders.delete(key);
            }
        }

        const q = query(collection(db, 'events'));
        const snapshot = await getDocs(q);

        for (const docSnap of snapshot.docs) {
            const event = docSnap.data();
            const eventId = docSnap.id;

            if (event.status !== 'active' || !event.startDate) continue;

            const startTime = new Date(event.startDate);

            // Backward compatibility: convert old single reminder to array format
            let reminders = event.reminderHours;
            if (typeof reminders === 'number' && reminders > 0) {
                reminders = [{ hours: reminders, sent: false }];
            }
            if (!Array.isArray(reminders)) {
                reminders = [];
            }

            // Process multiple reminders
            for (let i = 0; i < reminders.length; i++) {
                const reminder = reminders[i];
                if (!reminder || typeof reminder.hours !== 'number') continue;

                const reminderTime = new Date(startTime.getTime() - (reminder.hours * 60 * 60 * 1000));
                const reminderKey = `${eventId}-${reminder.hours}h`;

                // Check if reminder should fire: within the 5-min check window
                if (now >= reminderTime && now < startTime && !sentReminders.has(reminderKey)) {
                    sentReminders.set(reminderKey, startTime);
                    console.log(`⏰ Sending ${reminder.hours}h reminder for event: ${event.title}`);

                    // Get accepted registrations
                    const regQ = query(
                        collection(db, 'registrations'),
                        where('eventId', '==', eventId),
                        where('status', '==', 'accepted')
                    );
                    const regs = await getDocs(regQ);

                    const timeStr = startTime.toLocaleString('de-DE');
                    for (const regDoc of regs.docs) {
                        const reg = regDoc.data();
                        await sendDM(reg.userId,
                            `⏰ **Erinnerung!** Das Event **${event.title}** startet am ${timeStr}. Sei bereit!`
                        );
                    }

                    // Mark reminder as sent in database
                    if (Array.isArray(event.reminderHours)) {
                        event.reminderHours[i].sent = true;
                        await updateDoc(doc(db, 'events', eventId), {
                            reminderHours: event.reminderHours
                        });
                    }
                }
            }

            // Event-start notification
            const eventStartKey = `${eventId}-start`;
            const fiveMinutes = 5 * 60 * 1000;
            if (now >= startTime && now < new Date(startTime.getTime() + fiveMinutes) && !sentReminders.has(eventStartKey) && !event.eventStartNotificationSent) {
                sentReminders.set(eventStartKey, now);
                console.log(`🎯 Event started: ${event.title}`);

                // Get accepted registrations
                const regQ = query(
                    collection(db, 'registrations'),
                    where('eventId', '==', eventId),
                    where('status', '==', 'accepted')
                );
                const regs = await getDocs(regQ);

                for (const regDoc of regs.docs) {
                    const reg = regDoc.data();
                    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
                    await sendDM(reg.userId,
                        `🎯 **${event.title}** hat gerade begonnen! Viel Spaß!\n\n🔗 Event ansehen: ${baseUrl}/#event/${eventId}`
                    );
                }

                // Mark event-start notification as sent
                await updateDoc(doc(db, 'events', eventId), {
                    eventStartNotificationSent: true
                });
            }
        }
    } catch (err) {
        console.error('Reminder check error:', err.message);
    }
}

function startReminderScheduler() {
    if (reminderInterval) clearInterval(reminderInterval);
    reminderInterval = setInterval(checkReminders, 5 * 60 * 1000); // Every 5 min
    console.log('⏰ Reminder scheduler started (checks every 5 min)');
}

/**
 * Generate and log the bot invite URL with all required permissions
 */
function logBotInviteUrl() {
    const clientId = process.env.DISCORD_CLIENT_ID || client.user?.id;
    if (!clientId) {
        console.warn('⚠️ Keine Client ID verfügbar — Invite URL konnte nicht generiert werden.');
        return;
    }

    const permissions = new PermissionsBitField([
        PermissionsBitField.Flags.ManageRoles,        // Rollen zuweisen/entfernen
        PermissionsBitField.Flags.ManageChannels,      // Kanäle erstellen/löschen
        PermissionsBitField.Flags.SendMessages,        // Nachrichten in Channels senden
        PermissionsBitField.Flags.SendMessagesInThreads, // Nachrichten in Threads senden
        PermissionsBitField.Flags.EmbedLinks,          // Rich Embeds senden
        PermissionsBitField.Flags.MentionEveryone,     // @everyone und Rollen erwähnen
        PermissionsBitField.Flags.ViewChannel,         // Channels sehen
        PermissionsBitField.Flags.ReadMessageHistory,  // Nachrichtenverlauf lesen
        PermissionsBitField.Flags.UseExternalEmojis,   // Externe Emojis verwenden
    ]);

    const scopes = ['bot', 'applications.commands'];
    const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=${permissions.bitfield}&scope=${scopes.join('%20')}`;

    console.log('\n🔗 ════════════════════════════════════════════════════');
    console.log('   Bot Invite URL (mit allen benötigten Rechten):');
    console.log(`   ${inviteUrl}`);
    console.log('════════════════════════════════════════════════════════\n');
}

/**
 * Start the bot — returns a Promise that resolves when ready or rejects on error
 */
async function startBot(token) {
    if (!token) {
        console.warn('⚠️ No bot token provided, bot will not start.');
        return false;
    }
    try {
        await client.login(token);
        return true;
    } catch (err) {
        console.error('❌ Bot login fehlgeschlagen:', err.message);
        return false;
    }
}

/**
 * Stop the bot and clear the reminder scheduler (for graceful shutdown)
 */
function stopBot() {
    if (reminderInterval) {
        clearInterval(reminderInterval);
        reminderInterval = null;
    }
    if (isReady) {
        client.destroy();
        isReady = false;
    }
    console.log('🤖 Bot & Reminder Scheduler gestoppt.');
}

/**
 * Get all scheduled events from the guild
 */
async function getGuildScheduledEvents(guildId) {
    if (!isReady) return [];
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
    if (!isReady) return null;
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

        // Set Image (if URL valid and image supported format)
        if (event.bannerUrl) {
            try {
                await scheduledEvent.setImage(event.bannerUrl);
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
    if (!isReady) return null;
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
            const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
            const embed = new EmbedBuilder()
                .setTitle(`🎉 Event: ${event.title}`)
                .setColor(0x8b5cf6)
                .setDescription(event.description ? event.description.substring(0, 1000) : 'Keine Beschreibung.')
                .addFields(
                    { name: '📅 Start', value: event.startDate ? new Date(event.startDate).toLocaleString('de-DE', { dateStyle: 'long', timeStyle: 'short' }) + ' Uhr' : 'TBD', inline: true },
                    { name: '🔗 Link', value: `[Zur Event-Seite](${baseUrl}/#events/${event.id})`, inline: true }
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
    if (!isReady || (!event.discordChannelId && !event.discordTextChannelId)) return false;
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
    if (!isReady || (!event.discordChannelId && !event.discordTextChannelId)) return false;
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
    if (!isReady) return false;
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
    client,
    startBot,
    stopBot,
    sendDM,
    sendChannelMessage,
    buildEventEmbed,
    assignRole,
    removeRole,
    getUserRoles,
    isGuildMember,
    getGuildName,
    getGuildRoles,
    getGuildScheduledEvents,
    parseTemplate,
    startReminderScheduler,
    createEventChannels,
    addParticipantToEventChannels,
    removeParticipantFromEventChannels,
    deleteEventChannels,
    createScheduledEvent
};
