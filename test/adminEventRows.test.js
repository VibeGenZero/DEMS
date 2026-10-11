const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { loadFrontendApp } = require('./helpers');

let app;
before(async () => { ({ app } = await loadFrontendApp({})); });

// "Now" is Sunday, 11 October 2026, 16:00. All dates are built in local time,
// so the tests give the same result in every time zone.
const NOW = new Date(2026, 9, 11, 16, 0);
const at = (day, hour = 19, minute = 0) => new Date(2026, 9, day, hour, minute).toISOString();
const places = (fields = {}) => ({ taken: 0, capacity: 10, guests: 0, pending: 0, waitlist: 0, text: '0 von 10 Plätzen belegt', waitlistText: '', ...fields });
const event = (id, fields = {}) => ({ id, title: id, status: 'active', category: 'Gaming', startDate: at(20), maxParticipants: 10, places: places(), ...fields });
const rows = (events, options = {}) => app.buildAdminRows(events, { tab: 'active', now: NOW, ...options });
// Arrays and objects built by the modules belong to the vm context; deepEqual only
// accepts them after they are copied into arrays and objects of this file
const keys = (list) => Array.from(list, row => row.key);
const counts = (events, search) => ({ ...app.adminTabCounts(events, search, NOW) });

test('the status decides the tab, the time decides the state', () => {
    const cases = [
        [event('draft', { status: 'draft' }), 'drafts', 'draft'],
        [event('soon'), 'active', 'upcoming'],
        [event('no-status', { status: undefined }), 'active', 'upcoming'],
        [event('no-date', { startDate: '' }), 'active', 'upcoming'],
        [event('broken-date', { startDate: 'kein Datum' }), 'active', 'upcoming'],
        // Started 30 minutes ago, without an end an event lasts two hours
        [event('live', { startDate: at(11, 15, 30) }), 'active', 'running'],
        [event('just-over', { startDate: at(11, 13, 0) }), 'active', 'past'],
        [event('long', { startDate: at(10, 10), endDate: at(12, 10) }), 'active', 'running'],
        [event('old', { status: 'archived', startDate: at(1) }), 'archive', 'archived'],
        [event('off', { status: 'cancelled' }), 'archive', 'archived'],
        // Nobody can set this status; it must not turn up as an active event
        [event('odd', { status: 'paused' }), 'archive', 'archived']
    ];
    for (const [entry, tab, state] of cases) {
        assert.equal(app.adminTabOf(entry), tab, `tab of ${entry.id}`);
        assert.equal(app.adminStateOf(entry, NOW), state, `state of ${entry.id}`);
    }
});

test('every tab lists its own events', () => {
    const events = [event('a'), event('d', { status: 'draft' }), event('x', { status: 'archived' }), event('c', { status: 'cancelled' })];
    assert.deepEqual(keys(rows(events, { tab: 'drafts' })), ['d']);
    assert.deepEqual(keys(rows(events, { tab: 'active' })), ['a']);
    assert.deepEqual(keys(rows(events, { tab: 'archive' })).sort(), ['c', 'x']);
    assert.deepEqual(counts(events, ''), { drafts: 1, active: 1, archive: 2 });
    assert.deepEqual(keys(rows(undefined)), []);
    assert.deepEqual(counts(null, ''), { drafts: 0, active: 0, archive: 0 });
});

test('a series is one row that stands for its next date', () => {
    const events = [
        event('s3', { seriesId: 'series', startDate: at(26), places: places({ pending: 2 }) }),
        event('s1', { seriesId: 'series', startDate: at(5) }),
        event('s2', { seriesId: 'series', startDate: at(19), places: places({ pending: 1 }) }),
        event('single')
    ];
    const [series] = rows(events).filter(row => row.series);
    assert.equal(series.key, 'series:series');
    // s1 is over, so the next date s2 stands for the series
    assert.equal(series.event.id, 's2');
    assert.equal(series.state, 'upcoming');
    assert.equal(series.series.total, 3);
    assert.deepEqual(Array.from(series.series.dates, date => [date.event.id, date.position, date.state]), [['s1', 1, 'past'], ['s2', 2, 'upcoming'], ['s3', 3, 'upcoming']]);
    // Requests of the other dates, not of the one the row shows
    assert.equal(series.series.pendingElsewhere, 2);
    assert.equal(rows(events).length, 2);
});

test('each tab shows only the dates of a series that belong to it', () => {
    const events = [
        event('s1', { seriesId: 'series', startDate: at(5), status: 'archived' }),
        event('s2', { seriesId: 'series', startDate: at(19) }),
        event('s3', { seriesId: 'series', startDate: at(26) })
    ];
    const [active] = rows(events);
    assert.deepEqual(Array.from(active.series.dates, date => date.position), [2, 3]);
    assert.equal(active.series.total, 3);
    const [archived] = rows(events, { tab: 'archive' });
    assert.deepEqual(Array.from(archived.series.dates, date => [date.event.id, date.position]), [['s1', 1]]);
    assert.equal(archived.event.id, 's1');
    assert.deepEqual(keys(rows(events, { tab: 'drafts' })), []);
});

test('a series whose dates are all over is stood for by its last date', () => {
    const events = [event('s1', { seriesId: 'series', startDate: at(1) }), event('s2', { seriesId: 'series', startDate: at(8) })];
    const [series] = rows(events);
    assert.equal(series.event.id, 's2');
    assert.equal(series.state, 'past');
});

test('the search looks at title and category and counts the hits per tab', () => {
    const events = [
        event('raid', { title: 'Raid: Schattenfestung', category: 'Raid' }),
        event('night', { title: 'Spieleabend', category: 'Gaming' }),
        event('old-raid', { title: 'Alter RAID', status: 'archived' }),
        event('s1', { title: 'Training', seriesId: 'series', category: 'Raid-Training' }),
        event('s2', { title: 'Training', seriesId: 'series', category: 'Raid-Training', startDate: at(27) })
    ];
    assert.deepEqual(keys(rows(events, { search: '  rAiD ' })).sort(), ['raid', 'series:series']);
    assert.deepEqual(counts(events, 'raid'), { drafts: 0, active: 2, archive: 1 });
    assert.deepEqual(keys(rows(events, { search: 'gaming' })), ['night']);
    assert.deepEqual(keys(rows(events, { search: 'nichts' })), []);
    // A matching series keeps all its dates
    assert.equal(rows(events, { search: 'raid-training' })[0].series.dates.length, 2);
    // The description is not searched: admins look for a name
    assert.deepEqual(keys(rows([event('x', { description: 'raid' })], { search: 'raid' })), []);
});

test('the default sorting is by date, the archive newest first', () => {
    const events = [event('late', { startDate: at(30) }), event('early', { startDate: at(12) }), event('none', { startDate: '' }), event('mid', { startDate: at(20) })];
    assert.deepEqual(keys(rows(events)), ['early', 'mid', 'late', 'none']);
    const archive = events.map(entry => ({ ...entry, status: 'archived' }));
    assert.deepEqual(keys(rows(archive, { tab: 'archive' })), ['late', 'mid', 'early', 'none']);
    assert.deepEqual({ ...app.DEFAULT_ADMIN_SORT.archive }, { key: 'date', direction: 'desc' });
});

test('columns sort in both directions, events without a date stay last', () => {
    const events = [
        event('b', { title: 'berta', startDate: at(12), places: places({ taken: 7 }) }),
        event('a', { title: 'Anton', startDate: at(30), places: places({ taken: 2 }) }),
        event('z', { title: 'Ärger', startDate: '', places: places({ taken: 4 }) })
    ];
    const sorted = (key, direction) => keys(rows(events, { sort: { key, direction } }));
    // German order: Ä sorts with A, upper and lower case are the same
    assert.deepEqual(sorted('title', 'asc'), ['a', 'z', 'b']);
    assert.deepEqual(sorted('title', 'desc'), ['b', 'z', 'a']);
    assert.deepEqual(sorted('places', 'asc'), ['a', 'z', 'b']);
    assert.deepEqual(sorted('places', 'desc'), ['b', 'z', 'a']);
    assert.deepEqual(sorted('date', 'asc'), ['b', 'a', 'z']);
    assert.deepEqual(sorted('date', 'desc'), ['a', 'b', 'z']);
});

test('an unknown sort key falls back to the default of the tab', () => {
    const events = [event('late', { startDate: at(30) }), event('early', { startDate: at(12) })];
    for (const key of ['__proto__', 'constructor', '', undefined]) {
        assert.deepEqual(keys(rows(events, { sort: { key, direction: 'desc' } })), ['early', 'late'], String(key));
    }
    assert.deepEqual(keys(rows(events, { sort: null })), ['early', 'late']);
});

test('past events of the active tab stand below the others in every sorting', () => {
    const events = [
        event('past-a', { title: 'Alt', startDate: at(1), places: places({ taken: 9 }) }),
        event('soon', { title: 'Zebra', startDate: at(12), places: places({ taken: 1 }) }),
        event('past-b', { title: 'Bald vorbei', startDate: at(4) }),
        event('live', { title: 'Marathon', startDate: at(11, 15, 30) })
    ];
    assert.deepEqual(keys(rows(events)), ['live', 'soon', 'past-a', 'past-b']);
    assert.deepEqual(keys(rows(events, { sort: { key: 'title', direction: 'asc' } })), ['live', 'soon', 'past-a', 'past-b']);
    assert.deepEqual(keys(rows(events, { sort: { key: 'places', direction: 'desc' } })), ['soon', 'live', 'past-a', 'past-b']);
    // The archive has no second group
    const archive = events.map(entry => ({ ...entry, status: 'archived' }));
    assert.deepEqual(keys(rows(archive, { tab: 'archive' })), ['soon', 'live', 'past-b', 'past-a']);
});

test('an event without places sorts as empty', () => {
    const events = [event('with', { places: places({ taken: 3 }) }), event('without', { places: undefined, startDate: at(12) })];
    assert.deepEqual(keys(rows(events, { sort: { key: 'places', direction: 'asc' } })), ['without', 'with']);
});

test('the main action follows the state', () => {
    const actions = (state, fields = {}, options = {}) => app.adminEventActions(event('e', fields), state, options);
    assert.equal(actions('draft').main, 'publish');
    assert.equal(actions('upcoming').main, 'registrations');
    assert.equal(actions('running').main, 'registrations');
    assert.equal(actions('past').main, 'archive');
    assert.equal(actions('archived').main, 'registrations');
});

test('the menu names the status changes that fit the state', () => {
    const status = (state, fields = {}) => [...app.adminEventActions(event('e', fields), state).status];
    assert.deepEqual(status('draft'), ['archive']);
    // Only a draft without a date can be started on the spot
    assert.deepEqual(status('draft', { startDate: '' }), ['archive', 'start']);
    assert.deepEqual(status('draft', { startDate: 'kein Datum' }), ['archive', 'start']);
    assert.deepEqual(status('upcoming'), ['toDraft', 'archive']);
    assert.deepEqual(status('running'), ['end', 'toDraft']);
    assert.deepEqual(status('past'), ['toDraft']);
    assert.deepEqual(status('archived'), ['reactivate', 'toDraft']);
    assert.deepEqual(status('constructor'), []);
});

test('the general entries leave out the main action and a finished Discord entry', () => {
    const general = (state, fields = {}) => [...app.adminEventActions(event('e', fields), state).general];
    assert.deepEqual(general('upcoming'), ['edit', 'announce', 'duplicate', 'export', 'syncDiscord']);
    assert.deepEqual(general('past'), ['registrations', 'edit', 'announce', 'duplicate', 'export', 'syncDiscord']);
    assert.deepEqual(general('draft'), ['registrations', 'edit', 'announce', 'duplicate', 'export', 'syncDiscord']);
    assert.deepEqual(general('upcoming', { discordScheduledEventId: '123' }), ['edit', 'announce', 'duplicate', 'export']);
});

test('deleting names the date inside a series and offers the whole series on its row', () => {
    const danger = (options) => [...app.adminEventActions(event('e'), 'upcoming', options).danger];
    assert.deepEqual(danger(), ['delete']);
    assert.deepEqual(danger({ inSeries: true }), ['deleteDate']);
    assert.deepEqual(danger({ inSeries: true, seriesRow: true }), ['deleteDate', 'deleteSeries']);
});
