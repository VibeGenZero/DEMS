/**
 * Approval requests in Discord (B-06): a message per pending registration in
 * the approval channel of the bot center, with "Annehmen", "Ablehnen" and
 * "Warteliste". Decisions run changeRegistrationStatus (utils/registrationStatus.js)
 * like the website; the message is closed once the request is no longer open.
 */
const { ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, escapeMarkdown } = require('discord.js');
const {
    formatOutcome, loadApprovalRequest, storeApprovalMessage, eventForClosing, storedApprovalMessage
} = require('../utils/approvalRequests');
const { buildEventUrl } = require('../utils/eventUrl');
const { parseDate } = require('../utils/eventListing');
const { getSlots, findSlot } = require('../utils/slotService');
const { fitText, MESSAGE_TEXT_MAX } = require('./layout');
const { state } = require('./client');
const { sendChannelMessage, editChannelMessage } = require('./messages');
const {
    TIMEZONE, APPROVAL_ACCEPT_PREFIX, APPROVAL_REJECT_PREFIX, APPROVAL_WAITLIST_PREFIX
} = require('./constants');

const APPROVAL_OPEN_COLOR = 0xf59e0b;
const APPROVAL_CLOSED_COLOR = 0x6b7280;
// One answer in the message; the whole text is cut to Discord's limit as well
const ANSWER_MAX_LENGTH = 300;
// Room kept free for the heading, member lines and the result line
const ANSWERS_RESERVED_LENGTH = 1000;

/**
 * One stored form answer as text.
 *
 * @param {*} value -> Answer as stored (string, list or boolean).
 * @returns {string} -> Readable answer.
 */
function formatAnswer(value) {
    if (Array.isArray(value)) return value.join(', ');
    if (value === true) return 'Ja';
    if (value === false) return 'Nein';
    return String(value ?? '');
}

/**
 * Lines about the member: mention, wished slot, guests.
 *
 * @param {Object} registration -> Registration data.
 * @param {Object} event -> Event data.
 * @returns {string} -> Discord markdown.
 */
function formatMember(registration, event) {
    const lines = [`👤 <@${registration.userId}> (${escapeMarkdown(String(registration.userName || ''))})`];
    const wished = findSlot(getSlots(event), registration.preferredSlotId || registration.slotId);
    if (wished) lines.push(`🎯 Wunsch: ${[wished.emoji, wished.name].filter(Boolean).join(' ')}`);
    const guests = [
        ...(Array.isArray(registration.guests) ? registration.guests : []).map(id => `<@${id}>`),
        ...(Array.isArray(registration.pendingGuests) ? registration.pendingGuests : [])
            .map(guest => `${escapeMarkdown(String(guest.displayName || guest.userId))} (eingeladen)`)
    ];
    if (guests.length > 0) lines.push(`👥 Gäste: ${guests.join(', ')}`);
    return lines.join('\n');
}

/**
 * Form answers by label, each cut to ANSWER_MAX_LENGTH.
 *
 * @param {Object} formAnswers -> Answers keyed by field label.
 * @returns {string} -> Lines "**Label:** answer", '' without answers.
 */
function formatAnswers(formAnswers) {
    return Object.entries(formAnswers || {})
        .filter(([, value]) => formatAnswer(value) !== '')
        .map(([label, value]) => `**${escapeMarkdown(label)}:** ${fitText(escapeMarkdown(formatAnswer(value)), ANSWER_MAX_LENGTH)}`)
        .join('\n');
}

/**
 * The request message of one registration.
 *
 * @param {Object} registration -> Registration data with `id`, `eventId`, `userId`.
 * @param {Object} event -> Event data.
 * @param {{ status: string, actorName?: string }|null} [closed] -> Outcome once the request is no longer open.
 * @returns {{ flags: number, components: Array }} -> V2 payload: open with the three decision buttons, closed with the result line.
 */
function buildApprovalMessage(registration, event, closed = null) {
    const start = parseDate(event.startDate);
    const heading = `## 📋 Neue Anfrage: ${escapeMarkdown(String(event.title || ''))}`
        + (start ? `\n📅 ${start.toLocaleString('de-DE', { timeZone: TIMEZONE })}` : '');
    const member = formatMember(registration, event);
    const answers = fitText(formatAnswers(registration.formAnswers), MESSAGE_TEXT_MAX - ANSWERS_RESERVED_LENGTH);

    const container = new ContainerBuilder()
        .setAccentColor(closed ? APPROVAL_CLOSED_COLOR : APPROVAL_OPEN_COLOR)
        .addTextDisplayComponents(text => text.setContent(heading), text => text.setContent(member));
    if (answers) container.addTextDisplayComponents(text => text.setContent(answers));

    const link = new ButtonBuilder()
        .setLabel('Zum Event')
        .setStyle(ButtonStyle.Link)
        .setURL(buildEventUrl(registration.eventId));
    if (closed) {
        container
            .addTextDisplayComponents(text => text.setContent(`**${escapeMarkdown(formatOutcome(closed))}**`))
            .addActionRowComponents(row => row.addComponents(link));
    } else {
        container.addActionRowComponents(row => row.addComponents(
            new ButtonBuilder().setCustomId(`${APPROVAL_ACCEPT_PREFIX}:${registration.id}`).setLabel('Annehmen').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`${APPROVAL_REJECT_PREFIX}:${registration.id}`).setLabel('Ablehnen').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`${APPROVAL_WAITLIST_PREFIX}:${registration.id}`).setLabel('Warteliste').setStyle(ButtonStyle.Secondary),
            link
        ));
    }
    return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/**
 * Post the approval request of a pending registration (B-06).
 *
 * @param {string} registrationId -> The registration document ID.
 * @returns {Promise<Object|null>} -> The stored `approvalMessage`, null when nothing was posted (offline, no channel, not pending, error).
 */
async function sendApprovalRequest(registrationId) {
    if (!state.isReady) return null;
    try {
        const request = await loadApprovalRequest(registrationId);
        if (!request) return null;
        const payload = buildApprovalMessage(request.registration, request.event);
        const sent = await sendChannelMessage(request.channelId, payload, { roleIds: [] });
        if (!sent) return null;
        return await storeApprovalMessage(registrationId, sent);
    } catch (err) {
        console.error('Failed to send an approval request:', err.message);
        return null;
    }
}

/**
 * Close the request message of a registration that is no longer pending.
 *
 * Takes the registration data, not its ID, so it also works after the
 * registration was deleted (member withdrew, event deleted).
 *
 * @param {Object} registration -> Registration data with `id`, `eventId` and maybe `approvalMessage`.
 * @param {{ status: string, actorName?: string }} outcome -> Why the request is closed.
 * @param {Object|null} [event] -> Event data when the caller still has it.
 * @returns {Promise<boolean>} -> True when the message was edited.
 */
async function closeApprovalRequest(registration, outcome, event = null) {
    if (!state.isReady) return false;
    const stored = storedApprovalMessage(registration);
    if (!stored) return false;
    try {
        const eventData = await eventForClosing(registration, event);
        return await editChannelMessage(stored.channelId, stored.messageId, buildApprovalMessage(registration, eventData, outcome));
    } catch (err) {
        console.error('Failed to close an approval request:', err.message);
        return false;
    }
}

// Button action -> new status
const APPROVAL_ACTIONS = {
    [APPROVAL_ACCEPT_PREFIX]: 'accepted',
    [APPROVAL_REJECT_PREFIX]: 'rejected',
    [APPROVAL_WAITLIST_PREFIX]: 'waitlisted'
};
const STATUS_LABELS = { accepted: 'Angenommen', rejected: 'Abgelehnt', waitlisted: 'Warteliste', pending: 'Offen' };
const DECISION_REPLIES = { accepted: '✅ Angenommen.', rejected: '❌ Abgelehnt.', waitlisted: '🕒 Auf die Warteliste gesetzt.' };

/**
 * Handle „Annehmen“, „Ablehnen“ or „Warteliste“ on a request message.
 *
 * The admin role is read from the clicking member (live, not from a website
 * session); the change itself is changeRegistrationStatus, which also closes
 * the message.
 *
 * @param {import('discord.js').ButtonInteraction} interaction -> The button interaction.
 * @param {string} action -> One of the APPROVAL_* prefixes.
 * @param {string} registrationId -> The registration document ID.
 * @returns {Promise<void>}
 */
async function handleApprovalButton(interaction, action, registrationId) {
    // Acknowledge first -> DMs, roles and promotions can exceed Discord's 3 second limit
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const { resolveInteractionRoles } = require('./registration');
    const adminRoleId = process.env.DISCORD_ADMIN_ROLE_ID;
    const roleIds = await resolveInteractionRoles(interaction);
    if (!adminRoleId || !roleIds.includes(adminRoleId)) {
        return interaction.editReply({ content: '⛔ Nur Admins können Anmeldungen freigeben.' });
    }

    const { changeRegistrationStatus } = require('../utils/registrationStatus');
    const actor = {
        id: interaction.user.id,
        displayName: interaction.member?.displayName || interaction.user.globalName || interaction.user.username
    };
    const result = await changeRegistrationStatus({
        registrationId, status: APPROVAL_ACTIONS[action], actor, expectStatus: 'pending'
    });

    if (!result.ok && result.code === 'already_decided') {
        const current = result.registration.status;
        await closeApprovalRequest(result.registration, { status: current }, result.event);
        return interaction.editReply({ content: `ℹ️ Bereits entschieden: ${STATUS_LABELS[current] || current}.` });
    }
    if (!result.ok) {
        return interaction.editReply({ content: `❌ ${result.error}.` });
    }
    const warning = result.warning ? `\n⚠️ ${result.warning}` : '';
    await interaction.editReply({ content: `${DECISION_REPLIES[result.status]}${warning}` });
}

module.exports = {
    handleApprovalButton,
    buildApprovalMessage,
    sendApprovalRequest,
    closeApprovalRequest
};
