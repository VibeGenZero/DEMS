const { test } = require('node:test');
const assert = require('node:assert/strict');
const { placesOf, countOccupiedPlaces, pickCapacityPromotions } = require('../utils/capacity');

/** Registration with the fields the capacity rules read. */
function registration(id, status, createdAt, fields = {}) {
    return { id, status, createdAt, guests: [], pendingGuests: [], ...fields };
}

test('a registration needs one place per person and per open invitation', () => {
    const withGuests = registration('r1', 'accepted', '2026-10-01T10:00:00.000Z', {
        guests: ['g1'],
        pendingGuests: [{ userId: 'g1', status: 'accepted' }, { userId: 'g2', status: 'pending' }]
    });
    assert.equal(placesOf(withGuests), 3);
    assert.equal(placesOf({ status: 'accepted' }), 1);
});

test('only pending and accepted registrations occupy places', () => {
    const registrations = [
        registration('a', 'accepted', '1', { guests: ['g1'] }),
        registration('b', 'pending', '2'),
        registration('c', 'waitlisted', '3'),
        registration('d', 'rejected', '4')
    ];
    assert.equal(countOccupiedPlaces(registrations), 3);
});

test('a waitlisted registration with guests does not block a single person behind it', () => {
    const registrations = [
        registration('accepted', 'accepted', '2026-10-01T09:00:00.000Z'),
        registration('withGuest', 'waitlisted', '2026-10-01T10:00:00.000Z', { guests: ['g1'] }),
        registration('single', 'waitlisted', '2026-10-01T11:00:00.000Z')
    ];
    assert.deepEqual(pickCapacityPromotions(2, registrations), ['single']);
});

test('several registrations move up when enough places are free', () => {
    const registrations = [
        registration('accepted', 'accepted', '2026-10-01T09:00:00.000Z'),
        registration('w3', 'waitlisted', '2026-10-01T12:00:00.000Z'),
        registration('w1', 'waitlisted', '2026-10-01T10:00:00.000Z'),
        registration('w2', 'waitlisted', '2026-10-01T11:00:00.000Z')
    ];
    assert.deepEqual(pickCapacityPromotions(3, registrations), ['w1', 'w2']);
    assert.deepEqual(pickCapacityPromotions(0, registrations), ['w1', 'w2', 'w3']);
});
