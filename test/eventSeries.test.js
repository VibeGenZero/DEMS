const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
    SHORTEN_SERIES_MESSAGE, followingDates, transferTime, nextSeriesStart, planExtension,
    seriesUpdateFields, slotsForDate, localDay
} = require('../utils/eventSeries');

const TZ = 'Europe/Berlin';
// Berlin: summer time ends on Sunday 25.10.2026, starts on Sunday 28.03.2027
const NOW = new Date('2026-10-01T10:00:00.000Z');

const date = (id, startDate, extra = {}) => ({ id, seriesId: 'serie', status: 'active', startDate, endDate: '', ...extra });

test('followingDates takes the later, changeable dates of the same series by start', () => {
    const edited = date('b', '2026-10-09T18:00:00.000Z');
    const events = [
        date('d', '2026-10-23T18:00:00.000Z'),
        date('a', '2026-10-02T18:00:00.000Z'),
        edited,
        date('c', '2026-10-16T18:00:00.000Z', { status: 'draft' }),
        date('x', '2026-10-30T18:00:00.000Z', { status: 'cancelled' }),
        date('y', '2026-11-06T18:00:00.000Z', { status: 'archived' }),
        date('z', '2026-11-13T18:00:00.000Z', { seriesId: 'andere' }),
        date('e', '2026-11-20T18:00:00.000Z')
    ];
    assert.deepEqual(followingDates(events, edited, NOW).map(event => event.id), ['c', 'd', 'e']);
});

test('followingDates leaves dates out that are over', () => {
    const edited = date('a', '2026-09-20T18:00:00.000Z');
    const events = [edited, date('b', '2026-09-27T18:00:00.000Z'), date('c', '2026-10-04T18:00:00.000Z')];
    assert.deepEqual(followingDates(events, edited, NOW).map(event => event.id), ['c']);
});

test('followingDates of an event without series or start is empty', () => {
    assert.deepEqual(followingDates([date('b', '2026-10-09T18:00:00.000Z')], { id: 'a', seriesId: '', startDate: '2026-10-02T18:00:00.000Z' }, NOW), []);
    assert.deepEqual(followingDates([date('b', '2026-10-09T18:00:00.000Z')], date('a', ''), NOW), []);
});

test('transferTime keeps the day and takes start time, duration and deadline offsets', () => {
    // Source: Friday 09.10. 19:30–22:00 local, deadline a day before
    const source = {
        startDate: '2026-10-09T17:30:00.000Z',
        endDate: '2026-10-09T20:00:00.000Z',
        registrationDeadline: '2026-10-08T17:30:00.000Z',
        unregisterDeadline: ''
    };
    // Target: Friday 16.10. 20:00 local
    assert.deepEqual(transferTime('2026-10-16T18:00:00.000Z', source, TZ), {
        startDate: '2026-10-16T17:30:00.000Z',
        endDate: '2026-10-16T20:00:00.000Z',
        registrationDeadline: '2026-10-15T17:30:00.000Z',
        unregisterDeadline: ''
    });
});

test('transferTime keeps the local time across the switch to winter and to summer time', () => {
    const source = { startDate: '2026-10-23T17:30:00.000Z', endDate: '' };
    // Friday 30.10.2026 is winter time: 19:30 local = 18:30 UTC
    assert.equal(transferTime('2026-10-30T19:00:00.000Z', source, TZ).startDate, '2026-10-30T18:30:00.000Z');
    // Friday 02.04.2027 is summer time again: 19:30 local = 17:30 UTC
    const winter = { startDate: '2027-03-26T18:30:00.000Z', endDate: '' };
    assert.equal(transferTime('2027-04-02T18:00:00.000Z', winter, TZ).startDate, '2027-04-02T17:30:00.000Z');
});

test('transferTime without end gives no end', () => {
    const result = transferTime('2026-10-16T18:00:00.000Z', { startDate: '2026-10-09T17:30:00.000Z', endDate: '' }, TZ);
    assert.equal(result.endDate, '');
    assert.equal(result.registrationDeadline, '');
    assert.equal(result.unregisterDeadline, '');
});

test('transferTime without a source start keeps the target as it is', () => {
    assert.equal(transferTime('2026-10-16T18:00:00.000Z', { startDate: '' }, TZ), null);
});

test('nextSeriesStart steps weekly, biweekly and monthly in local time', () => {
    // Friday 23.10. 20:00 summer time -> Friday 30.10. 20:00 winter time
    assert.equal(nextSeriesStart('2026-10-23T18:00:00.000Z', 'weekly', TZ), '2026-10-30T19:00:00.000Z');
    assert.equal(nextSeriesStart('2026-10-16T18:00:00.000Z', 'biweekly', TZ), '2026-10-30T19:00:00.000Z');
    assert.equal(nextSeriesStart('2026-10-15T18:00:00.000Z', 'monthly', TZ), '2026-11-15T19:00:00.000Z');
    // Anything else counts as monthly, as when a series is created
    assert.equal(nextSeriesStart('2026-10-15T18:00:00.000Z', '', TZ), '2026-11-15T19:00:00.000Z');
    // The 31st runs over into the next month like Date#setMonth does
    assert.equal(nextSeriesStart('2027-01-31T19:00:00.000Z', 'monthly', TZ), '2027-03-03T19:00:00.000Z');
});

test('localDay is the calendar day in the time zone', () => {
    assert.equal(localDay('2026-10-23T22:30:00.000Z', TZ), '2026-10-24');
    assert.equal(localDay('2026-10-23T21:30:00.000Z', TZ), '2026-10-23');
});

test('planExtension lists the new starts up to and including the end day', () => {
    const events = [date('a', '2026-11-06T19:00:00.000Z'), date('b', '2026-11-27T19:00:00.000Z', { status: 'cancelled' }), date('c', '2026-11-13T19:00:00.000Z')];
    assert.deepEqual(planExtension({ seriesEvents: events, interval: 'weekly', oldUntil: '2026-11-27', newUntil: '2026-12-11', timeZone: TZ }), {
        starts: ['2026-12-04T19:00:00.000Z', '2026-12-11T19:00:00.000Z']
    });
});

test('planExtension with the same, an empty or an earlier end', () => {
    const events = [date('a', '2026-11-27T19:00:00.000Z')];
    assert.deepEqual(planExtension({ seriesEvents: events, interval: 'weekly', oldUntil: '2026-11-27', newUntil: '2026-11-27', timeZone: TZ }), { starts: [] });
    assert.deepEqual(planExtension({ seriesEvents: events, interval: 'weekly', oldUntil: '2026-11-27', newUntil: '', timeZone: TZ }), { starts: [] });
    assert.deepEqual(planExtension({ seriesEvents: events, interval: 'weekly', oldUntil: '2026-11-27', newUntil: '2026-11-20', timeZone: TZ }), { error: SHORTEN_SERIES_MESSAGE });
    assert.equal(SHORTEN_SERIES_MESSAGE, '„Wiederholen bis“ kann nur verlängert werden. Einzelne Termine löschst du in der Terminliste.');
});

test('planExtension of a later end that does not reach the next date creates nothing', () => {
    const events = [date('a', '2026-11-27T19:00:00.000Z')];
    assert.deepEqual(planExtension({ seriesEvents: events, interval: 'weekly', oldUntil: '2026-11-27', newUntil: '2026-12-03', timeZone: TZ }), { starts: [] });
});

test('seriesUpdateFields copies the shared settings and nothing that belongs to one date', () => {
    const updates = {
        title: 'Raid', description: 'Neu', bannerUrl: '/uploads/banners/a.png', accentColor: '#112233',
        aiNotes: 'Treffpunkt: Lobby', location: { text: 'Lobby' }, category: 'Raid', maxParticipants: 12, slots: [], allowGuests: true, allowTentative: true,
        accessMode: 'open', requiredRoles: ['r1'], approvalMode: 'instant', assignRoleId: 'r2', formFields: [],
        reminderHours: [{ hours: 24, sent: false }], checkinMessage: 'Hi', customBotMessages: {},
        autoCreateChannels: true, channelConfig: { type: 'voice' },
        status: 'active', startDate: 'x', endDate: 'y', registrationDeadline: 'z', unregisterDeadline: 'w',
        seriesId: 's', checkinCode: '123456', checkinEnabled: true, createdAt: 'c', createdBy: 'u', sourcePollId: 'p',
        recurring: true, recurringInterval: 'weekly', recurringUntil: '2026-12-01', updatedAt: 'now',
        registrationClosedRefreshed: true, eventStartNotificationSent: true
    };
    assert.deepEqual(Object.keys(seriesUpdateFields(updates)).sort(), [
        'accentColor', 'accessMode', 'aiNotes', 'allowGuests', 'allowTentative', 'approvalMode', 'assignRoleId', 'autoCreateChannels', 'bannerUrl',
        'category', 'channelConfig', 'checkinMessage', 'customBotMessages', 'description', 'formFields', 'location',
        'maxParticipants', 'reminderHours', 'requiredRoles', 'slots', 'title'
    ]);
    assert.equal(seriesUpdateFields(updates).description, 'Neu');
});

test('slotsForDate maps a slot of the edited date to the slot with the same name on another date', () => {
    const raw = [{ id: 'a1', name: 'Tank', capacity: 2 }, { id: 'a2', name: 'Heiler', capacity: 3 }, { name: 'Neu', capacity: 1 }];
    const target = [{ id: 'a1', name: 'Tank', capacity: 2 }, { id: 'b9', name: 'heiler', capacity: 2 }];
    assert.deepEqual(slotsForDate(raw, target), [
        { id: 'a1', name: 'Tank', capacity: 2 },
        { id: 'b9', name: 'Heiler', capacity: 3 },
        { name: 'Neu', capacity: 1 }
    ]);
    assert.equal(slotsForDate(undefined, target), undefined);
});
