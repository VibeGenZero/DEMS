/**
 * Links into the web interface.
 *
 * The SPA router opens an event only for `#event/<id>`; `#events` is the
 * event list. Every link to an event that leaves the server (Discord embeds,
 * buttons, DMs, `{event.url}` in message templates) is built here.
 */
const DEFAULT_BASE_URL = 'http://localhost:3000';

/**
 * Build the absolute URL of an event detail page.
 *
 * @param {string} eventId -> The event document ID.
 * @returns {string} -> URL that opens the event in the web interface.
 * @example
 * buildEventUrl('abc'); // 'https://dms.example.org/#event/abc'
 */
function buildEventUrl(eventId) {
    const baseUrl = process.env.BASE_URL || DEFAULT_BASE_URL;
    return `${baseUrl}/#event/${eventId}`;
}

/**
 * Build the absolute URL of a poll page.
 *
 * @param {string} pollId -> The poll document ID.
 * @returns {string} -> URL that opens the poll in the web interface.
 */
function buildPollUrl(pollId) {
    const baseUrl = process.env.BASE_URL || DEFAULT_BASE_URL;
    return `${baseUrl}/#poll/${pollId}`;
}

module.exports = { buildEventUrl, buildPollUrl };
