/**
 * Date polls -> database flows.
 *
 * Everything that writes a poll or a vote runs under the per-event lock
 * with the key "poll:<id>", so a vote never slips past a closing poll.
 * DMs and message refreshes run after the lock is released.
 */
const { db, collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, where, writeBatch } = require('../firebaseAdmin');
const { sendDM, markPollMessagesDeleted } = require('../bot');
const { withEventLock } = require('./eventLock');
const { notifyPollChanged } = require('./announcementRefresh');
const { buildEventUrl, buildPollUrl } = require('./eventUrl');
const {
    POLL_STATUS, normalizePollInput, normalizeVote, isPollOpen, canVote, tallyPoll, getFavoriteOptionId, formatPollOption
} = require('./pollService');

/** Machine readable failure codes. */
const POLL_ERROR = {
    NOT_FOUND: 'poll_not_found',
    CLOSED: 'poll_closed',
    MISSING_ROLE: 'missing_role',
    OPTION_NOT_FOUND: 'option_not_found',
    ALREADY_DECIDED: 'already_decided',
    INVALID: 'invalid_poll'
};

/** HTTP status codes of the failure codes. */
const POLL_ERROR_HTTP_STATUS = {
    [POLL_ERROR.NOT_FOUND]: 404,
    [POLL_ERROR.CLOSED]: 400,
    [POLL_ERROR.MISSING_ROLE]: 403,
    [POLL_ERROR.OPTION_NOT_FOUND]: 400,
    [POLL_ERROR.ALREADY_DECIDED]: 400,
    [POLL_ERROR.INVALID]: 400
};

/** Interval of the deadline check. */
const POLL_SCHEDULER_INTERVAL_MS = 5 * 60 * 1000;
let pollSchedulerTimer = null;

/**
 * Build a normalized failure result.
 *
 * @param {string} code -> One of POLL_ERROR.
 * @param {string} error -> German message.
 * @returns {Object} -> `{ ok: false, code, httpStatus, error }`.
 */
function pollFailure(code, error) {
    return { ok: false, code, httpStatus: POLL_ERROR_HTTP_STATUS[code] || 400, error };
}

/** Lock key of a poll -> shares the lock map with events without clashing. */
function lockKey(pollId) {
    return `poll:${pollId}`;
}

/** Document ID of a vote -> one vote per member and poll. */
function voteDocId(pollId, userId) {
    return `${pollId}_${userId}`;
}

/**
 * Load a poll.
 *
 * @param {string} pollId -> The poll document ID.
 * @returns {Promise<Object|null>} -> `{ id, ...data }` or null.
 */
async function loadPoll(pollId) {
    if (!pollId) return null;
    const snap = await getDoc(doc(db, 'polls', pollId));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/**
 * Load every vote of a poll.
 *
 * @param {string} pollId -> The poll document ID.
 * @returns {Promise<Array<Object>>} -> Votes with their `id`.
 */
async function loadPollVotes(pollId) {
    const snap = await getDocs(query(collection(db, 'pollVotes'), where('pollId', '==', pollId)));
    return snap.docs.map(voteDoc => ({ id: voteDoc.id, ...voteDoc.data() }));
}

/**
 * Load the vote of one member.
 *
 * @param {string} pollId -> The poll document ID.
 * @param {string} userId -> Discord user ID.
 * @returns {Promise<{ yes: string[], maybe: string[] }>} -> The vote, empty when there is none.
 */
async function loadUserVote(pollId, userId) {
    const snap = await getDoc(doc(db, 'pollVotes', voteDocId(pollId, userId)));
    if (!snap.exists()) return { yes: [], maybe: [] };
    const data = snap.data();
    return { yes: data.yes || [], maybe: data.maybe || [] };
}

/**
 * Store, overwrite or remove the vote of a member.
 *
 * @param {Object} params -> Vote input.
 * @param {string} params.pollId -> The poll document ID.
 * @param {Object} params.user -> `{ id, displayName, roles }`.
 * @param {string[]} [params.yes] -> Dates that fit.
 * @param {string[]} [params.maybe] -> Dates that fit if needed.
 * @param {Function} [params.update] -> `(stored) => ({ yes, maybe })` -> runs under the lock on the stored vote and replaces `yes`/`maybe`.
 * @param {Date} [params.now] -> Reference time.
 * @returns {Promise<Object>} -> `{ ok: true, vote }` or a failure.
 */
async function savePollVote({ pollId, user, yes = [], maybe = [], update = null, now = new Date() }) {
    const outcome = await withEventLock(lockKey(pollId), async () => {
        const poll = await loadPoll(pollId);
        if (!poll) return pollFailure(POLL_ERROR.NOT_FOUND, 'Abstimmung nicht gefunden');
        if (!isPollOpen(poll, now)) return pollFailure(POLL_ERROR.CLOSED, 'Die Abstimmung ist beendet.');
        if (!canVote(poll, user.roles || [])) {
            return pollFailure(POLL_ERROR.MISSING_ROLE, 'Du hast nicht die erforderliche Rolle für diese Abstimmung.');
        }

        // A change read under the lock -> parallel clicks of the same member keep each other
        const raw = update ? update(await loadUserVote(pollId, user.id)) : { yes, maybe };
        const vote = normalizeVote(poll.options, raw);
        const voteRef = doc(db, 'pollVotes', voteDocId(pollId, user.id));
        if (vote.yes.length === 0 && vote.maybe.length === 0) {
            await deleteDoc(voteRef);
        } else {
            await setDoc(voteRef, { pollId, userId: user.id, userName: user.displayName, ...vote, updatedAt: now.toISOString() });
        }
        return { ok: true, vote };
    });
    if (outcome.ok) notifyPollChanged(pollId);
    return outcome;
}

/**
 * Validate and store an edited poll.
 *
 * @param {string} pollId -> The poll document ID.
 * @param {Object} raw -> Request body.
 * @param {Date} [now] -> Reference time.
 * @returns {Promise<Object>} -> `{ ok: true, poll }` or a failure.
 */
async function updatePoll(pollId, raw, now = new Date()) {
    const outcome = await withEventLock(lockKey(pollId), async () => {
        const poll = await loadPoll(pollId);
        if (!poll) return pollFailure(POLL_ERROR.NOT_FOUND, 'Abstimmung nicht gefunden');
        const result = normalizePollInput(raw, poll, await loadPollVotes(pollId), now);
        if (result.error) return pollFailure(POLL_ERROR.INVALID, result.error);
        const update = { ...result.poll, updatedAt: now.toISOString() };
        await updateDoc(doc(db, 'polls', pollId), update);
        return { ok: true, poll: { ...poll, ...update } };
    });
    if (outcome.ok) notifyPollChanged(pollId);
    return outcome;
}

/**
 * Close a poll. Already closed or decided polls stay as they are.
 *
 * @param {string} pollId -> The poll document ID.
 * @param {Object} [options] -> Close options.
 * @param {boolean} [options.byDeadline] -> Closed by the scheduler -> the creator gets a DM.
 * @param {Date} [options.now] -> Reference time.
 * @returns {Promise<Object>} -> `{ ok: true, poll, changed }` or a failure.
 */
async function closePoll(pollId, { byDeadline = false, now = new Date() } = {}) {
    const outcome = await withEventLock(lockKey(pollId), async () => {
        const poll = await loadPoll(pollId);
        if (!poll) return pollFailure(POLL_ERROR.NOT_FOUND, 'Abstimmung nicht gefunden');
        if (poll.status !== POLL_STATUS.OPEN) return { ok: true, poll, changed: false };
        const update = { status: POLL_STATUS.CLOSED, closedAt: now.toISOString(), updatedAt: now.toISOString() };
        await updateDoc(doc(db, 'polls', pollId), update);
        return { ok: true, poll: { ...poll, ...update }, changed: true };
    });
    if (!outcome.ok || !outcome.changed) return outcome;

    if (byDeadline && outcome.poll.createdBy) {
        await notifyCreatorAboutEnd(outcome.poll);
    }
    notifyPollChanged(pollId);
    return outcome;
}

/**
 * DM to the creator when the deadline closed a poll.
 *
 * @param {Object} poll -> The closed poll.
 * @returns {Promise<void>}
 */
async function notifyCreatorAboutEnd(poll) {
    try {
        const tally = tallyPoll(poll, await loadPollVotes(poll.id));
        const favoriteId = getFavoriteOptionId(tally);
        const link = buildPollUrl(poll.id);
        if (!favoriteId) {
            await sendDM(poll.createdBy, `🗳️ Die Abstimmung **${poll.title}** ist beendet – leider hat niemand abgestimmt. ${link}`);
            return;
        }
        const favorite = tally.options.find(entry => entry.optionId === favoriteId);
        const option = poll.options.find(entry => entry.id === favoriteId);
        await sendDM(poll.createdBy,
            `🗳️ Die Abstimmung **${poll.title}** ist beendet. Favorit: **${formatPollOption(option)}** (✅ ${favorite.yes} · 🤔 ${favorite.maybe}). Jetzt Event erstellen: ${link}`
        );
    } catch (err) {
        console.error('Poll end notification failed:', err.message);
    }
}

/**
 * Check that a poll can be turned into an event with this date.
 *
 * @param {Object} params -> `{ pollId, optionId }`.
 * @returns {Promise<Object>} -> `{ ok: true, poll, option }` or a failure.
 */
async function validateDecision({ pollId, optionId }) {
    const poll = await loadPoll(pollId);
    if (!poll) return pollFailure(POLL_ERROR.NOT_FOUND, 'Abstimmung nicht gefunden');
    if (poll.status === POLL_STATUS.DECIDED) return pollFailure(POLL_ERROR.ALREADY_DECIDED, 'Diese Abstimmung ist bereits entschieden.');
    const option = poll.options.find(entry => entry.id === optionId);
    if (!option) return pollFailure(POLL_ERROR.OPTION_NOT_FOUND, 'Termin nicht gefunden');
    return { ok: true, poll, option };
}

/**
 * Decide a poll while creating its event -> one step under the poll lock.
 *
 * The check, the event creation and the decision run while the lock is
 * held, so two simultaneous requests (double click, two admins) cannot turn
 * one poll into two events. When `createEvent` throws, the poll stays as it
 * was.
 *
 * @param {Object} params -> Decision input.
 * @param {string} params.pollId -> The poll document ID.
 * @param {string} params.optionId -> The chosen date.
 * @param {Function} params.createEvent -> `async () => ({ eventId, ...extra })`, runs only for a valid decision.
 * @param {Date} [params.now] -> Reference time.
 * @returns {Promise<Object>} -> `{ ok: true, poll, created, notified }` or a failure.
 */
async function decidePollWithEvent({ pollId, optionId, createEvent, now = new Date() }) {
    const outcome = await withEventLock(lockKey(pollId), async () => {
        const check = await validateDecision({ pollId, optionId });
        if (!check.ok) return check;
        const created = await createEvent();
        const update = {
            status: POLL_STATUS.DECIDED,
            winnerOptionId: optionId,
            eventId: created.eventId,
            closedAt: check.poll.closedAt || now.toISOString(),
            updatedAt: now.toISOString()
        };
        await updateDoc(doc(db, 'polls', pollId), update);
        return { ok: true, poll: { ...check.poll, ...update }, option: check.option, created };
    });
    if (!outcome.ok) return outcome;

    const notified = await notifyVotersAboutDecision(outcome.poll, outcome.option);
    notifyPollChanged(pollId);
    return { ok: true, poll: outcome.poll, created: outcome.created, notified };
}

/**
 * Mark a poll as decided for an existing event and tell every voter.
 *
 * @param {Object} params -> Decision input.
 * @param {string} params.pollId -> The poll document ID.
 * @param {string} params.optionId -> The chosen date.
 * @param {string} params.eventId -> The event created from the date.
 * @param {Date} [params.now] -> Reference time.
 * @returns {Promise<Object>} -> `{ ok: true, poll, notified }` or a failure.
 */
async function decidePoll({ pollId, optionId, eventId, now = new Date() }) {
    const result = await decidePollWithEvent({ pollId, optionId, createEvent: async () => ({ eventId }), now });
    if (!result.ok) return result;
    return { ok: true, poll: result.poll, notified: result.notified };
}

/**
 * DM every voter which date was chosen, worded by their own vote.
 *
 * @param {Object} poll -> The decided poll (with `id` and `eventId`).
 * @param {Object} option -> The chosen date.
 * @returns {Promise<number>} -> Number of voters that were messaged.
 */
async function notifyVotersAboutDecision(poll, option) {
    const votes = await loadPollVotes(poll.id);
    const date = formatPollOption(option);
    const link = buildEventUrl(poll.eventId);
    for (const vote of votes) {
        let detail = `Er passt dir leider nicht – vielleicht klappt es trotzdem? ${link}`;
        if ((vote.yes || []).includes(option.id)) detail = `Du hattest ✅ *passt* angegeben – jetzt anmelden: ${link}`;
        else if ((vote.maybe || []).includes(option.id)) detail = `Du hattest 🤔 *wenn nötig* angegeben – jetzt anmelden: ${link}`;
        try {
            await sendDM(vote.userId, `📅 Der Termin für **${poll.title}** steht: **${date}**. ${detail}`);
        } catch (err) {
            console.error('Poll decision DM failed:', err.message);
        }
    }
    return votes.length;
}

/**
 * Close every open poll whose deadline has passed.
 *
 * @param {Date} [now] -> Reference time.
 * @returns {Promise<number>} -> Number of polls closed now.
 */
async function closeExpiredPolls(now = new Date()) {
    const snap = await getDocs(query(collection(db, 'polls'), where('status', '==', POLL_STATUS.OPEN)));
    let closed = 0;
    for (const pollDoc of snap.docs) {
        const poll = pollDoc.data();
        if (!poll.deadline || new Date(poll.deadline) > now) continue;
        const result = await closePoll(pollDoc.id, { byDeadline: true, now });
        if (result.ok && result.changed) closed += 1;
    }
    return closed;
}

/**
 * Delete a poll with its votes; posted messages become a short notice.
 *
 * @param {string} pollId -> The poll document ID.
 * @returns {Promise<Object>} -> `{ ok: true }` or a failure.
 */
async function deletePoll(pollId) {
    const poll = await loadPoll(pollId);
    if (!poll) return pollFailure(POLL_ERROR.NOT_FOUND, 'Abstimmung nicht gefunden');
    await markPollMessagesDeleted(poll);

    return withEventLock(lockKey(pollId), async () => {
        const batch = writeBatch(db);
        for (const vote of await loadPollVotes(pollId)) {
            batch.delete(doc(db, 'pollVotes', vote.id));
        }
        batch.delete(doc(db, 'polls', pollId));
        await batch.commit();
        return { ok: true };
    });
}

/**
 * Delete every vote of a member (account deletion).
 *
 * @param {string} userId -> Discord user ID.
 * @returns {Promise<number>} -> Number of deleted votes.
 */
async function deleteUserPollVotes(userId) {
    const snap = await getDocs(query(collection(db, 'pollVotes'), where('userId', '==', userId)));
    if (snap.empty) return 0;
    const batch = writeBatch(db);
    const pollIds = new Set();
    snap.docs.forEach(voteDoc => {
        batch.delete(voteDoc.ref);
        pollIds.add(voteDoc.data().pollId);
    });
    await batch.commit();
    pollIds.forEach(pollId => notifyPollChanged(pollId));
    return snap.size;
}

/**
 * Start the deadline check (independent of the bot's reminder setting).
 *
 * @returns {void}
 */
function startPollScheduler() {
    stopPollScheduler();
    pollSchedulerTimer = setInterval(() => {
        closeExpiredPolls().catch(err => console.error('Poll scheduler failed:', err.message));
    }, POLL_SCHEDULER_INTERVAL_MS);
    if (typeof pollSchedulerTimer.unref === 'function') pollSchedulerTimer.unref();
    console.log('🗳️ Poll scheduler started (checks every 5 min)');
}

/**
 * Stop the deadline check.
 *
 * @returns {void}
 */
function stopPollScheduler() {
    if (pollSchedulerTimer) clearInterval(pollSchedulerTimer);
    pollSchedulerTimer = null;
}

module.exports = {
    POLL_ERROR,
    voteDocId,
    loadPoll,
    loadPollVotes,
    loadUserVote,
    savePollVote,
    updatePoll,
    closePoll,
    validateDecision,
    decidePoll,
    decidePollWithEvent,
    closeExpiredPolls,
    deletePoll,
    deleteUserPollVotes,
    startPollScheduler,
    stopPollScheduler
};
