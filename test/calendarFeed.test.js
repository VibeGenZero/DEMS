const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { buildFeedEntries } = require('../utils/calendarFeed');

const NOW = new Date('2026-11-20T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const at = (days, hour = 18) => {
    const date = new Date(NOW.getTime() + days * DAY);
    date.setUTCHours(hour, 0, 0, 0);
    return date.toISOString();
};

let savedBaseUrl;
beforeEach(() => {
    savedBaseUrl = process.env.BASE_URL;
    process.env.BASE_URL = 'https://dems.example';
});
afterEach(() => {
    if (savedBaseUrl === undefined) delete process.env.BASE_URL;
    else process.env.BASE_URL = savedBaseUrl;
});

const event = (fields = {}) => ({
    title: 'Raid: Schattenfestung', status: 'active', startDate: at(3, 18), endDate: at(3, 21),
    location: { text: 'Discord, Raid-Kanal', channelId: null, channelType: null },
    updatedAt: '2026-11-19T10:00:00.000Z', ...fields
});
const own = (eventId, status = 'accepted', fields = {}) => ({ id: `r-${eventId}`, eventId, userId: 'u1', status, asGuest: false, ...fields });
const guest = (eventId, status = 'accepted', hostUserName = 'Chiara') => ({
    id: `r-${eventId}#u1`, registrationId: `r-${eventId}`, eventId, userId: 'u1', status, asGuest: true, hostUserId: 'host', hostUserName
});
const entriesFor = (participations, events) => buildFeedEntries(participations, events, NOW);

test('an accepted place is a confirmed entry with the plain title and the event data', () => {
    const [entry] = entriesFor([own('ev1')], { ev1: event() });
    assert.equal(entry.uid, 'ev1@dems.example');
    assert.equal(entry.title, 'Raid: Schattenfestung');
    assert.equal(entry.status, 'CONFIRMED');
    assert.equal(entry.start, at(3, 18));
    assert.equal(entry.end, at(3, 21));
    assert.equal(entry.location, 'Discord, Raid-Kanal');
    assert.equal(entry.url, 'https://dems.example/#event/ev1');
    assert.equal(entry.lastModified, '2026-11-19T10:00:00.000Z');
    assert.match(entry.description, /^Status: Angemeldet$/m);
    assert.match(entry.description, /https:\/\/dems\.example\/#event\/ev1/);
});

test('open answers are tentative entries with their German mark', () => {
    const cases = [
        ['pending', '[Ausstehend]'],
        ['waitlisted', '[Warteliste]'],
        ['offered', '[Nachrücken bestätigen]'],
        ['tentative', '[Vielleicht]']
    ];
    for (const [status, mark] of cases) {
        const [entry] = entriesFor([own('ev1', status)], { ev1: event() });
        assert.equal(entry.status, 'TENTATIVE', status);
        assert.equal(entry.title, `${mark} Raid: Schattenfestung`, status);
    }
});

test('an unknown status is tentative without a mark', () => {
    const [entry] = entriesFor([own('ev1', 'something-new')], { ev1: event() });
    assert.equal(entry.status, 'TENTATIVE');
    assert.equal(entry.title, 'Raid: Schattenfestung');
});

test('a cancelled event stays as a cancelled entry, whatever the registration says', () => {
    const [entry] = entriesFor([own('ev1', 'waitlisted')], { ev1: event({ status: 'cancelled' }) });
    assert.equal(entry.status, 'CANCELLED');
    assert.equal(entry.title, '[Abgesagt] Raid: Schattenfestung');
    assert.match(entry.description, /abgesagt/i);
});

test('rejected places, deleted events, drafts, events without a start and old events are left out', () => {
    const events = {
        rejected: event(),
        draft: event({ status: 'draft' }),
        undated: event({ startDate: '', endDate: '' }),
        broken: event({ startDate: 'kein Datum', endDate: '' }),
        old: event({ startDate: at(-40), endDate: at(-40, 21) }),
        recent: event({ startDate: at(-29), endDate: at(-29, 21) }),
        archived: event({ status: 'archived', startDate: at(-5), endDate: at(-5, 21) })
    };
    const participations = [
        own('rejected', 'rejected'), own('deleted'), own('draft'), own('undated'), own('broken'), own('old'), own('recent'), own('archived')
    ];
    const ids = entriesFor(participations, events).map(entry => entry.uid);
    assert.deepEqual(ids, ['recent@dems.example', 'archived@dems.example']);
});

test('without an end, or with an end before the start, an entry lasts two hours', () => {
    const [noEnd] = entriesFor([own('ev1')], { ev1: event({ endDate: '' }) });
    assert.equal(noEnd.end, at(3, 20));
    const [earlyEnd] = entriesFor([own('ev1')], { ev1: event({ endDate: at(3, 10) }) });
    assert.equal(earlyEnd.end, at(3, 20));
});

test('a guest place names the inviting member and takes the status of the registration', () => {
    const [entry] = entriesFor([guest('ev1', 'pending')], { ev1: event() });
    assert.equal(entry.title, '[Ausstehend] Raid: Schattenfestung');
    assert.match(entry.description, /^Du bist Gast von Chiara\.$/m);
    const [nameless] = entriesFor([guest('ev1', 'accepted', '')], { ev1: event() });
    assert.match(nameless.description, /^Du bist Gast\.$/m);
});

test('own place and guest place become one entry each, sorted by start', () => {
    const entries = entriesFor([own('late'), guest('early')], {
        late: event({ title: 'Spät', startDate: at(5), endDate: '' }),
        early: event({ title: 'Früh', startDate: at(1), endDate: '' })
    });
    assert.deepEqual(entries.map(entry => entry.title), ['Früh', 'Spät']);
});

test('the identifier stays the same when the start moves', () => {
    const [before] = entriesFor([own('ev1')], { ev1: event() });
    const [after] = entriesFor([own('ev1')], { ev1: event({ startDate: at(4), endDate: at(4, 21) }) });
    assert.equal(before.uid, after.uid);
    assert.notEqual(before.start, after.start);
});

test('an event without a location or an update time leaves both empty', () => {
    const [entry] = entriesFor([own('ev1')], { ev1: event({ location: null, updatedAt: undefined }) });
    assert.equal(entry.location, '');
    assert.equal(entry.lastModified, '');
});

test('without BASE_URL the identifier uses the default host', () => {
    delete process.env.BASE_URL;
    const [entry] = entriesFor([own('ev1')], { ev1: event() });
    assert.equal(entry.uid, 'ev1@localhost:3000');
});

const { createFeedToken, isFeedToken } = require('../utils/calendarFeed');

test('a feed secret has 43 base64url characters and differs on every call', () => {
    const first = createFeedToken();
    const second = createFeedToken();
    assert.match(first, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(first, second);
    assert.equal(isFeedToken(first), true);
});

test('only values shaped like a feed secret pass the check', () => {
    for (const value of ['', 'abc', 'A'.repeat(42), 'A'.repeat(44), `${'A'.repeat(42)}=`, `${'A'.repeat(42)}/`, `${'A'.repeat(42)}.`, null, undefined, 42, ['A'.repeat(43)]]) {
        assert.equal(isFeedToken(value), false, String(value));
    }
});
