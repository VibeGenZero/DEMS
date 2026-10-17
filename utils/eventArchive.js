/**
 * Automatic archive of ended events (W-01): an active event is archived 24
 * hours after its end (endDate, else start + 2 hours, see eventEndTime). The
 * scheduler runs once at start, so events that ended during a pause are
 * caught up, then every 5 minutes. Channels and the event role stay (B-10).
 */
const { db, collection, doc, getDocs, query, updateDoc, where } = require('../firebaseAdmin');
const { eventEndTime } = require('./eventListing');
const { addAuditLog } = require('./eventUtils');
const { notifyRegistrationsChanged } = require('./announcementRefresh');

const ARCHIVE_DELAY_MS = 24 * 60 * 60 * 1000;
const ARCHIVE_INTERVAL_MS = 5 * 60 * 1000;

let archiveTimer = null;
let schedulerGeneration = 0;

/**
 * Whether the scheduler archives an event now.
 *
 * @param {Object} event -> Event data.
 * @param {Date} now -> Reference time.
 * @returns {boolean} -> True for an active event whose end lies at least 24 hours back.
 */
function isDueForArchive(event, now) {
    if (!event || event.status !== 'active') return false;
    const end = eventEndTime(event);
    return end !== null && now.getTime() >= end.getTime() + ARCHIVE_DELAY_MS;
}

/**
 * Archive every active event that is due, log each one as done by the system
 * and refresh its stored announcements (their buttons go away).
 *
 * @param {Object} [options] -> Overrides for tests.
 * @param {Date} [options.now] -> Reference time.
 * @returns {Promise<number>} -> Number of archived events.
 */
async function archiveEndedEvents({ now = new Date() } = {}) {
    const snapshot = await getDocs(query(collection(db, 'events'), where('status', '==', 'active')));
    let count = 0;
    for (const eventDoc of snapshot.docs) {
        const event = eventDoc.data();
        if (!isDueForArchive(event, now)) continue;
        try {
            await updateDoc(doc(db, 'events', eventDoc.id), { status: 'archived', updatedAt: now.toISOString() });
            await addAuditLog('AUTO_ARCHIVE_EVENT', 'system', `Archived "${event.title}" 24 hours after its end`, eventDoc.id);
            notifyRegistrationsChanged(eventDoc.id);
            count++;
        } catch (err) {
            console.error('Auto archive failed for', eventDoc.id, err.message);
        }
    }
    if (count > 0) console.log(`🗄️ Archived ${count} ended event(s)`);
    return count;
}

/**
 * Start the archive scheduler: one run once `waitFor` has settled, then
 * every 5 minutes. The server passes the bot start, because an archive
 * refreshes the Discord announcements and that only works with a ready bot;
 * without the wait the catch-up run at start would leave their buttons.
 *
 * @param {Object} [options] -> Start options.
 * @param {Promise<*>} [options.waitFor] -> Settles when the first run may begin.
 * @returns {void}
 */
function startArchiveScheduler({ waitFor = Promise.resolve() } = {}) {
    stopArchiveScheduler();
    const generation = schedulerGeneration;
    const run = () => archiveEndedEvents().catch(err => console.error('Archive scheduler failed:', err.message));
    const begin = () => {
        // Stopped or started again while waiting
        if (generation !== schedulerGeneration) return;
        run();
        archiveTimer = setInterval(run, ARCHIVE_INTERVAL_MS);
        if (typeof archiveTimer.unref === 'function') archiveTimer.unref();
        console.log('🗄️ Archive scheduler started (checks every 5 min)');
    };
    Promise.resolve(waitFor).then(begin, begin);
}

/**
 * Stop the archive scheduler, also before its first run.
 *
 * @returns {void}
 */
function stopArchiveScheduler() {
    schedulerGeneration++;
    if (archiveTimer) clearInterval(archiveTimer);
    archiveTimer = null;
}

module.exports = {
    ARCHIVE_DELAY_MS,
    ARCHIVE_INTERVAL_MS,
    isDueForArchive,
    archiveEndedEvents,
    startArchiveScheduler,
    stopArchiveScheduler
};
