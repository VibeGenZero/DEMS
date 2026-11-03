/**
 * Check-in rules shared by the code check-in of the website and the
 * „Einchecken“ button in Discord (B-07): when check-in is open, checking a
 * member in, and who still needs a check-in invitation. No discord.js, so
 * routes, bot/ and dev/mockBot.js can all use it.
 */
const { db, collection, doc, getDoc, getDocs, updateDoc, query, where } = require('../firebaseAdmin');
const { parseDate, isEventOver } = require('./eventListing');

/**
 * Whether an event has check-in switched on.
 *
 * @param {Object} event -> Event data.
 * @returns {boolean} -> True for an active event with `checkinEnabled` and a generated code.
 */
function isCheckinActive(event) {
    return Boolean(event && event.status === 'active' && event.checkinEnabled && event.checkinCode);
}

/**
 * Whether members can check in through Discord right now.
 *
 * @param {Object} event -> Event data.
 * @param {Date} [now] -> Reference time.
 * @returns {boolean} -> True while check-in is active, the event has started and is not over.
 */
function isCheckinRunning(event, now = new Date()) {
    if (!isCheckinActive(event)) return false;
    const start = parseDate(event.startDate);
    return start !== null && now >= start && !isEventOver(event, now);
}

/**
 * The accepted registration of a member for an event.
 *
 * @param {string} eventId -> Event document id.
 * @param {string} userId -> Discord user id.
 * @returns {Promise<{ id: string, data: Object }|null>} -> The registration, or null without one.
 */
async function findAcceptedRegistration(eventId, userId) {
    const snapshot = await getDocs(query(
        collection(db, 'registrations'),
        where('eventId', '==', eventId),
        where('userId', '==', userId),
        where('status', '==', 'accepted')
    ));
    if (snapshot.empty) return null;
    const regDoc = snapshot.docs[0];
    return { id: regDoc.id, data: regDoc.data() };
}

/**
 * Check a member in.
 *
 * @param {Object} options
 * @param {string} options.eventId -> Event document id.
 * @param {string} options.userId -> Discord user id of the member.
 * @param {Date} [options.now] -> Check-in time.
 * @param {boolean} [options.requireRunning] -> Discord button: the event must be active, started and not over.
 *   The code route leaves it off and keeps its old rules (switch and code only).
 * @returns {Promise<Object>} -> `{ ok: true, alreadyCheckedIn, checkedInAt, event }` or `{ ok: false, code, event? }`
 *   with code `not_found`, `not_active`, `disabled`, `not_started`, `over` or `no_registration`.
 */
async function checkInMember({ eventId, userId, now = new Date(), requireRunning = false }) {
    const eventSnap = await getDoc(doc(db, 'events', eventId));
    if (!eventSnap.exists()) return { ok: false, code: 'not_found' };
    const event = eventSnap.data();

    if (requireRunning && event.status !== 'active') return { ok: false, code: 'not_active', event };
    if (!event.checkinEnabled || !event.checkinCode) return { ok: false, code: 'disabled', event };
    if (requireRunning) {
        const start = parseDate(event.startDate);
        if (!start || now < start) return { ok: false, code: 'not_started', event };
        if (isEventOver(event, now)) return { ok: false, code: 'over', event };
    }

    const registration = await findAcceptedRegistration(eventId, userId);
    if (!registration) return { ok: false, code: 'no_registration', event };

    if (registration.data.checkedIn) {
        return { ok: true, alreadyCheckedIn: true, checkedInAt: registration.data.checkedInAt || null, event };
    }
    const checkedInAt = now.toISOString();
    await updateDoc(doc(db, 'registrations', registration.id), { checkedIn: true, checkedInAt });
    return { ok: true, alreadyCheckedIn: false, checkedInAt, event };
}

/**
 * Registrations that still need a check-in invitation.
 *
 * @param {string} eventId -> Event document id.
 * @returns {Promise<Array<{ id: string, userId: string }>>} -> Accepted, not checked in, not invited yet; in creation order.
 */
async function listCheckinInvitees(eventId) {
    const snapshot = await getDocs(query(
        collection(db, 'registrations'),
        where('eventId', '==', eventId),
        where('status', '==', 'accepted')
    ));
    return snapshot.docs
        .map(regDoc => ({ id: regDoc.id, ...regDoc.data() }))
        .filter(registration => !registration.checkedIn && !registration.checkinInvitedAt)
        .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
        .map(registration => ({ id: registration.id, userId: registration.userId }));
}

/**
 * Record that a registration got its check-in invitation (written before the DM).
 *
 * @param {string} registrationId -> Registration document id.
 * @param {Date} [now] -> Invitation time.
 * @returns {Promise<void>}
 */
async function markInvited(registrationId, now = new Date()) {
    await updateDoc(doc(db, 'registrations', registrationId), { checkinInvitedAt: now.toISOString() });
}

module.exports = {
    isCheckinActive,
    isCheckinRunning,
    findAcceptedRegistration,
    checkInMember,
    listCheckinInvitees,
    markInvited
};
