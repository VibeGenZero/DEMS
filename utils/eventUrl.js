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

/**
 * Build the absolute URL of a page of the web interface without an ID.
 *
 * @param {string} page -> Router page, e.g. `profile` or `events`.
 * @returns {string} -> URL that opens the page.
 * @example
 * buildSiteUrl('profile'); // 'https://dms.example.org/#profile'
 */
function buildSiteUrl(page) {
    const baseUrl = process.env.BASE_URL || DEFAULT_BASE_URL;
    return `${baseUrl}/#${page}`;
}

/**
 * Build the links of a member's calendar subscription.
 *
 * @param {string} token -> Feed secret (utils/calendarFeed.js).
 * @returns {{ url: string, webcalUrl: string, googleUrl: string }} -> The feed file, the same as `webcal://` for Apple and Outlook, and the Google Calendar subscribe link.
 * @example
 * buildCalendarFeedUrls('abc').webcalUrl; // 'webcal://dms.example.org/calendar/abc.ics'
 */
function buildCalendarFeedUrls(token) {
    const baseUrl = process.env.BASE_URL || DEFAULT_BASE_URL;
    const url = `${baseUrl}/calendar/${token}.ics`;
    const webcalUrl = url.replace(/^https?:\/\//i, 'webcal://');
    return { url, webcalUrl, googleUrl: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl)}` };
}

module.exports = { buildEventUrl, buildPollUrl, buildSiteUrl, buildCalendarFeedUrls };
