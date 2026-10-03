/**
 * Date polls -> database flows.
 *
 * Everything that writes a poll or a vote runs under the per-event lock
 * with the key "poll:<id>", so a vote never slips past a closing poll.
 */
const { db, collection, doc, getDoc, getDocs, query, where } = require('../firebaseAdmin');

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

module.exports = { voteDocId, loadPoll, loadPollVotes, loadUserVote };
