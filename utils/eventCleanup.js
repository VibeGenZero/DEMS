/**
 * Clean-up in Discord once an event is over for good (B-10): an archived,
 * cancelled or deleted event loses its private channels, and its accepted
 * members lose the event role (`assignRoleId`) — unless they are accepted for
 * another draft or active event with the same role.
 *
 * `discordCleanup` on the event: 'pending' while the bot could not run it
 * (the archive scheduler retries), 'done' afterwards, null after a
 * reactivation. Events without the field are never touched by the retry.
 */
const { db, collection, doc, getDoc, getDocs, query, updateDoc, where } = require('../firebaseAdmin');
const { addAuditLog } = require('./eventUtils');

const OVER_STATUSES = ['archived', 'cancelled'];
const OPEN_STATUSES = ['draft', 'active'];

/** Lazy, so tests can inject a stub and the bot module loads only when needed. */
const defaultBot = () => require('../bot');

/**
 * User ids of the accepted registrations of an event.
 *
 * @param {string} eventId -> Event document id.
 * @returns {Promise<Array<string>>} -> Discord user ids.
 */
async function acceptedUserIds(eventId) {
    const snap = await getDocs(query(collection(db, 'registrations'), where('eventId', '==', eventId)));
    return snap.docs.map(entry => entry.data())
        .filter(reg => reg.status === 'accepted' && reg.userId)
        .map(reg => reg.userId);
}

/**
 * Members who still need the role: accepted for another draft or active event
 * that hands out the same role.
 *
 * @param {string} eventId -> The event being cleaned up.
 * @param {string} roleId -> Its event role.
 * @returns {Promise<Set<string>>} -> User ids that keep the role.
 */
async function membersStillNeedingRole(eventId, roleId) {
    const snap = await getDocs(query(collection(db, 'events'), where('assignRoleId', '==', roleId)));
    const keep = new Set();
    for (const other of snap.docs) {
        if (other.id === eventId || !OPEN_STATUSES.includes(other.data().status)) continue;
        for (const userId of await acceptedUserIds(other.id)) keep.add(userId);
    }
    return keep;
}

/**
 * Delete the event channels and take the event role from the accepted members.
 * Never throws; meant to run fire and forget after a status change.
 *
 * @param {string} eventId -> Event document id.
 * @param {Object} [options]
 * @param {Object} [options.bot] -> Discord helpers (default: bot.js).
 * @returns {Promise<'done'|'pending'|'nothing'>} -> 'pending' when the bot was not ready.
 */
async function cleanupEvent(eventId, { bot = defaultBot() } = {}) {
    try {
        const snap = await getDoc(doc(db, 'events', eventId));
        if (!snap.exists()) return 'nothing';
        const event = snap.data();

        const roleId = event.assignRoleId || '';
        let userIds = [];
        if (roleId) {
            const keep = await membersStillNeedingRole(eventId, roleId);
            userIds = (await acceptedUserIds(eventId)).filter(userId => !keep.has(userId));
        }
        const hasChannels = !!(event.discordChannelId || event.discordTextChannelId);
        if (!userIds.length && !hasChannels) return 'nothing';

        await updateDoc(doc(db, 'events', eventId), { discordCleanup: 'pending' });

        let roleResult = null;
        if (userIds.length) roleResult = await bot.removeRoleFromMembers(roleId, userIds);
        if (hasChannels) await bot.deleteEventChannels(eventId);

        const after = (await getDoc(doc(db, 'events', eventId))).data() || {};
        const channelsLeft = !!(after.discordChannelId || after.discordTextChannelId);
        if (roleResult === false || channelsLeft) return 'pending';

        await updateDoc(doc(db, 'events', eventId), { discordCleanup: 'done' });
        const parts = [];
        if (roleResult) {
            parts.push(`Removed role ${roleId} from ${roleResult.removed} member(s)` +
                (roleResult.failed ? ` (${roleResult.failed} failed)` : ''));
        }
        if (hasChannels) parts.push('deleted the event channels');
        await addAuditLog('DISCORD_CLEANUP', 'system', `"${event.title}": ${parts.join('; ')}`, eventId);
        return 'done';
    } catch (err) {
        console.error('Event clean-up failed for', eventId, err.message);
        return 'pending';
    }
}

/**
 * Run the clean-ups the bot could not run before, for events that are still
 * archived or cancelled. Called by the archive scheduler on every pass.
 *
 * @param {Object} [options]
 * @param {Object} [options.bot] -> Discord helpers (default: bot.js).
 * @returns {Promise<number>} -> Number of clean-ups finished in this pass.
 */
async function retryPendingCleanups({ bot = defaultBot() } = {}) {
    const snap = await getDocs(query(collection(db, 'events'), where('discordCleanup', '==', 'pending')));
    let done = 0;
    for (const eventDoc of snap.docs) {
        if (!OVER_STATUSES.includes(eventDoc.data().status)) continue;
        if (await cleanupEvent(eventDoc.id, { bot }) === 'done') done++;
    }
    return done;
}

/**
 * An archived or cancelled event is active again: hand the event role back to
 * the accepted members when the clean-up took it, and drop the marker so a
 * pending clean-up never runs later. Never throws.
 *
 * @param {string} eventId -> Event document id.
 * @param {Object} event -> The event before the change (with `discordCleanup`).
 * @param {Object} [options]
 * @param {Object} [options.bot] -> Discord helpers (default: bot.js).
 * @returns {Promise<void>}
 */
async function restoreEventRole(eventId, event, { bot = defaultBot() } = {}) {
    if (!event?.discordCleanup) return;
    try {
        await updateDoc(doc(db, 'events', eventId), { discordCleanup: null });
        if (event.discordCleanup !== 'done' || !event.assignRoleId) return;
        for (const userId of await acceptedUserIds(eventId)) {
            await bot.assignRole(userId, event.assignRoleId, process.env.DISCORD_GUILD_ID);
        }
    } catch (err) {
        console.error('Restoring the event role failed for', eventId, err.message);
    }
}

module.exports = {
    cleanupEvent,
    retryPendingCleanups,
    restoreEventRole
};
