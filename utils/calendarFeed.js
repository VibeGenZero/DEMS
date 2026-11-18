/**
 * Calendar subscription: the entries of a member's iCalendar feed and the
 * secret of the feed link. Pure helpers without database access;
 * utils/calendarFeedStore.js stores the feeds, routes/calendar.js loads the
 * member's participations and events and writes the file (utils/icalendar.js).
 */
const crypto = require('crypto');
const { parseDate, eventEndTime } = require('./eventListing');
const { buildEventUrl } = require('./eventUrl');

const DEFAULT_BASE_URL = 'http://localhost:3000';
// Events that started longer ago leave the feed
const PAST_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
// 32 random bytes -> 43 base64url characters (256 bits)
const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

// German title mark and status word per registration status; accepted has no mark
const STATUS_TEXTS = {
    accepted: { mark: '', label: 'Angemeldet' },
    pending: { mark: '[Ausstehend]', label: 'Ausstehend (wartet auf Freigabe)' },
    waitlisted: { mark: '[Warteliste]', label: 'Warteliste' },
    offered: { mark: '[Nachrücken bestätigen]', label: 'Platz frei – bitte auf der Event-Seite bestätigen' },
    tentative: { mark: '[Vielleicht]', label: 'Vielleicht (Ersatzbank)' }
};
const LEFT_OUT_STATUSES = ['rejected'];

/**
 * Host part of the entry identifiers, from BASE_URL.
 *
 * @returns {string} -> e.g. `dems.example` or `localhost:3000`.
 */
function uidHost() {
    try {
        return new URL(process.env.BASE_URL || DEFAULT_BASE_URL).host || 'dems';
    } catch {
        return 'dems';
    }
}

/**
 * The feed entry of one participation, or null when it stays out of the feed.
 *
 * @param {Object} participation -> Own registration or guest place (utils/participations.js).
 * @param {Object|undefined} event -> Event data, undefined when the event was deleted.
 * @param {Date} now -> Current time.
 * @param {string} host -> Host part of the identifier.
 * @returns {Object|null} -> `{ uid, title, start, end, status, location, url, description, lastModified }`.
 */
function toFeedEntry(participation, event, now, host) {
    if (!event || event.status === 'draft' || LEFT_OUT_STATUSES.includes(participation.status)) return null;
    const start = parseDate(event.startDate);
    if (!start || start.getTime() < now.getTime() - PAST_WINDOW_MS) return null;

    const cancelled = event.status === 'cancelled';
    const texts = STATUS_TEXTS[participation.status] || { mark: '', label: '' };
    const mark = cancelled ? '[Abgesagt]' : texts.mark;
    const title = String(event.title || 'Event');
    const url = buildEventUrl(participation.eventId);

    const description = [];
    if (cancelled) description.push('Das Event wurde abgesagt.');
    if (texts.label) description.push(`Status: ${texts.label}`);
    if (participation.asGuest) description.push(participation.hostUserName ? `Du bist Gast von ${participation.hostUserName}.` : 'Du bist Gast.');
    description.push(url);

    const lastModified = parseDate(event.updatedAt);
    return {
        uid: `${participation.eventId}@${host}`,
        title: mark ? `${mark} ${title}` : title,
        start: start.toISOString(),
        end: eventEndTime(event).toISOString(),
        status: cancelled ? 'CANCELLED' : (participation.status === 'accepted' ? 'CONFIRMED' : 'TENTATIVE'),
        location: String((event.location && event.location.text) || ''),
        url,
        description: description.join('\n'),
        lastModified: lastModified ? lastModified.toISOString() : ''
    };
}

/**
 * The entries of a member's feed, earliest start first.
 *
 * @param {Array<Object>} participations -> The member's participations (loadUserParticipations), one per event.
 * @param {Object<string, Object>} eventsById -> Event data by id; a missing id means the event was deleted.
 * @param {Date} [now] -> Current time.
 * @returns {Array<Object>} -> Entries for buildCalendar (utils/icalendar.js).
 */
function buildFeedEntries(participations, eventsById, now = new Date()) {
    const host = uidHost();
    return participations
        .map(participation => toFeedEntry(participation, eventsById[participation.eventId], now, host))
        .filter(Boolean)
        .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

/**
 * A new secret for a feed link.
 *
 * @returns {string} -> 43 base64url characters.
 */
function createFeedToken() {
    return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * Whether a value has the shape of a feed secret; checked before any lookup.
 *
 * @param {*} value -> Value from a request path.
 * @returns {boolean}
 */
function isFeedToken(value) {
    return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

module.exports = { buildFeedEntries, createFeedToken, isFeedToken, PAST_WINDOW_MS };
