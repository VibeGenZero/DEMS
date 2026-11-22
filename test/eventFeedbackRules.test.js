// Pure rules of the official plugin „Event-Feedback“ (plugins/event-feedback/rules.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    WINDOW_DAYS, COMMENT_MAX, ERRORS, eventEnd, feedbackWindow, isOpen, isEligible, validateAnswer, answerId, summarize,
    toEventView, requestDm
} = require('../plugins/event-feedback/rules');

test('constants and German messages', () => {
    assert.equal(WINDOW_DAYS, 7);
    assert.equal(COMMENT_MAX, 1000);
    assert.deepEqual(ERRORS, {
        notEligible: 'Für dieses Event kannst du kein Feedback geben.',
        rating: 'Bitte vergib 1 bis 5 Sterne.',
        comment: 'Der Kommentar darf höchstens 1000 Zeichen lang sein.',
        closed: 'Die Feedback-Zeit für dieses Event ist vorbei.'
    });
});

test('the window runs from the end until 7 days later; cancelled and draft events have none', () => {
    // Over but not archived yet (the archive runs a day after the end)
    const event = { startDate: '2026-11-20T18:00:00.000Z', endDate: '2026-11-20T21:00:00.000Z', status: 'active' };
    assert.deepEqual(feedbackWindow(event), { opensAt: new Date('2026-11-20T21:00:00.000Z'), closesAt: new Date('2026-11-27T21:00:00.000Z') });
    assert.equal(eventEnd({ startDate: '2026-11-20T18:00:00.000Z' }).toISOString(), '2026-11-20T20:00:00.000Z');
    assert.equal(eventEnd({ startDate: '2026-11-20T18:00:00.000Z', endDate: '2026-11-20T17:00:00.000Z' }).toISOString(), '2026-11-20T20:00:00.000Z');
    assert.equal(eventEnd({ startDate: 'kaputt' }), null);
    assert.equal(isOpen(event, new Date('2026-11-20T20:59:00.000Z')), false);
    assert.equal(isOpen(event, new Date('2026-11-27T21:00:00.000Z')), true);
    assert.equal(isOpen(event, new Date('2026-11-27T21:01:00.000Z')), false);
    for (const status of ['cancelled', 'draft']) assert.equal(feedbackWindow({ ...event, status }), null);
    assert.equal(feedbackWindow({ status: 'archived' }), null);
    assert.equal(isOpen({ ...event, status: 'cancelled' }, new Date('2026-11-21T10:00:00.000Z')), false);
});

test('an event ended early by an admin (archived before its scheduled end) is open at once', () => {
    const early = { startDate: '2026-11-20T18:00:00.000Z', endDate: '2026-11-20T23:00:00.000Z', status: 'archived' };
    assert.equal(isOpen(early, new Date('2026-11-20T19:00:00.000Z')), true);
    assert.equal(isOpen({ ...early, status: 'active' }, new Date('2026-11-20T19:00:00.000Z')), false);
    assert.equal(isOpen(early, new Date('2026-11-27T23:01:00.000Z')), false);
});

test('eligible: accepted, and checked in when the event uses check-in', () => {
    assert.equal(isEligible({}, { status: 'accepted', checkedIn: false }), true);
    assert.equal(isEligible({ checkinEnabled: true }, { status: 'accepted', checkedIn: false }), false);
    assert.equal(isEligible({ checkinEnabled: true }, { status: 'accepted', checkedIn: true }), true);
    for (const status of ['pending', 'waitlisted', 'offered', 'tentative', 'rejected']) {
        assert.equal(isEligible({}, { status, checkedIn: true }), false, status);
    }
    assert.equal(isEligible({}, null), false);
});

test('validateAnswer', () => {
    assert.deepEqual(validateAnswer({ rating: 4, comment: '  Gut  ' }), { ok: true, value: { rating: 4, comment: 'Gut' } });
    assert.deepEqual(validateAnswer({ rating: 5 }), { ok: true, value: { rating: 5, comment: '' } });
    for (const rating of [0, 6, 2.5, '4', null]) {
        assert.deepEqual(validateAnswer({ rating }), { ok: false, error: 'Bitte vergib 1 bis 5 Sterne.' }, String(rating));
    }
    assert.deepEqual(validateAnswer({ rating: 3, comment: 'x'.repeat(1001) }), { ok: false, error: 'Der Kommentar darf höchstens 1000 Zeichen lang sein.' });
    assert.deepEqual(validateAnswer({ rating: 3, comment: 7 }), { ok: false, error: 'Der Kommentar darf höchstens 1000 Zeichen lang sein.' });
    assert.deepEqual(validateAnswer(null), { ok: false, error: 'Bitte vergib 1 bis 5 Sterne.' });
});

test('summarize rounds to one decimal and counts each star', () => {
    assert.deepEqual(summarize([]), { count: 0, average: null, distribution: [0, 0, 0, 0, 0] });
    assert.deepEqual(summarize([{ rating: 5 }, { rating: 4 }, { rating: 4 }]), { count: 3, average: 4.3, distribution: [0, 0, 0, 2, 1] });
    assert.deepEqual(summarize([{ rating: 5 }, { rating: 4 }, { rating: 2 }]).average, 3.7);
});

test('answerId, toEventView and requestDm', () => {
    assert.equal(answerId('e1', '200000000000000003'), 'e1_200000000000000003');
    assert.deepEqual(toEventView({ id: 'e1', title: 'Raid', startDate: 's', category: 'Raid', checkinCode: 'x', description: 'd' }),
        { id: 'e1', title: 'Raid', startDate: 's', category: 'Raid' });
    assert.deepEqual(toEventView({ id: 'e2', title: 'Quiz', startDate: 's' }), { id: 'e2', title: 'Quiz', startDate: 's', category: '' });
    assert.equal(requestDm({ title: 'Raid_Abend *' }), 'Wie war **Raid\\_Abend \\***? Gib dem Team kurz Feedback – das dauert nur ein paar Sekunden.');
});

test('an event archived before it started is never open', () => {
    const upcoming = { startDate: '2026-11-25T18:00:00.000Z', status: 'archived' };
    assert.equal(isOpen(upcoming, new Date('2026-11-21T10:00:00.000Z')), false);
    assert.equal(isOpen(upcoming, new Date('2026-11-25T21:00:00.000Z')), true, 'open once it is over');
});

test('check-in counts only when it was really used at the event', () => {
    const event = { checkinEnabled: true };
    assert.equal(isEligible(event, { status: 'accepted', checkedIn: false }, false), true, 'nobody checked in');
    assert.equal(isEligible(event, { status: 'accepted', checkedIn: false }, true), false);
    assert.equal(isEligible(event, { status: 'accepted', checkedIn: true }, true), true);
});
