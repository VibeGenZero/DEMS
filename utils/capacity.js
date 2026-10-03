/**
 * Capacity counting shared by registrations and waitlist promotion.
 *
 * A registration occupies one place for the registrant, one per confirmed
 * guest and one per guest invitation that is still open -> an invitation
 * reserves its place until the guest answers.
 */

/** Registration statuses that occupy a place. */
const OCCUPYING_STATUSES = ['pending', 'accepted'];

/**
 * Number of places a single registration needs.
 *
 * @param {Object} registration -> Registration document data.
 * @returns {number} -> 1 + confirmed guests + open guest invitations.
 */
function placesOf(registration) {
    const confirmedGuests = Array.isArray(registration.guests) ? registration.guests.length : 0;
    const openInvitations = Array.isArray(registration.pendingGuests)
        ? registration.pendingGuests.filter(guest => guest.status === 'pending').length
        : 0;
    return 1 + confirmedGuests + openInvitations;
}

/**
 * Count the places that are currently taken at an event.
 *
 * @param {Array<Object>} registrations -> All registrations of the event.
 * @returns {number} -> Occupied places including guests.
 */
function countOccupiedPlaces(registrations) {
    return registrations
        .filter(registration => OCCUPYING_STATUSES.includes(registration.status))
        .reduce((sum, registration) => sum + placesOf(registration), 0);
}

/**
 * Sort comparator -> oldest registration first.
 *
 * @param {Object} a -> Registration.
 * @param {Object} b -> Registration.
 * @returns {number} -> Negative when `a` is older.
 */
function byCreatedAt(a, b) {
    return (a.createdAt || '').localeCompare(b.createdAt || '');
}

/**
 * Decide which waitlisted registrations of an event without slots move up.
 *
 * The waitlist is walked oldest first and every registration whose places
 * still fit moves up -> a registration with guests that does not fit yet
 * does not block a single person behind it.
 *
 * @param {number} maxParticipants -> Capacity of the event, 0 = unlimited.
 * @param {Array<Object>} registrations -> All registrations of the event.
 * @returns {string[]} -> IDs of the registrations that move up, oldest first.
 * @example
 * pickCapacityPromotions(10, registrations); // ['reg1', 'reg4']
 */
function pickCapacityPromotions(maxParticipants, registrations) {
    let occupied = countOccupiedPlaces(registrations);
    const promoted = [];

    registrations
        .filter(registration => registration.status === 'waitlisted')
        .sort(byCreatedAt)
        .forEach(registration => {
            const needed = placesOf(registration);
            if (maxParticipants > 0 && occupied + needed > maxParticipants) return;
            occupied += needed;
            promoted.push(registration.id);
        });

    return promoted;
}

module.exports = {
    OCCUPYING_STATUSES,
    placesOf,
    countOccupiedPlaces,
    byCreatedAt,
    pickCapacityPromotions
};
