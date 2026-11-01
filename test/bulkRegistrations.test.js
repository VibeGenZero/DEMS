const { test } = require('node:test');
const assert = require('node:assert/strict');
const { BULK_ACTIONS, MAX_BULK_IDS, planBulkAction } = require('../utils/bulkRegistrations');

let minute = 0;
const reg = (id, status, fields = {}) => ({
    id, eventId: 'evt', userId: `u-${id}`, status,
    createdAt: new Date(Date.UTC(2026, 9, 1, 12, minute++)).toISOString(), ...fields
});
const event = (fields = {}) => ({ title: 'Raid', maxParticipants: 0, ...fields });
const SLOTS = [
    { id: 'tank', name: 'Tank', emoji: '🛡️', capacity: 1 },
    { id: 'heal', name: 'Heiler', emoji: '💚', capacity: 2 }
];
const toById = (plan) => Object.fromEntries(plan.changes.map(change => [change.id, change]));

test('the actions and the id limit', () => {
    assert.deepEqual(BULK_ACTIONS, {
        // offered = a waitlist offer (B-15), decided like a waitlisted registration
        accept: ['pending', 'waitlisted', 'offered'],
        waitlist: ['pending', 'accepted', 'offered'],
        reject: ['pending', 'waitlisted', 'accepted', 'offered']
    });
    assert.equal(MAX_BULK_IDS, 200);
});

test('each action changes only fitting statuses, skips the rest and counts duplicates once', () => {
    const registrations = [reg('p', 'pending'), reg('a', 'accepted'), reg('r', 'rejected'), reg('w', 'waitlisted')];
    const plan = planBulkAction({ action: 'reject', ids: ['p', 'a', 'r', 'p', 'other-event'], registrations, event: event() });
    assert.deepEqual(plan.changes.map(change => [change.id, change.from, change.to]), [['p', 'pending', 'rejected'], ['a', 'accepted', 'rejected']]);
    assert.deepEqual(plan.skipped.sort(), ['other-event', 'r']);
    assert.deepEqual(plan.full, []);

    const accept = planBulkAction({ action: 'accept', ids: ['p', 'a', 'w'], registrations, event: event() });
    assert.deepEqual(accept.changes.map(change => change.id), ['p', 'w']);
    assert.deepEqual(accept.skipped, ['a']);

    const waitlist = planBulkAction({ action: 'waitlist', ids: ['p', 'a', 'w'], registrations, event: event() });
    assert.deepEqual(waitlist.changes.map(change => [change.id, change.to]), [['p', 'waitlisted'], ['a', 'waitlisted']]);
    assert.deepEqual(waitlist.skipped, ['w']);
});

test('accepting without a limit takes every fitting registration', () => {
    const registrations = Array.from({ length: 20 }, (_, i) => reg(`p${i}`, 'pending'));
    const plan = planBulkAction({ action: 'accept', ids: registrations.map(r => r.id), registrations, event: event() });
    assert.equal(plan.changes.length, 20);
    assert.ok(plan.changes.every(change => change.to === 'accepted'));
    assert.deepEqual(plan.full, []);
});

test('accepting fills the places in registration order; unselected registrations keep theirs', () => {
    const taken = Array.from({ length: 8 }, (_, i) => reg(`t${i}`, i < 2 ? 'pending' : 'accepted'));
    const selected = [reg('s1', 'pending'), reg('s2', 'pending'), reg('s3', 'pending')];
    const registrations = [...taken, ...selected];
    // Selection order in the request must not matter
    const plan = planBulkAction({ action: 'accept', ids: ['s3', 's1', 's2'], registrations, event: event({ maxParticipants: 10 }) });
    const byId = toById(plan);
    assert.equal(byId.s1.to, 'accepted');
    assert.equal(byId.s2.to, 'accepted');
    assert.equal(byId.s3.to, 'waitlisted');
    assert.deepEqual(plan.full, ['s3']);
    assert.deepEqual(plan.changes.map(change => change.id), ['s1', 's2', 's3'], 'oldest first');
});

test('guests and open invitations count; a later smaller registration still fits', () => {
    const registrations = [
        ...Array.from({ length: 8 }, (_, i) => reg(`t${i}`, 'accepted')),
        reg('big', 'pending', { guests: ['Anna', 'Ben'] }),
        reg('small', 'pending')
    ];
    const plan = planBulkAction({ action: 'accept', ids: ['big', 'small'], registrations, event: event({ maxParticipants: 10 }) });
    const byId = toById(plan);
    assert.equal(byId.big.to, 'waitlisted');
    assert.equal(byId.small.to, 'accepted');

    const invited = [
        ...Array.from({ length: 9 }, (_, i) => reg(`x${i}`, 'accepted')),
        reg('inv', 'pending', { pendingGuests: [{ name: 'Cleo', status: 'pending' }] })
    ];
    const invitePlan = planBulkAction({ action: 'accept', ids: ['inv'], registrations: invited, event: event({ maxParticipants: 10 }) });
    assert.equal(toById(invitePlan).inv.to, 'waitlisted');
});

test('a waitlisted registration that does not fit stays unchanged but counts as full', () => {
    const registrations = [reg('a1', 'accepted'), reg('a2', 'accepted'), reg('w', 'waitlisted')];
    const plan = planBulkAction({ action: 'accept', ids: ['w'], registrations, event: event({ maxParticipants: 2 }) });
    assert.deepEqual(plan.changes, []);
    assert.deepEqual(plan.full, ['w']);
    assert.deepEqual(plan.skipped, []);
});

test('slot events: main role, fallback role, full slot to the waitlist, never overbooked', () => {
    const registrations = [
        reg('older', 'pending', { preferredSlotId: 'tank', slotId: 'tank' }),
        reg('newer', 'pending', { preferredSlotId: 'tank', slotId: 'tank' }),
        reg('flex', 'waitlisted', { preferredSlotId: 'tank', altSlotIds: ['heal'], slotId: null })
    ];
    const plan = planBulkAction({ action: 'accept', ids: ['newer', 'flex', 'older'], registrations, event: event({ slots: SLOTS, maxParticipants: 3 }) });
    const byId = toById(plan);
    assert.deepEqual([byId.older.to, byId.older.slotId], ['accepted', 'tank'], 'keeps its free slot');
    assert.deepEqual([byId.newer.to, byId.newer.slotId], ['waitlisted', null]);
    assert.deepEqual([byId.flex.to, byId.flex.slotId], ['accepted', 'heal']);
    assert.deepEqual(plan.full, ['newer']);
});

test('slot events count the places of unselected registrations', () => {
    const registrations = [
        reg('holder', 'accepted', { preferredSlotId: 'tank', slotId: 'tank' }),
        reg('want', 'pending', { preferredSlotId: 'tank', slotId: null })
    ];
    const plan = planBulkAction({ action: 'accept', ids: ['want'], registrations, event: event({ slots: SLOTS, maxParticipants: 3 }) });
    assert.deepEqual([toById(plan).want.to, toById(plan).want.slotId], ['waitlisted', null]);
});

test('waitlisting and rejecting clear the slot on slot events and the check-in', () => {
    const registrations = [
        reg('in', 'accepted', { preferredSlotId: 'heal', slotId: 'heal', checkedIn: true }),
        reg('out', 'pending', { preferredSlotId: 'tank', slotId: 'tank' })
    ];
    const slotEvent = event({ slots: SLOTS, maxParticipants: 3 });
    for (const action of ['waitlist', 'reject']) {
        const byId = toById(planBulkAction({ action, ids: ['in', 'out'], registrations, event: slotEvent }));
        assert.deepEqual([byId.in.slotId, byId.in.clearCheckin], [null, true], action);
        assert.deepEqual([byId.out.slotId, byId.out.clearCheckin], [null, false], action);
    }
    // Without slots the slot stays untouched (undefined = no change)
    const plain = toById(planBulkAction({ action: 'reject', ids: ['in'], registrations: [reg('in', 'accepted', { checkedIn: true })], event: event() }));
    assert.equal(plain.in.slotId, undefined);
    assert.equal(plain.in.clearCheckin, true);
});
