/**
 * Check-in rules shared by the code check-in of the website and the
 * „Einchecken“ button in Discord (B-07): when check-in is open, checking a
 * member in, and who still needs a check-in invitation. No discord.js, so
 * routes, bot/ and dev/mockBot.js can all use it.
 */
const { db, collection, doc, getDoc, getDocs, updateDoc, query, where } = require('../firebaseAdmin');
const { parseDate, isEventOver } = require('./eventListing');
const { withEventLock } = require('./eventLock');
const { isListedGuest, guestCheckinOf } = require('./participations');

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
 * The accepted registration of an event that lists a member as guest (#110).
 *
 * @param {string} eventId -> Event document id.
 * @param {string} userId -> Discord user id of the guest.
 * @returns {Promise<{ id: string, data: Object }|null>} -> The inviting registration, or null.
 */
async function findAcceptedGuestRegistration(eventId, userId) {
    const snapshot = await getDocs(query(
        collection(db, 'registrations'),
        where('eventId', '==', eventId),
        where('status', '==', 'accepted')
    ));
    const regDoc = snapshot.docs.find(candidate => isListedGuest(candidate.data(), userId));
    return regDoc ? { id: regDoc.id, data: regDoc.data() } : null;
}

/**
 * Change the check-in entry of one guest. Runs under the event lock with a fresh
 * read and writes the whole map, because the guest buttons write the same document.
 *
 * @param {string} eventId -> Event document id (lock key).
 * @param {string} registrationId -> The inviting registration.
 * @param {string} guestId -> Discord user id of the guest.
 * @param {Function} change -> (current entry, registration) => new entry, or null to leave everything as it is.
 * @returns {Promise<Object|null>} -> `{ before, after }` entries, null when the guest is not listed (any more).
 */
function updateGuestCheckin(eventId, registrationId, guestId, change) {
    return withEventLock(eventId, async () => {
        const snap = await getDoc(doc(db, 'registrations', registrationId));
        if (!snap.exists() || !isListedGuest(snap.data(), guestId)) return null;
        const registration = snap.data();
        const before = guestCheckinOf(registration, guestId);
        const after = change(before, registration);
        if (after) {
            await updateDoc(doc(db, 'registrations', registrationId), {
                guestCheckins: { ...(registration.guestCheckins || {}), [guestId]: after }
            });
        }
        return { before, after: after || before, registration };
    });
}

/**
 * Check a guest in on the inviting registration.
 */
async function checkInGuest(eventId, registration, userId, now, event) {
    const checkedInAt = now.toISOString();
    // The status is checked again under the lock: a registration that just left „accepted“ gets no check-in
    const result = await updateGuestCheckin(eventId, registration.id, userId, (entry, current) => (
        entry.checkedIn || current.status !== 'accepted' ? null : { ...entry, checkedIn: true, checkedInAt }
    ));
    if (!result || result.registration.status !== 'accepted') return { ok: false, code: 'no_registration', event };
    if (result.before.checkedIn) {
        return { ok: true, alreadyCheckedIn: true, checkedInAt: result.before.checkedInAt, event, asGuest: true };
    }
    return { ok: true, alreadyCheckedIn: false, checkedInAt, event, asGuest: true };
}

/**
 * Admin tick-off of a guest (W-07 for guests, #110): sets or takes back the check-in
 * under the event lock; a registration that is no longer accepted is refused there.
 *
 * @param {Object} options -> `{ registrationId, guestId, checkedIn: boolean, now }`.
 * @returns {Promise<Object|null>} -> The guest's new `{ checkedIn, checkedInAt, checkinInvitedAt }`,
 *   null for a missing or not accepted registration or a guest who is not listed.
 */
async function setGuestCheckin({ registrationId, guestId, checkedIn, now = new Date() }) {
    const snap = await getDoc(doc(db, 'registrations', registrationId));
    if (!snap.exists()) return null;
    let refused = false;
    const result = await updateGuestCheckin(snap.data().eventId, registrationId, guestId, (entry, current) => {
        if (current.status !== 'accepted') {
            refused = true;
            return null;
        }
        // A repeated check-in keeps the original time
        return { ...entry, checkedIn, checkedInAt: checkedIn ? (entry.checkedIn && entry.checkedInAt) || now.toISOString() : null };
    });
    return !result || refused ? null : result.after;
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
 * @returns {Promise<Object>} -> `{ ok: true, alreadyCheckedIn, checkedInAt, event, asGuest }` or `{ ok: false, code, event? }`
 *   with code `not_found`, `not_active`, `disabled`, `not_started`, `over` or `no_registration`.
 *   Without an own accepted registration a listed guest of an accepted one is checked in there (#110).
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
    if (!registration) {
        const inviting = await findAcceptedGuestRegistration(eventId, userId);
        if (!inviting) return { ok: false, code: 'no_registration', event };
        return checkInGuest(eventId, inviting, userId, now, event);
    }

    if (registration.data.checkedIn) {
        return { ok: true, alreadyCheckedIn: true, checkedInAt: registration.data.checkedInAt || null, event, asGuest: false };
    }
    const checkedInAt = now.toISOString();
    await updateDoc(doc(db, 'registrations', registration.id), { checkedIn: true, checkedInAt });
    return { ok: true, alreadyCheckedIn: false, checkedInAt, event, asGuest: false };
}

/**
 * Registrations that still need a check-in invitation.
 *
 * @param {string} eventId -> Event document id.
 * @returns {Promise<Array<{ id: string, userId: string, guestId: string|null }>>} -> Accepted, not checked in,
 *   not invited yet; per registration in creation order the member, then its listed guests (`userId` = `guestId`).
 */
async function listCheckinInvitees(eventId) {
    const snapshot = await getDocs(query(
        collection(db, 'registrations'),
        where('eventId', '==', eventId),
        where('status', '==', 'accepted')
    ));
    const registrations = snapshot.docs
        .map(regDoc => ({ id: regDoc.id, ...regDoc.data() }))
        .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    // One invitation per person: someone with an own accepted registration is invited through it,
    // a guest of two registrations once (and not at all when one of the places already invited them)
    const handled = new Set(registrations.map(registration => registration.userId));
    for (const registration of registrations) {
        for (const guestId of registration.guests || []) {
            const entry = guestCheckinOf(registration, guestId);
            if (entry.checkedIn || entry.checkinInvitedAt) handled.add(guestId);
        }
    }
    const invitees = [];
    for (const registration of registrations) {
        if (!registration.checkedIn && !registration.checkinInvitedAt) {
            invitees.push({ id: registration.id, userId: registration.userId, guestId: null });
        }
        for (const guestId of registration.guests || []) {
            if (handled.has(guestId)) continue;
            handled.add(guestId);
            invitees.push({ id: registration.id, userId: guestId, guestId });
        }
    }
    return invitees;
}

/**
 * Record that a member or guest got the check-in invitation (written before the DM).
 *
 * @param {string} registrationId -> Registration document id.
 * @param {Date} [now] -> Invitation time.
 * @param {string|null} [guestId] -> A listed guest of the registration instead of its member.
 * @returns {Promise<void>}
 */
async function markInvited(registrationId, now = new Date(), guestId = null) {
    if (!guestId) {
        await updateDoc(doc(db, 'registrations', registrationId), { checkinInvitedAt: now.toISOString() });
        return;
    }
    const snap = await getDoc(doc(db, 'registrations', registrationId));
    if (!snap.exists()) return;
    await updateGuestCheckin(snap.data().eventId, registrationId, guestId, (entry) => ({ ...entry, checkinInvitedAt: now.toISOString() }));
}

module.exports = {
    isCheckinActive,
    isCheckinRunning,
    findAcceptedRegistration,
    findAcceptedGuestRegistration,
    updateGuestCheckin,
    setGuestCheckin,
    checkInMember,
    listCheckinInvitees,
    markInvited
};
