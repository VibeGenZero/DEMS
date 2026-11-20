/**
 * Pure rules of the official plugin „Event einreichen“: validation, the
 * German message texts and the admin status filter.
 *
 * No I/O and no DEMS imports, so `server.js` and the tests share one source
 * of truth.
 */

/** Same list as the editor's `#event-category` select (a test pins it). */
const CATEGORIES = Object.freeze(['Tournament', 'Community', 'Workshop', 'Gamenight', 'Meeting', 'Sonstiges']);

/** Most submissions with an open status one member may have at a time. */
const MAX_OPEN = 3;

/** Statuses that count towards `MAX_OPEN`. */
const OPEN_STATUSES = Object.freeze(['open', 'planning']);

const TITLE_MIN = 3;
const TITLE_MAX = 100;
const DESCRIPTION_MAX = 2000;
const REASON_MAX = 500;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const INVALID_INPUT = 'Ungültige Eingabe.';

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Absent → `''`, a string → trimmed, anything else → null. */
function readText(value) {
    if (value === undefined || value === null) return '';
    if (typeof value !== 'string') return null;
    return value.trim();
}

/** Whether `YYYY-MM-DD` names a real calendar day (no 2027-02-30). */
function isCalendarDate(value) {
    const match = value.match(DATE_PATTERN);
    if (!match) return false;
    const [year, month, day] = match.slice(1).map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * Validate the body of a new submission.
 *
 * @param {unknown} body -> Request body.
 * @param {string} today -> Today as `YYYY-MM-DD` (the wish date may not be earlier).
 * @returns {{ ok: true, value: { title: string, description: string, wishedDate: string, category: string } } | { ok: false, error: string }}
 * @example
 * validateSubmission({ title: ' Quiz ' }, '2026-11-19');
 * // { ok: true, value: { title: 'Quiz', description: '', wishedDate: '', category: '' } }
 */
function validateSubmission(body, today) {
    if (!isPlainObject(body)) return { ok: false, error: INVALID_INPUT };
    const title = readText(body.title);
    const description = readText(body.description);
    const wishedDate = readText(body.wishedDate);
    const category = readText(body.category);
    if ([title, description, wishedDate, category].includes(null)) return { ok: false, error: INVALID_INPUT };

    if (title.length < TITLE_MIN || title.length > TITLE_MAX) return { ok: false, error: 'Der Titel braucht 3 bis 100 Zeichen.' };
    if (description.length > DESCRIPTION_MAX) return { ok: false, error: 'Die Beschreibung darf höchstens 2000 Zeichen haben.' };
    if (wishedDate !== '') {
        if (!isCalendarDate(wishedDate)) return { ok: false, error: 'Ungültiger Wunschtermin.' };
        // ISO dates compare correctly as strings
        if (wishedDate < today) return { ok: false, error: 'Der Wunschtermin muss heute oder später sein.' };
    }
    if (category !== '' && !CATEGORIES.includes(category)) return { ok: false, error: 'Unbekannte Kategorie.' };

    return { ok: true, value: { title, description, wishedDate, category } };
}

/**
 * Validate the optional reason of a rejection.
 *
 * @param {unknown} value -> `reason` from the request body.
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
function validateReason(value) {
    const reason = readText(value);
    if (reason === null) return { ok: false, error: INVALID_INPUT };
    if (reason.length > REASON_MAX) return { ok: false, error: 'Die Begründung darf höchstens 500 Zeichen haben.' };
    return { ok: true, value: reason };
}

/**
 * Escape Discord Markdown and neutralise mentions in member text.
 *
 * The zero-width space after `@` is a second guard next to
 * `allowedMentions: { parse: [] }`: even if a message were sent without it,
 * `@everyone` or `<@&id>` would not ping.
 */
function escapeDiscord(text) {
    return String(text)
        .replace(/\\/g, '\\\\')
        .replace(/[*_~`|>]/g, '\\$&')
        .replace(/@/g, '@​');
}

/** DM to the member once the team published the event. */
function acceptedDm(title) {
    return `Dein Event „${title}“ wurde eingetragen.`;
}

/** DM to the member after a rejection, with the reason on a second line when given. */
function rejectedDm(title, reason) {
    return `Dein Event-Vorschlag „${title}“ wurde abgelehnt.` + (reason ? `\nBegründung: ${reason}` : '');
}

/** Channel post for the team about a new submission; name and title are escaped. */
function newSubmissionPost(name, title) {
    return `Neuer Event-Vorschlag von **${escapeDiscord(name)}**: „${escapeDiscord(title)}“`;
}

const FILTERS = Object.freeze({
    open: ['open'],
    planning: ['planning'],
    done: ['accepted', 'rejected']
});

/**
 * Filter submissions for the admin list, newest first.
 *
 * @param {Array<{ status: string, createdAt: string }>} list
 * @param {string} filter -> `'open'`, `'planning'`, `'done'` (accepted + rejected); anything else → all.
 * @returns {Array} -> A new array.
 */
function statusFilter(list, filter) {
    const statuses = Object.hasOwn(FILTERS, filter) ? FILTERS[filter] : null;
    return list
        .filter(item => !statuses || statuses.includes(item.status))
        .sort((a, b) => {
            // ISO strings: a plain string comparison is the time order
            const left = String(a.createdAt);
            const right = String(b.createdAt);
            return left < right ? 1 : left > right ? -1 : 0;
        });
}

module.exports = {
    CATEGORIES,
    MAX_OPEN,
    OPEN_STATUSES,
    validateSubmission,
    validateReason,
    acceptedDm,
    rejectedDm,
    newSubmissionPost,
    statusFilter
};
