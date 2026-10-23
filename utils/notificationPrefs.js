/**
 * DM choices of a member (W-16): which kinds of event DMs they want.
 * Stored as `users/{id}.notifications`; a missing field or key means "on",
 * so members who never chose (and Discord-only members) get every DM.
 */
// Read through the module object at call time -> tests can stub getDoc
const firebaseAdmin = require('../firebaseAdmin');

/** Kinds a member can switch off: reminders + start DM, change + cancellation DM, "put on the waitlist" DM. */
const NOTIFICATION_KINDS = ['reminders', 'changes', 'waitlist'];

/**
 * Effective choices of a member.
 *
 * @param {*} raw -> Stored `notifications` value (object, missing or anything else).
 * @returns {{ reminders: boolean, changes: boolean, waitlist: boolean }} -> Only an explicit false turns a kind off.
 */
function normalizeNotificationPrefs(raw) {
    const stored = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    return Object.fromEntries(NOTIFICATION_KINDS.map(kind => [kind, stored[kind] !== false]));
}

/**
 * Choices of one user; a missing document or a read error gives the defaults.
 *
 * @param {string} userId -> Discord user id.
 * @returns {Promise<Object>} -> Normalized choices.
 */
async function loadPrefs(userId) {
    try {
        const snap = await firebaseAdmin.getDoc(firebaseAdmin.doc(firebaseAdmin.db, 'users', userId));
        return normalizeNotificationPrefs(snap.exists() ? snap.data().notifications : undefined);
    } catch (err) {
        // A missed DM the member wanted is worse than one they did not want
        console.error(`[notificationPrefs] could not read the choices of ${userId}:`, err.message);
        return normalizeNotificationPrefs(undefined);
    }
}

/**
 * Users who want a DM kind.
 *
 * @param {string[]} userIds -> Recipients in send order (duplicates allowed).
 * @param {string} kind -> One of NOTIFICATION_KINDS.
 * @returns {Promise<{ userIds: string[], optedOut: number }>} -> Unique ids that want it, in order, and how many switched it off.
 */
async function filterByPreference(userIds, kind) {
    const unique = [...new Set(userIds)];
    const wanted = [];
    for (const userId of unique) {
        if ((await loadPrefs(userId))[kind]) wanted.push(userId);
    }
    return { userIds: wanted, optedOut: unique.length - wanted.length };
}

/**
 * Whether one user wants a DM kind.
 *
 * @param {string} userId -> Discord user id.
 * @param {string} kind -> One of NOTIFICATION_KINDS.
 * @returns {Promise<boolean>} -> True unless the user switched the kind off.
 */
async function wantsDm(userId, kind) {
    return (await loadPrefs(userId))[kind];
}

module.exports = { NOTIFICATION_KINDS, normalizeNotificationPrefs, filterByPreference, wantsDm };
