const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    trackedEventIds,
    memberStats,
    lastActivity,
    buildMemberList,
    buildMemberHistory
} = require('../utils/memberOverview');

const NOW = new Date('2026-10-13T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const at = (hours) => new Date(NOW.getTime() + hours * HOUR).toISOString();

const event = (title, fields = {}) => ({ title, status: 'active', startDate: at(-50), endDate: at(-48), ...fields });
let regCounter = 0;
const registration = (eventId, fields = {}) => ({
    id: `reg-${++regCounter}`, eventId, userId: 'u1', status: 'accepted', createdAt: at(-72), ...fields
});
const byId = (events) => new Map(Object.entries(events));

test('the numbers of a mixed history follow the spec scenario', () => {
    const events = byId({
        upcoming: event('Upcoming', { startDate: at(48), endDate: at(50) }),
        endedIn: event('Ended in', { checkinEnabled: true }),
        endedOut: event('Ended out', { checkinEnabled: true }),
        cancelled: event('Cancelled', { status: 'cancelled' })
    });
    const regs = [
        registration('upcoming', { status: 'pending' }),
        registration('endedIn', { checkedIn: true }),
        registration('endedOut'),
        registration('cancelled')
    ];
    const stats = memberStats(regs, events, trackedEventIds(events, regs), NOW);
    assert.deepEqual(stats, { registrations: 4, attended: 2, checkedIn: 1, noShows: 1 });
});

test('cancelled and deleted events count as registration only', () => {
    const events = byId({ cancelled: event('Cancelled', { status: 'cancelled', checkinEnabled: true }) });
    const regs = [registration('cancelled'), registration('gone')];
    const stats = memberStats(regs, events, new Set(['cancelled', 'gone']), NOW);
    assert.deepEqual(stats, { registrations: 2, attended: 0, checkedIn: 0, noShows: 0 });
});

test('an archived event counts as over even when its date lies ahead', () => {
    const events = byId({ archived: event('Archived', { status: 'archived', startDate: at(10), endDate: at(12) }) });
    const stats = memberStats([registration('archived')], events, new Set(), NOW);
    assert.equal(stats.attended, 1);
});

test('only pending, waitlisted or rejected registrations are no Teilnahme', () => {
    const events = byId({ e: event('E', { checkinEnabled: true }) });
    const regs = ['pending', 'waitlisted', 'rejected'].map(status => registration('e', { status }));
    assert.deepEqual(memberStats(regs, events, new Set(['e']), NOW), { registrations: 3, attended: 0, checkedIn: 0, noShows: 0 });
});

test('an event is tracked by its check-in switch or by one checked-in registration', () => {
    const events = byId({
        switch: event('Switch', { checkinEnabled: true }),
        byAdmin: event('By admin'),
        none: event('None')
    });
    const regs = [
        registration('byAdmin', { userId: 'u2', checkedIn: true }),
        registration('byAdmin'),
        registration('none')
    ];
    assert.deepEqual([...trackedEventIds(events, regs)].sort(), ['byAdmin', 'switch']);
});

test('an event nobody checked in for produces no no-shows', () => {
    const events = byId({ none: event('None') });
    const regs = [registration('none'), registration('none', { userId: 'u2' })];
    const tracked = trackedEventIds(events, regs);
    assert.deepEqual(memberStats([regs[0]], events, tracked, NOW), { registrations: 1, attended: 1, checkedIn: 0, noShows: 0 });
});

test('an accepted registration of an upcoming tracked event is no no-show yet', () => {
    const events = byId({ next: event('Next', { startDate: at(2), endDate: at(4), checkinEnabled: true }) });
    assert.equal(memberStats([registration('next')], events, new Set(['next']), NOW).noShows, 0);
});

test('last activity is the latest of the profile update and the registrations', () => {
    const user = { id: 'u1', updatedAt: at(-100) };
    assert.equal(lastActivity(user, [registration('x', { createdAt: at(-5) }), registration('y', { createdAt: at(-200) })]), at(-5));
    assert.equal(lastActivity({ id: 'u1', updatedAt: at(-1) }, [registration('x', { createdAt: at(-5) })]), at(-1));
    assert.equal(lastActivity({ id: 'u1' }, []), null);
    assert.equal(lastActivity({ id: 'u1', updatedAt: 'kaputt' }, [registration('x', { createdAt: '' })]), null);
});

test('the list has one entry per user, ignores unknown user ids and is ordered by name', () => {
    const users = [
        { id: '2', username: 'bernd', displayName: 'Bernd', avatar: 'b.png', createdAt: at(-500), updatedAt: at(-100), notifications: { changes: false } },
        { id: '1', username: 'anna', displayName: 'Anna', avatar: 'a.png', createdAt: at(-600), updatedAt: at(-90) },
        { id: '3', username: 'zora' },
        { id: '4' }
    ];
    const events = byId({ e: event('E', { checkinEnabled: true, checkinCode: '123456' }) });
    const regs = [
        registration('e', { userId: '1', checkedIn: true, createdAt: at(-80) }),
        registration('e', { userId: '2' }),
        registration('e', { userId: 'ghost' })
    ];
    const list = buildMemberList(users, regs, events, NOW);
    assert.deepEqual(list.map(m => m.id), ['4', '1', '2', '3']);
    const anna = list.find(m => m.id === '1');
    assert.deepEqual(anna, {
        id: '1', username: 'anna', displayName: 'Anna', avatar: 'a.png', createdAt: at(-600), lastActiveAt: at(-80),
        stats: { registrations: 1, attended: 1, checkedIn: 1, noShows: 0 }
    });
    assert.deepEqual(list.find(m => m.id === '2').stats, { registrations: 1, attended: 1, checkedIn: 0, noShows: 1 });
    // Name fallback: displayName -> username -> id
    assert.equal(list.find(m => m.id === '3').displayName, 'zora');
    assert.equal(list.find(m => m.id === '4').displayName, '4');
    assert.ok(!JSON.stringify(list).includes('123456'));
    assert.ok(!JSON.stringify(list).includes('notifications'));
});

test('the history lists every registration, newest event first, undated ones by registration time', () => {
    const events = byId({
        old: event('Old', { startDate: at(-300), endDate: at(-298) }),
        recent: event('Recent'),
        ahead: event('Ahead', { startDate: at(48), endDate: at(50) }),
        undated: event('Undated', { startDate: '', endDate: '' })
    });
    const regs = [
        registration('old'),
        registration('undated', { createdAt: at(-10) }),
        registration('ahead'),
        registration('recent'),
        registration('gone', { createdAt: at(-400) })
    ];
    const history = buildMemberHistory(regs, events, new Set(), NOW);
    assert.deepEqual(history.map(row => row.event ? row.event.title : null), ['Ahead', 'Undated', 'Recent', 'Old', null]);
});

test('history rows carry source, no-show flag and no secrets', () => {
    const events = byId({
        e: event('E', {
            checkinEnabled: true,
            checkinCode: '654321',
            slots: [{ id: 's1', name: 'Heiler', emoji: '+', capacity: 2 }]
        })
    });
    const regs = [
        registration('e', {
            source: 'admin',
            slotId: 's1',
            formAnswers: { Frage: 'geheime Antwort' },
            guests: ['g1'],
            pendingGuests: [{ userId: 'g2', displayName: 'Gast', status: 'pending' }]
        }),
        registration('e', { status: 'rejected', createdAt: at(-60) })
    ];
    const history = buildMemberHistory(regs, events, new Set(['e']), NOW);
    const admin = history.find(row => row.status === 'accepted');
    assert.equal(admin.source, 'admin');
    assert.equal(admin.noShow, true);
    assert.deepEqual(admin.slot, { name: 'Heiler', emoji: '+', wish: false });
    assert.equal(admin.event.title, 'E');
    const rejected = history.find(row => row.status === 'rejected');
    assert.equal(rejected.source, 'web');
    assert.equal(rejected.noShow, false);
    const text = JSON.stringify(history);
    for (const secret of ['654321', 'geheime Antwort', 'formAnswers', 'g1', 'pendingGuests', 'checkinCode']) {
        assert.ok(!text.includes(secret), `history leaks ${secret}`);
    }
});

test('a checked-in registration is no no-show', () => {
    const events = byId({ e: event('E', { checkinEnabled: true }) });
    const [row] = buildMemberHistory([registration('e', { checkedIn: true })], events, new Set(['e']), NOW);
    assert.equal(row.checkedIn, true);
    assert.equal(row.noShow, false);
});

// ── Guests (#110) ───────────────────────────────────────────────────────

test('a guest place counts as Teilnahme and Check-in, not as Anmeldung', () => {
    const events = byId({ guestNight: event('Gäste-Abend', { checkinEnabled: true }) });
    const host = registration('guestNight', {
        userId: 'host', guests: ['u-guest'],
        guestCheckins: { 'u-guest': { checkedIn: true, checkedInAt: at(-49), checkinInvitedAt: null } }
    });
    const [entry] = buildMemberList([{ id: 'u-guest', displayName: 'Greta' }], [host], events, NOW);
    assert.deepEqual(entry.stats, { registrations: 0, attended: 1, checkedIn: 1, noShows: 0 });
    assert.equal(entry.lastActiveAt, null, 'a guest place is no activity of the guest');

    const { participationsOf } = require('../utils/participations');
    const mine = participationsOf([host], 'u-guest');
    const tracked = trackedEventIds(events, [host]);
    assert.deepEqual(memberStats(mine, events, tracked, NOW), { registrations: 0, attended: 1, checkedIn: 1, noShows: 0 });
    const [history] = buildMemberHistory(mine, events, tracked, NOW);
    assert.deepEqual([history.asGuest, history.checkedIn, history.noShow], [true, true, false]);
});
