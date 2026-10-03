/**
 * Keep the Discord announcements of an event up to date.
 *
 * Every change to the registrations calls notifyRegistrationsChanged(). The
 * calls are bundled per event (trailing debounce), so a wave of sign-ups
 * right after an announcement edits the message only once and stays clear
 * of Discord's rate limits.
 */

/** Quiet time after the last change before the announcement is edited. */
const ANNOUNCEMENT_REFRESH_DELAY_MS = 2000;

/**
 * Create a debounced refresher.
 *
 * @param {Object} options -> Refresher options.
 * @param {Function} options.refresh -> Async function receiving the event ID.
 * @param {number} [options.delayMs] -> Debounce delay in milliseconds.
 * @returns {{ notify: Function, flush: Function }} -> Refresher API.
 */
function createAnnouncementRefresher({ refresh, delayMs = ANNOUNCEMENT_REFRESH_DELAY_MS }) {
    const timers = new Map();

    async function run(eventId) {
        timers.delete(eventId);
        try {
            await refresh(eventId);
        } catch (err) {
            console.error('[announcementRefresh] refresh failed:', err.message);
        }
    }

    function notify(eventId) {
        if (!eventId) return;
        clearTimeout(timers.get(eventId));
        const timer = setTimeout(() => run(eventId), delayMs);
        // A pending refresh must never keep the process (or a test) alive
        if (typeof timer.unref === 'function') timer.unref();
        timers.set(eventId, timer);
    }

    async function flush() {
        const eventIds = [...timers.keys()];
        eventIds.forEach(eventId => clearTimeout(timers.get(eventId)));
        await Promise.all(eventIds.map(run));
    }

    return { notify, flush };
}

// bot.js is required lazily -> it requires the registration helpers itself
const defaultRefresher = createAnnouncementRefresher({
    refresh: (eventId) => require('../bot').refreshEventAnnouncements(eventId)
});

// Posted poll messages are kept up to date the same way
const pollRefresher = createAnnouncementRefresher({
    refresh: (pollId) => require('../bot').refreshPollMessages(pollId)
});

module.exports = {
    ANNOUNCEMENT_REFRESH_DELAY_MS,
    createAnnouncementRefresher,
    notifyRegistrationsChanged: defaultRefresher.notify,
    flushAnnouncementRefreshes: defaultRefresher.flush,
    notifyPollChanged: pollRefresher.notify,
    flushPollRefreshes: pollRefresher.flush
};
