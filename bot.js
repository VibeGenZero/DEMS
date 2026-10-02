const {
    Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ModalBuilder, LabelBuilder, TextDisplayBuilder, TextInputBuilder, TextInputStyle,
    StringSelectMenuBuilder, UserSelectMenuBuilder, RoleSelectMenuBuilder,
    ChannelSelectMenuBuilder, MentionableSelectMenuBuilder, MessageFlags,
    REST, Routes, SlashCommandBuilder, PermissionsBitField, ChannelType, ActivityType, Events,
    escapeMarkdown
} = require('discord.js');
// Loaded before firebaseAdmin.js so the mock environment is in place even
// when bot.js is required without server.js (e.g. in tests)
const { IS_MOCK_MODE } = require('./dev/mockMode');
const { db, collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc, query, where, orderBy } = require('./firebaseAdmin');
const { debugLog } = require('./utils/debugLog');
const { buildEventUrl } = require('./utils/eventUrl');
const { isRegistrationBlocked } = require('./middleware/maintenance');
const {
    FORM_FIELD_TYPE, MODAL_MAX_FIELDS, getFormFields, getFieldType,
    formatEntityAnswer, fitsIntoDiscordModal, getModalFieldLimit
} = require('./utils/formFields');
const { getSlots, hasSlots, findSlot, formatSlotLabel, countSlotOccupancy, hasFreePlace } = require('./utils/slotService');

const TIMEZONE = process.env.TIMEZONE || 'Europe/Berlin';

// Discord length limits for modal components
const MODAL_TITLE_MAX_LENGTH = 45;
const MODAL_LABEL_MAX_LENGTH = 45;
const MODAL_DESCRIPTION_MAX_LENGTH = 100;
const MODAL_PLACEHOLDER_MAX_LENGTH = 100;
const SELECT_OPTION_LABEL_MAX_LENGTH = 100;

// Values of the yes/no select that represents a checkbox field
const CHECKBOX_VALUE_YES = 'true';
const CHECKBOX_VALUE_NO = 'false';

// Channel types offered by a channel select field
const SELECTABLE_CHANNEL_TYPES = [
    ChannelType.GuildText,
    ChannelType.GuildVoice,
    ChannelType.GuildAnnouncement,
    ChannelType.GuildStageVoice,
    ChannelType.GuildForum
];

// Custom ID prefixes for the event registration components
const REGISTER_BUTTON_PREFIX = 'event_register';
const REGISTER_MODAL_PREFIX = 'event_register_modal';
const MODAL_FIELD_PREFIX = 'field';
const SLOT_BUTTON_PREFIX = 'event_slot';
const SLOT_MODAL_PREFIX = 'event_slot_modal';
const SLOT_SWITCH_PREFIX = 'slot_switch';
const SLOT_LEAVE_PREFIX = 'slot_leave';
const ALT_SLOTS_FIELD_ID = 'alt_slots';

// Discord allows five buttons per action row
const BUTTONS_PER_ROW = 5;
// Names listed per slot in the announcement embed
const ROSTER_NAMES_MAX = 5;

// Registrations that are currently being processed -> guards against double clicks
const pendingDiscordRegistrations = new Set();

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
let botStartedAt = null;
let dmsSentCount = 0;
let commandsProcessedCount = 0;
let presenceUpdateInterval = null;

client.once(Events.ClientReady, async () => {
    console.log(`🤖 Bot logged in as ${client.user.tag}`);
    debugLog('bot.ready', { tag: client.user.tag, guildId: process.env.DISCORD_GUILD_ID });
    isReady = true;
    botStartedAt = new Date();
    await registerSlashCommands();
    logBotInviteUrl();
    await applyBotSettings();
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

    // Handle the registration modal of an event announcement
    if (interaction.isModalSubmit()) {
        const [modalAction, modalEventId, modalSlotId] = interaction.customId.split(':');
        if (modalAction === SLOT_MODAL_PREFIX && modalEventId && modalSlotId) {
            try {
                await handleEventSlotModal(interaction, modalEventId, modalSlotId);
            } catch (err) {
                console.error('Event slot modal error:', err);
                await replyWithFailure(interaction);
            }
            return;
        }
        if (modalAction === REGISTER_MODAL_PREFIX && modalEventId) {
            try {
                await handleEventRegisterModal(interaction, modalEventId);
            } catch (err) {
                console.error('Event registration modal error:', err);
                const failureMessage = { content: '❌ Fehler bei der Anmeldung.', flags: MessageFlags.Ephemeral };
                try {
                    if (interaction.deferred || interaction.replied) {
                        await interaction.editReply({ content: failureMessage.content });
                    } else {
                        await interaction.reply(failureMessage);
                    }
                } catch { /* interaction already expired */ }
            }
        }
        return;
    }

    // Handle guest invitation and event registration button interactions
    if (interaction.isButton()) {
        const [buttonAction, buttonEventId, buttonSlotId] = interaction.customId.split(':');
        if ([SLOT_BUTTON_PREFIX, SLOT_SWITCH_PREFIX, SLOT_LEAVE_PREFIX].includes(buttonAction) && buttonEventId) {
            try {
                if (buttonAction === SLOT_BUTTON_PREFIX) {
                    await handleEventSlotButton(interaction, buttonEventId, buttonSlotId);
                } else if (buttonAction === SLOT_SWITCH_PREFIX) {
                    await handleSlotSwitchButton(interaction, buttonEventId, buttonSlotId);
                } else {
                    await handleSlotLeaveButton(interaction, buttonEventId);
                }
            } catch (err) {
                console.error('Slot button error:', err);
                await replyWithFailure(interaction);
            }
            return;
        }

        const [action, registrationId, guestId] = interaction.customId.split(':');

        if (action === REGISTER_BUTTON_PREFIX && registrationId) {
            // For this custom ID the second segment carries the event ID
            const eventId = registrationId;
            try {
                await handleEventRegisterButton(interaction, eventId);
            } catch (err) {
                console.error('Event registration button error:', err);
                const failureMessage = { content: '❌ Fehler bei der Anmeldung.', flags: MessageFlags.Ephemeral };
                try {
                    if (interaction.deferred || interaction.replied) {
                        await interaction.editReply({ content: failureMessage.content });
                    } else {
                        await interaction.reply(failureMessage);
                    }
                } catch { /* interaction already expired */ }
            }
            return;
        }
        if ((action === 'guest_accept' || action === 'guest_decline') && registrationId && guestId) {
            // Only allow the invited user to respond
            if (interaction.user.id !== guestId) {
                return interaction.reply({ content: '❌ Diese Einladung ist nicht für dich.', flags: MessageFlags.Ephemeral });
            }
            try {
                const regRef = doc(db, 'registrations', registrationId);
                const regSnap = await getDoc(regRef);
                if (!regSnap.exists()) {
                    return interaction.update({ content: '❌ Registrierung nicht mehr vorhanden.', components: [] });
                }
                const reg = regSnap.data();

                // Find this guest in pendingGuests
                const pendingGuests = reg.pendingGuests || [];
                const guestIndex = pendingGuests.findIndex(g => g.userId === guestId);
                if (guestIndex === -1) {
                    return interaction.update({ content: '⚠️ Einladung bereits bearbeitet.', components: [] });
                }

                if (action === 'guest_accept') {
                    // Move from pendingGuests to guests
                    pendingGuests[guestIndex].status = 'accepted';
                    const guests = reg.guests || [];
                    if (!guests.includes(guestId)) guests.push(guestId);
                    await updateDoc(regRef, { pendingGuests, guests });

                    // Notify registrant
                    const inviteeName = pendingGuests[guestIndex].displayName || guestId;
                    await sendDM(reg.userId, `✅ **${inviteeName}** hat deine Gäste-Einladung für das Event angenommen!`);

                    // Send configured acceptance message to the guest
                    try {
                        const eventSnap = await getDoc(doc(db, 'events', reg.eventId));
                        const event = eventSnap.exists() ? eventSnap.data() : {};
                        const templateSnap = await getDoc(doc(db, 'botMessages', 'templates'));
                        const globalTemplates = templateSnap.exists() ? templateSnap.data() : {};
                        const customMsgs = event.customBotMessages || {};
                        const eventUrl = buildEventUrl(reg.eventId);
                        const vars = {
                            'user.id': guestId,
                            'user.name': inviteeName,
                            'user.mention': `<@${guestId}>`,
                            'event.title': event.title || 'Unbekanntes Event',
                            'event.url': eventUrl,
                            'role.name': '',
                            'role.mention': ''
                        };
                        const template = customMsgs.accepted || globalTemplates.accepted;
                        const msg = template
                            ? parseTemplate(template, vars)
                            : `✅ Du wurdest als Gast für **${event.title || 'das Event'}** eingetragen!`;
                        await sendDM(guestId, msg);
                    } catch (msgErr) {
                        console.error('Failed to send guest acceptance message:', msgErr);
                    }

                    await interaction.update({
                        embeds: [new EmbedBuilder()
                            .setTitle('✅ Einladung angenommen')
                            .setColor(0x22c55e)
                            .setDescription('Du wurdest als Gast eingetragen. Viel Spaß beim Event!')
                        ],
                        components: []
                    });
                } else {
                    // Remove from pendingGuests
                    pendingGuests.splice(guestIndex, 1);
                    await updateDoc(regRef, { pendingGuests });
                    // The open invitation no longer reserves a place
                    require('./utils/announcementRefresh').notifyRegistrationsChanged(reg.eventId);

                    // Notify registrant
                    await sendDM(reg.userId, `❌ Deine Gäste-Einladung wurde abgelehnt.`);

                    await interaction.update({
                        embeds: [new EmbedBuilder()
                            .setTitle('❌ Einladung abgelehnt')
                            .setColor(0xef4444)
                            .setDescription('Du hast die Einladung abgelehnt.')
                        ],
                        components: []
                    });
                }
            } catch (err) {
                console.error('Guest invitation button error:', err);
                try { await interaction.reply({ content: '❌ Fehler beim Verarbeiten der Einladung.', flags: MessageFlags.Ephemeral }); } catch {}
            }
            return;
        }
    }

    if (!interaction.isChatInputCommand()) return;
    commandsProcessedCount++;

    // /events command
    if (interaction.commandName === 'events') {
        try {
            // Fetch active events without orderBy to avoid composite index
            const q = query(collection(db, 'events'), where('status', '==', 'active'));
            const snapshot = await getDocs(q);

            if (snapshot.empty) {
                return interaction.reply({ content: '📭 Keine aktiven Events vorhanden.', flags: MessageFlags.Ephemeral });
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

            const embeds = [];
            const maxEmbeds = Math.min(events.length, 10); // Max 10 embeds per message

            for (let i = 0; i < maxEmbeds; i++) {
                const ev = events[i];
                const embed = new EmbedBuilder()
                    .setTitle(ev.title)
                    .setColor(0x8b5cf6)
                    .setDescription((ev.description || '').substring(0, 200))
                    .addFields(
                        { name: '📅 Datum', value: ev.startDate ? new Date(ev.startDate).toLocaleString('de-DE', { timeZone: TIMEZONE }) : 'TBD', inline: true },
                        { name: '👥 Plätze', value: ev.maxParticipants > 0 ? `${ev.currentParticipants || 0}/${ev.maxParticipants}` : 'Unbegrenzt', inline: true },
                        { name: '🔗 Link', value: `[Zur Anmeldung](${buildEventUrl(ev.id)})`, inline: true }
                    );
                if (ev.category) embed.setFooter({ text: ev.category });
                embeds.push(embed);
            }

            await interaction.reply({ embeds });
        } catch (err) {
            console.error('Slash /events error:', err);
            await interaction.reply({ content: '❌ Fehler beim Laden der Events.', flags: MessageFlags.Ephemeral });
        }
    }

    // /register command - DISABLED: Redirect to website for security
    if (interaction.commandName === 'register') {
        try {
            const eventId = interaction.options.getString('event');
            const eventSnap = await getDoc(doc(db, 'events', eventId));

            if (!eventSnap.exists()) {
                return interaction.reply({ content: '❌ Event nicht gefunden.', flags: MessageFlags.Ephemeral });
            }

            const event = eventSnap.data();
            const registrationUrl = buildEventUrl(eventId);

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

            await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        } catch (err) {
            console.error('Slash /register error:', err);
            await interaction.reply({ content: '❌ Fehler.', flags: MessageFlags.Ephemeral });
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
                return interaction.reply({ content: '❌ Event nicht gefunden.', flags: MessageFlags.Ephemeral });
            }

            const event = eventSnap.data();

            const { unregisterUserFromEvent } = require('./utils/registrationService');
            const result = await unregisterUserFromEvent({ eventId, userId });
            if (!result.ok) {
                return interaction.reply({ content: `⚠️ ${result.error}`, flags: MessageFlags.Ephemeral });
            }

            const embed = new EmbedBuilder()
                .setTitle('✅ Abmeldung erfolgreich')
                .setColor(0x22c55e)
                .setDescription(`Du wurdest erfolgreich von **${event.title}** abgemeldet.`)
                .setTimestamp();

            await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        } catch (err) {
            console.error('Slash /unregister error:', err);
            await interaction.reply({ content: '❌ Fehler bei der Abmeldung.', flags: MessageFlags.Ephemeral });
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
    debugLog('bot.sendDM', { userId, messageType: typeof message === 'string' ? 'text' : 'embed' });
    try {
        const user = await client.users.fetch(userId);
        await user.send(message);
        dmsSentCount++;
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
 * @param {ActionRowBuilder[]} [options.components] - Button rows below the embed
 * @returns {Promise<Object|false>} -> { channelId, messageId } of the sent message, false on failure.
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

        const message = await channel.send({
            content,
            embeds: [embed],
            components: options.components || [],
            allowedMentions: {
                parse: options.pingEveryone ? ['everyone', 'roles'] : ['roles'],
                roles: options.roleIds || []
            }
        });
        console.log(`📢 Announcement sent to channel ${channelId}`);
        return { channelId: channel.id, messageId: message.id };
    } catch (err) {
        console.error(`Failed to send channel message:`, err.message);
        return false;
    }
}

/**
 * Build an event announcement embed.
 *
 * With a roster the embed shows live numbers: the participant count and,
 * for slot events, one field per slot with the first names.
 *
 * @param {Object} event -> Event data.
 * @param {string} [registrationLink] -> Link to the event page.
 * @param {Object} [roster] -> Line-up from loadEventRoster().
 * @returns {EmbedBuilder} -> The embed.
 */
function buildEventEmbed(event, registrationLink, roster) {
    const embed = new EmbedBuilder()
        .setColor(0x8b5cf6)
        .setTitle(`🎉 ${event.title}`)
        .setDescription(event.description || 'Keine Beschreibung.')
        .addFields(
            { name: '🗓️ Datum', value: event.startDate ? new Date(event.startDate).toLocaleString('de-DE', { timeZone: TIMEZONE }) : 'TBA', inline: true },
            { name: '👥 Teilnehmer', value: formatParticipantCount(event, roster), inline: true },
            { name: '🔓 Zugang', value: event.accessMode === 'open' ? 'Offen für alle' : 'Rollen-Requirement', inline: true }
        )
        .setFooter({ text: 'DEMS — Event Management' })
        .setTimestamp();

    if (roster && roster.slots.length > 0) {
        roster.slots.forEach(slot => {
            embed.addFields({ name: formatRosterSlotTitle(slot), value: formatRosterMembers(slot), inline: true });
        });
        if (roster.waitlistCount > 0) {
            embed.addFields({ name: '⏳ Warteliste', value: String(roster.waitlistCount), inline: true });
        }
    }

    if (event.bannerUrl) {
        embed.setImage(event.bannerUrl);
    }

    if (event.category) {
        embed.addFields({ name: '🏷️ Kategorie', value: event.category, inline: true });
    }

    if (registrationLink) {
        embed.addFields({ name: '📋 Anmeldung', value: `[Hier anmelden](${registrationLink})`, inline: false });
    }

    return embed;
}

/**
 * Participant field of the embed.
 *
 * @param {Object} event -> Event data.
 * @param {Object} [roster] -> Line-up with live numbers.
 * @returns {string} -> "3/10", "3 (unbegrenzt)" or the static capacity.
 */
function formatParticipantCount(event, roster) {
    if (!roster) return event.maxParticipants > 0 ? `Max. ${event.maxParticipants}` : 'Unbegrenzt';
    return roster.capacity > 0 ? `${roster.taken}/${roster.capacity}` : `${roster.taken} (unbegrenzt)`;
}

/**
 * Field title of one slot, e.g. "🛡️ Tank 2/2 ✅".
 *
 * @param {Object} slot -> Roster slot.
 * @returns {string} -> Title with ✅ when full and ⚠️ when overbooked.
 */
function formatRosterSlotTitle(slot) {
    let marker = '';
    if (slot.taken > slot.capacity) marker = ' ⚠️';
    else if (slot.taken === slot.capacity) marker = ' ✅';
    return `${formatSlotLabel(slot)} ${slot.taken}/${slot.capacity}${marker}`;
}

/**
 * Field value of one slot: the first names, then "+N".
 *
 * @param {Object} slot -> Roster slot.
 * @returns {string} -> Names, escaped for Discord markdown.
 */
function formatRosterMembers(slot) {
    if (slot.members.length === 0) return '— frei —';
    const names = slot.members.slice(0, ROSTER_NAMES_MAX).map(member => escapeMarkdown(member.displayName));
    const hidden = slot.members.length - ROSTER_NAMES_MAX;
    return hidden > 0 ? `${names.join(', ')}, +${hidden}` : names.join(', ');
}

/**
 * Check whether an event can be joined directly from Discord.
 *
 * Events without a form are always joinable. Events with a form are joinable
 * as long as the form fits into a Discord modal -> at most five fields, each
 * of a known field type.
 *
 * @param {Object} event -> The event document data.
 * @returns {boolean} -> True when the "Anmelden" button may be shown.
 * @example
 * if (canRegisterViaDiscord(event)) row.addComponents(registerButton);
 */
function canRegisterViaDiscord(event) {
    if (!event) return false;
    if (event.status && event.status !== 'active') return false;
    return fitsIntoDiscordModal(event);
}

/**
 * Build the button rows that are attached to an event announcement.
 *
 * Slot events get one button per slot, normal events the "Anmelden" button,
 * both only while the event can be joined from Discord. The link button is
 * always the last button.
 *
 * @param {Object} event -> The event document data.
 * @param {string} eventId -> The event document ID.
 * @param {Object} [roster] -> Line-up, marks full slots.
 * @returns {ActionRowBuilder[]} -> Components array ready for channel.send().
 * @example
 * await channel.send({ embeds: [embed], components: buildEventComponents(event, eventId, roster) });
 */
function buildEventComponents(event, eventId, roster) {
    const buttons = [];

    if (canRegisterViaDiscord(event)) {
        if (hasSlots(event)) {
            getSlots(event).forEach(slot => buttons.push(buildSlotButton(eventId, slot, roster)));
        } else {
            buttons.push(
                new ButtonBuilder()
                    .setCustomId(`${REGISTER_BUTTON_PREFIX}:${eventId}`)
                    .setLabel('Anmelden')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅')
            );
        }
    }

    buttons.push(
        new ButtonBuilder()
            .setLabel('Zum Event')
            .setStyle(ButtonStyle.Link)
            .setURL(buildEventUrl(eventId))
            .setEmoji('🔗')
    );

    const rows = [];
    for (let index = 0; index < buttons.length; index += BUTTONS_PER_ROW) {
        rows.push(new ActionRowBuilder().addComponents(...buttons.slice(index, index + BUTTONS_PER_ROW)));
    }
    return rows;
}

/**
 * Build the button of one slot.
 *
 * Full slots stay clickable -> the click can still lead to a fallback role
 * or the waitlist.
 *
 * @param {string} eventId -> The event document ID.
 * @param {Object} slot -> The slot.
 * @param {Object} [roster] -> Line-up with the taken places.
 * @returns {ButtonBuilder} -> The slot button.
 */
function buildSlotButton(eventId, slot, roster) {
    const rosterSlot = roster ? roster.slots.find(entry => entry.id === slot.id) : null;
    const isFull = !!rosterSlot && rosterSlot.taken >= slot.capacity;
    const button = new ButtonBuilder()
        .setCustomId(`${SLOT_BUTTON_PREFIX}:${eventId}:${slot.id}`)
        .setLabel(isFull ? `${slot.name} (voll)` : slot.name)
        .setStyle(isFull ? ButtonStyle.Secondary : ButtonStyle.Primary);
    if (slot.emoji) button.setEmoji(slot.emoji);
    return button;
}

// Discord error codes for "Unknown Channel" and "Unknown Message"
const DISCORD_GONE_ERROR_CODES = [10003, 10008];

/**
 * Whether a Discord API error means the channel or message no longer exists.
 *
 * @param {*} err -> Error thrown by discord.js.
 * @returns {boolean} -> True for deleted channels or messages.
 */
function isGoneDiscordError(err) {
    return !!err && DISCORD_GONE_ERROR_CODES.includes(err.code);
}

/**
 * Re-render every stored announcement of an event with the live line-up.
 *
 * Deleted messages are dropped from `event.announcements`; other errors are
 * logged and the message is kept for the next attempt.
 *
 * @param {string} eventId -> The event document ID.
 * @returns {Promise<boolean>} -> True when announcements were processed.
 */
async function refreshEventAnnouncements(eventId) {
    if (!isReady) return false;
    try {
        const eventSnap = await getDoc(doc(db, 'events', eventId));
        if (!eventSnap.exists()) return false;

        const event = eventSnap.data();
        const announcements = Array.isArray(event.announcements) ? event.announcements : [];
        if (announcements.length === 0) return false;

        const { loadEventRoster } = require('./utils/eventUtils');
        const roster = await loadEventRoster(eventId, event);
        const embed = buildEventEmbed(event, buildEventUrl(eventId), roster);
        const components = buildEventComponents(event, eventId, roster);

        const kept = [];
        for (const announcement of announcements) {
            try {
                const channel = await client.channels.fetch(announcement.channelId);
                const message = await channel.messages.fetch(announcement.messageId);
                await message.edit({ embeds: [embed], components });
                kept.push(announcement);
            } catch (err) {
                if (isGoneDiscordError(err)) continue;
                console.error('Failed to refresh announcement:', err.message);
                kept.push(announcement);
            }
        }

        if (kept.length !== announcements.length) {
            await updateDoc(doc(db, 'events', eventId), { announcements: kept });
        }
        return true;
    } catch (err) {
        console.error('refreshEventAnnouncements failed:', err.message);
        return false;
    }
}

/**
 * Build the custom ID of a modal field.
 *
 * @param {number} index -> Index of the form field.
 * @returns {string} -> Custom ID used inside the modal.
 */
function buildFieldCustomId(index) {
    return `${MODAL_FIELD_PREFIX}:${index}`;
}

/**
 * Build the info text shown at the top of the registration modal.
 *
 * @param {Object} event -> The event document data.
 * @returns {TextDisplayBuilder} -> Text display component with markdown content.
 */
function buildModalIntro(event) {
    const lines = [`### ${event.title}`];

    if (event.startDate) {
        lines.push(`📅 ${new Date(event.startDate).toLocaleString('de-DE', { timeZone: TIMEZONE })}`);
    }
    if (event.maxParticipants > 0) {
        lines.push(`👥 Maximal ${event.maxParticipants} Teilnehmer`);
    }
    lines.push('-# Deine Angaben werden direkt im Event-System gespeichert.');

    return new TextDisplayBuilder().setContent(lines.join('\n'));
}

/**
 * Build the description line of a label component.
 *
 * @param {Object} field -> The form field definition.
 * @returns {string} -> Description text for the label.
 */
function buildFieldDescription(field) {
    if (field.description) {
        return String(field.description).substring(0, MODAL_DESCRIPTION_MAX_LENGTH);
    }
    return field.required ? 'Pflichtfeld' : 'Optional';
}

/**
 * Apply the selection constraints shared by every modal select menu.
 *
 * Discord rejects a select that is marked as required but still allows zero
 * values, so both flags are always set together -> required selects need at
 * least one value, optional ones must not be marked required.
 *
 * @param {Object} select -> The select menu builder to configure.
 * @param {boolean} required -> Whether the field has to be answered.
 * @returns {Object} -> The same builder, for chaining.
 */
function applySelectConstraints(select, required) {
    return select
        .setRequired(required)
        .setMinValues(required ? 1 : 0)
        .setMaxValues(1);
}

/**
 * Build the input component of a single form field.
 *
 * Every field type is mapped onto the component Discord provides for it:
 * text fields become text inputs, dropdowns and checkboxes become string
 * selects and the entity fields become user, role, channel or mentionable
 * selects.
 *
 * @param {LabelBuilder} label -> The label the component belongs to.
 * @param {Object} field -> The form field definition.
 * @param {number} index -> Index of the form field.
 * @returns {LabelBuilder} -> The label with its component set.
 */
function applyFieldComponent(label, field, index) {
    const customId = buildFieldCustomId(index);
    const required = !!field.required;
    const type = getFieldType(field);
    const options = Array.isArray(field.options) ? field.options.filter(Boolean) : [];

    switch (type) {
        case FORM_FIELD_TYPE.TEXTAREA:
            return label.setTextInputComponent(
                new TextInputBuilder()
                    .setCustomId(customId)
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(required)
            );

        case FORM_FIELD_TYPE.DROPDOWN:
            // A select needs at least one option -> fall back to free text otherwise
            if (options.length === 0) break;
            return label.setStringSelectMenuComponent(
                applySelectConstraints(new StringSelectMenuBuilder(), required)
                    .setCustomId(customId)
                    .setPlaceholder('Bitte wählen')
                    .addOptions(options.map((option, optionIndex) => ({
                        label: String(option).substring(0, SELECT_OPTION_LABEL_MAX_LENGTH),
                        value: String(optionIndex)
                    })))
            );

        case FORM_FIELD_TYPE.CHECKBOX:
            return label.setStringSelectMenuComponent(
                applySelectConstraints(new StringSelectMenuBuilder(), required)
                    .setCustomId(customId)
                    .setPlaceholder(required ? 'Zum Bestätigen "Ja" wählen' : 'Ja oder Nein')
                    .addOptions([
                        { label: 'Ja', value: CHECKBOX_VALUE_YES },
                        { label: 'Nein', value: CHECKBOX_VALUE_NO }
                    ])
            );

        case FORM_FIELD_TYPE.USER:
            return label.setUserSelectMenuComponent(
                applySelectConstraints(new UserSelectMenuBuilder(), required)
                    .setCustomId(customId)
                    .setPlaceholder('Mitglied auswählen')
            );

        case FORM_FIELD_TYPE.ROLE:
            return label.setRoleSelectMenuComponent(
                applySelectConstraints(new RoleSelectMenuBuilder(), required)
                    .setCustomId(customId)
                    .setPlaceholder('Rolle auswählen')
            );

        case FORM_FIELD_TYPE.CHANNEL:
            return label.setChannelSelectMenuComponent(
                applySelectConstraints(new ChannelSelectMenuBuilder(), required)
                    .setCustomId(customId)
                    .setChannelTypes(SELECTABLE_CHANNEL_TYPES)
                    .setPlaceholder('Channel auswählen')
            );

        case FORM_FIELD_TYPE.MENTIONABLE:
            return label.setMentionableSelectMenuComponent(
                applySelectConstraints(new MentionableSelectMenuBuilder(), required)
                    .setCustomId(customId)
                    .setPlaceholder('Mitglied oder Rolle auswählen')
            );

        default:
            break;
    }

    return label.setTextInputComponent(
        new TextInputBuilder()
            .setCustomId(customId)
            .setStyle(TextInputStyle.Short)
            .setRequired(required)
            .setPlaceholder(String(field.label).substring(0, MODAL_PLACEHOLDER_MAX_LENGTH))
    );
}

/**
 * Add one label per form field to a modal.
 *
 * @param {ModalBuilder} modal -> The modal to extend.
 * @param {Array<Object>} fields -> Form fields that fit into the modal.
 * @returns {void}
 */
function addFormFieldLabels(modal, fields) {
    fields.forEach((field, index) => {
        const label = new LabelBuilder()
            .setLabel(String(field.label).substring(0, MODAL_LABEL_MAX_LENGTH))
            .setDescription(buildFieldDescription(field));

        modal.addLabelComponents(applyFieldComponent(label, field, index));
    });
}

/**
 * Build the registration modal for an event form.
 *
 * The modal shows one label per form field, each carrying the component that
 * matches the field type. A text display repeating the event data is put in
 * front of them whenever the form leaves a component slot free -> Discord
 * counts it as one of the five top level components of the modal.
 *
 * @param {Object} event -> The event document data.
 * @param {string} eventId -> The event document ID.
 * @returns {ModalBuilder} -> Modal ready for interaction.showModal().
 * @example
 * await interaction.showModal(buildRegistrationModal(event, eventId));
 */
function buildRegistrationModal(event, eventId) {
    const modal = new ModalBuilder()
        .setCustomId(`${REGISTER_MODAL_PREFIX}:${eventId}`)
        .setTitle(`Anmeldung: ${event.title}`.substring(0, MODAL_TITLE_MAX_LENGTH));

    const fields = getFormFields(event).slice(0, getModalFieldLimit(event));

    // The intro shares the five top level component slots with the fields ->
    // it is only added while a slot is left over, otherwise Discord rejects
    // the modal with error 50035.
    if (fields.length < MODAL_MAX_FIELDS) {
        modal.addTextDisplayComponents(buildModalIntro(event));
    }

    addFormFieldLabels(modal, fields);

    return modal;
}

/**
 * Build the registration modal behind a slot button.
 *
 * It starts with a select for the fallback roles (all other slots) when the
 * event has more than one slot, followed by the form fields. The intro text
 * is only added while one of the five component places is left.
 *
 * @param {Object} event -> The event document data.
 * @param {string} eventId -> The event document ID.
 * @param {Object} slot -> The slot the user clicked.
 * @returns {ModalBuilder} -> Modal ready for interaction.showModal().
 */
function buildSlotModal(event, eventId, slot) {
    const modal = new ModalBuilder()
        .setCustomId(`${SLOT_MODAL_PREFIX}:${eventId}:${slot.id}`)
        .setTitle(`${slot.name}: ${event.title}`.substring(0, MODAL_TITLE_MAX_LENGTH));

    const otherSlots = getSlots(event).filter(entry => entry.id !== slot.id);
    const fields = getFormFields(event).slice(0, getModalFieldLimit(event));
    const usedComponents = fields.length + (otherSlots.length > 0 ? 1 : 0);

    if (usedComponents < MODAL_MAX_FIELDS) {
        modal.addTextDisplayComponents(buildModalIntro(event));
    }

    if (otherSlots.length > 0) {
        const select = new StringSelectMenuBuilder()
            .setCustomId(ALT_SLOTS_FIELD_ID)
            .setPlaceholder('Keine Ausweichrolle')
            .setRequired(false)
            .setMinValues(0)
            .setMaxValues(otherSlots.length)
            .addOptions(otherSlots.map(entry => ({
                label: entry.name,
                value: entry.id,
                ...(entry.emoji ? { emoji: { name: entry.emoji } } : {})
            })));
        modal.addLabelComponents(
            new LabelBuilder()
                .setLabel('Ausweichrollen (optional)')
                .setDescription(`Falls ${slot.name} voll ist, wirst du hier eingeplant.`.substring(0, MODAL_DESCRIPTION_MAX_LENGTH))
                .setStringSelectMenuComponent(select)
        );
    }

    addFormFieldLabels(modal, fields);
    return modal;
}

/**
 * Read the fallback roles chosen in a slot modal.
 *
 * @param {import('discord.js').ModalSubmitInteraction} interaction -> The submitted modal.
 * @returns {string[]} -> Selected slot IDs, empty when the select is missing.
 */
function readAltSlotIds(interaction) {
    try {
        return interaction.fields.getStringSelectValues(ALT_SLOTS_FIELD_ID) || [];
    } catch {
        return [];
    }
}

/**
 * Answer for a member who clicks a slot button while already registered.
 *
 * @param {Object} event -> The event document data.
 * @param {string} eventId -> The event document ID.
 * @param {Object} registration -> The member's registration.
 * @param {Object} clickedSlot -> The slot behind the clicked button.
 * @param {Array<Object>} registrations -> All registrations of the event.
 * @returns {Object} -> Ephemeral reply payload.
 */
function buildRegisteredSlotReply(event, eventId, registration, clickedSlot, registrations) {
    const slots = getSlots(event);

    if (registration.status === 'rejected') {
        return {
            content: `❌ Deine Anmeldung für **${event.title}** wurde abgelehnt.`,
            components: [],
            flags: MessageFlags.Ephemeral
        };
    }

    const current = findSlot(slots, registration.slotId);
    const content = registration.status === 'waitlisted' || !current
        ? `⏳ Du stehst für **${event.title}** auf der Warteliste.`
        : `Du bist für **${event.title}** als **${formatSlotLabel(current)}** eingeplant${registration.status === 'pending' ? ' (Anfrage ausstehend)' : ''}.`;

    const row = new ActionRowBuilder();
    const canSwitch = clickedSlot.id !== registration.slotId
        && hasFreePlace(clickedSlot, countSlotOccupancy(slots, registrations));
    if (canSwitch) {
        const switchButton = new ButtonBuilder()
            .setCustomId(`${SLOT_SWITCH_PREFIX}:${eventId}:${clickedSlot.id}`)
            .setLabel(`Zu ${clickedSlot.name} wechseln`)
            .setStyle(ButtonStyle.Primary);
        if (clickedSlot.emoji) switchButton.setEmoji(clickedSlot.emoji);
        row.addComponents(switchButton);
    }
    row.addComponents(
        new ButtonBuilder()
            .setCustomId(`${SLOT_LEAVE_PREFIX}:${eventId}`)
            .setLabel('Abmelden')
            .setStyle(ButtonStyle.Danger)
    );

    return { content, components: [row], flags: MessageFlags.Ephemeral };
}

/**
 * Read the display name of a selected guild member.
 *
 * @param {Object} user -> The selected Discord user.
 * @param {Object|null} member -> The matching guild member, when resolved.
 * @returns {string} -> Nickname, global name or username.
 */
function resolveSelectedUserName(user, member) {
    if (member) {
        if (member.displayName) return member.displayName;
        if (member.nick) return member.nick;
    }
    return user.globalName || user.username || user.id;
}

/**
 * Read the answer of a single modal field.
 *
 * @param {import('discord.js').ModalSubmitInteraction} interaction -> The submitted modal.
 * @param {Object} field -> The form field definition.
 * @param {number} index -> Index of the form field.
 * @returns {{ value: (string|boolean), error: (string|null) }} -> Answer and validation error.
 */
function readModalField(interaction, field, index) {
    const customId = buildFieldCustomId(index);
    const type = getFieldType(field);
    const { fields } = interaction;

    if (type === FORM_FIELD_TYPE.DROPDOWN) {
        const options = Array.isArray(field.options) ? field.options.filter(Boolean) : [];
        if (options.length === 0) {
            return { value: (fields.getTextInputValue(customId) || '').trim(), error: null };
        }
        const [selected] = fields.getStringSelectValues(customId) || [];
        if (selected === undefined) return { value: '', error: null };
        const option = options[Number(selected)];
        if (option === undefined) {
            return { value: '', error: `"${field.label}": Die Auswahl ist nicht mehr verfügbar.` };
        }
        return { value: option, error: null };
    }

    if (type === FORM_FIELD_TYPE.CHECKBOX) {
        const [selected] = fields.getStringSelectValues(customId) || [];
        const value = selected === CHECKBOX_VALUE_YES;
        if (field.required && !value) {
            return { value, error: `"${field.label}": Bitte mit "Ja" bestätigen.` };
        }
        return { value, error: null };
    }

    if (type === FORM_FIELD_TYPE.USER) {
        const users = fields.getSelectedUsers(customId);
        const user = users ? users.first() : null;
        if (!user) return { value: '', error: null };
        const members = fields.getSelectedMembers(customId);
        const member = members ? members.get(user.id) : null;
        return { value: formatEntityAnswer(type, resolveSelectedUserName(user, member), user.id), error: null };
    }

    if (type === FORM_FIELD_TYPE.ROLE) {
        const roles = fields.getSelectedRoles(customId);
        const role = roles ? roles.first() : null;
        if (!role) return { value: '', error: null };
        return { value: formatEntityAnswer(type, role.name, role.id), error: null };
    }

    if (type === FORM_FIELD_TYPE.CHANNEL) {
        const channels = fields.getSelectedChannels(customId);
        const channel = channels ? channels.first() : null;
        if (!channel) return { value: '', error: null };
        return { value: formatEntityAnswer(type, channel.name, channel.id), error: null };
    }

    if (type === FORM_FIELD_TYPE.MENTIONABLE) {
        const mentionables = fields.getSelectedMentionables(customId);
        const user = mentionables && mentionables.users ? mentionables.users.first() : null;
        if (user) {
            const member = mentionables.members ? mentionables.members.get(user.id) : null;
            return { value: formatEntityAnswer(type, resolveSelectedUserName(user, member), user.id), error: null };
        }
        const role = mentionables && mentionables.roles ? mentionables.roles.first() : null;
        if (role) {
            return { value: formatEntityAnswer(type, role.name, role.id), error: null };
        }
        return { value: '', error: null };
    }

    return { value: (fields.getTextInputValue(customId) || '').trim(), error: null };
}

/**
 * Convert the modal input into form answers of the web interface format.
 *
 * Text stays a string, dropdown answers are mapped back onto the configured
 * option, checkboxes become booleans and selected users, roles or channels
 * become a readable reference including their ID -> the result looks exactly
 * like an answer set submitted through the website.
 *
 * @param {import('discord.js').ModalSubmitInteraction} interaction -> The submitted modal.
 * @param {Object} event -> The event document data.
 * @returns {{ answers: Object, errors: string[] }} -> Parsed answers and validation errors.
 */
function parseModalAnswers(interaction, event) {
    const answers = {};
    const errors = [];

    getFormFields(event).slice(0, getModalFieldLimit(event)).forEach((field, index) => {
        const type = getFieldType(field);
        try {
            const { value, error } = readModalField(interaction, field, index);
            answers[field.label] = value;
            if (error) errors.push(error);
        } catch (err) {
            // A field can be missing when the form was changed while the modal was open
            debugLog('bot.readModalField', { label: field.label, error: err.message });
            answers[field.label] = type === FORM_FIELD_TYPE.CHECKBOX ? false : '';
        }
    });

    return { answers, errors };
}

/**
 * Read the Discord role IDs of the interacting member.
 *
 * @param {import('discord.js').Interaction} interaction -> The interaction to inspect.
 * @returns {Promise<string[]>} -> Role IDs of the member, empty when unknown.
 */
async function resolveInteractionRoles(interaction) {
    const member = interaction.member;
    if (member && member.roles && member.roles.cache) {
        return member.roles.cache.map(role => role.id);
    }
    if (member && Array.isArray(member.roles)) {
        return member.roles;
    }
    const roles = await getUserRoles(interaction.user.id, process.env.DISCORD_GUILD_ID);
    return roles.map(role => role.id);
}

/**
 * Make sure the Discord user exists in the users collection.
 *
 * Users that register from Discord may never have logged into the web
 * interface -> without a profile they would show up without name and avatar
 * in the participant list.
 *
 * @param {import('discord.js').User} user -> The Discord user.
 * @param {string} displayName -> Display name to store.
 * @returns {Promise<void>} -> Resolves once the profile was written.
 */
async function ensureUserProfile(user, displayName) {
    try {
        const userRef = doc(db, 'users', user.id);
        const userSnap = await getDoc(userRef);
        const avatarUrl = typeof user.displayAvatarURL === 'function'
            ? user.displayAvatarURL({ extension: 'png', size: 128 })
            : '';
        const now = new Date().toISOString();

        if (!userSnap.exists()) {
            await setDoc(userRef, {
                id: user.id,
                username: user.username,
                displayName,
                avatar: avatarUrl,
                acceptInvitations: true,
                createdAt: now,
                updatedAt: now
            });
            return;
        }

        await updateDoc(userRef, {
            username: user.username,
            displayName,
            avatar: avatarUrl,
            updatedAt: now
        });
    } catch (err) {
        console.error('Failed to store user profile:', err.message);
    }
}

/**
 * Check the conditions that can be verified before the modal is shown.
 *
 * @param {Object} params -> Check input.
 * @param {Object} params.event -> The event document data.
 * @param {string} params.eventId -> The event document ID.
 * @param {string} params.userId -> Discord user ID.
 * @param {string[]} params.roleIds -> Discord role IDs of the user.
 * @returns {Promise<string|null>} -> Error message, or null when all conditions match.
 */
async function checkRegistrationConditions({ event, eventId, userId, roleIds }) {
    if (await isRegistrationBlocked()) {
        return 'Event-Registrierungen sind wegen Wartungsarbeiten vorübergehend deaktiviert.';
    }

    if (event.status && event.status !== 'active') {
        return 'Dieses Event akzeptiert keine Anmeldungen.';
    }

    const existingQ = query(
        collection(db, 'registrations'),
        where('eventId', '==', eventId),
        where('userId', '==', userId)
    );
    const existingSnap = await getDocs(existingQ);
    if (!existingSnap.empty) {
        return 'Du bist bereits für dieses Event registriert.';
    }

    if (event.accessMode === 'role-required' && Array.isArray(event.requiredRoles) && event.requiredRoles.length > 0) {
        const hasRole = event.requiredRoles.some(roleId => roleIds.includes(roleId));
        if (!hasRole) {
            return 'Du hast nicht die erforderliche Rolle für dieses Event.';
        }
    }

    return null;
}

/**
 * Create the registration and answer the interaction with the result.
 *
 * @param {import('discord.js').Interaction} interaction -> Button or modal interaction.
 * @param {Object} params -> Registration input.
 * @param {string} params.eventId -> The event document ID.
 * @param {Object} params.event -> The event document data.
 * @param {string[]} params.roleIds -> Discord role IDs of the user.
 * @param {Object} params.formAnswers -> Answers keyed by form field label.
 * @returns {Promise<void>} -> Resolves once the interaction was answered.
 */
async function completeDiscordRegistration(interaction, { eventId, event, roleIds, formAnswers, slotId = null, altSlotIds = [] }) {
    const { registerUserForEvent, REGISTRATION_SOURCE } = require('./utils/registrationService');
    const displayName = interaction.member?.displayName
        || interaction.user.globalName
        || interaction.user.username;

    const pendingKey = `${eventId}:${interaction.user.id}`;
    if (pendingDiscordRegistrations.has(pendingKey)) {
        await interaction.editReply({ content: '⏳ Deine Anmeldung wird bereits verarbeitet.' });
        return;
    }
    pendingDiscordRegistrations.add(pendingKey);

    let result;
    try {
        result = await registerUserForEvent({
            eventId,
            user: { id: interaction.user.id, displayName, roles: roleIds },
            formAnswers,
            guests: [],
            source: REGISTRATION_SOURCE.DISCORD,
            slotId,
            altSlotIds
        });
    } finally {
        pendingDiscordRegistrations.delete(pendingKey);
    }

    if (!result.ok) {
        await interaction.editReply({ content: `❌ ${result.error}` });
        return;
    }

    // Store the profile so the participant shows up with name and avatar in the web interface
    await ensureUserProfile(interaction.user, displayName);

    const slots = getSlots(event);
    const slot = findSlot(slots, result.slotId);
    const wantedSlot = findSlot(slots, slotId);
    const placement = slot ? ` als **${formatSlotLabel(slot)}**` : '';
    const altNote = result.isAlt && wantedSlot ? ` (${formatSlotLabel(wantedSlot)} war voll)` : '';
    const statusDescriptions = {
        accepted: `Du bist für **${event.title}**${placement} angemeldet${altNote}. Deine Anmeldung ist ab sofort auch im Event-System sichtbar.`,
        pending: `Deine Anfrage für **${event.title}**${placement}${altNote} ist eingegangen und wartet auf Bestätigung. Du siehst den Status im Event-System.`,
        waitlisted: slots.length > 0
            ? `Für **${event.title}** sind gerade alle gewünschten Slots belegt — du stehst auf der Warteliste und rückst automatisch nach.`
            : `**${event.title}** ist aktuell voll — du stehst auf der Warteliste und rückst automatisch nach.`
    };
    const statusColors = { accepted: 0x22c55e, pending: 0xf59e0b, waitlisted: 0x8b5cf6 };
    const statusTitles = {
        accepted: '✅ Anmeldung bestätigt',
        pending: '📋 Anfrage eingegangen',
        waitlisted: '🕒 Auf der Warteliste'
    };

    const embed = new EmbedBuilder()
        .setTitle(statusTitles[result.status] || '✅ Anmeldung')
        .setColor(statusColors[result.status] || 0x8b5cf6)
        .setDescription(statusDescriptions[result.status] || result.message)
        .addFields({ name: '🔗 Event-Seite', value: `[Zur Übersicht](${buildEventUrl(eventId)})` })
        .setFooter({ text: 'DEMS — Event Management' })
        .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
}

/**
 * Handle a click on the "Anmelden" button of an event announcement.
 *
 * All conditions are checked before a form is shown, so nobody fills in a
 * modal just to be rejected afterwards.
 *
 * @param {import('discord.js').ButtonInteraction} interaction -> The button interaction.
 * @param {string} eventId -> The event document ID from the custom ID.
 * @returns {Promise<void>} -> Resolves once the interaction was answered.
 */
async function handleEventRegisterButton(interaction, eventId) {
    debugLog('bot.registerButton', { eventId, userId: interaction.user.id });

    const eventSnap = await getDoc(doc(db, 'events', eventId));
    if (!eventSnap.exists()) {
        return interaction.reply({ content: '❌ Event nicht gefunden.', flags: MessageFlags.Ephemeral });
    }

    const event = eventSnap.data();
    const roleIds = await resolveInteractionRoles(interaction);
    const conditionError = await checkRegistrationConditions({ event, eventId, userId: interaction.user.id, roleIds });

    if (conditionError) {
        return interaction.reply({ content: `❌ ${conditionError}`, flags: MessageFlags.Ephemeral });
    }

    const formFields = getFormFields(event);

    if (formFields.length > 0) {
        if (!fitsIntoDiscordModal(event)) {
            return interaction.reply({
                content: `📝 Für dieses Event ist das Formular zu umfangreich für Discord (max. ${MODAL_MAX_FIELDS} Felder). Bitte melde dich hier an: ${buildEventUrl(eventId)}`,
                flags: MessageFlags.Ephemeral
            });
        }
        return interaction.showModal(buildRegistrationModal(event, eventId));
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await completeDiscordRegistration(interaction, { eventId, event, roleIds, formAnswers: {} });
}

/**
 * Handle the submitted registration modal of an event.
 *
 * @param {import('discord.js').ModalSubmitInteraction} interaction -> The submitted modal.
 * @param {string} eventId -> The event document ID from the custom ID.
 * @returns {Promise<void>} -> Resolves once the interaction was answered.
 */
async function handleEventRegisterModal(interaction, eventId) {
    debugLog('bot.registerModal', { eventId, userId: interaction.user.id });

    const eventSnap = await getDoc(doc(db, 'events', eventId));
    if (!eventSnap.exists()) {
        return interaction.reply({ content: '❌ Event nicht gefunden.', flags: MessageFlags.Ephemeral });
    }

    const event = eventSnap.data();

    // The form may have been changed while the modal was open
    if (!canRegisterViaDiscord(event)) {
        return interaction.reply({
            content: `📝 Das Formular dieses Events hat sich geändert. Bitte melde dich hier an: ${buildEventUrl(eventId)}`,
            flags: MessageFlags.Ephemeral
        });
    }

    const { answers, errors } = parseModalAnswers(interaction, event);

    if (errors.length > 0) {
        return interaction.reply({
            content: `❌ Bitte korrigiere deine Angaben:\n${errors.map(e => `• ${e}`).join('\n')}`,
            flags: MessageFlags.Ephemeral
        });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const roleIds = await resolveInteractionRoles(interaction);
    const conditionError = await checkRegistrationConditions({ event, eventId, userId: interaction.user.id, roleIds });
    if (conditionError) {
        return interaction.editReply({ content: `❌ ${conditionError}` });
    }

    await completeDiscordRegistration(interaction, { eventId, event, roleIds, formAnswers: answers });
}

/**
 * Answer a failed interaction without throwing.
 *
 * @param {import('discord.js').Interaction} interaction -> The interaction.
 * @returns {Promise<void>}
 */
async function replyWithFailure(interaction) {
    const content = '❌ Fehler bei der Anmeldung.';
    try {
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content });
        } else {
            await interaction.reply({ content, flags: MessageFlags.Ephemeral });
        }
    } catch { /* interaction already expired */ }
}

/**
 * Handle a click on a slot button of an event announcement.
 *
 * Registered members get their status with switch/leave buttons; everybody
 * else is checked and gets the slot modal (or is registered directly when
 * there is nothing to ask).
 *
 * @param {import('discord.js').ButtonInteraction} interaction -> The button interaction.
 * @param {string} eventId -> The event document ID.
 * @param {string} slotId -> The clicked slot.
 * @returns {Promise<void>}
 */
async function handleEventSlotButton(interaction, eventId, slotId) {
    debugLog('bot.slotButton', { eventId, slotId, userId: interaction.user.id });

    const eventSnap = await getDoc(doc(db, 'events', eventId));
    if (!eventSnap.exists()) {
        return interaction.reply({ content: '❌ Event nicht gefunden.', flags: MessageFlags.Ephemeral });
    }
    const event = eventSnap.data();
    const slot = findSlot(getSlots(event), slotId);
    if (!slot) {
        return interaction.reply({
            content: `❌ Diesen Slot gibt es nicht mehr. Bitte melde dich hier an: ${buildEventUrl(eventId)}`,
            flags: MessageFlags.Ephemeral
        });
    }

    const { loadEventRegistrations } = require('./utils/eventUtils');
    const registrations = await loadEventRegistrations(eventId);
    const registration = registrations.find(entry => entry.userId === interaction.user.id);
    if (registration) {
        return interaction.reply(buildRegisteredSlotReply(event, eventId, registration, slot, registrations));
    }

    const roleIds = await resolveInteractionRoles(interaction);
    const conditionError = await checkRegistrationConditions({ event, eventId, userId: interaction.user.id, roleIds });
    if (conditionError) {
        return interaction.reply({ content: `❌ ${conditionError}`, flags: MessageFlags.Ephemeral });
    }

    const needsModal = getFormFields(event).length > 0 || getSlots(event).length > 1;
    if (needsModal) {
        if (!fitsIntoDiscordModal(event)) {
            return interaction.reply({
                content: `📝 Für dieses Event ist das Formular zu umfangreich für Discord (max. ${getModalFieldLimit(event)} Felder). Bitte melde dich hier an: ${buildEventUrl(eventId)}`,
                flags: MessageFlags.Ephemeral
            });
        }
        return interaction.showModal(buildSlotModal(event, eventId, slot));
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await completeDiscordRegistration(interaction, { eventId, event, roleIds, formAnswers: {}, slotId, altSlotIds: [] });
}

/**
 * Handle the submitted slot modal.
 *
 * @param {import('discord.js').ModalSubmitInteraction} interaction -> The submitted modal.
 * @param {string} eventId -> The event document ID.
 * @param {string} slotId -> The slot of the clicked button.
 * @returns {Promise<void>}
 */
async function handleEventSlotModal(interaction, eventId, slotId) {
    debugLog('bot.slotModal', { eventId, slotId, userId: interaction.user.id });

    const eventSnap = await getDoc(doc(db, 'events', eventId));
    if (!eventSnap.exists()) {
        return interaction.reply({ content: '❌ Event nicht gefunden.', flags: MessageFlags.Ephemeral });
    }
    const event = eventSnap.data();

    // Slots or the form may have changed while the modal was open
    if (!canRegisterViaDiscord(event) || !findSlot(getSlots(event), slotId)) {
        return interaction.reply({
            content: `📝 Das Event hat sich geändert. Bitte melde dich hier an: ${buildEventUrl(eventId)}`,
            flags: MessageFlags.Ephemeral
        });
    }

    const { answers, errors } = parseModalAnswers(interaction, event);
    if (errors.length > 0) {
        return interaction.reply({
            content: `❌ Bitte korrigiere deine Angaben:\n${errors.map(e => `• ${e}`).join('\n')}`,
            flags: MessageFlags.Ephemeral
        });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const roleIds = await resolveInteractionRoles(interaction);
    const conditionError = await checkRegistrationConditions({ event, eventId, userId: interaction.user.id, roleIds });
    if (conditionError) {
        return interaction.editReply({ content: `❌ ${conditionError}` });
    }

    await completeDiscordRegistration(interaction, {
        eventId, event, roleIds, formAnswers: answers, slotId, altSlotIds: readAltSlotIds(interaction)
    });
}

/**
 * Handle "Zu <Slot> wechseln" in the ephemeral status answer.
 *
 * @param {import('discord.js').ButtonInteraction} interaction -> The button interaction.
 * @param {string} eventId -> The event document ID.
 * @param {string} slotId -> Target slot.
 * @returns {Promise<void>}
 */
async function handleSlotSwitchButton(interaction, eventId, slotId) {
    if (await isRegistrationBlocked()) {
        return interaction.update({ content: '❌ Event-Registrierungen sind wegen Wartungsarbeiten vorübergehend deaktiviert.', components: [] });
    }
    const { switchOwnSlot } = require('./utils/registrationService');
    const result = await switchOwnSlot({ eventId, userId: interaction.user.id, slotId });
    await interaction.update({ content: result.ok ? `✅ ${result.message}` : `❌ ${result.error}`, components: [] });
}

/**
 * Handle "Abmelden" in the ephemeral status answer.
 *
 * @param {import('discord.js').ButtonInteraction} interaction -> The button interaction.
 * @param {string} eventId -> The event document ID.
 * @returns {Promise<void>}
 */
async function handleSlotLeaveButton(interaction, eventId) {
    const { unregisterUserFromEvent } = require('./utils/registrationService');
    const result = await unregisterUserFromEvent({ eventId, userId: interaction.user.id });
    const title = result.event && result.event.title ? result.event.title : 'dem Event';
    await interaction.update({
        content: result.ok ? `✅ Du wurdest von **${title}** abgemeldet.` : `❌ ${result.error}`,
        components: []
    });
}

/**
 * Assign a role to a user in the configured guild
 */
async function assignRole(userId, roleId, guildId) {
    if (!isReady) {
        console.warn('Bot not ready yet, cannot assign role');
        return false;
    }
    debugLog('bot.assignRole', { userId, roleId });
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
 * Get all channels from the guild (for location autocomplete)
 */
async function getGuildChannels(guildId) {
    if (!isReady) return [];
    try {
        const guild = await client.guilds.fetch(guildId);
        const channels = await guild.channels.fetch();
        return channels
            .filter(c => c && [ChannelType.GuildVoice, ChannelType.GuildText, ChannelType.GuildStageVoice, ChannelType.GuildForum].includes(c.type))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(c => ({
                id: c.id,
                name: c.name,
                type: (c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice) ? 'voice' : 'text'
            }));
    } catch (err) {
        console.error('Failed to get guild channels:', err.message);
        return [];
    }
}

/**
 * Get the channels every guild member can see.
 *
 * Used for the channel picker of the web registration form -> private
 * channels must not leak to users that cannot see them anyway.
 *
 * @param {string} guildId -> The guild to read the channels from.
 * @returns {Promise<Array<Object>>} -> Channels as `{ id, name, type }`.
 * @example
 * const channels = await getPublicGuildChannels(process.env.DISCORD_GUILD_ID);
 */
async function getPublicGuildChannels(guildId) {
    if (!isReady) return [];
    try {
        const guild = await client.guilds.fetch(guildId);
        const channels = await guild.channels.fetch();
        const everyone = guild.roles.everyone;

        return channels
            .filter(channel => channel
                && SELECTABLE_CHANNEL_TYPES.includes(channel.type)
                && channel.permissionsFor(everyone)?.has(PermissionsBitField.Flags.ViewChannel))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(channel => ({
                id: channel.id,
                name: channel.name,
                type: (channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice) ? 'voice' : 'text'
            }));
    } catch (err) {
        console.error('Failed to get public guild channels:', err.message);
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

                    const timeStr = startTime.toLocaleString('de-DE', { timeZone: TIMEZONE });
                    debugLog('bot.sendReminder', { eventId, recipientCount: regs.docs?.length });
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
                    await sendDM(reg.userId,
                        `🎯 **${event.title}** hat gerade begonnen! Viel Spaß!\n\n🔗 Event ansehen: ${buildEventUrl(eventId)}`
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
    if (presenceUpdateInterval) {
        clearInterval(presenceUpdateInterval);
        presenceUpdateInterval = null;
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

/**
 * Get bot status information for the control center
 */
function getBotStatus() {
    const guild = client.guilds?.cache.get(process.env.DISCORD_GUILD_ID);
    return {
        online: isReady,
        username: client.user?.tag || null,
        avatarUrl: client.user?.displayAvatarURL({ size: 128 }) || null,
        uptime: botStartedAt ? Math.floor((Date.now() - botStartedAt.getTime()) / 1000) : 0,
        startedAt: botStartedAt ? botStartedAt.toISOString() : null,
        ping: client.ws.ping || 0,
        guildName: guild?.name || null,
        guildMemberCount: guild?.memberCount || 0,
        guildId: process.env.DISCORD_GUILD_ID || null,
        dmsSent: dmsSentCount,
        commandsProcessed: commandsProcessedCount,
        reminderSchedulerActive: !!reminderInterval,
        presenceAutoUpdate: !!presenceUpdateInterval,
    };
}

/**
 * Get bot settings from Firestore
 */
async function getBotSettings() {
    try {
        const snap = await getDoc(doc(db, 'botSettings', 'config'));
        if (snap.exists()) return snap.data();
    } catch (err) {
        console.error('Failed to load bot settings:', err.message);
    }
    // Defaults
    return {
        statusType: 'online',
        activityType: 'WATCHING',
        activityText: '',
        dmNotifications: true,
        reminderEnabled: true,
        eventStartNotifications: true,
        autoChannelCreation: true,
        autoUpdatePresence: false,
        autoStatusCalendarEvents: false,
        announceChannel: process.env.DISCORD_ANNOUNCE_CHANNEL_ID || '',
        welcomeMessage: '',
    };
}

/**
 * Save bot settings to Firestore and apply them
 */
async function saveBotSettings(settings) {
    try {
        await setDoc(doc(db, 'botSettings', 'config'), {
            ...settings,
            updatedAt: new Date().toISOString()
        });
        await applyBotSettings();
        return true;
    } catch (err) {
        console.error('Failed to save bot settings:', err.message);
        return false;
    }
}

/**
 * Build template variables for activity text from live event data
 * Supported variables:
 *   {events.count}        — Number of active events
 *   {events.next}         — Title of the next upcoming event
 *   {events.next.date}    — Date of the next upcoming event (short format)
 *   {events.next.time}    — Time of the next upcoming event
 *   {events.next.participants} — Current participant count of next event
 *   {events.list}         — Comma-separated list of next 2 event titles
 *   {events.list.details} — Next 2 events with date (e.g. "Event1 (12. Mär) | Event2 (15. Mär)")
 *   {server.members}      — Guild member count
 *   {server.name}         — Guild name
 *   {link.events}         — URL to events page
 */
async function buildActivityVariables() {
    const vars = {};
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

    // Server info
    const guild = client.guilds?.cache.get(process.env.DISCORD_GUILD_ID);
    vars['server.members'] = guild?.memberCount || 0;
    vars['server.name'] = guild?.name || 'Server';
    vars['link.events'] = `${baseUrl}/#events`;

    // Fetch active events (lightweight — no registration stats needed here)
    try {
        const q = query(collection(db, 'events'), where('status', '==', 'active'));
        const snapshot = await getDocs(q);
        const events = [];
        snapshot.forEach(d => events.push({ id: d.id, ...d.data() }));

        // Sort by startDate ascending (soonest first)
        const now = new Date();
        events.sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));

        // Filter to upcoming/current events (not in the past)
        const upcoming = events.filter(e => {
            if (!e.startDate) return true;
            const end = e.endDate ? new Date(e.endDate) : new Date(new Date(e.startDate).getTime() + 2 * 60 * 60 * 1000);
            return end > now;
        });

        vars['events.count'] = upcoming.length;

        if (upcoming.length > 0) {
            const next = upcoming[0];
            vars['events.next'] = next.title || 'Unbekannt';

            if (next.startDate) {
                const d = new Date(next.startDate);
                vars['events.next.date'] = d.toLocaleDateString('de-DE', { day: '2-digit', month: 'short', timeZone: TIMEZONE });
                vars['events.next.time'] = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: TIMEZONE });
            } else {
                vars['events.next.date'] = 'TBD';
                vars['events.next.time'] = 'TBD';
            }

            vars['events.next.participants'] = next.currentParticipants || 0;

            // List of up to 2 events
            const listEvents = upcoming.slice(0, 2);
            vars['events.list'] = listEvents.map(e => e.title).join(', ');
            vars['events.list.details'] = listEvents.map(e => {
                const dateStr = e.startDate
                    ? new Date(e.startDate).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', timeZone: TIMEZONE })
                    : 'TBD';
                return `${e.title} (${dateStr})`;
            }).join(' | ');
        } else {
            vars['events.next'] = 'Keine Events';
            vars['events.next.date'] = '-';
            vars['events.next.time'] = '-';
            vars['events.next.participants'] = 0;
            vars['events.list'] = 'Keine Events';
            vars['events.list.details'] = 'Keine Events geplant';
        }
    } catch (err) {
        console.error('Failed to build activity variables:', err.message);
        vars['events.count'] = 0;
        vars['events.next'] = 'Fehler';
        vars['events.next.date'] = '-';
        vars['events.next.time'] = '-';
        vars['events.next.participants'] = 0;
        vars['events.list'] = '-';
        vars['events.list.details'] = '-';
    }

    return vars;
}

/**
 * Apply bot settings (presence, activity, etc.)
 */
async function applyBotSettings() {
    if (!isReady) return;
    try {
        const settings = await getBotSettings();

        // Set presence status
        const statusMap = { online: 'online', idle: 'idle', dnd: 'dnd', invisible: 'invisible' };
        let status = statusMap[settings.statusType] || 'online';

        // Auto-Status based on calendar events (only when autoUpdatePresence is enabled)
        if (settings.autoStatusCalendarEvents && settings.autoUpdatePresence) {
            try {
                const now = new Date();
                const q = query(collection(db, 'events'), where('status', '==', 'active'));
                const snapshot = await getDocs(q);
                const events = [];
                snapshot.forEach(d => events.push({ id: d.id, ...d.data() }));

                const running = events.some(e => {
                    if (!e.startDate) return false;
                    const start = new Date(e.startDate);
                    const end = e.endDate ? new Date(e.endDate) : new Date(start.getTime() + 2 * 60 * 60 * 1000);
                    return start <= now && now <= end;
                });

                const upcoming = events.some(e => {
                    if (!e.startDate) return false;
                    const start = new Date(e.startDate);
                    return start > now;
                });

                if (running) {
                    status = 'dnd';       // Event läuft gerade
                } else if (upcoming) {
                    status = 'online';    // Event steht an
                } else {
                    status = 'idle';      // Keine Events in Zukunft geplant
                }
            } catch (err) {
                console.error('Auto-Status calendar check failed:', err.message);
            }
        }

        // Set activity
        const activityTypeMap = {
            PLAYING: ActivityType.Playing,
            WATCHING: ActivityType.Watching,
            LISTENING: ActivityType.Listening,
            COMPETING: ActivityType.Competing,
        };

        const activities = [];
        if (settings.activityText) {
            // Parse template variables in activity text
            const vars = await buildActivityVariables();
            let activityText = settings.activityText;
            for (const [key, value] of Object.entries(vars)) {
                activityText = activityText.replace(new RegExp(`\\{${key.replace('.', '\\.')}\\}`, 'g'), String(value));
            }

            activities.push({
                name: activityText.substring(0, 128),
                type: activityTypeMap[settings.activityType] || ActivityType.Watching
            });
        }

        client.user.setPresence({ status, activities });

        // Toggle reminder scheduler
        if (settings.reminderEnabled && !reminderInterval) {
            startReminderScheduler();
        } else if (!settings.reminderEnabled && reminderInterval) {
            clearInterval(reminderInterval);
            reminderInterval = null;
            console.log('⏰ Reminder scheduler deaktiviert via Bot-Zentrale');
        }

        // Toggle presence auto-update (refreshes activity text with live event data)
        if (settings.autoUpdatePresence && !presenceUpdateInterval) {
            presenceUpdateInterval = setInterval(applyBotSettings, 5 * 60 * 1000); // Every 5 min
            console.log('🔄 Presence Auto-Update aktiviert (alle 5 Min.)');
        } else if (!settings.autoUpdatePresence && presenceUpdateInterval) {
            clearInterval(presenceUpdateInterval);
            presenceUpdateInterval = null;
            console.log('🔄 Presence Auto-Update deaktiviert');
        }

    } catch (err) {
        console.error('Failed to apply bot settings:', err.message);
    }
}

/**
 * Send a guest invitation DM with Accept/Decline buttons
 * @param {string} guestUserId - Discord ID of the invited guest
 * @param {Object} registrant - {id, displayName} of the person sending the invite
 * @param {Object} event - event object with title and id
 * @param {string} registrationId - Firestore registration document ID
 */
async function sendGuestInvitation(guestUserId, registrant, event, registrationId) {
    if (!isReady) return false;
    try {
        const user = await client.users.fetch(guestUserId);

        const embed = new EmbedBuilder()
            .setTitle('🎟️ Gäste-Einladung erhalten')
            .setColor(0x8b5cf6)
            .setDescription(
                `**${registrant.displayName}** hat dich als Gast zum Event eingeladen.\n\n` +
                `**Event:** ${event.title}\n` +
                (event.startDate ? `**Datum:** ${new Date(event.startDate).toLocaleString('de-DE', { timeZone: TIMEZONE })}\n` : '') +
                `\nMöchtest du die Einladung annehmen?`
            )
            .addFields({ name: '🔗 Event', value: `[Zur Event-Seite](${buildEventUrl(event.id)})` })
            .setFooter({ text: 'DEMS — Event Management' })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`guest_accept:${registrationId}:${guestUserId}`)
                .setLabel('Annehmen')
                .setStyle(ButtonStyle.Success)
                .setEmoji('✅'),
            new ButtonBuilder()
                .setCustomId(`guest_decline:${registrationId}:${guestUserId}`)
                .setLabel('Ablehnen')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('❌')
        );

        await user.send({ embeds: [embed], components: [row] });
        dmsSentCount++;
        return true;
    } catch (err) {
        console.error(`Failed to send guest invitation to ${guestUserId}:`, err.message);
        return false;
    }
}

/**
 * Get currently running (active) events with live data
 */
async function getRunningEvents() {
    try {
        const q = query(collection(db, 'events'), where('status', '==', 'active'));
        const snapshot = await getDocs(q);
        const events = [];
        for (const docSnap of snapshot.docs) {
            const event = { id: docSnap.id, ...docSnap.data() };
            // Count registrations
            const regQ = query(
                collection(db, 'registrations'),
                where('eventId', '==', docSnap.id)
            );
            const regSnap = await getDocs(regQ);
            let accepted = 0, pending = 0, waitlisted = 0;
            regSnap.forEach(r => {
                const s = r.data().status;
                if (s === 'accepted') accepted++;
                else if (s === 'pending') pending++;
                else if (s === 'waitlisted') waitlisted++;
            });
            event.registrationStats = { accepted, pending, waitlisted, total: regSnap.size };
            events.push(event);
        }
        events.sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
        return events;
    } catch (err) {
        console.error('Failed to get running events:', err.message);
        return [];
    }
}

module.exports = {
    client,
    startBot,
    stopBot,
    sendDM,
    sendChannelMessage,
    refreshEventAnnouncements,
    isGoneDiscordError,
    buildSlotModal,
    buildRegisteredSlotReply,
    buildEventEmbed,
    assignRole,
    removeRole,
    getUserRoles,
    isGuildMember,
    getGuildName,
    getGuildRoles,
    getGuildChannels,
    getPublicGuildChannels,
    getGuildScheduledEvents,
    parseTemplate,
    startReminderScheduler,
    createEventChannels,
    addParticipantToEventChannels,
    removeParticipantFromEventChannels,
    deleteEventChannels,
    createScheduledEvent,
    getBotStatus,
    getBotSettings,
    saveBotSettings,
    getRunningEvents,
    sendGuestInvitation,
    buildEventComponents,
    canRegisterViaDiscord
};

// Dev mock mode: every call that would reach Discord goes to the simulated
// server instead (see dev/mockBot.js)
if (IS_MOCK_MODE) Object.assign(module.exports, require('./dev/mockBot'));
