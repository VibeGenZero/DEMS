const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { loadFrontendApp } = require('./helpers');

let app;
before(async () => { ({ app } = await loadFrontendApp({})); });

const NOW = new Date(2026, 9, 13, 12, 0);
const member = (fields = {}) => ({
    id: '200000000000000011', displayName: 'Kira', username: 'kira', avatar: 'https://cdn.example/kira.png',
    createdAt: new Date(2026, 8, 1).toISOString(), lastActiveAt: new Date(2026, 9, 12, 9).toISOString(),
    stats: { registrations: 5, attended: 3, checkedIn: 2, noShows: 1 },
    ...fields
});
const SORT = { key: 'name', direction: 'asc' };

// ── List ──────────────────────────────────────────────────────

test('the table links every member to their page and shows the numbers', () => {
    const html = app.renderMemberTable([member()], { sort: SORT, now: NOW });
    assert.match(html, /<table class="data-table members-table">/);
    assert.match(html, /href="#member\/200000000000000011"/);
    assert.match(html, />Kira</);
    assert.match(html, /@kira/);
    for (const head of ['Mitglied', 'Anmeldungen', 'Teilnahmen', 'Check-ins', 'No-Shows', 'Letzte Aktivität']) {
        assert.ok(html.includes(head), head);
    }
    assert.match(html, /data-label="Teilnahmen">3</);
    assert.match(html, /data-label="No-Shows">1</);
    assert.match(html, /Gestern/);
});

test('the active head carries aria-sort and every head the sort action', () => {
    const html = app.renderMemberTable([member()], { sort: { key: 'attended', direction: 'desc' }, now: NOW });
    assert.match(html, /aria-sort="descending"><button type="button" class="data-table-sort" data-click="sortMembers" data-sort="attended">/);
    assert.match(html, /aria-sort="none"><button type="button" class="data-table-sort" data-click="sortMembers" data-sort="name">/);
    assert.equal(html.match(/data-click="sortMembers"/g).length, 6);
});

test('names and ids are escaped', () => {
    const html = app.renderMemberTable([member({ displayName: '<script>alert(1)</script>', username: 'x"y', id: '1"2' })], { sort: SORT, now: NOW });
    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(!html.includes('x"y'));
    assert.ok(!html.includes('#member/1"2'));
});

test('a member without activity shows a dash', () => {
    const html = app.renderMemberTable([member({ lastActiveAt: null })], { sort: SORT, now: NOW });
    assert.match(html, /data-label="Letzte Aktivität">–</);
});

test('the header count names one or many members', () => {
    assert.equal(app.memberCountText(12), '12 Mitglieder');
    assert.equal(app.memberCountText(1), '1 Mitglied');
    assert.equal(app.memberCountText(0), '0 Mitglieder');
});

test('a search without hits offers to clear it', () => {
    const html = app.renderMemberEmpty({ search: 'xyz' });
    assert.match(html, /Keine Mitglieder gefunden/);
    assert.match(html, /data-click="resetMemberSearch"/);
    assert.match(html, /„xyz“/);
    const none = app.renderMemberEmpty({ search: '' });
    assert.match(none, /Noch keine Mitglieder/);
    assert.ok(!none.includes('resetMemberSearch'));
});

test('a failed load offers a retry', () => {
    assert.match(app.renderMemberLoadError(), /data-click="reloadMembers"/);
});

// ── Member page ───────────────────────────────────────────────

const entry = (fields = {}) => ({
    id: 'reg-1', status: 'accepted', checkedIn: false, createdAt: new Date(2026, 9, 1).toISOString(),
    slot: null, waitlistPosition: null, source: 'web', noShow: false,
    event: { id: 'ev-1', title: 'Raid-Abend', startDate: new Date(2026, 9, 6, 20).toISOString(), endDate: '', status: 'archived', category: '', location: '', checkinEnabled: false },
    ...fields
});
const detail = (fields = {}) => ({
    member: {
        ...member(),
        acceptInvitations: false,
        notifications: { reminders: true, changes: false, waitlist: true }
    },
    stats: { registrations: 5, attended: 3, checkedIn: 2, noShows: 1 },
    history: [entry()],
    ...fields
});

test('the member page shows names, id, dates, account settings and the numbers', () => {
    const html = app.renderMemberDetail(detail(), NOW);
    assert.match(html, />Kira</);
    assert.match(html, /@kira/);
    assert.match(html, /200000000000000011/);
    assert.match(html, /Dabei seit/);
    assert.match(html, /01\.09\.2026/);
    assert.match(html, /Letzte Aktivität/);
    assert.match(html, /Gestern/);
    const setting = (label) => html.match(new RegExp(`<dt>${label}</dt><dd>(.*?)</dd>`))[1];
    assert.match(setting('Gast-Einladungen'), />aus</);
    assert.match(setting('Erinnerungen per DM'), />an</);
    assert.match(setting('Änderungen per DM'), />aus</);
    assert.match(setting('Warteliste per DM'), />an</);
    for (const [label, value] of [['Anmeldungen', 5], ['Teilnahmen', 3], ['Check-ins', 2], ['No-Shows', 1]]) {
        assert.match(html, new RegExp(`<dt>${label}</dt><dd>${value}</dd>`), label);
    }
    assert.match(html, /Teilnahmeverlauf/);
});

test('member values are escaped on the page', () => {
    const html = app.renderMemberDetail(detail({ member: { ...detail().member, displayName: '<img src=x>', username: '<b>' } }), NOW);
    assert.ok(!html.includes('<img src=x>'));
    assert.ok(!html.includes('<b>'));
});

test('a history row links to its event and names status, source and date', () => {
    const html = app.renderMemberHistoryRow(entry(), NOW);
    assert.match(html, /^<a class="profile-history-row members-history-row" href="#event\/ev-1">/);
    assert.match(html, /Raid-Abend/);
    assert.match(html, /06\. Okt\. 2026/);
    assert.match(html, /Angenommen/);
    assert.match(html, /bi-globe/);
    assert.match(html, />Web</);
});

test('check-in, no-show, Discord and admin sources and slots get their chips', () => {
    assert.match(app.renderMemberHistoryRow(entry({ checkedIn: true }), NOW), /Eingecheckt/);
    const noShow = app.renderMemberHistoryRow(entry({ noShow: true }), NOW);
    assert.match(noShow, /Nicht erschienen/);
    assert.ok(!noShow.includes('Eingecheckt'));
    assert.match(app.renderMemberHistoryRow(entry({ source: 'discord' }), NOW), /bi-discord[^]*>Discord</);
    const admin = app.renderMemberHistoryRow(entry({ source: 'admin', slot: { name: 'Heiler', emoji: '💚', wish: false } }), NOW);
    assert.match(admin, /bi-person-gear[^]*>Admin</);
    assert.match(admin, /💚 Heiler/);
});

test('each registration status has its own label', () => {
    const labels = { accepted: 'Angenommen', pending: 'Ausstehend', waitlisted: 'Warteliste', rejected: 'Abgelehnt' };
    for (const [status, label] of Object.entries(labels)) {
        assert.match(app.renderMemberHistoryRow(entry({ status }), NOW), new RegExp(label), status);
    }
    assert.match(app.renderMemberHistoryRow(entry({ event: { ...entry().event, status: 'cancelled' } }), NOW), /Abgesagt/);
});

test('a deleted event has no link and shows the registration day', () => {
    const html = app.renderMemberHistoryRow(entry({ event: null, status: 'rejected' }), NOW);
    assert.match(html, /^<div class="profile-history-row members-history-row">/);
    assert.match(html, /Gelöschtes Event/);
    assert.match(html, /Abgelehnt/);
    assert.match(html, /01\. Okt\. 2026/);
    assert.ok(!html.includes('href='));
});

test('a member without registrations gets an empty history', () => {
    const html = app.renderMemberDetail(detail({ history: [] }), NOW);
    assert.match(html, /Noch keine Anmeldungen/);
});

test('an unknown member leads back to the list', () => {
    const html = app.renderMemberNotFound();
    assert.match(html, /Mitglied nicht gefunden/);
    assert.match(html, /href="#members"/);
});

test('the member page loads the member and shows a not-found state for an unknown id', async () => {
    const loaded = await loadFrontendApp({ '/api/admin/members/200000000000000011': detail() });
    await loaded.app.showMemberDetail('200000000000000011');
    assert.match(loaded.element('member-detail').innerHTML, /Teilnahmeverlauf/);
    assert.equal(loaded.element('member-detail-section').style.display, 'block');

    await loaded.app.showMemberDetail('999');
    assert.match(loaded.element('member-detail').innerHTML, /Mitglied nicht gefunden/);
});

test('the list page counts, filters and sorts the loaded members', async () => {
    const loaded = await loadFrontendApp({ '/api/admin/members': { members: [member(), member({ id: '2', displayName: 'Anna', username: 'anna' })] } });
    await loaded.app.showMembersSection();
    assert.equal(loaded.element('members-count').textContent, '2 Mitglieder');
    const table = loaded.element('members-table').innerHTML;
    assert.ok(table.indexOf('Anna') < table.indexOf('Kira'), 'name order');
    loaded.app.searchMembers('kir');
    assert.ok(!loaded.element('members-table').innerHTML.includes('Anna'));
    loaded.app.searchMembers('zzz');
    assert.match(loaded.element('members-table').innerHTML, /Keine Mitglieder gefunden/);
});
