/**
 * Date polls -> pure rules.
 *
 * Validation of the admin input, cleaning of votes, the tally and the
 * favorite. Every function works on plain data, so the rules are tested
 * without a database.
 */
const crypto = require('crypto');

/** Poll lifecycle. */
const POLL_STATUS = { OPEN: 'open', CLOSED: 'closed', DECIDED: 'decided' };

/** Limits of the poll editor. */
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 10;
const TITLE_MAX_LENGTH = 200;
const DESCRIPTION_MAX_LENGTH = 5000;
const OPTION_ID_LENGTH = 8;

/** Answers members pick from -> admins can rename them per poll. */
const DEFAULT_POLL_LABELS = { yes: 'passt', maybe: 'wenn nötig', no: 'passt nicht' };
const LABEL_MAX_LENGTH = 30;

const { getTimezone } = require('./timezone');

/**
 * Parse a date value.
 *
 * @param {*} value -> ISO string or anything else.
 * @returns {Date|null} -> The date, or null when it is not a valid date.
 */
function parseDate(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Create an option ID that is not used yet.
 *
 * @param {Set<string>} taken -> IDs already in use.
 * @returns {string} -> New 8 character hex ID.
 */
function generateOptionId(taken) {
    let id;
    do {
        id = crypto.randomUUID().replace(/-/g, '').slice(0, OPTION_ID_LENGTH);
    } while (taken.has(id));
    return id;
}

/**
 * Date parts in the event time zone.
 *
 * @param {Date} date -> The date.
 * @param {Object} options -> Intl.DateTimeFormat options.
 * @returns {Object} -> Parts keyed by type (weekday, day, month, hour, minute).
 */
function dateParts(date, options) {
    const formatter = new Intl.DateTimeFormat('de-DE', { ...options, timeZone: getTimezone(), hourCycle: 'h23' });
    return Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
}

/**
 * Readable date of a poll option, e.g. "So, 11.10. · 20:00–22:00".
 *
 * @param {Object} option -> `{ startDate, endDate }`.
 * @returns {string} -> German label in the event time zone.
 */
function formatPollOption(option) {
    const start = dateParts(new Date(option.startDate), { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    let label = `${start.weekday.replace('.', '')}, ${start.day}.${start.month}. · ${start.hour}:${start.minute}`;
    if (option.endDate) {
        const end = dateParts(new Date(option.endDate), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        label += end.day === start.day && end.month === start.month
            ? `–${end.hour}:${end.minute}`
            : ` – ${end.day}.${end.month}. ${end.hour}:${end.minute}`;
    }
    return label;
}

/**
 * Answers of a poll -> missing ones (older polls) fall back to the defaults.
 *
 * @param {Object} poll -> The poll (or `{ labels }`).
 * @returns {{ yes: string, maybe: string, no: string }} -> The three answers.
 */
function getPollLabels(poll) {
    const stored = poll && poll.labels && typeof poll.labels === 'object' ? poll.labels : {};
    const labels = {};
    for (const key of Object.keys(DEFAULT_POLL_LABELS)) {
        const value = typeof stored[key] === 'string' ? stored[key].trim() : '';
        labels[key] = value || DEFAULT_POLL_LABELS[key];
    }
    return labels;
}

/**
 * Validate the answers of the poll editor; an empty answer gets its default.
 *
 * @param {Object} raw -> `{ yes, maybe, no }` from the request, may be missing.
 * @param {Object|null} existingPoll -> Stored poll when editing -> kept when `raw` is missing.
 * @returns {Object} -> `{ labels }` or `{ error }`.
 */
function normalizePollLabels(raw, existingPoll) {
    if (!raw || typeof raw !== 'object') return { labels: getPollLabels(existingPoll) };
    const labels = getPollLabels({ labels: raw });
    const values = Object.values(labels);
    if (values.some(label => label.length > LABEL_MAX_LENGTH)) {
        return { error: `Antworttexte dürfen höchstens ${LABEL_MAX_LENGTH} Zeichen lang sein.` };
    }
    if (new Set(values.map(label => label.toLowerCase())).size !== values.length) {
        return { error: 'Die drei Antworten brauchen unterschiedliche Texte.' };
    }
    return { labels };
}

/**
 * Validate and clean the poll sent by the admin form.
 *
 * Options that already exist keep their ID. An option with votes may not
 * be removed or moved -> people voted for exactly that date.
 *
 * @param {Object} raw -> Request body.
 * @param {Object|null} [existingPoll] -> The stored poll when editing.
 * @param {Array<Object>} [votes] -> Stored votes of the poll when editing.
 * @param {Date} [now] -> Reference time.
 * @returns {{ poll: Object } | { error: string }} -> Clean fields or a German error message.
 */
function normalizePollInput(raw, existingPoll = null, votes = [], now = new Date()) {
    if (existingPoll && existingPoll.status !== POLL_STATUS.OPEN) {
        return { error: 'Nur offene Abstimmungen können bearbeitet werden.' };
    }
    const body = raw || {};

    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title || title.length > TITLE_MAX_LENGTH) return { error: 'Titel ist erforderlich (max. 200 Zeichen).' };
    const description = typeof body.description === 'string' ? body.description : '';
    if (description.length > DESCRIPTION_MAX_LENGTH) return { error: 'Beschreibung darf maximal 5000 Zeichen lang sein.' };

    const rawOptions = Array.isArray(body.options) ? body.options : [];
    if (rawOptions.length < MIN_OPTIONS || rawOptions.length > MAX_OPTIONS) {
        return { error: 'Eine Abstimmung braucht 2–10 Termine.' };
    }

    const existingOptions = existingPoll ? existingPoll.options : [];
    const existingById = new Map(existingOptions.map(option => [option.id, option]));
    const votedIds = new Set(votes.flatMap(vote => [...(vote.yes || []), ...(vote.maybe || [])]));
    const takenIds = new Set(existingById.keys());
    const usedIds = new Set();
    const usedStarts = new Set();
    const options = [];

    for (const rawOption of rawOptions) {
        const start = parseDate(rawOption && rawOption.startDate);
        if (!start) return { error: 'Jeder Termin braucht ein gültiges Datum.' };
        const end = rawOption.endDate ? parseDate(rawOption.endDate) : null;
        if (rawOption.endDate && (!end || end <= start)) {
            return { error: 'Das Ende eines Termins muss nach dem Beginn liegen.' };
        }

        const startIso = start.toISOString();
        const known = typeof rawOption.id === 'string' && existingById.has(rawOption.id) && !usedIds.has(rawOption.id)
            ? existingById.get(rawOption.id)
            : null;
        const moved = !known || known.startDate !== startIso;
        if (known && moved && votedIds.has(known.id)) {
            return { error: 'Termine mit Stimmen können nicht verschoben werden.' };
        }
        if (moved && start <= now) return { error: 'Neue oder verschobene Termine müssen in der Zukunft liegen.' };
        if (usedStarts.has(startIso)) return { error: 'Zwei Termine haben denselben Beginn.' };
        usedStarts.add(startIso);

        const id = known ? known.id : generateOptionId(takenIds);
        takenIds.add(id);
        usedIds.add(id);
        options.push({ id, startDate: startIso, endDate: end ? end.toISOString() : '' });
    }

    for (const old of existingOptions) {
        if (!usedIds.has(old.id) && votedIds.has(old.id)) {
            return { error: `Der Termin am ${formatPollOption(old)} hat bereits Stimmen.` };
        }
    }
    options.sort((a, b) => a.startDate.localeCompare(b.startDate));

    let deadline = '';
    if (body.deadline) {
        const parsed = parseDate(body.deadline);
        if (!parsed) return { error: 'Die Deadline ist kein gültiges Datum.' };
        if (!existingPoll && parsed <= now) return { error: 'Die Deadline muss in der Zukunft liegen.' };
        deadline = parsed.toISOString();
    }

    const accessMode = body.accessMode === 'role-required' ? 'role-required' : 'open';
    const requiredRoles = accessMode === 'role-required' && Array.isArray(body.requiredRoles)
        ? body.requiredRoles.filter(roleId => typeof roleId === 'string' && roleId)
        : [];
    if (accessMode === 'role-required' && requiredRoles.length === 0) {
        return { error: 'Bitte wähle mindestens eine Rolle aus.' };
    }

    const labelResult = normalizePollLabels(body.labels, existingPoll);
    if (labelResult.error) return { error: labelResult.error };

    return { poll: { title, description, options, deadline, accessMode, requiredRoles, labels: labelResult.labels } };
}

/**
 * Clean a vote: known dates only, in date order; "passt" wins over "wenn nötig".
 *
 * @param {Array<Object>} options -> Options of the poll.
 * @param {*} raw -> `{ yes, maybe }` from the request.
 * @returns {{ yes: string[], maybe: string[] }} -> Clean vote.
 */
function normalizeVote(options, raw) {
    const yes = new Set(raw && Array.isArray(raw.yes) ? raw.yes : []);
    const maybe = new Set(raw && Array.isArray(raw.maybe) ? raw.maybe : []);
    const ids = options.map(option => option.id);
    return {
        yes: ids.filter(id => yes.has(id)),
        maybe: ids.filter(id => maybe.has(id) && !yes.has(id))
    };
}

/**
 * Answers a member can give for one date.
 */
const VOTE_STATES = ['yes', 'maybe', 'no'];

/**
 * Change the answer for one date and keep every other date as it is.
 *
 * @param {{ yes: string[], maybe: string[] }} current -> The stored vote.
 * @param {string} optionId -> The changed date.
 * @param {string} state -> One of `VOTE_STATES`.
 * @returns {{ yes: string[], maybe: string[] }} -> The new vote, not yet normalized.
 */
function applyVoteChange(current, optionId, state) {
    const yes = (current.yes || []).filter(id => id !== optionId);
    const maybe = (current.maybe || []).filter(id => id !== optionId);
    if (state === 'yes') yes.push(optionId);
    if (state === 'maybe') maybe.push(optionId);
    return { yes, maybe };
}

/**
 * Whether votes are still accepted.

 *
 * @param {Object} poll -> The poll.
 * @param {Date} [now] -> Reference time.
 * @returns {boolean} -> True while open and before the deadline.
 */
function isPollOpen(poll, now = new Date()) {
    if (!poll || poll.status !== POLL_STATUS.OPEN) return false;
    return !poll.deadline || now < new Date(poll.deadline);
}

/**
 * Status as members see it -> an open poll past its deadline counts as closed.
 *
 * @param {Object} poll -> The poll.
 * @param {Date} [now] -> Reference time.
 * @returns {string} -> One of POLL_STATUS.
 */
function effectivePollStatus(poll, now = new Date()) {
    if (poll.status === POLL_STATUS.OPEN && !isPollOpen(poll, now)) return POLL_STATUS.CLOSED;
    return poll.status;
}

/**
 * Whether a member with these roles may vote.
 *
 * @param {Object} poll -> The poll.
 * @param {string[]} userRoles -> Discord role IDs of the member.
 * @returns {boolean} -> True when the poll is open to everyone or a role matches.
 */
function canVote(poll, userRoles) {
    if (poll.accessMode !== 'role-required' || !Array.isArray(poll.requiredRoles) || poll.requiredRoles.length === 0) return true;
    const roles = Array.isArray(userRoles) ? userRoles : [];
    return poll.requiredRoles.some(roleId => roles.includes(roleId));
}

/**
 * Count the votes per date.
 *
 * @param {Object} poll -> The poll.
 * @param {Array<Object>} votes -> Stored votes.
 * @param {Object} [usersById] -> Profiles for names and avatars.
 * @returns {Object} -> `{ voterCount, options: [...] }` in option order.
 */
function tallyPoll(poll, votes, usersById = {}) {
    const ordered = [...votes].sort((a, b) => (a.updatedAt || '').localeCompare(b.updatedAt || ''));
    const describe = (vote) => {
        const profile = usersById[vote.userId] || {};
        return { displayName: profile.displayName || vote.userName || 'Unbekannt', avatar: profile.avatar || '' };
    };
    return {
        voterCount: votes.length,
        options: poll.options.map(option => {
            const yesVoters = ordered.filter(vote => (vote.yes || []).includes(option.id)).map(describe);
            const maybeVoters = ordered.filter(vote => (vote.maybe || []).includes(option.id)).map(describe);
            return {
                optionId: option.id,
                startDate: option.startDate,
                endDate: option.endDate || '',
                yes: yesVoters.length,
                maybe: maybeVoters.length,
                yesVoters,
                maybeVoters
            };
        })
    };
}

/**
 * Options from best to worst: most "passt", then most "wenn nötig", then earliest.
 *
 * @param {Object} tally -> Result of tallyPoll().
 * @returns {Array<Object>} -> Ranked tally options.
 */
function rankOptions(tally) {
    return [...tally.options].sort((a, b) =>
        b.yes - a.yes || b.maybe - a.maybe || a.startDate.localeCompare(b.startDate));
}

/**
 * The current favorite.
 *
 * @param {Object} tally -> Result of tallyPoll().
 * @returns {string|null} -> Option ID, or null while nobody voted for anything.
 */
function getFavoriteOptionId(tally) {
    const [best] = rankOptions(tally);
    return best && best.yes + best.maybe > 0 ? best.optionId : null;
}

module.exports = {
    POLL_STATUS,
    MIN_OPTIONS,
    MAX_OPTIONS,
    DEFAULT_POLL_LABELS,
    getPollLabels,
    normalizePollInput,
    VOTE_STATES,
    normalizeVote,
    applyVoteChange,
    isPollOpen,
    effectivePollStatus,
    canVote,
    tallyPoll,
    rankOptions,
    getFavoriteOptionId,
    formatPollOption
};
