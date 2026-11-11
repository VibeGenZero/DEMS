/**
 * One view per person (#110): a registration stands for its member and for
 * every guest listed in `guests`. A guest's check-in lives on the inviting
 * registration in `guestCheckins[<guestId>]` (`{ checkedIn, checkedInAt,
 * checkinInvitedAt }`). Entries of ids that are not in `guests` are ignored.
 * Pure helpers, no database access.
 */

const NO_CHECKIN = Object.freeze({ checkedIn: false, checkedInAt: null, checkinInvitedAt: null });

/**
 * Whether a user is a confirmed guest of a registration.
 *
 * @param {Object} registration -> Registration data.
 * @param {string} userId -> Discord user id.
 * @returns {boolean}
 */
function isListedGuest(registration, userId) {
    return Array.isArray(registration?.guests) && registration.guests.includes(userId);
}

/**
 * Check-in state of one guest.
 *
 * @param {Object} registration -> The inviting registration.
 * @param {string} guestId -> Discord user id of the guest.
 * @returns {{ checkedIn: boolean, checkedInAt: string|null, checkinInvitedAt: string|null }}
 */
function guestCheckinOf(registration, guestId) {
    const entry = isListedGuest(registration, guestId) ? registration.guestCheckins?.[guestId] : null;
    if (!entry) return { ...NO_CHECKIN };
    return {
        checkedIn: entry.checkedIn === true,
        checkedInAt: entry.checkedInAt || null,
        checkinInvitedAt: entry.checkinInvitedAt || null
    };
}

/**
 * The participation of one guest of a registration.
 */
function guestParticipation(registration, guestId) {
    const profile = (registration.pendingGuests || []).find(guest => guest && guest.userId === guestId);
    const { checkedIn, checkedInAt } = guestCheckinOf(registration, guestId);
    return {
        id: `${registration.id}#${guestId}`,
        registrationId: registration.id,
        eventId: registration.eventId,
        status: registration.status,
        createdAt: registration.createdAt,
        source: registration.source,
        userId: guestId,
        userName: (profile && profile.displayName) || guestId,
        userAvatar: (profile && profile.avatar) || '',
        checkedIn,
        checkedInAt,
        asGuest: true,
        hostUserId: registration.userId
    };
}

/**
 * Which entry stands for a person who appears more than once for one event (own
 * registration and guest place, or two guest places): lower wins. Matches the
 * order in which checkInMember looks for a place.
 */
function placeRank(entry) {
    const accepted = entry.status === 'accepted';
    if (!entry.asGuest) return accepted ? 0 : 2;
    return accepted ? 1 : 3;
}

/**
 * One entry per person and event: each registration for its member, then one per
 * listed guest. A person who appears more than once for the same event keeps one
 * entry: the own accepted registration, else an accepted guest place, else the own
 * registration, else the first guest place.
 *
 * @param {Array<Object>} registrations -> Registrations with `id`.
 * @returns {Array<Object>} -> The registration itself with `asGuest: false`, and guest entries
 *   `{ id: '<registrationId>#<guestId>', registrationId, eventId, status, createdAt, source, userId,
 *   userName, userAvatar, checkedIn, checkedInAt, asGuest: true, hostUserId }`.
 */
function toParticipations(registrations) {
    const participations = [];
    for (const registration of registrations) {
        participations.push({ ...registration, asGuest: false });
        if (!Array.isArray(registration.guests)) continue;
        for (const guestId of registration.guests) participations.push(guestParticipation(registration, guestId));
    }
    const best = new Map();
    for (const entry of participations) {
        if (!entry.eventId || !entry.userId) continue;
        const key = `${entry.eventId}\u0000${entry.userId}`;
        if (!best.has(key) || placeRank(entry) < placeRank(best.get(key))) best.set(key, entry);
    }
    return participations.filter(entry => !entry.eventId || !entry.userId || best.get(`${entry.eventId}\u0000${entry.userId}`) === entry);
}

/**
 * The participations of one person: own registrations and guest places.
 *
 * @param {Array<Object>} registrations -> Registrations that may concern the person.
 * @param {string} userId -> Discord user id.
 * @returns {Array<Object>}
 */
function participationsOf(registrations, userId) {
    return toParticipations(registrations).filter(entry => entry.userId === userId);
}

/**
 * Whether the member or a listed guest of a registration is checked in.
 *
 * @param {Object} registration -> Registration data.
 * @returns {boolean}
 */
function hasAnyCheckin(registration) {
    if (registration.checkedIn === true) return true;
    return (registration.guests || []).some(guestId => guestCheckinOf(registration, guestId).checkedIn);
}

/**
 * Update fields that take back the check-in of the member and of every guest;
 * invitation times stay, so nobody gets a second check-in DM.
 *
 * @param {Object} registration -> Registration data.
 * @returns {Object} -> `{ checkedIn: false, checkedInAt: null }`, plus `guestCheckins` when the registration has one.
 */
function clearedCheckins(registration) {
    const update = { checkedIn: false, checkedInAt: null };
    if (registration.guestCheckins && typeof registration.guestCheckins === 'object') {
        update.guestCheckins = Object.fromEntries(Object.entries(registration.guestCheckins).map(([guestId, entry]) => [
            guestId,
            { checkedIn: false, checkedInAt: null, checkinInvitedAt: (entry && entry.checkinInvitedAt) || null }
        ]));
    }
    return update;
}

module.exports = { isListedGuest, guestCheckinOf, toParticipations, participationsOf, hasAnyCheckin, clearedCheckins };
