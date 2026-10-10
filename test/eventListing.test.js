const { test } = require('node:test');
const assert = require('node:assert/strict');
const { eventEndTime, isEventOver, myRegistrationStatus } = require('../utils/eventListing');

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-10-10T15:00:00.000Z');

test('an event ends at its end date, without one two hours after the start', () => {
    assert.equal(eventEndTime({ startDate: '2026-10-10T18:00:00.000Z', endDate: '2026-10-10T23:00:00.000Z' }).toISOString(), '2026-10-10T23:00:00.000Z');
    assert.equal(eventEndTime({ startDate: '2026-10-10T18:00:00.000Z', endDate: '' }).toISOString(), '2026-10-10T20:00:00.000Z');
    // Older events store a space instead of the T
    assert.equal(eventEndTime({ startDate: '2026-10-10 18:00' }).getTime(), new Date('2026-10-10T18:00').getTime() + 2 * HOUR);
    assert.equal(eventEndTime({ startDate: '2026-10-10T18:00:00.000Z', endDate: 'kaputt' }).toISOString(), '2026-10-10T20:00:00.000Z');
    assert.equal(eventEndTime({ startDate: '' }), null);
    assert.equal(eventEndTime({ startDate: 'kein Datum' }), null);
    assert.equal(eventEndTime({}), null);
});

test('an event is over once its end has passed', () => {
    assert.equal(isEventOver({ startDate: '2026-10-10T14:30:00.000Z', endDate: '2026-10-10T17:00:00.000Z' }, NOW), false, 'running');
    assert.equal(isEventOver({ startDate: '2026-10-10T13:30:00.000Z' }, NOW), false, 'within the default two hours');
    assert.equal(isEventOver({ startDate: '2026-10-10T12:00:00.000Z' }, NOW), true, 'two hours have passed');
    assert.equal(isEventOver({ startDate: '2026-10-03T19:00:00.000Z', endDate: '2026-10-03T22:00:00.000Z' }, NOW), true, 'last week');
    assert.equal(isEventOver({ startDate: '2026-10-11T19:00:00.000Z' }, NOW), false, 'tomorrow');
    assert.equal(isEventOver({}, NOW), false, 'without a date it counts as upcoming');
});

test('the own status comes from the own registration, else from being a guest', () => {
    const registrations = [
        { userId: 'u-accepted', status: 'accepted', guests: ['u-guest'] },
        { userId: 'u-pending', status: 'pending', guests: ['u-pending-guest'] },
        { userId: 'u-wait', status: 'waitlisted', guests: ['u-wait-guest'] },
        { userId: 'u-rejected', status: 'rejected', guests: ['u-rejected-guest'] },
        { userId: 'u-cancelled', status: 'cancelled' }
    ];
    assert.equal(myRegistrationStatus(registrations, 'u-accepted'), 'accepted');
    assert.equal(myRegistrationStatus(registrations, 'u-pending'), 'pending');
    assert.equal(myRegistrationStatus(registrations, 'u-wait'), 'waitlisted');
    assert.equal(myRegistrationStatus(registrations, 'u-guest'), 'guest');
    assert.equal(myRegistrationStatus(registrations, 'u-pending-guest'), 'guest');
    assert.equal(myRegistrationStatus(registrations, 'u-wait-guest'), null, 'guest of a waitlisted registration');
    assert.equal(myRegistrationStatus(registrations, 'u-rejected-guest'), null, 'guest of a rejected registration');
    assert.equal(myRegistrationStatus(registrations, 'u-rejected'), null);
    assert.equal(myRegistrationStatus(registrations, 'u-cancelled'), null);
    assert.equal(myRegistrationStatus(registrations, 'u-stranger'), null);
    assert.equal(myRegistrationStatus(registrations, undefined), null);
    assert.equal(myRegistrationStatus([], 'u-accepted'), null);
});

test('an own rejected registration does not hide a guest place', () => {
    const registrations = [
        { userId: 'u-1', status: 'rejected', guests: [] },
        { userId: 'u-2', status: 'accepted', guests: ['u-1'] }
    ];
    assert.equal(myRegistrationStatus(registrations, 'u-1'), 'guest');
});
