/**
 * Slash commands of the bot: registering them with Discord, the event
 * autocomplete and the answers to /events, /register and /unregister.
 */
const { ActionRowBuilder, EmbedBuilder, MessageFlags, REST, Routes, SlashCommandBuilder } = require('discord.js');
const { db, collection, doc, getDoc, getDocs, query, where } = require('../firebaseAdmin');
const { buildEventUrl } = require('../utils/eventUrl');
const { summarizePlaces, formatPlaces } = require('../utils/capacity');
const { debugLog } = require('../utils/debugLog');
const { fitsIntoDiscordModal, getModalFieldLimit } = require('../utils/formFields');
const { getSlots, buildRoster } = require('../utils/slotService');
const { client } = require('./client');
const { TIMEZONE } = require('./constants');
const { buildSlotButton } = require('./messages');
const {
    resolveInteractionRoles, checkRegistrationConditions, handleEventRegisterButton, replyWithFailure
} = require('./registration');

// Discord allows at most five buttons per action row
const BUTTONS_PER_ROW = 5;

/**
 * Build one command with an event option, named in German for German clients.
 *
 * Discord keeps sending the base name as `commandName`, so routing and
 * autocomplete only ever see `register` / `unregister`.
 *
 * @param {string} name -> Base command name.
 * @param {string} germanName -> Name shown to clients with the language "de".
 * @param {string} description -> German description (base and "de").
 * @returns {SlashCommandBuilder} -> The command definition.
 */
function buildEventCommand(name, germanName, description) {
    return new SlashCommandBuilder()
        .setName(name)
        .setNameLocalizations({ de: germanName })
        .setDescription(description)
        .setDescriptionLocalizations({ de: description })
        .addStringOption(opt => opt
            .setName('event')
            .setDescription('Name des Events')
            .setRequired(true)
            .setAutocomplete(true)
        );
}

/**
 * Definitions of all slash commands as Discord expects them.
 *
 * @returns {Object[]} -> JSON bodies of /events, /register (/anmelden) and /unregister (/abmelden).
 */
function buildSlashCommands() {
    return [
        new SlashCommandBuilder()
            .setName('events')
            .setDescription('Zeigt aktive Events an'),
        buildEventCommand('register', 'anmelden', 'Melde dich für ein Event an'),
        buildEventCommand('unregister', 'abmelden', 'Melde dich von einem Event ab')
    ].map(command => command.toJSON());
}

/**
 * Register slash commands
 */
async function registerSlashCommands() {
    try {
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
        await rest.put(
            Routes.applicationGuildCommands(client.user.id, process.env.DISCORD_GUILD_ID),
            { body: buildSlashCommands() }
        );
        console.log('✅ Slash Commands registriert');
    } catch (err) {
        console.error('❌ Slash Command Registration Error:', err.message);
    }
}

/**
 * Offer events while a member types the event option of /register or /unregister.
 *
 * @param {Object} interaction -> Autocomplete interaction.
 */
async function handleAutocomplete(interaction) {
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
}

/**
 * Handle /register (German client: /anmelden) for one event.
 *
 * Events without slots take the path of the "Anmelden" button. Slot events
 * are checked the same way and then answer privately with one button per
 * slot; a click continues in handleEventSlotButton like on the announcement.
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction -> The slash command.
 * @param {string} eventId -> The event document ID from the autocomplete option.
 * @returns {Promise<void>} -> Resolves once the interaction was answered.
 */
async function handleRegisterCommand(interaction, eventId) {
    debugLog('bot.registerCommand', { eventId, userId: interaction.user.id });

    const eventSnap = await getDoc(doc(db, 'events', eventId));
    if (!eventSnap.exists()) {
        return interaction.reply({ content: '❌ Event nicht gefunden.', flags: MessageFlags.Ephemeral });
    }

    const event = eventSnap.data();
    const slots = getSlots(event);
    if (slots.length === 0) {
        return handleEventRegisterButton(interaction, eventId);
    }

    const roleIds = await resolveInteractionRoles(interaction);
    const conditionError = await checkRegistrationConditions({ event, eventId, userId: interaction.user.id, roleIds });
    if (conditionError) {
        return interaction.reply({ content: `❌ ${conditionError}`, flags: MessageFlags.Ephemeral });
    }

    if (!fitsIntoDiscordModal(event)) {
        return interaction.reply({
            content: `📝 Für dieses Event ist das Formular zu umfangreich für Discord (max. ${getModalFieldLimit(event)} Felder). Bitte melde dich hier an: ${buildEventUrl(eventId)}`,
            flags: MessageFlags.Ephemeral
        });
    }

    const { loadEventRegistrations } = require('../utils/eventUtils');
    const roster = buildRoster(event, await loadEventRegistrations(eventId));
    const rows = [];
    for (let i = 0; i < slots.length; i += BUTTONS_PER_ROW) {
        const buttons = slots.slice(i, i + BUTTONS_PER_ROW).map(slot => buildSlotButton(eventId, slot, roster));
        rows.push(new ActionRowBuilder().addComponents(buttons));
    }

    await interaction.reply({
        content: `Wähle deine Rolle für **${event.title}**:`,
        components: rows,
        flags: MessageFlags.Ephemeral
    });
}

/**
 * Answer the slash commands /events, /register and /unregister.
 *
 * @param {Object} interaction -> Chat input command interaction.
 */
async function handleChatCommand(interaction) {
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

            // Registrations of all events in one query, for the places sentence
            const registrationsByEvent = {};
            (await getDocs(collection(db, 'registrations'))).forEach(regDoc => {
                const registration = regDoc.data();
                (registrationsByEvent[registration.eventId] ||= []).push(registration);
            });

            const embeds = [];
            const maxEmbeds = Math.min(events.length, 10); // Max 10 embeds per message

            for (let i = 0; i < maxEmbeds; i++) {
                const ev = events[i];
                const embed = new EmbedBuilder()
                    .setTitle(ev.title)
                    .setColor(0x8b5cf6)
                    // Discord refuses an empty description; one event without a text broke the whole list
                    .setDescription((ev.description || 'Keine Beschreibung.').substring(0, 200))
                    .addFields(
                        { name: '📅 Datum', value: ev.startDate ? new Date(ev.startDate).toLocaleString('de-DE', { timeZone: TIMEZONE }) : 'TBD', inline: true },
                        { name: '👥 Plätze', value: formatPlaces(summarizePlaces(registrationsByEvent[ev.id] || [], ev.maxParticipants)), inline: true },
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

    // /register command (/anmelden) -> same flow as the "Anmelden" and slot buttons (B-03)
    if (interaction.commandName === 'register') {
        try {
            await handleRegisterCommand(interaction, interaction.options.getString('event'));
        } catch (err) {
            console.error('Slash /register error:', err);
            await replyWithFailure(interaction);
        }
    }

    // /unregister command
    if (interaction.commandName === 'unregister') {
        try {
            // Acknowledge first -> clean-up and waitlist DMs can exceed Discord's 3 second limit
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const eventId = interaction.options.getString('event');
            const userId = interaction.user.id;

            // Get event details
            const eventSnap = await getDoc(doc(db, 'events', eventId));
            if (!eventSnap.exists()) {
                return interaction.editReply({ content: '❌ Event nicht gefunden.' });
            }

            const event = eventSnap.data();

            const { unregisterUserFromEvent } = require('../utils/registrationService');
            const result = await unregisterUserFromEvent({ eventId, userId });
            if (!result.ok) {
                return interaction.editReply({ content: `⚠️ ${result.error}` });
            }

            const embed = new EmbedBuilder()
                .setTitle('✅ Abmeldung erfolgreich')
                .setColor(0x22c55e)
                .setDescription(`Du wurdest erfolgreich von **${event.title}** abgemeldet.`)
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        } catch (err) {
            console.error('Slash /unregister error:', err);
            try {
                if (interaction.deferred) {
                    await interaction.editReply({ content: '❌ Fehler bei der Abmeldung.' });
                } else {
                    await interaction.reply({ content: '❌ Fehler bei der Abmeldung.', flags: MessageFlags.Ephemeral });
                }
            } catch { /* interaction already expired */ }
        }
    }
}

module.exports = {
    buildSlashCommands,
    registerSlashCommands,
    handleAutocomplete,
    handleRegisterCommand,
    handleChatCommand
};
