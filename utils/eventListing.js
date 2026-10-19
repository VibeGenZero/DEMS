/**
 * Pure helpers for listing events: when an event is over, when its deadlines
 * close registration and unregistering (W-03), and how the
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
// German answers once a deadline has passed (W-03), shared by the service and the bot
const REGISTRATION_CLOSED_MESSAGE = 'Die Anmeldung für dieses Event ist geschlossen.';
const UNREGISTER_CLOSED_MESSAGE = 'Abmelden ist nicht mehr möglich. Wende dich an einen Admin.';

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
 * Whether members can no longer register (W-03).
 *
 * @param {Object} event -> Event data with optional `registrationDeadline`.
 * @param {Date} [now] -> Reference time.
 * @returns {boolean} -> True once the event is over or its registration deadline is reached; an invalid deadline counts as none.
 */
function isRegistrationClosed(event, now = new Date()) {
    if (isEventOver(event, now)) return true;
    const deadline = parseDate(event.registrationDeadline);
    return deadline !== null && deadline <= now;
}

/**
 * Whether members can no longer unregister themselves (W-03).
 *
 * @param {Object} event -> Event data with optional `unregisterDeadline`.
 * @param {Date} [now] -> Reference time.
 * @returns {boolean} -> True once the unregister deadline is reached; without one unregistering stays open, even after the end.
 */
function isUnregisterClosed(event, now = new Date()) {
    const deadline = parseDate(event.unregisterDeadline);
    return deadline !== null && deadline <= now;
}

/**
 * Whether an edited event keeps its "announcement refreshed at the deadline" flag (W-03).
 *
 * @param {Object} oldEvent -> Stored event before the edit.
 * @param {string} registrationDeadline -> Deadline after the edit ('' = none).
 * @returns {boolean} -> True only while the deadline stays the same, so a moved deadline refreshes again.
 */
function keepDeadlineRefreshFlag(oldEvent, registrationDeadline) {
    return oldEvent.registrationClosedRefreshed === true && (oldEvent.registrationDeadline || '') === (registrationDeadline || '');
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

module.exports = { DEFAULT_DURATION_MS, parseDate, eventEndTime, isEventOver, isRegistrationClosed, isUnregisterClosed, keepDeadlineRefreshFlag, REGISTRATION_CLOSED_MESSAGE, UNREGISTER_CLOSED_MESSAGE, pickSeriesRepresentative, myRegistrationStatus };
