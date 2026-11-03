/**
 * Dates typed by admins in Discord modals (B-13): `TT.MM.JJJJ HH:MM` in the
 * server's time zone, an end as a plain time, and the date lines of a poll.
 */
const { zonedParts, fromZonedParts } = require('./eventSeries');

const DEFAULT_TIMEZONE = process.env.TIMEZONE || 'Europe/Berlin';
const DATE_FORMAT_HINT = 'TT.MM.JJJJ HH:MM, z. B. 24.12.2026 19:30';

const DATE_TIME_PATTERN = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})\s+(\d{1,2}):(\d{2})$/;
const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;
// "24.12.2026 18:00 – 22:00", "… - …" or "… bis …"
const RANGE_SEPARATOR = /\s+(?:–|-|bis)\s+/;

const validTime = (hour, minute) => hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;

/**
 * Point in time of a wall-clock time, or null when the parts do not exist
 * (31.02., a time in the daylight saving gap).
 *
 * @param {Object} parts -> `{ year, month, day, hour, minute }`.
 * @param {string} timeZone -> IANA time zone.
 * @returns {Date|null}
 */
function exactZoned(parts, timeZone) {
    const date = fromZonedParts({ ...parts, second: 0 }, timeZone);
    const back = zonedParts(date, timeZone);
    const same = back.year === parts.year && back.month === parts.month && back.day === parts.day
        && back.hour === parts.hour && back.minute === parts.minute;
    return same ? date : null;
}

/**
 * Read `D.M.YYYY H:MM` (also two-digit year = 20xx) in the time zone.
 *
 * @param {*} text -> Typed value.
 * @param {string} [timeZone] -> IANA time zone.
 * @returns {Date|null} -> The point in time, or null when unreadable or impossible.
 */
function parseLocalDateTime(text, timeZone = DEFAULT_TIMEZONE) {
    if (typeof text !== 'string') return null;
    const match = text.trim().match(DATE_TIME_PATTERN);
    if (!match) return null;
    const [, day, month, rawYear, hour, minute] = match.map(Number);
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    if (month < 1 || month > 12 || day < 1 || day > 31 || !validTime(hour, minute)) return null;
    return exactZoned({ year, month, day, hour, minute }, timeZone);
}

/**
 * Read the end of an event: empty, a plain `H:MM` on the start day (the next
 * day when it is not after the start), or a full date and time.
 *
 * @param {*} text -> Typed value.
 * @param {Date} start -> Start of the event.
 * @param {string} [timeZone] -> IANA time zone.
 * @returns {Date|null|undefined} -> The end, null for no end, undefined when unreadable.
 */
function parseEndInput(text, start, timeZone = DEFAULT_TIMEZONE) {
    const value = typeof text === 'string' ? text.trim() : '';
    if (!value) return null;
    const time = value.match(TIME_PATTERN);
    if (!time) return parseLocalDateTime(value, timeZone) || undefined;

    const [, hour, minute] = time.map(Number);
    if (!validTime(hour, minute)) return undefined;
    const day = zonedParts(start, timeZone);
    let end = fromZonedParts({ year: day.year, month: day.month, day: day.day, hour, minute }, timeZone);
    if (end <= start) end = fromZonedParts({ year: day.year, month: day.month, day: day.day + 1, hour, minute }, timeZone);
    return end;
}

/**
 * Read the date lines of a poll: one date per line, optionally with an end
 * after „–“, „-“ or „bis“. Empty lines are skipped.
 *
 * @param {*} text -> Typed value.
 * @param {string} [timeZone] -> IANA time zone.
 * @returns {{ options: Array<{ startDate: string, endDate: string }> } | { error: string }}
 */
function parsePollLines(text, timeZone = DEFAULT_TIMEZONE) {
    const lines = (typeof text === 'string' ? text : '').split(/\r?\n/);
    const options = [];
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index].trim();
        if (!line) continue;
        const [startText, endText = ''] = line.split(RANGE_SEPARATOR);
        const start = parseLocalDateTime(startText, timeZone);
        const end = start ? parseEndInput(endText, start, timeZone) : undefined;
        if (!start || end === undefined) {
            return { error: `Zeile ${index + 1}: „${line}“ ist kein Termin. Bitte als ${DATE_FORMAT_HINT} angeben, das Ende optional nach „–“.` };
        }
        options.push({ startDate: start.toISOString(), endDate: end ? end.toISOString() : '' });
    }
    return { options };
}

module.exports = { DATE_FORMAT_HINT, parseLocalDateTime, parseEndInput, parsePollLines };
