const express = require('express');
const router = express.Router();
const { db, collection, getDocs } = require('../firebaseAdmin');
const { requireAuth } = require('../middleware/auth');
const { checkRegistrationAllowed } = require('../middleware/maintenance');
const {
    tallyPoll, getFavoriteOptionId, isPollOpen, effectivePollStatus, canVote, normalizeVote, VOTE_STATES, applyVoteChange
} = require('../utils/pollService');
const { loadPoll, loadPollVotes, savePollVote } = require('../utils/pollStore');
const { debugLog } = require('../utils/debugLog');

// Every poll route needs a logged-in member
router.use(requireAuth);

/**
 * Profiles keyed by user ID for names and avatars in the tally.
 *
 * @returns {Promise<Object>} -> `{ [userId]: profile }`.
 */
async function loadUsersById() {
    const usersById = {};
    (await getDocs(collection(db, 'users'))).forEach(userDoc => { usersById[userDoc.id] = userDoc.data(); });
    return usersById;
}

/**
 * Poll as the event page needs it.
 *
 * @param {Object} poll -> The poll with its `id`.
 * @param {Array<Object>} votes -> Votes of the poll.
 * @param {Object} user -> Session user.
 * @param {Object} usersById -> Profiles for names and avatars.
 * @returns {Object} -> Response body.
 */
function buildPollResponse(poll, votes, user, usersById) {
    const tally = tallyPoll(poll, votes, usersById);
    const own = votes.find(vote => vote.userId === user.id);
    const { announcements, ...publicPoll } = poll;
    return {
        ...publicPoll,
        status: effectivePollStatus(poll),
        tally,
        favoriteOptionId: getFavoriteOptionId(tally),
        myVote: own ? normalizeVote(poll.options, own) : { yes: [], maybe: [] },
        canVote: canVote(poll, user.roles || []),
        isOpen: isPollOpen(poll)
    };
}

/**
 * Sort comparator -> open polls by deadline (without deadline last), then the rest newest first.
 */
function byPollOrder(a, b) {
    const aOpen = a.status === 'open';
    const bOpen = b.status === 'open';
    if (aOpen !== bOpen) return aOpen ? -1 : 1;
    if (aOpen) {
        if (!a.deadline !== !b.deadline) return a.deadline ? -1 : 1;
        return (a.deadline || '').localeCompare(b.deadline || '');
    }
    return (b.createdAt || '').localeCompare(a.createdAt || '');
}

/**
 * GET /api/polls — All polls with the own vote status
 */
router.get('/', async (req, res) => {
    try {
        const user = req.session.user;
        const votesByPoll = {};
        (await getDocs(collection(db, 'pollVotes'))).forEach(voteDoc => {
            const vote = voteDoc.data();
            (votesByPoll[vote.pollId] ||= []).push(vote);
        });

        const polls = (await getDocs(collection(db, 'polls'))).docs.map(pollDoc => {
            const poll = { id: pollDoc.id, ...pollDoc.data() };
            const votes = votesByPoll[poll.id] || [];
            const tally = tallyPoll(poll, votes);
            const favoriteId = getFavoriteOptionId(tally);
            const favorite = favoriteId ? tally.options.find(entry => entry.optionId === favoriteId) : null;
            return {
                id: poll.id,
                title: poll.title,
                status: effectivePollStatus(poll),
                deadline: poll.deadline || '',
                optionCount: poll.options.length,
                voterCount: tally.voterCount,
                favorite: favorite ? { optionId: favorite.optionId, startDate: favorite.startDate, endDate: favorite.endDate, yes: favorite.yes, maybe: favorite.maybe } : null,
                myVoteStatus: votes.some(vote => vote.userId === user.id) ? 'voted' : 'open',
                canVote: canVote(poll, user.roles || []),
                eventId: poll.eventId || '',
                createdAt: poll.createdAt || ''
            };
        });

        polls.sort(byPollOrder);
        res.json(polls);
    } catch (err) {
        console.error('List polls error:', err);
        res.status(500).json({ error: 'Fehler beim Laden der Abstimmungen' });
    }
});

/**
 * GET /api/polls/:id — One poll with tally and own vote
 */
router.get('/:id', async (req, res) => {
    try {
        const poll = await loadPoll(req.params.id);
        if (!poll) {
            return res.status(404).json({ error: 'Abstimmung nicht gefunden' });
        }
        const votes = await loadPollVotes(poll.id);
        res.json(buildPollResponse(poll, votes, req.session.user, await loadUsersById()));
    } catch (err) {
        console.error('Get poll error:', err);
        res.status(500).json({ error: 'Fehler beim Laden der Abstimmung' });
    }
});

/**
 * PUT /api/polls/:id/vote — Store the own vote
 * Body `{ optionId, state }` changes one date, `{ yes, maybe }` replaces the whole vote.
 */
router.put('/:id/vote', checkRegistrationAllowed, async (req, res) => {
    try {
        const user = req.session.user;
        const { optionId, state } = req.body;
        let change;
        if (typeof optionId === 'string') {
            // One date at a time is merged into the stored vote -> fast clicks keep each other
            if (!VOTE_STATES.includes(state)) {
                return res.status(400).json({ error: 'Ungültige Auswahl' });
            }
            change = { update: stored => applyVoteChange(stored, optionId, state) };
        } else {
            change = {
                yes: Array.isArray(req.body.yes) ? req.body.yes : [],
                maybe: Array.isArray(req.body.maybe) ? req.body.maybe : []
            };
        }
        const result = await savePollVote({
            pollId: req.params.id,
            user: { id: user.id, displayName: user.displayName, roles: user.roles },
            ...change
        });
        if (!result.ok) {
            return res.status(result.httpStatus).json({ error: result.error });
        }
        debugLog('polls.vote', { pollId: req.params.id, userId: user.id });

        const poll = await loadPoll(req.params.id);
        const votes = await loadPollVotes(req.params.id);
        res.json(buildPollResponse(poll, votes, user, await loadUsersById()));
    } catch (err) {
        console.error('Poll vote error:', err);
        res.status(500).json({ error: 'Fehler beim Abstimmen' });
    }
});

module.exports = router;
