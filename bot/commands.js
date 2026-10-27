/**
 * Slash commands of the bot: registering them with Discord, the event
 * autocomplete and the answers to /events, /register and /unregister.
 */
const { EmbedBuilder, MessageFlags, REST, Routes, SlashCommandBuilder } = require('discord.js');
const { db, collection, doc, getDoc, getDocs, query, where } = require('../firebaseAdmin');
const { buildEventUrl } = require('../utils/eventUrl');
const { summarizePlaces, formatPlaces } = require('../utils/capacity');
const { client } = require('./client');
const { TIMEZONE } = require('./constants');

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
    registerSlashCommands,
    handleAutocomplete,
    handleChatCommand
};
