const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { loadFrontendApp } = require('./helpers');

let app;
before(async () => { ({ app } = await loadFrontendApp({})); });

const member = (id, displayName, username, stats = {}, lastActiveAt = null) => ({
    id, displayName, username, avatar: '', createdAt: '', lastActiveAt,
    stats: { registrations: 0, attended: 0, checkedIn: 0, noShows: 0, ...stats }
});
const MEMBERS = [
    member('201', 'Bernd', 'bernd', { registrations: 3, attended: 1, noShows: 2 }, '2026-10-01T10:00:00.000Z'),
    member('202', 'Anna', 'anna', { registrations: 12, attended: 9, checkedIn: 8 }, '2026-10-10T10:00:00.000Z'),
    member('203', 'Özlem', 'oezi', { registrations: 3, attended: 9 }, null),
    member('204', 'carl', 'carl_x', { registrations: 0 }, '2026-09-01T10:00:00.000Z')
];
const ids = (rows) => Array.from(rows, row => row.id);

test('the search finds display name, username and id, ignoring case and spaces', () => {
    assert.deepEqual(ids(app.filterMemberRows(MEMBERS, 'ANN')), ['202']);
    assert.deepEqual(ids(app.filterMemberRows(MEMBERS, ' carl_ ')), ['204']);
    assert.deepEqual(ids(app.filterMemberRows(MEMBERS, '203')), ['203']);
    assert.deepEqual(ids(app.filterMemberRows(MEMBERS, '')), ['201', '202', '203', '204']);
    assert.deepEqual(ids(app.filterMemberRows(MEMBERS, 'niemand')), []);
});

test('the default order is the name A to Z with German rules', () => {
    assert.deepEqual({ ...app.DEFAULT_MEMBER_SORT }, { key: 'name', direction: 'asc' });
    assert.deepEqual(ids(app.sortMemberRows(MEMBERS, app.DEFAULT_MEMBER_SORT)), ['202', '201', '204', '203']);
});

test('numbers sort highest first, equal values by name', () => {
    assert.deepEqual(ids(app.sortMemberRows(MEMBERS, { key: 'attended', direction: 'desc' })), ['202', '203', '201', '204']);
    assert.deepEqual(ids(app.sortMemberRows(MEMBERS, { key: 'registrations', direction: 'desc' })), ['202', '201', '203', '204']);
    assert.deepEqual(ids(app.sortMemberRows(MEMBERS, { key: 'registrations', direction: 'asc' })), ['204', '201', '203', '202']);
});

test('last activity sorts newest first, members without one last', () => {
    assert.deepEqual(ids(app.sortMemberRows(MEMBERS, { key: 'lastActive', direction: 'desc' })), ['202', '201', '204', '203']);
});

test('sorting does not change the given list', () => {
    const copy = MEMBERS.slice();
    app.sortMemberRows(copy, { key: 'noShows', direction: 'desc' });
    assert.deepEqual(ids(copy), ids(MEMBERS));
});

test('a new column starts with its natural direction, the same column flips', () => {
    assert.deepEqual({ ...app.nextMemberSort({ key: 'name', direction: 'asc' }, 'attended') }, { key: 'attended', direction: 'desc' });
    assert.deepEqual({ ...app.nextMemberSort({ key: 'attended', direction: 'desc' }, 'attended') }, { key: 'attended', direction: 'asc' });
    assert.deepEqual({ ...app.nextMemberSort({ key: 'attended', direction: 'desc' }, 'name') }, { key: 'name', direction: 'asc' });
    assert.deepEqual({ ...app.nextMemberSort({ key: 'name', direction: 'asc' }, 'name') }, { key: 'name', direction: 'desc' });
    assert.deepEqual(Array.from(app.MEMBER_SORT_KEYS), ['name', 'registrations', 'attended', 'checkedIn', 'noShows', 'lastActive']);
});
