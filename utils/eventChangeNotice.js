/**
 * Change DMs for an edited event (W-04): when an admin moves the start or
 * the end or changes the location and asks for it, every participant
 * learns the old and the new value by DM.
 */
const { db, collection, query, where, getDocs } = require('../firebaseAdmin');
const { sendDM } = require('../bot');
const { buildEventUrl } = require('./eventUrl');

const TIMEZONE = process.env.TIMEZONE || 'Europe/Berlin';
const NO_VALUE = 'nicht festgelegt';
const DATE_FORMAT = { timeZone: TIMEZONE, weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' };

/**
 * Point in time of a stored date.
 *
 * @param {*} value -> ISO string, '' or anything else.
 * @returns {number|null} -> Milliseconds, or null when there is no valid date.
 */
function timeOf(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? null : time;
}

/**
 * Location as it is compared: its text and the linked channel.
 *
 * @param {*} location -> `{ text, channelId, channelType }` or null.
 * @returns {{ text: string, channelId: string }|null} -> null when the location has no text.
 */
function placeOf(location) {
    const text = location && typeof location.text === 'string' ? location.text.trim() : '';
    if (!text) return null;
    return { text, channelId: String(location.channelId || '') };
}

const formatTime = (time) => (time === null ? NO_VALUE : new Date(time).toLocaleString('de-DE', DATE_FORMAT));
const formatPlace = (place) => (place === null ? NO_VALUE : place.text);
const samePlace = (a, b) => (a === null || b === null ? a === b : a.text === b.text && a.channelId === b.channelId);

// Fields participants plan by, in the order the DM lists them
const WATCHED_FIELDS = [
    { field: 'startDate', label: 'Beginn', read: timeOf, same: (a, b) => a === b, format: formatTime },
    { field: 'endDate', label: 'Ende', read: timeOf, same: (a, b) => a === b, format: formatTime },
    { field: 'location', label: 'Ort', read: placeOf, same: samePlace, format: formatPlace }
];

/**
 * Changes of an edit that participants must know about.
 *
 * @param {Object} oldEvent -> Event as stored before the save.
 * @param {Object} newEvent -> Event values after the save.
 * @returns {Array<{ field: string, label: string, before: string, after: string }>} -> Changed start, end and location in this order; empty when none of them changed.
 */
function describeEventChanges(oldEvent, newEvent) {
    const changes = [];
    for (const { field, label, read, same, format } of WATCHED_FIELDS) {
        const before = read(oldEvent && oldEvent[field]);
        const after = read(newEvent && newEvent[field]);
        if (!same(before, after)) changes.push({ field, label, before: format(before), after: format(after) });
    }
    return changes;
}

/**
 * Text of the change DM.
 *
 * @param {string} title -> Event title.
 * @param {Array<Object>} changes -> Result of describeEventChanges().
 * @param {string} url -> Link to the event page (buildEventUrl).
 * @returns {string} -> German DM with every change as before → after.
 */
function buildEventChangeMessage(title, changes, url) {
    const lines = changes.map(({ label, before, after }) => {
        const old = before === NO_VALUE ? before : `~~${before}~~`;
        return `**${label}:** ${old} → **${after}**`;
    });
    return [`📅 Das Event **${title}** wurde geändert:`, ...lines, `Alle Infos: ${url}`].join('\n');
}

/**
 * Users who take part: accepted registrants and their accepted guests.
 *
 * @param {Array<Object>} registrations -> Registrations of one event.
 * @returns {string[]} -> User ids, each once; pending, waitlisted and rejected registrations and open guest invitations are left out.
 */
function changeRecipients(registrations) {
    const userIds = new Set();
    for (const registration of registrations) {
        if (registration.status !== 'accepted') continue;
        userIds.add(registration.userId);
        (registration.guests || []).forEach(guestId => userIds.add(guestId));
    }
    return [...userIds];
}

/**
 * Send the change DM to every participant of an event.
 *
 * @param {Object} options
 * @param {string} options.eventId -> Event id.
 * @param {string} options.title -> Event title.
 * @param {Array<Object>} options.changes -> Result of describeEventChanges().
 * @param {Function} [options.send] -> DM function (userId, message) → true when delivered; sendDM by default.
 * @returns {Promise<{ recipients: number, notified: number }>} -> How many were meant and how many DMs arrived.
 */
async function notifyEventChange({ eventId, title, changes, send = sendDM }) {
    if (changes.length === 0) return { recipients: 0, notified: 0 };
    const snap = await getDocs(query(collection(db, 'registrations'), where('eventId', '==', eventId)));
    const recipients = changeRecipients(snap.docs.map(registration => registration.data()));
    const message = buildEventChangeMessage(title, changes, buildEventUrl(eventId));

    let notified = 0;
    for (const userId of recipients) {
        if (await send(userId, message)) notified++;
    }
    return { recipients: recipients.length, notified };
}

module.exports = { describeEventChanges, buildEventChangeMessage, changeRecipients, notifyEventChange };
