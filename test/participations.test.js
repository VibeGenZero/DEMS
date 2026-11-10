const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    isListedGuest, guestCheckinOf, toParticipations, participationsOf, hasAnyCheckin, clearedCheckins
} = require('../utils/participations');

const registration = (fields = {}) => ({
    id: 'r1', eventId: 'ev1', userId: 'host', userName: 'Hanna', status: 'accepted', source: 'web',
    createdAt: '2026-11-01T18:00:00.000Z', guests: ['g1', 'g2'],
    pendingGuests: [{ userId: 'g1', displayName: 'Greta', avatar: 'https://cdn/greta.png', status: 'accepted' }],
    ...fields
});

test('a registration with two guests becomes three participations', () => {
    const [host, greta, second] = toParticipations([registration()]);
    assert.equal(host.id, 'r1');
    assert.equal(host.asGuest, false);
    assert.equal(host.userName, 'Hanna');

    assert.deepEqual(greta, {
        id: 'r1#g1', registrationId: 'r1', eventId: 'ev1', status: 'accepted', createdAt: '2026-11-01T18:00:00.000Z',
        source: 'web', userId: 'g1', userName: 'Greta', userAvatar: 'https://cdn/greta.png',
        checkedIn: false, checkedInAt: null, asGuest: true, hostUserId: 'host'
    });
    assert.equal(second.id, 'r1#g2');
    assert.equal(second.userName, 'g2', 'no profile name -> the id');
    assert.equal(second.userAvatar, '');
    assert.equal(toParticipations([registration({ guests: undefined })]).length, 1);
});

test('guest check-ins come from guestCheckins, only for listed guests', () => {
    const reg = registration({
        guestCheckins: { g1: { checkedIn: true, checkedInAt: 'T1', checkinInvitedAt: 'T0' }, gone: { checkedIn: true, checkedInAt: 'T2' } }
    });
    const participations = toParticipations([reg]);
    assert.deepEqual(participations.map(entry => entry.id), ['r1', 'r1#g1', 'r1#g2']);
    assert.equal(participations[1].checkedIn, true);
    assert.equal(participations[1].checkedInAt, 'T1');
    assert.deepEqual(guestCheckinOf(reg, 'g1'), { checkedIn: true, checkedInAt: 'T1', checkinInvitedAt: 'T0' });
    assert.deepEqual(guestCheckinOf(reg, 'gone'), { checkedIn: false, checkedInAt: null, checkinInvitedAt: null });
    assert.deepEqual(guestCheckinOf(reg, 'g2'), { checkedIn: false, checkedInAt: null, checkinInvitedAt: null });
    assert.equal(isListedGuest(reg, 'g1'), true);
    assert.equal(isListedGuest(reg, 'gone'), false);
    assert.equal(isListedGuest(registration({ guests: null }), 'g1'), false);
});

test('participationsOf lists own registrations and guest places of one user', () => {
    const own = registration({ id: 'r2', eventId: 'ev2', userId: 'g1', guests: [] });
    const mine = participationsOf([registration(), own], 'g1');
    assert.deepEqual(mine.map(entry => [entry.id, entry.asGuest]), [['r1#g1', true], ['r2', false]]);
    assert.deepEqual(participationsOf([registration()], 'host').map(entry => entry.id), ['r1']);
});

test('hasAnyCheckin sees own and guest check-ins, not stale ones', () => {
    assert.equal(hasAnyCheckin(registration()), false);
    assert.equal(hasAnyCheckin(registration({ checkedIn: true })), true);
    assert.equal(hasAnyCheckin(registration({ guestCheckins: { g2: { checkedIn: true } } })), true);
    assert.equal(hasAnyCheckin(registration({ guestCheckins: { gone: { checkedIn: true } } })), false);
});

test('clearedCheckins resets own and guest check-ins and keeps the invitation time', () => {
    const reg = registration({
        checkedIn: true, checkedInAt: 'T1',
        guestCheckins: { g1: { checkedIn: true, checkedInAt: 'T1', checkinInvitedAt: 'T0' } }
    });
    assert.deepEqual(clearedCheckins(reg), {
        checkedIn: false, checkedInAt: null,
        guestCheckins: { g1: { checkedIn: false, checkedInAt: null, checkinInvitedAt: 'T0' } }
    });
    assert.deepEqual(clearedCheckins(registration({ checkedIn: true })), { checkedIn: false, checkedInAt: null });
});

test('one person with an own registration and a guest place on one event counts once', () => {
    const guestPlace = registration({ id: 'r1', guests: ['g1'] });
    const own = (status) => registration({ id: 'own', userId: 'g1', status, guests: [], pendingGuests: [] });
    // Own accepted registration wins
    assert.deepEqual(participationsOf([guestPlace, own('accepted')], 'g1').map(entry => entry.id), ['own']);
    // An accepted guest place wins over an own request
    assert.deepEqual(participationsOf([guestPlace, own('pending')], 'g1').map(entry => entry.id), ['r1#g1']);
    // Two guest places: the accepted one
    const pendingPlace = registration({ id: 'r0', userId: 'other', status: 'pending', guests: ['g1'] });
    assert.deepEqual(participationsOf([pendingPlace, guestPlace], 'g1').map(entry => entry.id), ['r1#g1']);
    // Other events and other people stay
    const otherEvent = registration({ id: 'r9', eventId: 'ev9', guests: ['g1'] });
    assert.equal(toParticipations([guestPlace, own('accepted'), otherEvent]).filter(entry => entry.userId === 'g1').length, 2);
    assert.equal(toParticipations([guestPlace, own('accepted')]).filter(entry => entry.userId === 'host').length, 1);
});
