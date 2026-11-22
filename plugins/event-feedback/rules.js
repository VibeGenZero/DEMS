/**
 * Rules of the official plugin „Event-Feedback“: the feedback window,
 * who may answer, answer checks, summaries and the DM text. Pure (no I/O,
 * no requires), so server and tests share one definition.
 *
 * Event end = `endDate`, else start + 2 h (DEMS' `isEventOver` rule); the
 * window runs from the end (or the archiving, when an admin ends it early)
 * until 7 days after the end; cancelled and draft events never take feedback. Eligible = own registration `accepted`, and checked
 * in when the event uses check-in.
 */

const WINDOW_DAYS = 7;
const COMMENT_MAX = 1000;
const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const CLOSED_STATUSES = ['cancelled', 'draft'];

const ERRORS = Object.freeze({
    notEligible: 'Für dieses Event kannst du kein Feedback geben.',
    rating: 'Bitte vergib 1 bis 5 Sterne.',
    comment: `Der Kommentar darf höchstens ${COMMENT_MAX} Zeichen lang sein.`,
    closed: 'Die Feedback-Zeit für dieses Event ist vorbei.'
});

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function parseDate(value) {
    if (typeof value !== 'string' || value === '') return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * When an event is over.
 *
 * @param {{ startDate?: string, endDate?: string }} event
 * @returns {Date|null} -> `endDate`, else start + 2 h; an end before the start counts as missing; null without a valid start.
 */
function eventEnd(event) {
    const start = parseDate(event && event.startDate);
    if (!start) return null;
    const end = parseDate(event.endDate);
    return end && end >= start ? end : new Date(start.getTime() + DEFAULT_DURATION_MS);
}

/**
 * @param {object} event
 * @returns {{ opensAt: Date, closesAt: Date }|null} -> null for cancelled or draft events and events without a start.
 */
function feedbackWindow(event) {
    if (!event || CLOSED_STATUSES.includes(event.status)) return null;
    const end = eventEnd(event);
    if (!end) return null;
    return { opensAt: end, closesAt: new Date(end.getTime() + WINDOW_DAYS * DAY_MS) };
}

/** Whether the event has started at `now` (an event without a valid start never has). */
function hasStarted(event, now) {
    const start = parseDate(event && event.startDate);
    return Boolean(start) && start <= now;
}

/**
 * Whether the event takes feedback at `now`. An event archived after its start but before its
 * scheduled end („Beenden“ during the event) is over at once; one archived before it started is
 * not over until its scheduled end.
 */
function isOpen(event, now) {
    const window = feedbackWindow(event);
    if (!window || now > window.closesAt) return false;
    return window.opensAt <= now || (event.status === 'archived' && hasStarted(event, now));
}

/**
 * Whether a member's registration allows feedback for the event.
 *
 * @param {{ checkinEnabled?: boolean }} event
 * @param {{ status: string, checkedIn: boolean }|null} registration -> The member's own registration.
 * @param {boolean} [checkinUsed] -> Whether check-in really happened at the event (someone checked in);
 *   defaults to `checkinEnabled`. A switched-on check-in nobody used (e.g. a duplicate without code) does not count.
 * @returns {boolean}
 */
function isEligible(event, registration, checkinUsed = Boolean(event && event.checkinEnabled)) {
    if (!registration || registration.status !== 'accepted') return false;
    return !checkinUsed || registration.checkedIn === true;
}

/** Whether check-in was used at the event: switched on and at least one of its registrations checked in. */
const isCheckinUsed = (event, registrations) => Boolean(event && event.checkinEnabled)
    && registrations.some(entry => entry.checkedIn === true);

/**
 * Check what a member sends.
 *
 * @param {unknown} input -> `{ rating, comment? }`.
 * @returns {{ ok: true, value: { rating: number, comment: string } } | { ok: false, error: string }}
 */
function validateAnswer(input) {
    if (!isPlainObject(input)) return { ok: false, error: ERRORS.rating };
    const { rating } = input;
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { ok: false, error: ERRORS.rating };
    const raw = input.comment === undefined || input.comment === null ? '' : input.comment;
    if (typeof raw !== 'string') return { ok: false, error: ERRORS.comment };
    const comment = raw.trim();
    if (comment.length > COMMENT_MAX) return { ok: false, error: ERRORS.comment };
    return { ok: true, value: { rating, comment } };
}

/** Document id of one member's answer for one event. */
const answerId = (eventId, userId) => `${eventId}_${userId}`;

/**
 * @param {Array<{ rating: number }>} answers
 * @returns {{ count: number, average: number|null, distribution: number[] }} -> `average` with one decimal; `distribution[0]` = 1 star.
 */
function summarize(answers) {
    const distribution = [0, 0, 0, 0, 0];
    let sum = 0;
    for (const { rating } of answers) {
        distribution[rating - 1] += 1;
        sum += rating;
    }
    const count = answers.length;
    return { count, average: count ? Math.round((sum / count) * 10) / 10 : null, distribution };
}

/** The few event fields the plugin's answers carry. */
const toEventView = event => ({ id: event.id, title: event.title, startDate: event.startDate, category: event.category || '' });

const escapeMarkdown = text => String(text).replace(/[\\*_~`|]/g, character => `\\${character}`);

/** DM text that asks for feedback. */
const requestDm = event => `Wie war **${escapeMarkdown(event.title)}**? Gib dem Team kurz Feedback – das dauert nur ein paar Sekunden.`;

module.exports = {
    WINDOW_DAYS,
    COMMENT_MAX,
    ERRORS,
    eventEnd,
    feedbackWindow,
    hasStarted,
    isOpen,
    isEligible,
    isCheckinUsed,
    validateAnswer,
    answerId,
    summarize,
    toEventView,
    requestDm
};
