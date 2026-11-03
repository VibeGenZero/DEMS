const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    MESSAGE_GROUPS,
    MAX_MESSAGE_LENGTH,
    messageRecipients,
    recipientCounts,
    validateMessageText,
    buildParticipantMessage,
    sendParticipantMessage
} = require('../utils/participantMessage');
const { PARTICIPANT_MESSAGE_CASES } = require('./fixtures/participantMessageCases');

const reg = (userId, status, fields = {}) => ({ userId, status, eventId: 'ev', ...fields });

// The spec scenario: 3 accepted (one with an accepted guest), 2 pending, 1 waitlisted, 1 rejected
const SCENARIO = [
    reg('a1', 'accepted', { guests: ['g1'] }),
    reg('a2', 'accepted', { pendingGuests: [{ userId: 'open', status: 'pending' }] }),
    reg('a3', 'accepted'),
    reg('p1', 'pending'),
    reg('p2', 'pending'),
    reg('w1', 'waitlisted'),
    reg('r1', 'rejected', { guests: ['rg'] })
];

test('the groups are accepted only and all open registrations', () => {
    assert.deepEqual(Object.keys(MESSAGE_GROUPS), ['accepted', 'all']);
    assert.equal(MAX_MESSAGE_LENGTH, 1500);
});

test('accepted only reaches accepted members and their accepted guests', () => {
    assert.deepEqual(messageRecipients(SCENARIO, 'accepted').sort(), ['a1', 'a2', 'a3', 'g1']);
});

test('all registrations add pending and waitlisted, never rejected or open invitations', () => {
    const all = messageRecipients(SCENARIO, 'all').sort();
    assert.deepEqual(all, ['a1', 'a2', 'a3', 'g1', 'p1', 'p2', 'w1']);
    for (const never of ['r1', 'rg', 'open']) assert.ok(!all.includes(never), never);
});

test('all registrations reach the bench, accepted only does not (B-17)', () => {
    const registrations = [reg('a1', 'accepted'), reg('a2', 'accepted'), reg('t1', 'tentative'), reg('t2', 'tentative'), reg('t3', 'tentative')];
    assert.deepEqual(messageRecipients(registrations, 'all').sort(), ['a1', 'a2', 't1', 't2', 't3']);
    assert.deepEqual(messageRecipients(registrations, 'accepted').sort(), ['a1', 'a2']);
});

test('a member who is also a guest is addressed once', () => {
    const registrations = [reg('a1', 'accepted', { guests: ['a2'] }), reg('a2', 'accepted')];
    assert.deepEqual(messageRecipients(registrations, 'accepted').sort(), ['a1', 'a2']);
});

test('an unknown group addresses nobody', () => {
    assert.deepEqual(messageRecipients(SCENARIO, 'rejected'), []);
});

test('the counts are plain numbers', () => {
    assert.deepEqual(recipientCounts(SCENARIO), { accepted: 4, all: 7 });
    assert.deepEqual(recipientCounts([]), { accepted: 0, all: 0 });
});

test('the text is required and at most 1500 characters after trimming', () => {
    assert.deepEqual(validateMessageText('   '), { error: 'Bitte gib eine Nachricht ein.' });
    assert.deepEqual(validateMessageText(undefined), { error: 'Bitte gib eine Nachricht ein.' });
    assert.deepEqual(validateMessageText(42), { error: 'Bitte gib eine Nachricht ein.' });
    assert.deepEqual(validateMessageText('x'.repeat(1501)), { error: 'Die Nachricht darf höchstens 1500 Zeichen lang sein.' });
    assert.deepEqual(validateMessageText(`  ${'x'.repeat(1500)}  `), { text: 'x'.repeat(1500) });
    assert.deepEqual(validateMessageText(' Hallo \n'), { text: 'Hallo' });
});

for (const [description, input, expected] of PARTICIPANT_MESSAGE_CASES) {
    test(`the DM text: ${description}`, () => {
        assert.equal(buildParticipantMessage(input), expected);
    });
}

test('the longest DM stays below the Discord limit of 2000 characters', () => {
    const message = buildParticipantMessage({
        title: 'T'.repeat(200), text: 'x'.repeat(1500), sender: 'S'.repeat(32), url: 'https://dems.example.org/#event/abcdefghijklmnopqrst'
    });
    assert.ok(message.length < 2000, `${message.length} characters`);
});

test('sending calls send once per recipient and counts deliveries', async () => {
    const calls = [];
    const send = async (userId, message) => {
        calls.push([userId, message]);
        return userId !== 'a3';
    };
    const result = await sendParticipantMessage({
        registrations: SCENARIO, group: 'accepted', title: 'Raid', text: 'Hallo', sender: 'Mori', url: 'https://x/#event/ev', send
    });
    assert.deepEqual(result, { recipients: 4, delivered: 3 });
    assert.deepEqual(calls.map(([userId]) => userId).sort(), ['a1', 'a2', 'a3', 'g1']);
    const expected = buildParticipantMessage({ title: 'Raid', text: 'Hallo', sender: 'Mori', url: 'https://x/#event/ev' });
    assert.ok(calls.every(([, message]) => message === expected));
});

test('sending ignores DM choices: nothing is filtered by preference', async () => {
    const registrations = [reg('opted-out', 'accepted', { notifications: { reminders: false, changes: false, waitlist: false } })];
    const calls = [];
    const result = await sendParticipantMessage({
        registrations, group: 'accepted', title: 'E', text: 'Hi', sender: 'M', url: 'u', send: async (userId) => { calls.push(userId); return true; }
    });
    assert.deepEqual(calls, ['opted-out']);
    assert.deepEqual(result, { recipients: 1, delivered: 1 });
});

test('a failing send counts as not delivered and does not stop the others', async () => {
    let n = 0;
    const result = await sendParticipantMessage({
        registrations: SCENARIO, group: 'all', title: 'E', text: 'Hi', sender: 'M', url: 'u',
        send: async () => { n += 1; if (n === 2) throw new Error('boom'); return n !== 3; }
    });
    assert.deepEqual(result, { recipients: 7, delivered: 5 });
});
