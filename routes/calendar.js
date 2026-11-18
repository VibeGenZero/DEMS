/**
 * GET /calendar/<token>.ics — a member's calendar subscription as iCalendar
 * file (OpenSpec calendar-subscription). Public on purpose: calendar apps
 * fetch it without a session or CSRF token; the secret in the path is the
 * only key. Mounted in server.js before the session middleware, so a fetch
 * reads and writes no session. Errors answer plain text, because calendar
 * apps show the body.
 */
const express = require('express');
const { db, doc, getDoc } = require('../firebaseAdmin');
const { loadUserParticipations } = require('../utils/eventUtils');
const { buildFeedEntries } = require('../utils/calendarFeed');
const { findFeedByToken } = require('../utils/calendarFeedStore');
const { buildCalendar } = require('../utils/icalendar');
const { getTimezone } = require('../utils/timezone');
const { resolveServerName } = require('../utils/serverName');
const { createCalendarLimiters } = require('../middleware/rateLimits');

const FILE_PATTERN = /^([A-Za-z0-9_-]+)\.ics$/;

const sendText = (res, status, text) => res.status(status).type('text/plain; charset=utf-8').send(text);

/**
 * The events of the participations that still exist.
 *
 * @param {Array<Object>} participations -> Participations with `eventId`.
 * @returns {Promise<Object<string, Object>>} -> Event data by id; deleted events are missing.
 */
async function loadEvents(participations) {
    const ids = [...new Set(participations.map(entry => entry.eventId).filter(Boolean))];
    const snaps = await Promise.all(ids.map(id => getDoc(doc(db, 'events', id))));
    return Object.fromEntries(snaps.filter(snap => snap.exists()).map(snap => [snap.id, snap.data()]));
}

/**
 * @param {Object} [options]
 * @param {boolean} [options.skipAddressLimit] -> Dev mock mode: no brake per address (the budget per link stays).
 * @returns {express.Router}
 */
function createCalendarRouter({ skipAddressLimit = false } = {}) {
    const router = express.Router();

    router.get('/:file', ...createCalendarLimiters({ skipAddress: skipAddressLimit }), async (req, res) => {
        try {
            const match = FILE_PATTERN.exec(req.params.file);
            const feed = match ? await findFeedByToken(match[1]) : null;
            if (!feed) return sendText(res, 404, 'Kalender nicht gefunden.');

            const participations = await loadUserParticipations(feed.userId);
            const entries = buildFeedEntries(participations, await loadEvents(participations), new Date());
            const calendar = buildCalendar({
                name: `${await resolveServerName()} · Meine Events`,
                timeZone: getTimezone(),
                entries
            });

            res.set({
                'Content-Type': 'text/calendar; charset=utf-8',
                'Content-Disposition': 'inline; filename="dems.ics"',
                'Cache-Control': 'private, max-age=300',
                'X-Robots-Tag': 'noindex'
            });
            // Express adds an ETag, so unchanged feeds answer 304 Not Modified
            res.send(calendar);
        } catch (err) {
            console.error('Kalender-Abo konnte nicht erstellt werden:', err);
            sendText(res, 500, 'Kalender konnte nicht erstellt werden.');
        }
    });

    return router;
}

module.exports = { createCalendarRouter };
