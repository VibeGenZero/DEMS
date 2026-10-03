const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir } = require('./helpers');

// Mock mode with an own database; the empty cwd keeps a local .env out
const tmpDir = createTempDir('poll-store');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'poll-store.sqlite');

const bot = require('../bot');
const { db, doc, getDoc, setDoc } = require('../firebaseAdmin');
const {
    loadPoll, loadPollVotes, loadUserVote, savePollVote, closePoll, validateDecision, decidePoll, decidePollWithEvent,
    updatePoll, closeExpiredPolls, deletePoll, deleteUserPollVotes
} = require('../utils/pollStore');
const { applyVoteChange } = require('../utils/pollService');

after(async () => {
    await bot.client.destroy();
});

const A = { id: 'aaaaaaaa', startDate: '2026-12-11T18:00:00.000Z', endDate: '' };
const B = { id: 'bbbbbbbb', startDate: '2026-12-12T16:00:00.000Z', endDate: '' };
let counter = 0;

async function createPoll(fields = {}) {
    const id = `store-poll-${++counter}`;
    await setDoc(doc(db, 'polls', id), {
        title: `Abstimmung ${counter}`, description: '', status: 'open', deadline: '',
        accessMode: 'open', requiredRoles: [], options: [A, B], winnerOptionId: '', eventId: '',
        announcements: [], createdBy: 'store-admin', createdAt: '2026-10-01T00:00:00.000Z', ...fields
    });
    return id;
}

const user = (name, roles = []) => ({ id: `store-user-${name}`, displayName: name, roles });

async function captureLogs(fn) {
    const lines = [];
    const original = console.log;
    console.log = (...args) => lines.push(args.map(String).join(' '));
    try {
        await fn();
    } finally {
        console.log = original;
    }
    return lines.join('\n');
}

test('a vote is stored, overwritten and removed when empty', async () => {
    const pollId = await createPoll();
    const first = await savePollVote({ pollId, user: user('Ana'), yes: [A.id, 'x'], maybe: [A.id, B.id] });
    assert.deepEqual(first, { ok: true, vote: { yes: [A.id], maybe: [B.id] } });
    assert.deepEqual(await loadUserVote(pollId, user('Ana').id), { yes: [A.id], maybe: [B.id] });

    await savePollVote({ pollId, user: user('Ana'), yes: [B.id], maybe: [] });
    assert.deepEqual(await loadUserVote(pollId, user('Ana').id), { yes: [B.id], maybe: [] });
    assert.equal((await loadPollVotes(pollId)).length, 1);

    await savePollVote({ pollId, user: user('Ana'), yes: [], maybe: [] });
    assert.equal((await loadPollVotes(pollId)).length, 0);
});

test('closed, expired, role-restricted and missing polls refuse votes', async () => {
    const closed = await createPoll({ status: 'closed' });
    const expired = await createPoll({ deadline: '2026-01-01T00:00:00.000Z' });
    const restricted = await createPoll({ accessMode: 'role-required', requiredRoles: ['raid'] });

    const vote = (pollId, voter = user('Ben')) => savePollVote({ pollId, user: voter, yes: [A.id] });
    assert.deepEqual(await vote(closed), { ok: false, code: 'poll_closed', httpStatus: 400, error: 'Die Abstimmung ist beendet.' });
    assert.equal((await vote(expired)).code, 'poll_closed');
    assert.deepEqual(await vote(restricted), { ok: false, code: 'missing_role', httpStatus: 403, error: 'Du hast nicht die erforderliche Rolle für diese Abstimmung.' });
    assert.equal((await vote(restricted, user('Ben', ['raid']))).ok, true);
    assert.deepEqual(await vote('does-not-exist'), { ok: false, code: 'poll_not_found', httpStatus: 404, error: 'Abstimmung nicht gefunden' });
});

test('a vote that arrives while the poll is closing is refused', async () => {
    const pollId = await createPoll();
    const [closing, voting] = await Promise.all([
        closePoll(pollId),
        savePollVote({ pollId, user: user('Cem'), yes: [A.id] })
    ]);
    assert.equal(closing.changed, true);
    assert.equal(voting.code, 'poll_closed');
    assert.equal((await loadPoll(pollId)).status, 'closed');
});

test('closing by deadline tells the creator about the favorite', async () => {
    const pollId = await createPoll({ deadline: '2026-01-01T00:00:00.000Z', title: 'Herbst-Raid' });
    await setDoc(doc(db, 'pollVotes', `${pollId}_v1`), { pollId, userId: 'v1', userName: 'Ana', yes: [B.id], maybe: [], updatedAt: '1' });

    let closedCount;
    const output = await captureLogs(async () => { closedCount = await closeExpiredPolls(new Date('2026-10-03T00:00:00.000Z')); });
    assert.ok(closedCount >= 1);
    assert.equal((await loadPoll(pollId)).status, 'closed');
    assert.ok(output.includes('Die Abstimmung **Herbst-Raid** ist beendet. Favorit: **Sa, 12.12. · 17:00** (✅ 1 · 🤔 0)'));

    const open = await createPoll();
    await closeExpiredPolls(new Date('2026-10-03T00:00:00.000Z'));
    assert.equal((await loadPoll(open)).status, 'open');
});

test('a poll can only be decided once and voters get a DM', async () => {
    const pollId = await createPoll({ title: 'Raid' });
    await savePollVote({ pollId, user: user('Dan'), yes: [A.id] });
    await savePollVote({ pollId, user: user('Eva'), maybe: [A.id] });
    await savePollVote({ pollId, user: user('Fin'), yes: [B.id] });

    assert.deepEqual(await validateDecision({ pollId, optionId: 'nope' }), { ok: false, code: 'option_not_found', httpStatus: 400, error: 'Termin nicht gefunden' });

    let result;
    const output = await captureLogs(async () => { result = await decidePoll({ pollId, optionId: A.id, eventId: 'event-1' }); });
    assert.equal(result.ok, true);
    assert.equal(result.notified, 3);
    const stored = await loadPoll(pollId);
    assert.deepEqual([stored.status, stored.winnerOptionId, stored.eventId], ['decided', A.id, 'event-1']);
    assert.ok(output.includes('Du hattest ✅ *passt* angegeben – jetzt anmelden:'));
    assert.ok(output.includes('Du hattest 🤔 *wenn nötig* angegeben – jetzt anmelden:'));
    assert.ok(output.includes('Er passt dir leider nicht – vielleicht klappt es trotzdem?'));

    assert.equal((await validateDecision({ pollId, optionId: A.id })).error, 'Diese Abstimmung ist bereits entschieden.');
    assert.equal((await decidePoll({ pollId, optionId: A.id, eventId: 'event-2' })).ok, false);
    assert.equal((await validateDecision({ pollId: 'nope', optionId: A.id })).httpStatus, 404);
});

test('editing a poll keeps voted dates', async () => {
    const pollId = await createPoll();
    await savePollVote({ pollId, user: user('Gus'), yes: [A.id] });
    const refused = await updatePoll(pollId, { title: 'Neu', options: [B, { startDate: '2026-12-20T18:00:00.000Z' }] });
    assert.equal(refused.ok, false);
    assert.equal(refused.httpStatus, 400);
    assert.match(refused.error, /hat bereits Stimmen/);

    const saved = await updatePoll(pollId, { title: 'Neu', options: [A, B, { startDate: '2026-12-20T18:00:00.000Z' }] });
    assert.equal(saved.ok, true);
    assert.equal((await loadPoll(pollId)).options.length, 3);
    assert.equal((await loadPoll(pollId)).title, 'Neu');
});

test('deleting a poll removes its votes, deleting an account removes the own votes', async () => {
    const pollId = await createPoll();
    await savePollVote({ pollId, user: user('Hal'), yes: [A.id] });
    assert.deepEqual(await deletePoll(pollId), { ok: true });
    assert.equal(await loadPoll(pollId), null);
    assert.equal((await loadPollVotes(pollId)).length, 0);
    assert.equal((await deletePoll(pollId)).httpStatus, 404);

    const other = await createPoll();
    await savePollVote({ pollId: other, user: user('Ida'), yes: [A.id] });
    assert.equal(await deleteUserPollVotes(user('Ida').id), 1);
    assert.equal((await getDoc(doc(db, 'pollVotes', `${other}_${user('Ida').id}`))).exists(), false);
});


test('two decisions at the same time create only one event', async () => {
    const pollId = await createPoll({ title: 'Doppelklick' });
    let created = 0;
    const createEvent = async () => {
        created += 1;
        const eventId = `double-event-${created}`;
        await new Promise(resolve => setTimeout(resolve, 30));
        return { eventId };
    };

    const results = await Promise.all([
        decidePollWithEvent({ pollId, optionId: A.id, createEvent }),
        decidePollWithEvent({ pollId, optionId: A.id, createEvent })
    ]);

    assert.equal(created, 1);
    assert.deepEqual(results.map(result => result.ok).sort(), [false, true]);
    assert.equal(results.find(result => !result.ok).error, 'Diese Abstimmung ist bereits entschieden.');
    assert.equal(results.find(result => result.ok).created.eventId, 'double-event-1');
    assert.equal((await loadPoll(pollId)).eventId, 'double-event-1');
});

test('a failing event creation leaves the poll undecided', async () => {
    const pollId = await createPoll();
    await assert.rejects(
        decidePollWithEvent({ pollId, optionId: A.id, createEvent: async () => { throw new Error('Event kaputt'); } }),
        /Event kaputt/
    );
    assert.equal((await loadPoll(pollId)).status, 'open');
});

test('per-date changes at the same time keep each other', async () => {
    const pollId = await createPoll();
    const voter = user('Ida');
    const change = (optionId, state) => savePollVote({ pollId, user: voter, update: current => applyVoteChange(current, optionId, state) });
    await Promise.all([change(A.id, 'yes'), change(B.id, 'maybe')]);
    assert.deepEqual(await loadUserVote(pollId, voter.id), { yes: [A.id], maybe: [B.id] });
});

test('the decision DM uses the own answers of the poll', async () => {
    const pollId = await createPoll({ labels: { yes: 'Bin dabei', maybe: 'Vielleicht', no: 'Kann nicht' } });
    await savePollVote({ pollId, user: user('Jan'), yes: [A.id] });
    await savePollVote({ pollId, user: user('Kim'), maybe: [A.id] });

    const output = await captureLogs(() => decidePoll({ pollId, optionId: A.id, eventId: 'label-event' }));
    assert.ok(output.includes('Du hattest ✅ *Bin dabei* angegeben'));
    assert.ok(output.includes('Du hattest 🤔 *Vielleicht* angegeben'));
});
