const { test } = require('node:test');
const assert = require('node:assert/strict');
const { placesOf, countOccupiedPlaces, pickCapacityPromotions, summarizePlaces, formatPlaces, formatWaitlist, describePlaces } = require('../utils/capacity');

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

test('the places of an event are counted like the registration counts them', () => {
    const registrations = [
        registration('a', 'accepted', '1', { guests: ['g1'] }),
        // An open invitation reserves its place, a declined one does not
        registration('b', 'accepted', '2', { pendingGuests: [{ userId: 'g2', status: 'pending' }, { userId: 'g3', status: 'declined' }] }),
        registration('c', 'pending', '3'),
        registration('d', 'waitlisted', '4', { guests: ['g4'] }),
        registration('e', 'waitlisted', '5'),
        registration('f', 'rejected', '6', { guests: ['g5'] })
    ];
    assert.deepEqual(summarizePlaces(registrations, 20), { taken: 5, capacity: 20, guests: 2, pending: 1, waitlist: 2 });
    assert.equal(summarizePlaces(registrations, 20).taken, countOccupiedPlaces(registrations));
    assert.deepEqual(summarizePlaces(registrations, 0), { taken: 5, capacity: 0, guests: 2, pending: 1, waitlist: 2 });
    assert.deepEqual(summarizePlaces([], undefined), { taken: 0, capacity: 0, guests: 0, pending: 0, waitlist: 0 });
});

test('the places sentence names guests and open requests only when there are some', () => {
    const places = (fields) => ({ taken: 5, capacity: 20, guests: 0, pending: 0, waitlist: 0, ...fields });
    assert.equal(formatPlaces(places()), '5 von 20 Plätzen belegt');
    assert.equal(formatPlaces(places({ guests: 1 })), '5 von 20 Plätzen belegt (inkl. 1 Gast)');
    assert.equal(formatPlaces(places({ guests: 2, pending: 1 })), '5 von 20 Plätzen belegt (inkl. 2 Gäste, 1 Anfrage offen)');
    assert.equal(formatPlaces(places({ pending: 3 })), '5 von 20 Plätzen belegt (3 Anfragen offen)');
    assert.equal(formatPlaces(places({ taken: 1, capacity: 1 })), '1 von 1 Platz belegt');
    assert.equal(formatPlaces(places({ taken: 0 })), '0 von 20 Plätzen belegt');
    // The waitlist is not part of the sentence; it stands beside it
    assert.equal(formatPlaces(places({ waitlist: 4 })), '5 von 20 Plätzen belegt');
});

test('without a limit the sentence counts the places only', () => {
    const places = (fields) => ({ taken: 5, capacity: 0, guests: 0, pending: 0, waitlist: 0, ...fields });
    assert.equal(formatPlaces(places()), '5 Plätze belegt');
    assert.equal(formatPlaces(places({ taken: 1, guests: 0 })), '1 Platz belegt');
    assert.equal(formatPlaces(places({ taken: 0 })), '0 Plätze belegt');
    assert.equal(formatPlaces(places({ guests: 1 })), '5 Plätze belegt (inkl. 1 Gast)');
});

test('the waitlist note is empty without anybody waiting', () => {
    assert.equal(formatWaitlist(0), '');
    assert.equal(formatWaitlist(1), '1 auf der Warteliste');
    assert.equal(formatWaitlist(3), '3 auf der Warteliste');
    assert.equal(formatWaitlist(undefined), '');
});

test('describePlaces adds the sentence and the waitlist note to the numbers', () => {
    const registrations = [
        registration('a', 'accepted', '1', { guests: ['g1'] }),
        registration('b', 'pending', '2'),
        registration('c', 'waitlisted', '3'),
        registration('d', 'rejected', '4')
    ];
    assert.deepEqual(describePlaces(registrations, 20), {
        taken: 3, capacity: 20, guests: 1, pending: 1, waitlist: 1,
        text: '3 von 20 Plätzen belegt (inkl. 1 Gast, 1 Anfrage offen)',
        waitlistText: '1 auf der Warteliste'
    });
    assert.deepEqual(describePlaces([], 0), {
        taken: 0, capacity: 0, guests: 0, pending: 0, waitlist: 0, text: '0 Plätze belegt', waitlistText: ''
    });
});
