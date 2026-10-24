/**
 * Pure helpers for editing a series of events together (W-11): which dates
 * follow the edited one, how they take its start time, the rhythm of the
 * series and which dates an extension creates. No database or bot access.
 * Times are ISO strings in UTC; days and clock times count in TIMEZONE.
 */
const { parseDate, isEventOver } = require('./eventListing');

const DEFAULT_TIMEZONE = process.env.TIMEZONE || 'Europe/Berlin';
const DAY_MS = 24 * 60 * 60 * 1000;
const SHORTEN_SERIES_MESSAGE = '„Wiederholen bis“ kann nur verlängert werden. Einzelne Termine löschst du in der Terminliste.';
// Statuses of dates that "this and all following dates" still changes
const CHANGEABLE_STATUSES = ['draft', 'active'];
// Settings the following dates take from the edited one; status, dates, check-in and origin stay per date
const SERIES_FIELDS = [
    'title', 'description', 'bannerUrl', 'accentColor', 'location', 'category', 'maxParticipants', 'slots',
    'allowGuests', 'accessMode', 'requiredRoles', 'approvalMode', 'assignRoleId', 'formFields', 'reminderHours',
    'checkinMessage', 'customBotMessages', 'autoCreateChannels', 'channelConfig'
];

/**
 * Wall-clock parts of a point in time.
 *
 * @param {Date} date -> Point in time.
 * @param {string} timeZone -> IANA time zone.
 * @returns {Object} -> `{ year, month, day, hour, minute, second }` as numbers (month 1-12).
 */
function zonedParts(date, timeZone) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, Number(part.value)]));
    return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute, second: parts.second };
}

/**
 * Offset of the time zone at a point in time.
 *
 * @param {number} time -> Milliseconds since the epoch.
 * @param {string} timeZone -> IANA time zone.
 * @returns {number} -> Local time minus UTC in milliseconds.
 */
function zoneOffset(time, timeZone) {
    const p = zonedParts(new Date(time), timeZone);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(time / 1000) * 1000;
}

/**
 * Point in time of a wall-clock time; day and month may run over like Date.UTC allows.
 *
 * @param {Object} parts -> `{ year, month, day, hour, minute, second }` (month 1-12).
 * @param {string} timeZone -> IANA time zone.
 * @returns {Date} -> The point in time.
 */
function fromZonedParts(parts, timeZone) {
    const guess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second || 0);
    const first = guess - zoneOffset(guess, timeZone);
    const second = guess - zoneOffset(first, timeZone);
    return new Date(second);
}

/**
 * Calendar day of a point in time.
 *
 * @param {string} iso -> ISO date.
 * @param {string} [timeZone] -> IANA time zone.
 * @returns {string} -> `YYYY-MM-DD` in the time zone, or '' without a valid date.
 */
function localDay(iso, timeZone = DEFAULT_TIMEZONE) {
    const date = parseDate(iso);
    if (!date) return '';
    const p = zonedParts(date, timeZone);
    return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

const startTime = (event) => parseDate(event.startDate)?.getTime() ?? NaN;

/**
 * Dates that "this and all following dates" changes besides the edited one.
 *
 * @param {Array<Object>} seriesEvents -> Events with `id`, in any order.
 * @param {Object} edited -> The edited date as stored before the save.
 * @param {Date} [now] -> Current time.
 * @returns {Array<Object>} -> Same series, later start, not over, draft or active; sorted by start.
 */
function followingDates(seriesEvents, edited, now = new Date()) {
    const editedStart = startTime(edited);
    if (!edited.seriesId || !Number.isFinite(editedStart)) return [];
    return seriesEvents
        .filter(event => event.id !== edited.id && event.seriesId === edited.seriesId)
        .filter(event => startTime(event) > editedStart)
        .filter(event => CHANGEABLE_STATUSES.includes(event.status || 'active') && !isEventOver(event, now))
        .sort((a, b) => startTime(a) - startTime(b));
}

/**
 * Dates of a following date with the start time of the edited date.
 *
 * @param {string} targetStart -> Start of the following date (its day is kept).
 * @param {Object} source -> `{ startDate, endDate, registrationDeadline, unregisterDeadline }` of the edited date after the save.
 * @param {string} [timeZone] -> IANA time zone.
 * @returns {Object|null} -> `{ startDate, endDate, registrationDeadline, unregisterDeadline }`, or null without both starts.
 */
function transferTime(targetStart, source, timeZone = DEFAULT_TIMEZONE) {
    const sourceStart = parseDate(source.startDate);
    const target = parseDate(targetStart);
    if (!sourceStart || !target) return null;
    const day = zonedParts(target, timeZone);
    const clock = zonedParts(sourceStart, timeZone);
    const start = fromZonedParts({ ...day, hour: clock.hour, minute: clock.minute, second: clock.second }, timeZone);
    const shifted = (value) => {
        const point = parseDate(value);
        return point ? new Date(start.getTime() + (point.getTime() - sourceStart.getTime())).toISOString() : '';
    };
    return {
        startDate: start.toISOString(),
        endDate: shifted(source.endDate),
        registrationDeadline: shifted(source.registrationDeadline),
        unregisterDeadline: shifted(source.unregisterDeadline)
    };
}

/**
 * Next date in the rhythm of a series, at the same local time.
 *
 * @param {string} start -> ISO start of a date.
 * @param {string} interval -> `weekly`, `biweekly`, anything else counts as monthly.
 * @param {string} [timeZone] -> IANA time zone.
 * @returns {string} -> ISO start of the next date.
 */
function nextSeriesStart(start, interval, timeZone = DEFAULT_TIMEZONE) {
    const p = zonedParts(parseDate(start), timeZone);
    if (interval === 'weekly') return fromZonedParts({ ...p, day: p.day + 7 }, timeZone).toISOString();
    if (interval === 'biweekly') return fromZonedParts({ ...p, day: p.day + 14 }, timeZone).toISOString();
    // Month overflow (31.01. -> 03.03.) as Date#setMonth does when a series is created
    const monthStart = Date.UTC(p.year, p.month, 1);
    const target = new Date(monthStart + (p.day - 1) * DAY_MS);
    return fromZonedParts({ ...p, year: target.getUTCFullYear(), month: target.getUTCMonth() + 1, day: target.getUTCDate() }, timeZone).toISOString();
}

/**
 * Starts an extension of a series creates.
 *
 * @param {Object} params -> `{ seriesEvents, interval, oldUntil, newUntil, timeZone }`; until values as `YYYY-MM-DD`.
 * @returns {Object} -> `{ starts: string[] }` after the last date up to and including `newUntil`, or `{ error }` for an earlier end.
 */
function planExtension({ seriesEvents, interval, oldUntil, newUntil, timeZone = DEFAULT_TIMEZONE }) {
    if (!newUntil || newUntil === oldUntil) return { starts: [] };
    if (oldUntil && newUntil < oldUntil) return { error: SHORTEN_SERIES_MESSAGE };
    const last = seriesEvents
        .filter(event => Number.isFinite(startTime(event)))
        .sort((a, b) => startTime(a) - startTime(b))
        .at(-1);
    if (!last) return { starts: [] };
    const starts = [];
    let next = nextSeriesStart(last.startDate, interval, timeZone);
    while (localDay(next, timeZone) <= newUntil) {
        starts.push(next);
        next = nextSeriesStart(next, interval, timeZone);
    }
    return { starts };
}

/**
 * Settings of a saved date that the following dates take over.
 *
 * @param {Object} updates -> Fields written to the edited date.
 * @returns {Object} -> Only the fields in SERIES_FIELDS that are present.
 */
function seriesUpdateFields(updates) {
    return Object.fromEntries(SERIES_FIELDS.filter(field => Object.hasOwn(updates, field)).map(field => [field, updates[field]]));
}

/**
 * Slots of the request as another date of the series knows them: a slot whose
 * id that date does not know takes the id of its slot with the same name, so
 * the registrations in it stay.
 *
 * @param {Array<Object>|undefined} rawSlots -> Slots of the request.
 * @param {Array<Object>} targetSlots -> Stored slots of the other date.
 * @returns {Array<Object>|undefined} -> Slots to save for that date.
 */
function slotsForDate(rawSlots, targetSlots) {
    if (!Array.isArray(rawSlots)) return rawSlots;
    const knownIds = new Set(targetSlots.map(slot => slot.id));
    const used = new Set(rawSlots.map(slot => slot && slot.id).filter(id => knownIds.has(id)));
    return rawSlots.map(slot => {
        if (!slot || typeof slot.name !== 'string' || knownIds.has(slot.id)) return slot;
        const match = targetSlots.find(other => !used.has(other.id) && other.name.toLowerCase() === slot.name.trim().toLowerCase());
        if (!match) return slot;
        used.add(match.id);
        return { ...slot, id: match.id };
    });
}

module.exports = {
    SHORTEN_SERIES_MESSAGE, SERIES_FIELDS, followingDates, transferTime, nextSeriesStart, planExtension,
    seriesUpdateFields, slotsForDate, localDay
};
