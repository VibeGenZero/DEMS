const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    MAX_SLOTS, getSlots, hasSlots, findSlot, formatSlotLabel, isSingleEmoji, sumCapacity,
    normalizeSlots, countSlotOccupancy, sanitizeAltSlotIds, pickSlot
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
