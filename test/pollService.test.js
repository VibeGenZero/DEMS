const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    POLL_STATUS, normalizePollInput, normalizeVote, isPollOpen, canVote, tallyPoll,
    rankOptions, getFavoriteOptionId, formatPollOption, effectivePollStatus
} = require('../utils/pollService');

const NOW = new Date('2026-10-03T10:00:00.000Z');
const A = { id: 'aaaaaaaa', startDate: '2026-10-11T18:00:00.000Z', endDate: '2026-10-11T20:00:00.000Z' };
const B = { id: 'bbbbbbbb', startDate: '2026-10-12T16:00:00.000Z', endDate: '' };
const C = { id: 'cccccccc', startDate: '2026-10-17T18:00:00.000Z', endDate: '' };
const POLL = { title: 'Raid', status: 'open', deadline: '', accessMode: 'open', requiredRoles: [], options: [A, B, C] };

const input = (fields = {}) => ({
    title: 'Raid-Termin', description: 'Wann passt es?',
    options: [{ startDate: B.startDate }, { startDate: A.startDate, endDate: A.endDate }],
    deadline: '2026-10-09T16:00:00.000Z', ...fields
});

test('a new poll is trimmed, sorted by date and gets option IDs', () => {
    const { poll, error } = normalizePollInput(input({ title: '  Raid-Termin  ' }), null, [], NOW);
    assert.equal(error, undefined);
    assert.equal(poll.title, 'Raid-Termin');
    assert.deepEqual(poll.options.map(o => o.startDate), [A.startDate, B.startDate]);
    assert.ok(poll.options.every(o => /^[0-9a-f]{8}$/.test(o.id)));
    assert.equal(poll.options[0].endDate, A.endDate);
    assert.equal(poll.options[1].endDate, '');
    assert.equal(poll.deadline, '2026-10-09T16:00:00.000Z');
    assert.equal(poll.accessMode, 'open');
});

test('invalid polls are refused with a German message', () => {
    const cases = [
        [input({ title: ' ' }), 'Titel ist erforderlich (max. 200 Zeichen).'],
        [input({ description: 'x'.repeat(5001) }), 'Beschreibung darf maximal 5000 Zeichen lang sein.'],
        [input({ options: [{ startDate: A.startDate }] }), 'Eine Abstimmung braucht 2–10 Termine.'],
        [input({ options: Array.from({ length: 11 }, (_, i) => ({ startDate: `2026-11-${String(i + 1).padStart(2, '0')}T18:00:00.000Z` })) }), 'Eine Abstimmung braucht 2–10 Termine.'],
        [input({ options: [{ startDate: 'kein Datum' }, { startDate: B.startDate }] }), 'Jeder Termin braucht ein gültiges Datum.'],
        [input({ options: [{ startDate: A.startDate, endDate: A.startDate }, { startDate: B.startDate }] }), 'Das Ende eines Termins muss nach dem Beginn liegen.'],
        [input({ options: [{ startDate: '2026-10-01T18:00:00.000Z' }, { startDate: B.startDate }] }), 'Neue oder verschobene Termine müssen in der Zukunft liegen.'],
        [input({ options: [{ startDate: A.startDate }, { startDate: A.startDate }] }), 'Zwei Termine haben denselben Beginn.'],
        [input({ deadline: 'morgen' }), 'Die Deadline ist kein gültiges Datum.'],
        [input({ deadline: '2026-10-02T10:00:00.000Z' }), 'Die Deadline muss in der Zukunft liegen.'],
        [input({ accessMode: 'role-required', requiredRoles: [] }), 'Bitte wähle mindestens eine Rolle aus.']
    ];
    for (const [raw, message] of cases) {
        assert.deepEqual(normalizePollInput(raw, null, [], NOW), { error: message });
    }
});

test('editing keeps option IDs and only allows open polls', () => {
    const raw = { title: 'Raid', options: [A, B, { startDate: '2026-10-20T18:00:00.000Z' }] };
    const { poll } = normalizePollInput(raw, POLL, [], NOW);
    assert.deepEqual(poll.options.map(o => o.id).slice(0, 2), [A.id, B.id]);
    assert.match(poll.options[2].id, /^[0-9a-f]{8}$/);

    assert.deepEqual(
        normalizePollInput(raw, { ...POLL, status: 'closed' }, [], NOW),
        { error: 'Nur offene Abstimmungen können bearbeitet werden.' }
    );
});

test('a date with votes cannot be removed or moved', () => {
    const votes = [{ userId: 'u1', yes: [A.id], maybe: [] }];
    assert.deepEqual(
        normalizePollInput({ title: 'Raid', options: [B, C] }, POLL, votes, NOW),
        { error: 'Der Termin am So, 11.10. · 20:00–22:00 hat bereits Stimmen.' }
    );
    assert.deepEqual(
        normalizePollInput({ title: 'Raid', options: [{ ...A, startDate: '2026-10-11T19:00:00.000Z' }, B] }, POLL, votes, NOW),
        { error: 'Termine mit Stimmen können nicht verschoben werden.' }
    );
    // Without votes both is fine
    assert.equal(normalizePollInput({ title: 'Raid', options: [B, C] }, POLL, [], NOW).error, undefined);
});

test('a vote keeps known dates in date order and "passt" wins over "wenn nötig"', () => {
    assert.deepEqual(
        normalizeVote(POLL.options, { yes: [C.id, 'unknown', A.id, A.id], maybe: [A.id, B.id] }),
        { yes: [A.id, C.id], maybe: [B.id] }
    );
    assert.deepEqual(normalizeVote(POLL.options, null), { yes: [], maybe: [] });
});

test('a poll is open until it is closed or the deadline passes', () => {
    assert.equal(isPollOpen(POLL, NOW), true);
    assert.equal(isPollOpen({ ...POLL, deadline: '2026-10-03T09:00:00.000Z' }, NOW), false);
    assert.equal(isPollOpen({ ...POLL, deadline: '2026-10-03T11:00:00.000Z' }, NOW), true);
    assert.equal(isPollOpen({ ...POLL, status: 'closed' }, NOW), false);
    assert.equal(effectivePollStatus({ ...POLL, deadline: '2026-10-03T09:00:00.000Z' }, NOW), POLL_STATUS.CLOSED);
    assert.equal(effectivePollStatus({ ...POLL, status: 'decided' }, NOW), POLL_STATUS.DECIDED);
    assert.equal(effectivePollStatus(POLL, NOW), POLL_STATUS.OPEN);
});

test('role-restricted polls need one of the roles', () => {
    const restricted = { ...POLL, accessMode: 'role-required', requiredRoles: ['raid'] };
    assert.equal(canVote(restricted, ['member']), false);
    assert.equal(canVote(restricted, ['member', 'raid']), true);
    assert.equal(canVote(POLL, []), true);
});

test('the tally counts votes per date and the favorite wins by passt, then wenn nötig, then date', () => {
    const votes = [
        { userId: 'u1', userName: 'Ana', yes: [A.id, B.id], maybe: [], updatedAt: '1' },
        { userId: 'u2', userName: 'Ben', yes: [B.id], maybe: [A.id], updatedAt: '2' },
        { userId: 'u3', userName: 'Cem', yes: [A.id], maybe: [], updatedAt: '3' }
    ];
    const tally = tallyPoll(POLL, votes, { u1: { displayName: 'Anna', avatar: 'https://cdn.example/a.png' } });

    assert.equal(tally.voterCount, 3);
    assert.deepEqual(tally.options.map(o => [o.yes, o.maybe]), [[2, 1], [2, 0], [0, 0]]);
    assert.deepEqual(tally.options[0].yesVoters, [
        { displayName: 'Anna', avatar: 'https://cdn.example/a.png' },
        { displayName: 'Cem', avatar: '' }
    ]);
    assert.deepEqual(tally.options[0].maybeVoters.map(v => v.displayName), ['Ben']);
    assert.deepEqual(rankOptions(tally).map(o => o.optionId), [A.id, B.id, C.id]);
    assert.equal(getFavoriteOptionId(tally), A.id);
    assert.equal(getFavoriteOptionId(tallyPoll(POLL, [])), null);
});

test('dates are formatted in German with the event time zone', () => {
    assert.equal(formatPollOption(A), 'So, 11.10. · 20:00–22:00');
    assert.equal(formatPollOption(B), 'Mo, 12.10. · 18:00');
    assert.equal(formatPollOption({ startDate: A.startDate, endDate: '2026-10-12T08:00:00.000Z' }), 'So, 11.10. · 20:00 – 12.10. 10:00');
});
