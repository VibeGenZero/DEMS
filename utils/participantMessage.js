/**
 * Message of the team to the participants of one event (W-09): who is
 * addressed, the DM text and the sending loop. Pure apart from the injected
 * `send` (bot.js#sendDM in routes/admin.js); the DM choices of W-16 do not
 * apply, like for accept/reject DMs.
 */

/** Recipient groups -> registration statuses they reach. Rejected never. */
const MESSAGE_GROUPS = {
    accepted: ['accepted'],
    all: ['accepted', 'pending', 'waitlisted', 'offered']
};
const MAX_MESSAGE_LENGTH = 1500;

/**
 * Users a group reaches: registrants with a matching status and their accepted guests.
 *
 * @param {Array<Object>} registrations -> Registrations of one event.
 * @param {string} group -> Key of MESSAGE_GROUPS; anything else reaches nobody.
 * @returns {string[]} -> User ids, each once; open guest invitations are left out.
 */
function messageRecipients(registrations, group) {
    const statuses = Object.hasOwn(MESSAGE_GROUPS, group) ? MESSAGE_GROUPS[group] : [];
    const userIds = new Set();
    for (const registration of registrations) {
        if (!statuses.includes(registration.status)) continue;
        if (registration.userId) userIds.add(registration.userId);
        (Array.isArray(registration.guests) ? registration.guests : []).forEach(guestId => userIds.add(guestId));
    }
    return [...userIds];
}

/**
 * How many people each group reaches.
 *
 * @param {Array<Object>} registrations -> Registrations of one event.
 * @returns {{ accepted: number, all: number }} -> Numbers only, no ids.
 */
function recipientCounts(registrations) {
    return {
        accepted: messageRecipients(registrations, 'accepted').length,
        all: messageRecipients(registrations, 'all').length
    };
}

/**
 * Check the text the admin typed.
 *
 * @param {*} text -> Body value.
 * @returns {{ text: string }|{ error: string }} -> The trimmed text, or the German reason.
 */
function validateMessageText(text) {
    const trimmed = typeof text === 'string' ? text.trim() : '';
    if (!trimmed) return { error: 'Bitte gib eine Nachricht ein.' };
    if (trimmed.length > MAX_MESSAGE_LENGTH) return { error: `Die Nachricht darf höchstens ${MAX_MESSAGE_LENGTH} Zeichen lang sein.` };
    return { text: trimmed };
}

/**
 * The DM as plain text, so line breaks and Discord markdown stay as typed.
 * Twin: buildParticipantMessagePreview in public/js/admin/participant-message.js
 * (test/fixtures/participantMessageCases.js keeps both equal).
 *
 * @param {Object} input -> `{ title, text, sender, url }`.
 * @returns {string}
 */
function buildParticipantMessage({ title, text, sender, url }) {
    return [
        `📣 **Nachricht zum Event „${String(title ?? '')}“**`,
        '',
        String(text ?? '').trim(),
        '',
        `— ${String(sender ?? '')} · Alle Infos: ${String(url ?? '')}`
    ].join('\n');
}

/**
 * Send the message to everybody the group reaches, one after another.
 *
 * @param {Object} options
 * @param {Array<Object>} options.registrations -> Registrations of the event.
 * @param {string} options.group -> Key of MESSAGE_GROUPS.
 * @param {string} options.title -> Event title.
 * @param {string} options.text -> Validated text.
 * @param {string} options.sender -> Display name of the admin.
 * @param {string} options.url -> Link to the event page.
 * @param {Function} options.send -> (userId, message) → true when delivered; a throw counts as not delivered.
 * @returns {Promise<{ recipients: number, delivered: number }>}
 */
async function sendParticipantMessage({ registrations, group, title, text, sender, url, send }) {
    const recipients = messageRecipients(registrations, group);
    const message = buildParticipantMessage({ title, text, sender, url });
    let delivered = 0;
    for (const userId of recipients) {
        try {
            if (await send(userId, message)) delivered++;
        } catch (err) {
            console.error(`[participantMessage] DM to ${userId} failed:`, err.message);
        }
    }
    return { recipients: recipients.length, delivered };
}

module.exports = {
    MESSAGE_GROUPS,
    MAX_MESSAGE_LENGTH,
    messageRecipients,
    recipientCounts,
    validateMessageText,
    buildParticipantMessage,
    sendParticipantMessage
};
