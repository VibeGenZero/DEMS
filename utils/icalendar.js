/**
 * The subset of iCalendar (RFC 5545) the calendar subscription needs: one
 * VCALENDAR with VEVENT entries in UTC. Pure helpers, no dependency. Every
 * text value goes through escapeText and every line through foldLine, so
 * text from an event can never start a property or an entry of its own.
 */

const CRLF = '\r\n';
const MAX_LINE_OCTETS = 75;

/**
 * Escape a TEXT value (RFC 5545 3.3.11).
 *
 * @param {*} value -> Any value; null and undefined become ''.
 * @returns {string} -> Backslash, semicolon and comma escaped, every line break as `\n`.
 */
function escapeText(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Clean a URI value: URIs are not escaped like text, so control characters
 * (line breaks included) are dropped instead.
 *
 * @param {*} value -> URI.
 * @returns {string}
 */
function cleanUri(value) {
    return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '');
}

/**
 * Fold a content line to at most 75 octets per line (RFC 5545 3.1); the
 * continuation lines start with one space. Splits only between characters,
 * never inside a multi-byte UTF-8 sequence or a surrogate pair.
 *
 * @param {string} line -> One unfolded content line without CRLF.
 * @returns {string} -> The folded line, parts joined with CRLF.
 */
function foldLine(line) {
    if (Buffer.byteLength(line, 'utf8') <= MAX_LINE_OCTETS) return line;
    const parts = [];
    let current = '';
    let size = 0;
    // for…of walks code points, so an emoji (surrogate pair) stays whole
    for (const char of line) {
        const charSize = Buffer.byteLength(char, 'utf8');
        // Continuation lines spend one octet on the leading space
        const limit = parts.length === 0 ? MAX_LINE_OCTETS : MAX_LINE_OCTETS - 1;
        if (size + charSize > limit) {
            parts.push(current);
            current = '';
            size = 0;
        }
        current += char;
        size += charSize;
    }
    parts.push(current);
    return parts.map((part, index) => (index === 0 ? part : ` ${part}`)).join(CRLF);
}

/**
 * A point in time as UTC DATE-TIME in the basic format.
 *
 * @param {string|Date} value -> ISO string or Date.
 * @returns {string} -> `YYYYMMDDTHHMMSSZ`, or '' for an unreadable value.
 */
function formatUtc(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '');
}

/**
 * The lines of one VEVENT.
 *
 * @param {Object} entry -> `{ uid, title, start, end, status, location?, url?, description?, lastModified? }`.
 * @param {string} stamp -> DTSTAMP value.
 * @returns {Array<string>}
 */
function eventLines(entry, stamp) {
    const lines = [
        'BEGIN:VEVENT',
        `UID:${escapeText(entry.uid)}`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${formatUtc(entry.start)}`,
        `DTEND:${formatUtc(entry.end)}`,
        `SUMMARY:${escapeText(entry.title)}`,
        `STATUS:${escapeText(entry.status)}`
    ];
    if (entry.location) lines.push(`LOCATION:${escapeText(entry.location)}`);
    if (entry.url) lines.push(`URL:${cleanUri(entry.url)}`);
    if (entry.description) lines.push(`DESCRIPTION:${escapeText(entry.description)}`);
    const lastModified = entry.lastModified ? formatUtc(entry.lastModified) : '';
    if (lastModified) lines.push(`LAST-MODIFIED:${lastModified}`);
    lines.push('END:VEVENT');
    return lines;
}

/**
 * A complete iCalendar file.
 *
 * @param {Object} options -> Calendar data.
 * @param {string} options.name -> Calendar name shown by calendar apps (X-WR-CALNAME).
 * @param {string} options.timeZone -> IANA time zone apps may show times in (X-WR-TIMEZONE); times stay UTC.
 * @param {Array<Object>} options.entries -> Entries, see eventLines.
 * @param {Date} [options.now] -> DTSTAMP of every entry.
 * @returns {string} -> The file, every line folded and ended with CRLF.
 */
function buildCalendar({ name, timeZone, entries, now = new Date() }) {
    const stamp = formatUtc(now);
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//DEMS//Kalender-Abo//DE',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        `X-WR-CALNAME:${escapeText(name)}`,
        `X-WR-TIMEZONE:${escapeText(timeZone)}`,
        'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
        'X-PUBLISHED-TTL:PT1H',
        ...entries.flatMap(entry => eventLines(entry, stamp)),
        'END:VCALENDAR'
    ];
    return lines.map(foldLine).join(CRLF) + CRLF;
}

module.exports = { escapeText, foldLine, formatUtc, buildCalendar };
