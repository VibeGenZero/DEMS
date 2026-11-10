const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RANGES, DEFAULT_RANGE, isValidRange, evaluatedEvents, buildInsights } = require('../utils/insights');

const NOW = new Date('2026-10-13T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days, hours = 0) => new Date(NOW.getTime() - days * DAY + hours * 60 * 60 * 1000).toISOString();

const event = (title, fields = {}) => ({ title, status: 'active', startDate: daysAgo(5), endDate: daysAgo(5, 2), category: 'Gaming', maxParticipants: 0, ...fields });
let counter = 0;
const reg = (eventId, userId, fields = {}) => ({ id: `r${++counter}`, eventId, userId, userName: `name-${userId}`, status: 'accepted', createdAt: daysAgo(10), ...fields });
const byId = (events) => new Map(Object.entries(events));

/** n accepted registrations of one event, the first `checkedIn` of them checked in. */
function crowd(eventId, accepted, checkedIn, prefix = eventId) {
    return Array.from({ length: accepted }, (_, i) => reg(eventId, `${prefix}-${i}`, { checkedIn: i < checkedIn }));
}

const build = (events, registrations, range = '90', users = []) =>
    buildInsights({ users, registrations, eventsById: byId(events), range, now: NOW });

// ── Ranges ────────────────────────────────────────────────────

test('the ranges are 30, 90, 365 days and everything; 90 is the default', () => {
    assert.deepEqual(Object.keys(RANGES), ['30', '90', '365', 'all']);
    assert.equal(DEFAULT_RANGE, '90');
    for (const range of ['30', '90', '365', 'all']) assert.equal(isValidRange(range), true, range);
    for (const range of ['7', '', 'ALL', undefined, '90 ']) assert.equal(isValidRange(range), false, String(range));
});

test('only over, not cancelled events that started in the range are evaluated', () => {
    const events = byId({
        recent: event('Recent'),
        old: event('Old', { startDate: daysAgo(120), endDate: daysAgo(120, 2) }),
        ancient: event('Ancient', { startDate: daysAgo(500), endDate: daysAgo(500, 2) }),
        tomorrow: event('Tomorrow', { startDate: daysAgo(-1), endDate: daysAgo(-1, 2) }),
        cancelled: event('Cancelled', { status: 'cancelled', startDate: daysAgo(7) }),
        archived: event('Archived', { status: 'archived', startDate: daysAgo(20) }),
        undatedArchived: event('Undated', { status: 'archived', startDate: '', endDate: '' })
    });
    const ids = (range) => evaluatedEvents(events, range, NOW).map(([id]) => id).sort();
    assert.deepEqual(ids('90'), ['archived', 'recent']);
    assert.deepEqual(ids('30'), ['archived', 'recent']);
    assert.deepEqual(ids('365'), ['archived', 'old', 'recent']);
    assert.deepEqual(ids('all'), ['ancient', 'archived', 'old', 'recent', 'undatedArchived']);
});

// ── Totals ────────────────────────────────────────────────────

test('attendance and no-show rates follow the spec scenario and add up to 100', () => {
    const events = { a: event('A', { checkinEnabled: true }), b: event('B', { checkinEnabled: true }) };
    const { totals } = build(events, [...crowd('a', 10, 8), ...crowd('b', 5, 2)]);
    assert.equal(totals.events, 2);
    assert.equal(totals.trackedEvents, 2);
    assert.equal(totals.accepted, 15);
    assert.equal(totals.checkedIn, 10);
    assert.equal(totals.attendanceRate, 67);
    assert.equal(totals.noShowRate, 33);
});

test('an untracked event counts as evaluated but leaves the rates unchanged', () => {
    const events = { a: event('A', { checkinEnabled: true }), b: event('B', { checkinEnabled: true }), c: event('C') };
    const { totals } = build(events, [...crowd('a', 10, 8), ...crowd('b', 5, 2), ...crowd('c', 6, 0)]);
    assert.equal(totals.events, 3);
    assert.equal(totals.trackedEvents, 2);
    assert.equal(totals.attendanceRate, 67);
    assert.equal(totals.noShowRate, 33);
});

test('one check-in makes an event tracked even with check-in switched off', () => {
    const { totals } = build({ a: event('A') }, crowd('a', 4, 1));
    assert.equal(totals.trackedEvents, 1);
    assert.equal(totals.attendanceRate, 25);
});

test('without tracked events both rates are null', () => {
    const { totals } = build({ c: event('C') }, crowd('c', 6, 0));
    assert.equal(totals.attendanceRate, null);
    assert.equal(totals.noShowRate, null);
});

test('occupancy sums places over events with a limit; guests count as places', () => {
    const events = {
        a: event('A', { maxParticipants: 10 }),
        b: event('B', { maxParticipants: 20 }),
        open: event('Open', { maxParticipants: 0 })
    };
    const registrations = [
        ...crowd('a', 8, 0),
        ...crowd('b', 9, 0),
        reg('b', 'host', { guests: ['g1'], pendingGuests: [{ userId: 'g2', status: 'pending' }] }),
        reg('b', 'waiting', { status: 'waitlisted' }),
        ...crowd('open', 30, 0)
    ];
    const { totals } = build(events, registrations);
    assert.equal(totals.placesTaken, 20);
    assert.equal(totals.placesOffered, 30);
    assert.equal(totals.occupancyRate, 67);
    assert.equal(build({ open: event('Open') }, crowd('open', 3, 0)).totals.occupancyRate, null);
});

test('an empty range has zero events and null rates', () => {
    const { totals, members, categories, events } = build({ old: event('Old', { startDate: daysAgo(200) }) }, crowd('old', 3, 3));
    assert.equal(totals.events, 0);
    assert.equal(totals.attendanceRate, null);
    assert.equal(totals.occupancyRate, null);
    assert.deepEqual([members, categories, events], [[], [], []]);
});

// ── Event rows ────────────────────────────────────────────────

test('event rows carry the numbers, null for untracked or unlimited events, newest first', () => {
    const events = {
        tracked: event('Tracked', { checkinEnabled: true, maxParticipants: 4, startDate: daysAgo(3), endDate: daysAgo(3, 2) }),
        untracked: event('Untracked', { startDate: daysAgo(8), endDate: daysAgo(8, 2) })
    };
    const { events: rows } = build(events, [...crowd('tracked', 4, 3), ...crowd('untracked', 2, 0), reg('tracked', 'p', { status: 'pending' })]);
    assert.deepEqual(rows.map(row => row.id), ['tracked', 'untracked']);
    assert.deepEqual({ ...rows[0] }, {
        id: 'tracked', title: 'Tracked', startDate: daysAgo(3), category: 'Gaming',
        accepted: 4, checkedIn: 3, noShows: 1, attendanceRate: 75, placesTaken: 4, placesOffered: 4, occupancyRate: 100
    });
    assert.equal(rows[1].noShows, null);
    assert.equal(rows[1].attendanceRate, null);
    assert.equal(rows[1].occupancyRate, null);
    assert.equal(rows[1].placesOffered, 0);
});

// ── Members ───────────────────────────────────────────────────

test('the most active members are ranked by Teilnahmen, then check-ins, then name', () => {
    const events = {
        e1: event('E1', { checkinEnabled: true }),
        e2: event('E2', { checkinEnabled: true }),
        e3: event('E3', { checkinEnabled: true })
    };
    const registrations = [];
    for (const id of ['e1', 'e2', 'e3']) {
        registrations.push(reg(id, 'lena', { checkedIn: true }));
        registrations.push(reg(id, 'tom', { checkedIn: id === 'e1' }));
    }
    registrations.push(reg('e1', 'anna', { checkedIn: true }));
    registrations.push(reg('e1', 'zero', { status: 'rejected' }));
    const users = [{ id: 'lena', displayName: 'Lena' }, { id: 'tom', username: 'tom' }];
    const { members } = build(events, registrations, '90', users);
    assert.deepEqual(members.map(m => ({ ...m })), [
        { id: 'lena', name: 'Lena', attended: 3, checkedIn: 3, hasProfile: true },
        { id: 'tom', name: 'tom', attended: 3, checkedIn: 1, hasProfile: true },
        { id: 'anna', name: 'name-anna', attended: 1, checkedIn: 1, hasProfile: false }
    ]);
});

test('at most ten members are listed', () => {
    const { members } = build({ e: event('E') }, crowd('e', 14, 0));
    assert.equal(members.length, 10);
});

// ── Categories ────────────────────────────────────────────────

test('categories group case-insensitively, name empty ones and carry averages, rates and a share', () => {
    const events = {
        g1: event('G1', { category: 'Gaming', startDate: daysAgo(2), endDate: daysAgo(2, 2), checkinEnabled: true }),
        g2: event('G2', { category: 'gaming ', startDate: daysAgo(4), endDate: daysAgo(4, 2) }),
        none: event('None', { category: '  ', startDate: daysAgo(6), endDate: daysAgo(6, 2) }),
        raid: event('Raid', { category: 'Raid', startDate: daysAgo(7), endDate: daysAgo(7, 2) })
    };
    const registrations = [
        ...crowd('g1', 4, 2), ...crowd('g2', 3, 0), reg('g2', 'x', { status: 'rejected' }),
        ...crowd('none', 2, 0), ...crowd('raid', 5, 0)
    ];
    const { categories } = build(events, registrations);
    assert.deepEqual(categories.map(c => ({ ...c })), [
        { label: 'Gaming', events: 2, registrations: 8, averageAccepted: 3.5, attendanceRate: 50, share: 100 },
        { label: 'Raid', events: 1, registrations: 5, averageAccepted: 5, attendanceRate: null, share: 50 },
        { label: 'Ohne Kategorie', events: 1, registrations: 2, averageAccepted: 2, attendanceRate: null, share: 50 }
    ]);
});

// ── Secrets ───────────────────────────────────────────────────

test('the answer carries no codes, answers, guests or DM settings', () => {
    const events = { e: event('E', { checkinEnabled: true, checkinCode: '987654' }) };
    const registrations = [reg('e', 'u1', { checkedIn: true, formAnswers: { Frage: 'geheime Antwort' }, guests: ['guest-id'] })];
    const users = [{ id: 'u1', displayName: 'U', notifications: { changes: false } }];
    const text = JSON.stringify(build(events, registrations, '90', users));
    for (const secret of ['987654', 'geheime Antwort', 'formAnswers', '"guests"', 'guestCheckins', 'notifications', 'checkinCode']) {
        assert.ok(!text.includes(secret), `leaks ${secret}`);
    }
    // A guest counts as a participant (#110): they appear as a member of their own, not as the host's guest list
    const guest = build(events, registrations, '90', users).members.find(member => member.id === 'guest-id');
    assert.deepEqual(Object.keys(guest).sort(), ['attended', 'checkedIn', 'hasProfile', 'id', 'name']);
});

// ── Guests (#110) ─────────────────────────────────────────────

test('a checked-in guest counts as a participant who came', () => {
    const host = reg('guestNight', 'host', {
        checkedIn: true,
        guests: ['g1', 'g2'],
        pendingGuests: [{ userId: 'g1', displayName: 'Greta', avatar: '', status: 'accepted' }],
        guestCheckins: { g1: { checkedIn: true, checkedInAt: daysAgo(5), checkinInvitedAt: null } }
    });
    const result = build({ guestNight: event('Gäste-Abend', { checkinEnabled: true, maxParticipants: 5 }) }, [host], '90', [{ id: 'g1', displayName: 'Greta' }]);
    const [row] = result.events;
    assert.deepEqual(
        [row.accepted, row.checkedIn, row.noShows, row.attendanceRate, row.placesTaken],
        [3, 2, 1, 67, 3]
    );
    const greta = result.members.find(member => member.id === 'g1');
    assert.deepEqual([greta.attended, greta.checkedIn], [1, 1]);
});

test('an event counts as tracked when only a guest checked in', () => {
    const host = reg('guestOnly', 'host', { guests: ['g1'], guestCheckins: { g1: { checkedIn: true, checkedInAt: daysAgo(5) } } });
    const result = build({ guestOnly: event('Nur Gast') }, [host]);
    assert.equal(result.totals.trackedEvents, 1);
    assert.equal(result.events[0].noShows, 1, 'the host did not check in');
});
