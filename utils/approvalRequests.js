/**
 * Data side of the approval requests in Discord (B-06), without discord.js:
 * which registration gets a request, where its message is stored and how a
 * closed request reads. Used by bot/approvals.js and its twin in dev/mockBot.js.
 */
const { db, doc, getDoc, updateDoc } = require('../firebaseAdmin');
const { loadBotSettings } = require('./botSettings');

/**
 * Result line of a closed request.
 *
 * @param {{ status: string, actorName?: string }} outcome -> Why the request is no longer open.
 * @returns {string} -> German line with its symbol.
 */
function formatOutcome({ status, actorName = '' }) {
    const by = actorName ? ` von ${String(actorName)}` : '';
    const lines = {
        accepted: `✅ Angenommen${by}`,
        rejected: `❌ Abgelehnt${by}`,
        waitlisted: `🕒 Auf die Warteliste gesetzt${by}`,
        withdrawn: '↩️ Vom Mitglied zurückgezogen',
        cancelled: '🚫 Event abgesagt',
        deleted: '🗑️ Event gelöscht'
    };
    return lines[status] || 'ℹ️ Nicht mehr offen';
}

/**
 * The registration and event a request is posted for.
 *
 * @param {string} registrationId -> The registration document ID.
 * @returns {Promise<{ channelId: string, registration: Object, event: Object }|null>} -> Null without approval channel, for unknown data or a registration that is not pending.
 */
async function loadApprovalRequest(registrationId) {
    const { approvalChannel } = await loadBotSettings();
    if (!approvalChannel) return null;
    const regSnap = await getDoc(doc(db, 'registrations', registrationId));
    if (!regSnap.exists()) return null;
    const registration = { id: registrationId, ...regSnap.data() };
    if (registration.status !== 'pending') return null;
    const eventSnap = await getDoc(doc(db, 'events', registration.eventId));
    if (!eventSnap.exists()) return null;
    return { channelId: approvalChannel, registration, event: eventSnap.data() };
}

/**
 * Remember where the request of a registration was posted.
 *
 * @param {string} registrationId -> The registration document ID.
 * @param {{ channelId: string, messageId: string }} sent -> The posted message.
 * @returns {Promise<Object>} -> The stored `approvalMessage`.
 */
async function storeApprovalMessage(registrationId, sent) {
    const approvalMessage = { channelId: sent.channelId, messageId: sent.messageId };
    await updateDoc(doc(db, 'registrations', registrationId), { approvalMessage });
    return approvalMessage;
}

/**
 * Event data for closing a request.
 *
 * @param {Object} registration -> Registration data.
 * @param {Object|null} event -> Event data when the caller has it.
 * @returns {Promise<Object>} -> Event data, `{}` when the event is gone.
 */
async function eventForClosing(registration, event) {
    if (event) return event;
    const eventSnap = await getDoc(doc(db, 'events', registration.eventId));
    return eventSnap.exists() ? eventSnap.data() : {};
}

/**
 * The stored message of a request, when there is one.
 *
 * @param {Object} registration -> Registration data.
 * @returns {{ channelId: string, messageId: string }|null} -> Where the request was posted.
 */
function storedApprovalMessage(registration) {
    const stored = registration && registration.approvalMessage;
    return stored && stored.channelId && stored.messageId ? stored : null;
}

/**
 * Close the requests of every pending registration in a list (event cancelled or deleted).
 *
 * @param {Array<Object>} registrations -> Registration data of one event.
 * @param {{ status: string, actorName?: string }} outcome -> Why the requests are closed.
 * @param {Object|null} event -> Event data, also after the event was deleted.
 * @returns {Promise<number>} -> Number of edited messages.
 */
async function closePendingRequests(registrations, outcome, event) {
    // Required lazily -> mock mode merges dev/mockBot.js into the bot exports
    const { closeApprovalRequest } = require('../bot');
    let closed = 0;
    for (const registration of registrations) {
        if (registration.status !== 'pending' || !storedApprovalMessage(registration)) continue;
        if (await closeApprovalRequest(registration, outcome, event)) closed += 1;
    }
    return closed;
}

/**
 * Name of an admin as the closed request shows it.
 *
 * @param {Object} user -> Session user or Discord actor.
 * @returns {string} -> Display name, else user name, else ''.
 */
function actorName(user) {
    return String((user && (user.displayName || user.globalName || user.username)) || '');
}

module.exports = {
    formatOutcome, loadApprovalRequest, storeApprovalMessage, eventForClosing, storedApprovalMessage,
    closePendingRequests, actorName
};
