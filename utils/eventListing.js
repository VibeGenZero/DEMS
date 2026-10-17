/**
 * Pure helpers for listing events: when an event is over and how the
 * signed-in member takes part. No database or bot access, so the routes
 * and bot.js share them without a require cycle. The overview cards in
 * public/js/events/cards.js apply the same end rule in the browser.
 */

// Without an end date an event counts as two hours long
const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000;
// Own registrations that put the member on the event's list
const OWN_STATUSES = ['accepted', 'pending', 'waitlisted'];
// Registrations whose guests count as taking part
const HOST_STATUSES = ['accepted', 'pending'];

/**
 * Parse a stored date; older events use a space instead of the T.
 *
 * @param {string} value -> ISO date or empty.
 * @returns {Date|null} -> The date, or null when there is none or it is invalid.
 */
function parseDate(value) {
    if (!value) return null;
    const date = new Date(String(value).replace(' ', 'T'));
    return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * End of an event.
 *
 * @param {Object} event -> Event data with `startDate` and optional `endDate`.
 * @returns {Date|null} -> `endDate`, else start + 2 hours; null without a valid start. An end before the start counts as missing.
 */
function eventEndTime(event) {
    const start = parseDate(event.startDate);
    if (!start) return null;
    const end = parseDate(event.endDate);
    return end && end >= start ? end : new Date(start.getTime() + DEFAULT_DURATION_MS);
}

/**
 * Whether an event has ended.
 *
 * @param {Object} event -> Event data.
 * @param {Date} [now] -> Reference time.
 * @returns {boolean} -> True once the end lies before `now`; events without a date are never over.
 */
function isEventOver(event, now = new Date()) {
    const end = eventEndTime(event);
    return end !== null && end < now;
}

/**
 * The date that stands for a series in the event list.
 *
 * @param {Array<Object>} seriesEvents -> Events of one series, sorted by start.
 * @param {Date} [now] -> Reference time.
 * @returns {Object} -> The first date that is not over (a running one included), else the last date.
 */
function pickSeriesRepresentative(seriesEvents, now = new Date()) {
    return seriesEvents.find(event => !isEventOver(event, now)) || seriesEvents[seriesEvents.length - 1];
}

/**
 * Status of a member for one event, as the overview marks it.
 *
 * @param {Array<Object>} registrations -> Registrations of the event (`userId`, `status`, `guests`).
 * @param {string} userId -> Discord user ID of the member.
 * @returns {string|null} -> Own `accepted`/`pending`/`waitlisted`, else `guest` in an accepted or pending registration, else null.
 */
function myRegistrationStatus(registrations, userId) {
    if (!userId) return null;
    const own = registrations.find(registration => registration.userId === userId);
    if (own && OWN_STATUSES.includes(own.status)) return own.status;
    const host = registrations.find(registration => HOST_STATUSES.includes(registration.status)
        && Array.isArray(registration.guests) && registration.guests.includes(userId));
    return host ? 'guest' : null;
}

module.exports = { DEFAULT_DURATION_MS, parseDate, eventEndTime, isEventOver, pickSeriesRepresentative, myRegistrationStatus };
