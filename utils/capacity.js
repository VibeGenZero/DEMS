/**
 * Capacity counting shared by registrations and waitlist promotion.
 *
 * A registration occupies one place for the registrant, one per confirmed
 * guest and one per guest invitation that is still open -> an invitation
 * reserves its place until the guest answers.
 */

/** Registration statuses that occupy a place. */
// An offered place (B-15) is held for the member until they confirm or the offer runs out
const OCCUPYING_STATUSES = ['pending', 'accepted', 'offered'];

/** Non-binding „Vielleicht“ answer (B-17): on the bench, takes no place and never moves up. */
const TENTATIVE_STATUS = 'tentative';

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
 * Numbers behind the places sentence of an event.
 *
 * @param {Array<Object>} registrations -> All registrations of the event.
 * @param {number} maxParticipants -> Capacity of the event, 0 = unlimited.
 * @returns {Object} -> `{ taken, capacity, guests, pending, waitlist, bench }`: taken places as the registration counts them (guests and open invitations included), how many of them are guests, how many requests wait for approval, how many registrations are on the waitlist and how many on the bench (B-17).
 */
function summarizePlaces(registrations, maxParticipants) {
    const occupying = registrations.filter(registration => OCCUPYING_STATUSES.includes(registration.status));
    return {
        taken: occupying.reduce((sum, registration) => sum + placesOf(registration), 0),
        capacity: maxParticipants > 0 ? maxParticipants : 0,
        guests: occupying.reduce((sum, registration) => sum + placesOf(registration) - 1, 0),
        pending: occupying.filter(registration => registration.status === 'pending').length,
        waitlist: registrations.filter(registration => registration.status === 'waitlisted').length,
        bench: registrations.filter(registration => registration.status === TENTATIVE_STATUS).length
    };
}

const countOf = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/**
 * The one sentence every place shows for the places of an event (website
 * and Discord), so nobody has to guess whether guests count.
 *
 * @param {Object} places -> Result of summarizePlaces().
 * @returns {string} -> e.g. "5 von 20 Plätzen belegt (inkl. 1 Gast, 1 Anfrage offen)"; without a limit "5 Plätze belegt".
 */
function formatPlaces(places) {
    const sentence = places.capacity > 0
        ? `${places.taken} von ${countOf(places.capacity, 'Platz', 'Plätzen')} belegt`
        : `${countOf(places.taken, 'Platz', 'Plätze')} belegt`;
    const details = [];
    if (places.guests > 0) details.push(`inkl. ${countOf(places.guests, 'Gast', 'Gäste')}`);
    if (places.pending > 0) details.push(`${countOf(places.pending, 'Anfrage', 'Anfragen')} offen`);
    return details.length > 0 ? `${sentence} (${details.join(', ')})` : sentence;
}

/**
 * Note about the waitlist that stands beside the places sentence.
 *
 * @param {number} waitlist -> Registrations on the waitlist.
 * @returns {string} -> "3 auf der Warteliste", empty when nobody waits.
 */
function formatWaitlist(waitlist) {
    return waitlist > 0 ? `${waitlist} auf der Warteliste` : '';
}

/**
 * Note about the bench (B-17) that stands beside the places sentence.
 *
 * @param {number} bench -> Tentative registrations of the event.
 * @returns {string} -> "2 auf der Ersatzbank", empty when the bench is empty.
 */
function formatBench(bench) {
    return bench > 0 ? `${bench} auf der Ersatzbank` : '';
}

/**
 * Places of an event as every view shows them: the numbers plus the sentence.
 *
 * @param {Array<Object>} registrations -> All registrations of the event.
 * @param {number} maxParticipants -> Capacity of the event, 0 = unlimited.
 * @returns {Object} -> `{ taken, capacity, guests, pending, waitlist, bench, text, waitlistText, benchText }`.
 */
function describePlaces(registrations, maxParticipants) {
    const places = summarizePlaces(registrations, maxParticipants);
    return {
        ...places,
        text: formatPlaces(places),
        waitlistText: formatWaitlist(places.waitlist),
        benchText: formatBench(places.bench)
    };
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
 * Waitlist position of every waitlisted registration of one event (W-05):
 * rank by registration time, oldest first, the order in which the waitlist moves up.
 * Slot events use the same single list. Equal times are ordered by id, so the numbers stay stable.
 *
 * @param {Array<Object>} registrations -> All registrations of the event.
 * @returns {Map<string, {position: number, total: number}>} -> Position per registration id; only waitlisted ones.
 */
function waitlistPositions(registrations) {
    const waiting = registrations
        .filter(registration => registration.status === 'waitlisted')
        .sort((a, b) => byCreatedAt(a, b) || String(a.id).localeCompare(String(b.id)));
    return new Map(waiting.map((registration, index) => [registration.id, { position: index + 1, total: waiting.length }]));
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
    TENTATIVE_STATUS,
    placesOf,
    countOccupiedPlaces,
    summarizePlaces,
    formatPlaces,
    formatWaitlist,
    formatBench,
    describePlaces,
    byCreatedAt,
    waitlistPositions,
    pickCapacityPromotions
};
