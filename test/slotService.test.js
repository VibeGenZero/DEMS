const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    MAX_SLOTS, getSlots, hasSlots, findSlot, formatSlotLabel, isSingleEmoji, sumCapacity,
    normalizeSlots, countSlotOccupancy, sanitizeAltSlotIds, pickSlot,
    pickWaitlistPromotions, resolveAcceptanceSlot, buildSlotSummary, withSlotSummary,
    buildRoster, validateSlotChange
} = require('../utils/slotService');

const SLOTS = [
    { id: 'tank', name: 'Tank', emoji: '🛡️', capacity: 1 },
    { id: 'heal', name: 'Heiler', emoji: '💚', capacity: 2 },
    { id: 'dps', name: 'Schaden', emoji: '⚔️', capacity: 3 }
];

test('events without slots have an empty slot list', () => {
    assert.deepEqual(getSlots({}), []);
    assert.deepEqual(getSlots(null), []);
    assert.equal(hasSlots({ slots: [] }), false);
    assert.equal(hasSlots({ slots: SLOTS }), true);
    assert.equal(findSlot(SLOTS, 'heal').name, 'Heiler');
    assert.equal(findSlot(SLOTS, 'nope'), null);
    assert.equal(sumCapacity(SLOTS), 6);
});

test('slot labels show the emoji when there is one', () => {
    assert.equal(formatSlotLabel(SLOTS[0]), '🛡️ Tank');
    assert.equal(formatSlotLabel({ name: 'Flex', emoji: '' }), 'Flex');
    assert.equal(formatSlotLabel(null), '');
});

test('normalizeSlots trims names, keeps known IDs and creates new ones', () => {
    const result = normalizeSlots([
        { id: 'tank', name: ' Tank ', emoji: '🛡️', capacity: '2' },
        { id: 'forged', name: 'Heiler', emoji: '', capacity: 3 }
    ], SLOTS);

    assert.equal(result.error, undefined);
    assert.deepEqual(result.slots[0], { id: 'tank', name: 'Tank', emoji: '🛡️', capacity: 2 });
    assert.notEqual(result.slots[1].id, 'forged');
    assert.match(result.slots[1].id, /^[0-9a-f]{8}$/);
    assert.equal(result.slots[1].emoji, '');
});

test('normalizeSlots treats a missing value as no slots', () => {
    assert.deepEqual(normalizeSlots(undefined), { slots: [] });
    assert.deepEqual(normalizeSlots(null), { slots: [] });
    assert.deepEqual(normalizeSlots([]), { slots: [] });
});

test('normalizeSlots rejects invalid input with a German message', () => {
    const tooMany = Array.from({ length: MAX_SLOTS + 1 }, (_, i) => ({ name: `Slot ${i}`, capacity: 1 }));
    const cases = [
        ['nope', 'Slots müssen eine Liste sein.'],
        [tooMany, 'Es sind höchstens 10 Slots erlaubt.'],
        [[{ name: '  ', capacity: 1 }], 'Jeder Slot braucht einen Namen mit 1–30 Zeichen.'],
        [[{ name: 'x'.repeat(31), capacity: 1 }], 'Jeder Slot braucht einen Namen mit 1–30 Zeichen.'],
        [[{ name: 'Tank', capacity: 1 }, { name: 'tank', capacity: 1 }], 'Slot-Name „tank“ ist doppelt vergeben.'],
        [[{ name: 'Tank', capacity: 0 }], 'Slot „Tank“ braucht 1–100 Plätze.'],
        [[{ name: 'Tank', capacity: 101 }], 'Slot „Tank“ braucht 1–100 Plätze.'],
        [[{ name: 'Tank', capacity: 2.5 }], 'Slot „Tank“ braucht 1–100 Plätze.']
    ];
    for (const [input, message] of cases) {
        assert.deepEqual(normalizeSlots(input), { error: message });
    }
});

test('normalizeSlots only accepts a single emoji', () => {
    for (const emoji of ['🛡️', '💚', '⚔️', '👩‍🚀', '👍🏽']) {
        assert.equal(isSingleEmoji(emoji), true, emoji);
    }
    for (const emoji of ['abc', '🛡️🛡️', ':shield:', 'T']) {
        assert.equal(isSingleEmoji(emoji), false, emoji);
        assert.deepEqual(
            normalizeSlots([{ name: 'Tank', emoji, capacity: 1 }]),
            { error: 'Das Emoji von Slot „Tank“ muss ein einzelnes Emoji sein.' }
        );
    }
});

test('slot occupancy counts pending and accepted registrations only', () => {
    const occupancy = countSlotOccupancy(SLOTS, [
        { status: 'accepted', slotId: 'tank' },
        { status: 'pending', slotId: 'heal' },
        { status: 'waitlisted', slotId: null },
        { status: 'rejected', slotId: 'heal' },
        { status: 'accepted', slotId: 'removed-slot' }
    ]);
    assert.deepEqual(occupancy, { tank: 1, heal: 1, dps: 0 });
});

test('alternatives are cleaned and sorted in slot order', () => {
    assert.deepEqual(sanitizeAltSlotIds(SLOTS, 'tank', ['dps', 'tank', 'unknown', 'heal', 'dps']), ['heal', 'dps']);
    assert.deepEqual(sanitizeAltSlotIds(SLOTS, 'tank', 'heal'), []);
});

test('pickSlot prefers the main role, then the first free alternative', () => {
    assert.equal(pickSlot(SLOTS, { tank: 0, heal: 0, dps: 0 }, 'tank', ['heal']), 'tank');
    assert.equal(pickSlot(SLOTS, { tank: 1, heal: 0, dps: 0 }, 'tank', ['heal', 'dps']), 'heal');
    assert.equal(pickSlot(SLOTS, { tank: 1, heal: 2, dps: 0 }, 'tank', ['heal', 'dps']), 'dps');
    assert.equal(pickSlot(SLOTS, { tank: 1, heal: 2, dps: 3 }, 'tank', ['heal', 'dps']), null);
    assert.equal(pickSlot(SLOTS, { tank: 1, heal: 0, dps: 0 }, 'tank'), null);
    assert.equal(pickSlot(SLOTS, { tank: 0, heal: 0, dps: 0 }, 'gone', ['dps']), 'dps');
});


/** Registration for the slot rules. */
function slotReg(id, status, slotId, createdAt, fields = {}) {
    return {
        id, status, slotId, createdAt,
        preferredSlotId: slotId, altSlotIds: [],
        userId: `user-${id}`, userName: `Name ${id}`,
        guests: [], pendingGuests: [],
        ...fields
    };
}

test('the oldest matching waitlist entry moves into a free slot', () => {
    const registrations = [
        slotReg('a', 'accepted', 'tank', '2026-10-01T08:00:00.000Z'),
        slotReg('b', 'accepted', 'heal', '2026-10-01T08:30:00.000Z'),
        slotReg('wTank', 'waitlisted', null, '2026-10-01T09:00:00.000Z', { preferredSlotId: 'tank' }),
        slotReg('wHeal', 'waitlisted', null, '2026-10-01T10:00:00.000Z', { preferredSlotId: 'heal' })
    ];
    assert.deepEqual(pickWaitlistPromotions(SLOTS, registrations), [{ registrationId: 'wHeal', slotId: 'heal' }]);
});

test('waitlist entries move into their alternatives and several can move at once', () => {
    const registrations = [
        slotReg('a', 'accepted', 'tank', '2026-10-01T08:00:00.000Z'),
        slotReg('w1', 'waitlisted', null, '2026-10-01T09:00:00.000Z', { preferredSlotId: 'tank', altSlotIds: ['dps'] }),
        slotReg('w2', 'waitlisted', null, '2026-10-01T10:00:00.000Z', { preferredSlotId: 'dps' }),
        slotReg('w3', 'waitlisted', null, '2026-10-01T11:00:00.000Z', { preferredSlotId: 'gone', altSlotIds: ['heal'] })
    ];
    assert.deepEqual(pickWaitlistPromotions(SLOTS, registrations), [
        { registrationId: 'w1', slotId: 'dps' },
        { registrationId: 'w2', slotId: 'dps' },
        { registrationId: 'w3', slotId: 'heal' }
    ]);
});

test('nobody moves into an overbooked slot', () => {
    const registrations = [
        slotReg('a', 'accepted', 'tank', '1'),
        slotReg('b', 'accepted', 'tank', '2'),
        slotReg('w', 'waitlisted', null, '3', { preferredSlotId: 'tank' })
    ];
    assert.deepEqual(pickWaitlistPromotions(SLOTS, registrations), []);
});

test('accepting picks a free wanted slot, otherwise the main role overbooked', () => {
    const registrations = [
        slotReg('a', 'accepted', 'tank', '1'),
        slotReg('w', 'waitlisted', null, '2', { preferredSlotId: 'tank', altSlotIds: ['heal'] })
    ];
    assert.deepEqual(resolveAcceptanceSlot(SLOTS, registrations, registrations[1]), { slotId: 'heal', overbooked: false });

    const noAlternative = { ...registrations[1], altSlotIds: [] };
    assert.deepEqual(resolveAcceptanceSlot(SLOTS, registrations, noAlternative), { slotId: 'tank', overbooked: true });
});

test('the slot summary counts the taken places', () => {
    const registrations = [slotReg('a', 'accepted', 'tank', '1'), slotReg('b', 'pending', 'dps', '2')];
    assert.deepEqual(buildSlotSummary(SLOTS, registrations), [
        { id: 'tank', name: 'Tank', emoji: '🛡️', capacity: 1, taken: 1 },
        { id: 'heal', name: 'Heiler', emoji: '💚', capacity: 2, taken: 0 },
        { id: 'dps', name: 'Schaden', emoji: '⚔️', capacity: 3, taken: 1 }
    ]);
    assert.equal('slotSummary' in withSlotSummary({ title: 'x' }, registrations), false);
    assert.equal(withSlotSummary({ title: 'x', slots: SLOTS }, registrations).slotSummary.length, 3);
});

test('the roster lists members per slot and the waitlist in order', () => {
    const registrations = [
        slotReg('a', 'accepted', 'tank', '1'),
        slotReg('b', 'pending', 'heal', '2', { preferredSlotId: 'tank', altSlotIds: ['heal'] }),
        slotReg('w2', 'waitlisted', null, '4', { preferredSlotId: 'dps' }),
        slotReg('w1', 'waitlisted', null, '3', { preferredSlotId: 'tank', altSlotIds: ['heal'] }),
        slotReg('r', 'rejected', 'dps', '5')
    ];
    const usersById = { 'user-a': { displayName: 'Anna', avatar: 'https://cdn.example/a.png' } };
    const roster = buildRoster({ slots: SLOTS, maxParticipants: 6 }, registrations, usersById);

    assert.equal(roster.taken, 2);
    assert.equal(roster.capacity, 6);
    assert.equal(roster.waitlistCount, 2);
    assert.deepEqual(roster.slots[0].members, [{ displayName: 'Anna', avatar: 'https://cdn.example/a.png', pending: false, isAlt: false }]);
    assert.deepEqual(roster.slots[1].members, [{ displayName: 'Name b', avatar: '', pending: true, isAlt: true }]);
    assert.equal(roster.slots[2].taken, 0);
    assert.deepEqual(roster.waitlist.map(entry => entry.displayName), ['Name w1', 'Name w2']);
    assert.deepEqual(roster.waitlist[0].altSlotIds, ['heal']);
});

test('the roster of a normal event counts guests and has no slots', () => {
    const registrations = [slotReg('a', 'accepted', undefined, '1', { guests: ['g1'] }), slotReg('w', 'waitlisted', undefined, '2')];
    const roster = buildRoster({ maxParticipants: 10 }, registrations);
    assert.deepEqual(roster, { taken: 2, capacity: 10, waitlistCount: 1, slots: [], waitlist: [] });
    assert.equal(buildRoster({ maxParticipants: 0 }, []).capacity, 0);
});

test('a slot that still has registrations cannot be removed', () => {
    const registrations = [slotReg('a', 'accepted', 'tank', '1'), slotReg('b', 'pending', 'tank', '2')];
    assert.equal(
        validateSlotChange({ oldSlots: SLOTS, newSlots: SLOTS.slice(1), registrations }),
        'Slot „Tank“ hat noch 2 Anmeldungen – bitte zuerst verschieben.'
    );
    assert.equal(validateSlotChange({ oldSlots: SLOTS, newSlots: SLOTS.slice(0, 2), registrations }), null);
    assert.equal(validateSlotChange({ oldSlots: SLOTS, newSlots: [], registrations }), null);
});

test('slots can only be switched on while nobody is registered', () => {
    const open = [slotReg('a', 'waitlisted', undefined, '1')];
    const rejectedOnly = [slotReg('a', 'rejected', undefined, '1')];
    assert.equal(
        validateSlotChange({ oldSlots: [], newSlots: SLOTS, registrations: open }),
        'Slots können nur aktiviert werden, solange es keine Anmeldungen gibt.'
    );
    assert.equal(validateSlotChange({ oldSlots: [], newSlots: SLOTS, registrations: rejectedOnly }), null);
});

test('a slot that waitlisted members want as main role cannot be removed', () => {
    const registrations = [slotReg('w', 'waitlisted', null, '1', { preferredSlotId: 'tank', altSlotIds: [] })];
    assert.equal(
        validateSlotChange({ oldSlots: SLOTS, newSlots: SLOTS.slice(1), registrations }),
        'Slot „Tank“ hat noch 1 Anmeldung – bitte zuerst verschieben.'
    );
});

test('accepting without a known main role prefers a free slot over a false overbooking', () => {
    const registrations = [
        slotReg('a', 'accepted', 'tank', '1'),
        slotReg('w', 'waitlisted', null, '2', { preferredSlotId: 'gone', altSlotIds: [] })
    ];
    assert.deepEqual(resolveAcceptanceSlot(SLOTS, registrations, registrations[1]), { slotId: 'heal', overbooked: false });
});
