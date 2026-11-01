/**
 * Member info commands (B-12): `/abstimmungen` lists the open date polls with
 * „Abstimmen“, `/event info` shows an event in the layout of its
 * announcement. Both answer privately and post nothing.
 */
const {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, TextDisplayBuilder, escapeMarkdown
} = require('discord.js');
const { db, collection, doc, getDoc, getDocs, query, where } = require('../firebaseAdmin');
const { isEventOver } = require('../utils/eventListing');
const { toProfileEntry } = require('../utils/profileEvents');
const { waitlistPositions } = require('../utils/capacity');
const { buildPollUrl, buildSiteUrl } = require('../utils/eventUrl');
const { isPollOpen, canVote } = require('../utils/pollService');
const { POLL_VOTE_PREFIX, TIMEZONE } = require('./constants');
const { DEMS_ACCENT } = require('./layout');
const { resolveInteractionRoles } = require('./registration');
const { buildEventAnnouncement } = require('./messages');
const { formatStatusWithSlot } = require('./myEvents');
const { hasAdminRole } = require('./adminCommands');

// Polls listed in one answer (each: text + one row; keeps far below the 40 components)
const POLLS_MAX = 5;
const AUTOCOMPLETE_MAX = 25;
const EVENT_NOT_FOUND = '❌ Event nicht gefunden.';

/** Deadline in the server time zone, e.g. "Fr., 06.11., 18:00". */
const formatDeadline = (iso) => new Date(iso).toLocaleString('de-DE', {
    timeZone: TIMEZONE, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
});

/**
 * Open polls the member may vote in, soonest deadline first (none last).
 *
 * @param {string} userId -> Discord user id.
 * @param {Array<string>} roleIds -> The member's role ids.
 * @param {Date} [now] -> Reference time.
 * @returns {Promise<Array<{ poll: Object, voted: boolean }>>}
 */
async function loadOpenPollsFor(userId, roleIds, now = new Date()) {
    const polls = (await getDocs(collection(db, 'polls'))).docs
        .map(pollDoc => ({ id: pollDoc.id, ...pollDoc.data() }))
        .filter(poll => isPollOpen(poll, now) && canVote(poll, roleIds));
    if (polls.length === 0) return [];

    const votedPollIds = new Set((await getDocs(collection(db, 'pollVotes'))).docs
        .map(voteDoc => voteDoc.data())
        .filter(vote => vote.userId === userId)
        .map(vote => vote.pollId));
    const deadlineOf = (poll) => (poll.deadline ? new Date(poll.deadline).getTime() : Infinity);
    return polls
        .sort((a, b) => deadlineOf(a) - deadlineOf(b) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
        .map(poll => ({ poll, voted: votedPollIds.has(poll.id) }));
}

/**
 * Text block of one poll: title, dates and deadline, own state.
 *
 * @param {{ poll: Object, voted: boolean }} item
 * @returns {string} -> Discord markdown.
 */
function formatPollEntry({ poll, voted }) {
    const count = Array.isArray(poll.options) ? poll.options.length : 0;
    const until = poll.deadline ? `bis ${formatDeadline(poll.deadline)}` : 'ohne Frist';
    return [
        `**${escapeMarkdown(String(poll.title || ''))}**`,
        `🗓️ ${count} Termine · ${until}`,
        voted ? '✅ Du hast abgestimmt' : '🗳️ Noch nicht abgestimmt'
    ].join('\n');
}

/**
 * The private answer of /abstimmungen.
 *
 * @param {Array<{ poll: Object, voted: boolean }>} items -> From loadOpenPollsFor.
 * @returns {Object} -> Payload for editReply.
 */
function buildOpenPollsMessage(items) {
    if (items.length === 0) {
        return { content: `📭 Gerade läuft keine Abstimmung. Alle Abstimmungen: ${buildSiteUrl('polls')}` };
    }
    const container = new ContainerBuilder()
        .setAccentColor(DEMS_ACCENT)
        .addTextDisplayComponents(text => text.setContent('## 🗳️ Offene Abstimmungen'));
    for (const item of items.slice(0, POLLS_MAX)) {
        container
            .addTextDisplayComponents(text => text.setContent(formatPollEntry(item)))
            .addActionRowComponents(new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`${POLL_VOTE_PREFIX}:${item.poll.id}`).setLabel('Abstimmen').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setURL(buildPollUrl(item.poll.id)).setLabel('Ansehen').setStyle(ButtonStyle.Link)
            ));
    }
    const hidden = items.length - POLLS_MAX;
    if (hidden > 0) {
        container.addTextDisplayComponents(text => text.setContent(`… und ${hidden} weitere — alle Abstimmungen: ${buildSiteUrl('polls')}`));
    }
    return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/**
 * /abstimmungen: the open polls of the member, privately.
 *
 * @param {Object} interaction -> Chat input command.
 * @returns {Promise<void>}
 */
async function handlePollsCommand(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const roleIds = await resolveInteractionRoles(interaction);
    const items = await loadOpenPollsFor(interaction.user.id, roleIds);
    await interaction.editReply(buildOpenPollsMessage(items));
}

/**
 * Offer active events that are not over while a member types the option
 * `event` of /event info; the next event first.
 *
 * @param {Object} interaction -> Autocomplete interaction.
 * @returns {Promise<void>}
 */
async function handleEventInfoAutocomplete(interaction) {
    try {
        const typed = String(interaction.options.getFocused() || '').toLowerCase();
        const now = new Date();
        const snapshot = await getDocs(query(collection(db, 'events'), where('status', '==', 'active')));
        const choices = snapshot.docs
            .map(eventDoc => ({ id: eventDoc.id, ...eventDoc.data() }))
            .filter(event => String(event.title || '').toLowerCase().includes(typed) && !isEventOver(event, now))
            .sort((a, b) => String(a.startDate || '').localeCompare(String(b.startDate || '')))
            .slice(0, AUTOCOMPLETE_MAX)
            .map(event => ({ name: String(event.title).substring(0, 100), value: event.id }));
        await interaction.respond(choices);
    } catch {
        await interaction.respond([]).catch(() => {});
    }
}

/**
 * Status line of the member's own registration, or '' without one.
 *
 * @param {string} eventId -> Event document id.
 * @param {Object} event -> Event data.
 * @param {string} userId -> Discord user id.
 * @returns {Promise<string>}
 */
async function ownStatusLine(eventId, event, userId) {
    // utils/eventUtils.js loads bot.js -> required when used, not while bot.js loads this module
    const { loadEventRegistrations } = require('../utils/eventUtils');
    const registrations = await loadEventRegistrations(eventId);
    const own = registrations.find(registration => registration.userId === userId);
    if (!own) return '';
    const place = own.status === 'waitlisted' ? waitlistPositions(registrations).get(own.id) || null : null;
    return `Dein Status: ${formatStatusWithSlot(toProfileEntry(own, event, place))}`;
}

/**
 * The private answer of /event info: the announcement layout plus the own status.
 *
 * @param {string} eventId -> Event document id.
 * @param {Object} event -> Event data.
 * @param {Object} roster -> From loadEventRoster.
 * @param {string} statusLine -> Own status, or ''.
 * @returns {Object} -> V2 payload for editReply.
 */
function buildEventInfoMessage(eventId, event, roster, statusLine) {
    const message = buildEventAnnouncement(event, eventId, roster);
    const components = statusLine ? [...message.components, new TextDisplayBuilder().setContent(statusLine)] : message.components;
    return { flags: MessageFlags.IsComponentsV2, components };
}

/**
 * /event info event:<id>: the event details, privately. Drafts and archived
 * events exist only for admins, as on the website.
 *
 * @param {Object} interaction -> Chat input command.
 * @returns {Promise<void>}
 */
async function handleEventInfoCommand(interaction) {
    const { isEventVisibleTo, loadEventRoster } = require('../utils/eventUtils');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const eventId = interaction.options.getString('event');
    const snap = eventId ? await getDoc(doc(db, 'events', eventId)) : null;
    const event = snap?.exists() ? snap.data() : null;
    if (!event || !isEventVisibleTo({ isAdmin: await hasAdminRole(interaction) }, event)) {
        await interaction.editReply({ content: EVENT_NOT_FOUND });
        return;
    }
    const roster = await loadEventRoster(eventId, event);
    const statusLine = await ownStatusLine(eventId, event, interaction.user.id);
    await interaction.editReply(buildEventInfoMessage(eventId, event, roster, statusLine));
}

module.exports = {
    loadOpenPollsFor,
    buildOpenPollsMessage,
    handlePollsCommand,
    handleEventInfoAutocomplete,
    buildEventInfoMessage,
    handleEventInfoCommand
};
