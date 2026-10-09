const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeReminderHours, mergeReminderHours, findDueReminders } = require('../utils/reminders');

const HOUR = 60 * 60 * 1000;
const START = '2026-10-20T18:00:00.000Z';
const at = (hoursBeforeStart) => new Date(new Date(START).getTime() - hoursBeforeStart * HOUR);

test('reminder hours come as a list of { hours, sent } in every stored shape', () => {
    assert.deepEqual(normalizeReminderHours(24), [{ hours: 24, sent: false }]);
    assert.deepEqual(normalizeReminderHours('2'), [{ hours: 2, sent: false }]);
    assert.deepEqual(normalizeReminderHours([{ hours: 24, sent: true }, { hours: 1 }]), [{ hours: 24, sent: true }, { hours: 1, sent: false }]);
    for (const empty of [0, '', '0', null, undefined, [], [{ hours: 'x' }], 'abc']) {
        assert.deepEqual(normalizeReminderHours(empty), [], String(empty));
    }
});

test('the event form may list several reminders as text', () => {
    assert.deepEqual(normalizeReminderHours('24, 1'), [{ hours: 24, sent: false }, { hours: 1, sent: false }]);
    assert.deepEqual(normalizeReminderHours('48 2;0.5'), [{ hours: 48, sent: false }, { hours: 2, sent: false }, { hours: 0.5, sent: false }]);
    assert.deepEqual(normalizeReminderHours('24, 24, 0, x'), [{ hours: 24, sent: false }]);

    const oldEvent = { startDate: START, reminderHours: [{ hours: 24, sent: true }] };
    assert.deepEqual(mergeReminderHours('24, 1', oldEvent, START), [{ hours: 24, sent: true }, { hours: 1, sent: false }]);
});

test('saving an event keeps a sent reminder sent while the start stays the same', () => {
    const oldEvent = { startDate: START, reminderHours: [{ hours: 24, sent: true }] };
    // The event form sends the hours as a plain number
    assert.deepEqual(mergeReminderHours(24, oldEvent, START), [{ hours: 24, sent: true }]);
    assert.deepEqual(mergeReminderHours([{ hours: 24, sent: false }, { hours: 1, sent: false }], oldEvent, START),
        [{ hours: 24, sent: true }, { hours: 1, sent: false }]);
});

test('a new start time makes every reminder due again', () => {
    const oldEvent = { startDate: START, reminderHours: [{ hours: 24, sent: true }] };
    assert.deepEqual(mergeReminderHours(24, oldEvent, '2026-10-27T18:00:00.000Z'), [{ hours: 24, sent: false }]);
    assert.deepEqual(mergeReminderHours(24, null, START), [{ hours: 24, sent: false }]);
});

test('a reminder is due from its time until the start, unless it was sent', () => {
    const event = { startDate: START, reminderHours: [{ hours: 24, sent: false }, { hours: 1, sent: false }] };
    assert.deepEqual(findDueReminders(event, at(25)), []);
    assert.deepEqual(findDueReminders(event, at(23)), [0]);
    assert.deepEqual(findDueReminders(event, at(0.5)), [0, 1]);
    assert.deepEqual(findDueReminders(event, at(-0.1)), []);

    const sent = { startDate: START, reminderHours: [{ hours: 24, sent: true }, { hours: 1, sent: false }] };
    assert.deepEqual(findDueReminders(sent, at(0.5)), [1]);
    assert.deepEqual(findDueReminders({ startDate: START, reminderHours: 24 }, at(2)), [0]);
});
