/**
 * Reminder rules for event.reminderHours. The stored `sent` flag is the only
 * protection against duplicates: it survives restarts, unlike process memory.
 */

const HOUR_MS = 60 * 60 * 1000;

/**
 * reminderHours in its one valid shape. Legacy events store a number, the
 * event form sends text such as "24, 1" (separated by comma, semicolon or space).
 *
 * @param {*} value -> Stored or submitted reminderHours.
 * @returns {Array<{ hours: number, sent: boolean }>} -> Reminders with positive hours, each hour once.
 */
function normalizeReminderHours(value) {
    const list = Array.isArray(value)
        ? value
        : String(value ?? '').split(/[\s,;]+/).map(hours => ({ hours, sent: false }));
    const seen = new Set();
    return list
        .map(reminder => ({ hours: Number.parseFloat(reminder?.hours), sent: reminder?.sent === true }))
        .filter(reminder => Number.isFinite(reminder.hours) && reminder.hours > 0 && !seen.has(reminder.hours) && seen.add(reminder.hours));
}

/**
 * reminderHours to store when an event is saved: a reminder that was already
 * sent stays sent as long as the start time is unchanged, so editing an event
 * does not send it again. A new start time makes every reminder due again.
 *
 * @param {*} value -> Submitted reminderHours.
 * @param {Object|null} oldEvent -> Stored event before the change, null when created.
 * @param {string} startDate -> New start date.
 * @returns {Array<{ hours: number, sent: boolean }>} -> Reminders to store.
 */
function mergeReminderHours(value, oldEvent, startDate) {
    const sameStart = !!oldEvent && oldEvent.startDate === startDate;
    const sentHours = new Set(sameStart
        ? normalizeReminderHours(oldEvent.reminderHours).filter(reminder => reminder.sent).map(reminder => reminder.hours)
        : []);
    return normalizeReminderHours(value).map(reminder => ({ hours: reminder.hours, sent: sentHours.has(reminder.hours) }));
}

/**
 * Indexes of the reminders that must go out now: reminder time reached, event
 * not started yet, not sent before.
 *
 * @param {Object} event -> Event document data.
 * @param {Date} now -> Current time.
 * @returns {number[]} -> Indexes into normalizeReminderHours(event.reminderHours).
 */
function findDueReminders(event, now) {
    const start = new Date(event.startDate).getTime();
    if (!Number.isFinite(start) || now.getTime() >= start) return [];
    return normalizeReminderHours(event.reminderHours)
        .map((reminder, index) => ({ reminder, index }))
        .filter(({ reminder }) => !reminder.sent && now.getTime() >= start - reminder.hours * HOUR_MS)
        .map(({ index }) => index);
}

module.exports = { normalizeReminderHours, mergeReminderHours, findDueReminders };
