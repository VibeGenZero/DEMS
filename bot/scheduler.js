/**
 * Reminder scheduler of the bot: reminder and start DMs, closing announcements
 * at the registration deadline, every 5 minutes.
 */
const { db, collection, doc, getDocs, updateDoc, query, where } = require('../firebaseAdmin');
const { loadBotSettings } = require('../utils/botSettings');
const { debugLog } = require('../utils/debugLog');
const { buildEventUrl } = require('../utils/eventUrl');
const { normalizeReminderHours, findDueReminders } = require('../utils/reminders');
const { filterByPreference } = require('../utils/notificationPrefs');
const { isEventOver, isRegistrationClosed } = require('../utils/eventListing');
const { sendDM } = require('./messages');
const { TIMEZONE } = require('./constants');

/**
 * Reminder scheduler — every 5 min: DM accepted participants when a reminder
 * time is reached, and once when the event starts. Duplicates are prevented only
 * by the flags stored in the event (reminderHours[].sent, eventStartNotificationSent),
 * written before the DMs go out: a restart or a crash while sending never repeats them.
 */
let reminderInterval = null;

/**
 * DM every accepted participant of an event who wants reminders (W-16).
 *
 * @param {string} eventId -> Event document id.
 * @param {string} message -> DM text.
 * @param {Function} send -> DM function (userId, message).
 * @returns {Promise<number>} -> Number of recipients messaged.
 */
async function messageAcceptedParticipants(eventId, message, send) {
    const regs = await getDocs(query(
        collection(db, 'registrations'),
        where('eventId', '==', eventId),
        where('status', '==', 'accepted')
    ));
    const { userIds } = await filterByPreference(regs.docs.map(regDoc => regDoc.data().userId), 'reminders');
    for (const userId of userIds) {
        await send(userId, message);
    }
    return userIds.length;
}

/**
 * One scheduler pass.
 *
 * @param {Object} [options] -> Overrides for tests.
 * @param {Date} [options.now] -> Current time.
 * @param {Function} [options.send] -> DM function (userId, message), default sendDM.
 * @param {Function} [options.refresh] -> Announcement refresh (eventId), default notifyRegistrationsChanged.
 * @param {Object} [options.settings] -> Bot center settings, default loadBotSettings() (B-02).
 * @returns {Promise<void>}
 */
async function checkReminders({ now = new Date(), send = sendDM, refresh = (eventId) => require('../utils/announcementRefresh').notifyRegistrationsChanged(eventId), settings = null } = {}) {
    try {
        // Switches of the bot center (B-02): a due reminder or start DM is marked
        // either way, so nothing is sent late after a switch is turned on again
        const { reminderEnabled, eventStartNotifications } = settings || await loadBotSettings();
        const snapshot = await getDocs(query(collection(db, 'events')));

        for (const docSnap of snapshot.docs) {
            const event = docSnap.data();
            const eventId = docSnap.id;

            if (event.status !== 'active' || !event.startDate) continue;

            // Registration deadline passed -> refresh once so the register buttons go away (W-03);
            // the flag is written first, like the reminder flags, so a crash cannot repeat it
            if (!event.registrationClosedRefreshed && !isEventOver(event, now) && isRegistrationClosed(event, now)) {
                await updateDoc(doc(db, 'events', eventId), { registrationClosedRefreshed: true });
                refresh(eventId);
            }

            const startTime = new Date(event.startDate);

            // After a downtime several reminders can be due at once -> one DM, all marked.
            // Legacy numeric reminderHours are stored as a list on the way.
            const due = findDueReminders(event, now);
            if (due.length > 0 && !reminderEnabled) {
                // Dropped, not postponed: marked as sent without a DM
                const reminderHours = normalizeReminderHours(event.reminderHours)
                    .map((reminder, index) => (due.includes(index) ? { ...reminder, sent: true } : reminder));
                await updateDoc(doc(db, 'events', eventId), { reminderHours });
                debugLog('bot.reminderSkipped', { eventId });
            } else if (due.length > 0) {
                const reminderHours = normalizeReminderHours(event.reminderHours)
                    .map((reminder, index) => (due.includes(index) ? { ...reminder, sent: true } : reminder));
                await updateDoc(doc(db, 'events', eventId), { reminderHours });

                console.log(`⏰ Sending reminder for event: ${event.title}`);
                const timeStr = startTime.toLocaleString('de-DE', { timeZone: TIMEZONE });
                const recipientCount = await messageAcceptedParticipants(eventId,
                    `⏰ **Erinnerung!** Das Event **${event.title}** startet am ${timeStr}. Sei bereit!`, send);
                debugLog('bot.sendReminder', { eventId, recipientCount });
            }

            // Event-start notification during the first 5 minutes
            const fiveMinutes = 5 * 60 * 1000;
            if (now >= startTime && now < new Date(startTime.getTime() + fiveMinutes) && !event.eventStartNotificationSent) {
                await updateDoc(doc(db, 'events', eventId), { eventStartNotificationSent: true });

                console.log(`🎯 Event started: ${event.title}`);
                if (eventStartNotifications) await messageAcceptedParticipants(eventId,
                    `🎯 **${event.title}** hat gerade begonnen! Viel Spaß!\n\n🔗 Event ansehen: ${buildEventUrl(eventId)}`, send);
            }
        }
    } catch (err) {
        console.error('Reminder check error:', err.message);
    }
}

function startReminderScheduler() {
    if (reminderInterval) clearInterval(reminderInterval);
    reminderInterval = setInterval(checkReminders, 5 * 60 * 1000); // Every 5 min
    console.log('⏰ Reminder scheduler started (checks every 5 min)');
}

/**
 * Stop the reminder scheduler (graceful shutdown).
 */
function stopReminderScheduler() {
    if (reminderInterval) {
        clearInterval(reminderInterval);
        reminderInterval = null;
    }
}

/**
 * Whether the reminder scheduler runs (bot control center status).
 *
 * @returns {boolean}
 */
function isReminderSchedulerRunning() {
    return !!reminderInterval;
}

module.exports = {
    checkReminders,
    startReminderScheduler,
    stopReminderScheduler,
    isReminderSchedulerRunning
};
