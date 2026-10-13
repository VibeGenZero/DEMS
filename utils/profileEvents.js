/**
 * The two lists of the profile page: what a member is registered for next
 * and what lies behind them. Pure helpers without database access;
 * routes/user.js loads registrations and events. "Over" follows the rule of
 * the event overview (isEventOver in eventListing.js).
 */
const { isEventOver, parseDate } = require('./eventListing');
const { getSlots, findSlot } = require('./slotService');

// Event statuses that end the waiting, whatever the date says
const CLOSED_STATUSES = ['cancelled', 'archived'];
// Registrations without a slot that still name the one they hope for
const WISH_STATUSES = ['pending', 'waitlisted'];

/**
 * Slot shown next to a registration.
 *
 * @param {Object} registration -> Registration data.
 * @param {Object} event -> Event data.
 * @returns {{ name: string, emoji: string, wish: boolean }|null} -> The slot taken; for a pending or waitlisted registration without one its main role with `wish: true`; null without slots or when the slot no longer exists.
 */
function profileSlot(registration, event) {
    const slots = getSlots(event);
    const describe = (slot, wish) => ({ name: String(slot.name || ''), emoji: String(slot.emoji || ''), wish });
    const taken = registration.slotId ? findSlot(slots, registration.slotId) : null;
    if (taken) return describe(taken, false);
    if (!WISH_STATUSES.includes(registration.status) || !registration.preferredSlotId) return null;
    const wished = findSlot(slots, registration.preferredSlotId);
    return wished ? describe(wished, true) : null;
}

/**
 * One entry of the profile lists: the registration and the few event fields the page shows.
 *
 * @param {Object} registration -> Registration with `id` and `eventId`.
 * @param {Object|null} event -> Event data, null when the event was deleted.
 * @returns {Object} -> `{ id, status, checkedIn, createdAt, slot, event }`; `event` is `{ id, title, startDate, endDate, status, category, location, checkinEnabled }` or null. Never carries the check-in code.
 */
function toProfileEntry(registration, event) {
    return {
        id: registration.id,
        status: registration.status || '',
        checkedIn: registration.checkedIn === true,
        createdAt: registration.createdAt || '',
        slot: event ? profileSlot(registration, event) : null,
        event: event ? {
            id: registration.eventId,
            title: event.title || '',
            startDate: event.startDate || '',
            endDate: event.endDate || '',
            status: event.status || '',
            category: event.category || '',
            location: String((event.location && event.location.text) || ''),
            // A check-in needs the switch and a generated code (POST /api/events/:id/checkin)
            checkinEnabled: Boolean(event.checkinEnabled && event.checkinCode)
        } : null
    };
}

/**
 * Start of an entry's event.
 *
 * @param {Object} entry -> Profile entry.
 * @returns {number|null} -> Milliseconds, or null without an event or a readable start.
 */
function startTime(entry) {
    const start = entry.event ? parseDate(entry.event.startDate) : null;
    return start ? start.getTime() : null;
}

/**
 * Day an entry was registered.
 *
 * @param {Object} entry -> Profile entry.
 * @returns {number} -> Milliseconds, 0 without a readable date.
 */
function createdTime(entry) {
    const created = parseDate(entry.createdAt);
    return created ? created.getTime() : 0;
}

// Next event first; events without a date go to the end; equal starts keep the order of registering
function byStartAscending(a, b) {
    const startA = startTime(a);
    const startB = startTime(b);
    if (startA === null || startB === null) {
        if (startA !== startB) return startA === null ? 1 : -1;
        return createdTime(a) - createdTime(b);
    }
    return startA - startB || createdTime(a) - createdTime(b);
}

// Latest event first; without an event or a start the registration date stands in
function byDateDescending(a, b) {
    return (startTime(b) ?? createdTime(b)) - (startTime(a) ?? createdTime(a));
}

/**
 * Split a member's registrations into what is coming up and what is over.
 *
 * @param {Array<Object>} registrations -> Registrations with `id`, every status included.
 * @param {Map<string, Object>} eventsById -> Event data by id; deleted events are missing.
 * @param {Date} [now] -> Reference time.
 * @returns {{ upcoming: Array<Object>, history: Array<Object> }} -> Entries of toProfileEntry(). `history` holds deleted, cancelled, archived and ended events, latest first; `upcoming` everything else by start.
 */
function buildProfileEvents(registrations, eventsById, now = new Date()) {
    const upcoming = [];
    const history = [];
    for (const registration of registrations) {
        const event = eventsById.get(registration.eventId) || null;
        const closed = !event || CLOSED_STATUSES.includes(event.status) || isEventOver(event, now);
        (closed ? history : upcoming).push(toProfileEntry(registration, event));
    }
    return { upcoming: upcoming.sort(byStartAscending), history: history.sort(byDateDescending) };
}

module.exports = { buildProfileEvents, toProfileEntry };
