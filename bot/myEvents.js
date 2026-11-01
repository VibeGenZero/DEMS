/**
 * /my-events (German client: /meine-events, B-04): private overview of the
 * member's upcoming registrations with "Abmelden" (asks first), "Slot
 * wechseln" and "Zum Event". Confirming and switching reuse the slot_leave
 * and slot_switch handlers of bot/registration.js.
 */
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, escapeMarkdown } = require('discord.js');
const { db, collection, doc, getDoc, getDocs, query, where } = require('../firebaseAdmin');
const { debugLog } = require('../utils/debugLog');
const { buildProfileEvents } = require('../utils/profileEvents');
const { waitlistPositions } = require('../utils/capacity');
const { getSlots, countSlotOccupancy, hasFreePlace } = require('../utils/slotService');
const { isRegistrationClosed, isUnregisterClosed, parseDate } = require('../utils/eventListing');
const { buildEventUrl, buildSiteUrl } = require('../utils/eventUrl');
const { DEMS_ACCENT } = require('./layout');
const {
    TIMEZONE, MY_LEAVE_PREFIX, MY_LEAVE_CANCEL_PREFIX, MY_SWITCH_PREFIX, SLOT_LEAVE_PREFIX, SLOT_SWITCH_PREFIX
} = require('./constants');

// Entries listed in one overview -> 29 of Discord's 40 components
const MY_EVENTS_MAX = 5;
// Discord allows at most five buttons per action row
const BUTTONS_PER_ROW = 5;
// Statuses that hold a place and may move to another slot
const SWITCHABLE_STATUSES = ['accepted', 'pending'];

/**
 * Load the member's registrations for events that are still coming up.
 *
 * Same rules as the profile page (routes/user.js): over, cancelled and
 * archived events are left out, the next event comes first, waitlisted
 * registrations of active events carry their place.
 *
 * @param {string} userId -> Discord user ID of the member.
 * @returns {Promise<Array<{ entry: Object, registration: Object, event: Object }>>} -> Profile entry (utils/profileEvents.js), raw registration with `id` and the event data.
 */
async function loadUpcomingRegistrations(userId) {
    const snapshot = await getDocs(query(collection(db, 'registrations'), where('userId', '==', userId)));
    const registrations = snapshot.docs.map(regDoc => ({ id: regDoc.id, ...regDoc.data() }));

    const eventsById = new Map();
    for (const eventId of new Set(registrations.map(registration => registration.eventId))) {
        const eventSnap = await getDoc(doc(db, 'events', eventId));
        if (eventSnap.exists()) eventsById.set(eventId, eventSnap.data());
    }

    const { loadEventRegistrations } = require('../utils/eventUtils');
    const waitlistPositionsById = new Map();
    for (const registration of registrations) {
        if (registration.status !== 'waitlisted' || eventsById.get(registration.eventId)?.status !== 'active') continue;
        const position = waitlistPositions(await loadEventRegistrations(registration.eventId)).get(registration.id);
        if (position) waitlistPositionsById.set(registration.id, position);
    }

    const registrationsById = new Map(registrations.map(registration => [registration.id, registration]));
    const { upcoming } = buildProfileEvents(registrations, eventsById, new Date(), waitlistPositionsById);
    return upcoming.map(entry => {
        const registration = registrationsById.get(entry.id);
        return { entry, registration, event: eventsById.get(registration.eventId) };
    });
}

/**
 * Status line of one entry.
 *
 * @param {Object} entry -> Profile entry with `status` and `waitlistPosition`.
 * @returns {string} -> German status with its symbol.
 */
function formatStatus(entry) {
    if (entry.status === 'pending') return '📋 Anfrage ausstehend';
    if (entry.status === 'rejected') return '❌ Abgelehnt';
    if (entry.status === 'waitlisted') {
        const place = entry.waitlistPosition;
        return place ? `🕒 Warteliste – Platz ${place.position} von ${place.total}` : '🕒 Warteliste';
    }
    return '✅ Angemeldet';
}

/**
 * Status line with the held slot or the slot wish, as /my-events and
 * /event info (B-12) show it.
 *
 * @param {Object} entry -> Profile entry with `status`, `waitlistPosition` and `slot`.
 * @returns {string} -> e.g. "✅ Angemeldet · ⚔️ Schaden".
 */
function formatStatusWithSlot(entry) {
    let status = formatStatus(entry);
    if (entry.slot) {
        const label = [entry.slot.emoji, entry.slot.name].filter(Boolean).join(' ');
        status += entry.slot.wish ? ` · Wunsch: ${label}` : ` · ${label}`;
    }
    return status;
}

/**
 * Text block of one entry: title, start, status and slot.
 *
 * @param {{ entry: Object, event: Object }} item -> Loaded registration.
 * @returns {string} -> Discord markdown.
 */
function formatEntry({ entry, event }) {
    const start = parseDate(event.startDate);
    const lines = [`**${escapeMarkdown(String(event.title || ''))}**`];
    if (start) lines.push(`📅 ${start.toLocaleString('de-DE', { timeZone: TIMEZONE })}`);
    lines.push(formatStatusWithSlot(entry));
    return lines.join('\n');
}

/**
 * Buttons of one entry; deadlines and the status take "Abmelden" and "Slot wechseln" away.
 *
 * @param {{ registration: Object, event: Object }} item -> Loaded registration.
 * @returns {ButtonBuilder[]} -> One to three buttons, "Zum Event" always last.
 */
function buildEntryButtons({ registration, event }) {
    const eventId = registration.eventId;
    const buttons = [];
    if (registration.status !== 'rejected' && !isUnregisterClosed(event)) {
        buttons.push(new ButtonBuilder()
            .setCustomId(`${MY_LEAVE_PREFIX}:${eventId}`)
            .setLabel('Abmelden')
            .setStyle(ButtonStyle.Danger));
    }
    const canSwitch = getSlots(event).length > 0
        && registration.slotId
        && SWITCHABLE_STATUSES.includes(registration.status)
        && !isRegistrationClosed(event);
    if (canSwitch) {
        buttons.push(new ButtonBuilder()
            .setCustomId(`${MY_SWITCH_PREFIX}:${eventId}`)
            .setLabel('Slot wechseln')
            .setStyle(ButtonStyle.Secondary));
    }
    buttons.push(new ButtonBuilder()
        .setLabel('Zum Event')
        .setStyle(ButtonStyle.Link)
        .setURL(buildEventUrl(eventId)));
    return buttons;
}

/**
 * The private answer of /my-events.
 *
 * @param {Array<{ entry: Object, registration: Object, event: Object }>} items -> Result of loadUpcomingRegistrations().
 * @returns {Object} -> Reply payload: a V2 container with up to five entries, or a plain notice without any.
 */
function buildMyEventsMessage(items) {
    if (items.length === 0) {
        return {
            content: `📭 Du bist für kein kommendes Event angemeldet. Zur Übersicht: ${buildSiteUrl('events')}`,
            flags: MessageFlags.Ephemeral
        };
    }

    const container = new ContainerBuilder()
        .setAccentColor(DEMS_ACCENT)
        .addTextDisplayComponents(text => text.setContent('## 📅 Deine Events'));
    for (const item of items.slice(0, MY_EVENTS_MAX)) {
        container
            .addTextDisplayComponents(text => text.setContent(formatEntry(item)))
            .addActionRowComponents(row => row.addComponents(...buildEntryButtons(item)));
    }
    const hidden = items.length - MY_EVENTS_MAX;
    if (hidden > 0) {
        container.addTextDisplayComponents(text => text.setContent(
            `… und ${hidden} weitere — alle auf deiner Profilseite: ${buildSiteUrl('profile')}`
        ));
    }

    return { flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, components: [container] };
}

/**
 * Answer /my-events with the member's overview.
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction -> The slash command.
 * @returns {Promise<void>}
 */
async function handleMyEventsCommand(interaction) {
    debugLog('bot.myEvents', { userId: interaction.user.id });
    const items = await loadUpcomingRegistrations(interaction.user.id);
    await interaction.reply(buildMyEventsMessage(items));
}

/**
 * Load an event for a button of the overview.
 *
 * @param {string} eventId -> The event document ID.
 * @returns {Promise<Object|null>} -> Event data, null when it was deleted.
 */
async function loadEvent(eventId) {
    const eventSnap = await getDoc(doc(db, 'events', eventId));
    return eventSnap.exists() ? eventSnap.data() : null;
}

/**
 * "Abmelden" in the overview: ask first. "Ja, abmelden" is the slot_leave
 * button, so confirming runs handleSlotLeaveButton unchanged.
 *
 * @param {import('discord.js').ButtonInteraction} interaction -> The button interaction.
 * @param {string} eventId -> The event document ID.
 * @returns {Promise<void>}
 */
async function handleMyLeaveButton(interaction, eventId) {
    const event = await loadEvent(eventId);
    if (!event) {
        return interaction.reply({ content: '❌ Event nicht gefunden.', flags: MessageFlags.Ephemeral });
    }
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${SLOT_LEAVE_PREFIX}:${eventId}`)
            .setLabel('Ja, abmelden')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(`${MY_LEAVE_CANCEL_PREFIX}:${eventId}`)
            .setLabel('Abbrechen')
            .setStyle(ButtonStyle.Secondary)
    );
    await interaction.reply({
        content: `Wirklich von **${escapeMarkdown(String(event.title || ''))}** abmelden?`,
        components: [row],
        flags: MessageFlags.Ephemeral
    });
}

/**
 * "Abbrechen" in the confirmation: nothing changes.
 *
 * @param {import('discord.js').ButtonInteraction} interaction -> The button interaction.
 * @returns {Promise<void>}
 */
async function handleMyLeaveCancelButton(interaction) {
    await interaction.update({ content: 'Abmeldung abgebrochen.', components: [] });
}

/**
 * "Slot wechseln" in the overview: one "Zu <Slot> wechseln" button per other
 * slot with a free place. They are slot_switch buttons, so a click runs
 * handleSlotSwitchButton unchanged (which checks everything again).
 *
 * @param {import('discord.js').ButtonInteraction} interaction -> The button interaction.
 * @param {string} eventId -> The event document ID.
 * @returns {Promise<void>}
 */
async function handleMySwitchButton(interaction, eventId) {
    const event = await loadEvent(eventId);
    if (!event) {
        return interaction.reply({ content: '❌ Event nicht gefunden.', flags: MessageFlags.Ephemeral });
    }

    const { loadEventRegistrations } = require('../utils/eventUtils');
    const registrations = await loadEventRegistrations(eventId);
    const own = registrations.find(registration => registration.userId === interaction.user.id);
    if (!own || own.status === 'rejected') {
        return interaction.reply({ content: '❌ Du bist für dieses Event nicht angemeldet.', flags: MessageFlags.Ephemeral });
    }

    const slots = getSlots(event);
    const occupancy = countSlotOccupancy(slots, registrations);
    const buttons = slots
        .filter(slot => slot.id !== own.slotId && hasFreePlace(slot, occupancy))
        .map(slot => {
            const button = new ButtonBuilder()
                .setCustomId(`${SLOT_SWITCH_PREFIX}:${eventId}:${slot.id}`)
                .setLabel(`Zu ${slot.name} wechseln`)
                .setStyle(ButtonStyle.Primary);
            if (slot.emoji) button.setEmoji(slot.emoji);
            return button;
        });
    if (buttons.length === 0) {
        return interaction.reply({ content: 'Gerade ist kein anderer Slot frei.', components: [], flags: MessageFlags.Ephemeral });
    }

    const rows = [];
    for (let i = 0; i < buttons.length; i += BUTTONS_PER_ROW) {
        rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + BUTTONS_PER_ROW)));
    }
    await interaction.reply({
        content: `In welchen Slot möchtest du bei **${escapeMarkdown(String(event.title || ''))}** wechseln?`,
        components: rows,
        flags: MessageFlags.Ephemeral
    });
}

module.exports = {
    formatStatusWithSlot,
    loadUpcomingRegistrations,
    buildMyEventsMessage,
    handleMyEventsCommand,
    handleMyLeaveButton,
    handleMyLeaveCancelButton,
    handleMySwitchButton
};
