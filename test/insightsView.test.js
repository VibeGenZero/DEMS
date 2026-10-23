const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { loadFrontendApp } = require('./helpers');

let app;
before(async () => { ({ app } = await loadFrontendApp({})); });

const row = (id, fields = {}) => ({
    id, title: `Event ${id}`, startDate: '2026-10-01T18:00:00.000Z', category: 'Gaming',
    accepted: 10, checkedIn: 8, noShows: 2, attendanceRate: 80, placesTaken: 10, placesOffered: 12, occupancyRate: 83,
    ...fields
});
const ids = (rows) => Array.from(rows, r => r.id);
const totals = (fields = {}) => ({
    events: 4, trackedEvents: 3, accepted: 30, checkedIn: 20, attendanceRate: 67, noShowRate: 33,
    placesTaken: 20, placesOffered: 30, occupancyRate: 67, ...fields
});

// ── Rules ─────────────────────────────────────────────────────

test('rates read as whole percent or a dash', () => {
    assert.equal(app.formatRate(67), '67 %');
    assert.equal(app.formatRate(0), '0 %');
    assert.equal(app.formatRate(null), '–');
});

test('the table starts newest first; empty values always sort last', () => {
    const rows = [
        row('old', { startDate: '2026-09-01T18:00:00.000Z', attendanceRate: 90 }),
        row('new', { startDate: '2026-10-10T18:00:00.000Z', attendanceRate: null }),
        row('mid', { startDate: '2026-09-20T18:00:00.000Z', attendanceRate: 50 })
    ];
    assert.deepEqual({ ...app.DEFAULT_INSIGHT_SORT }, { key: 'date', direction: 'desc' });
    assert.deepEqual(ids(app.sortInsightEvents(rows, app.DEFAULT_INSIGHT_SORT)), ['new', 'mid', 'old']);
    assert.deepEqual(ids(app.sortInsightEvents(rows, { key: 'attendanceRate', direction: 'desc' })), ['old', 'mid', 'new']);
    assert.deepEqual(ids(app.sortInsightEvents(rows, { key: 'attendanceRate', direction: 'asc' })), ['mid', 'old', 'new']);
    assert.deepEqual(ids(app.sortInsightEvents(rows, { key: 'title', direction: 'asc' })), ['mid', 'new', 'old']);
});

test('equal values keep the newest event first', () => {
    const rows = [row('a', { startDate: '2026-09-01T18:00:00.000Z' }), row('b', { startDate: '2026-10-01T18:00:00.000Z' })];
    assert.deepEqual(ids(app.sortInsightEvents(rows, { key: 'accepted', direction: 'desc' })), ['b', 'a']);
});

test('a new column starts with its natural direction, the same one flips', () => {
    assert.deepEqual({ ...app.nextInsightSort({ key: 'date', direction: 'desc' }, 'title') }, { key: 'title', direction: 'asc' });
    assert.deepEqual({ ...app.nextInsightSort({ key: 'date', direction: 'desc' }, 'accepted') }, { key: 'accepted', direction: 'desc' });
    assert.deepEqual({ ...app.nextInsightSort({ key: 'accepted', direction: 'desc' }, 'accepted') }, { key: 'accepted', direction: 'asc' });
    assert.deepEqual(Array.from(app.INSIGHT_SORT_KEYS), ['date', 'title', 'accepted', 'checkedIn', 'noShows', 'attendanceRate', 'occupancyRate']);
});

// ── Markup ────────────────────────────────────────────────────

test('the range buttons mark the chosen one', () => {
    const html = app.renderInsightRanges('90');
    for (const label of ['30 Tage', '90 Tage', '12 Monate', 'Alles']) assert.ok(html.includes(label), label);
    assert.equal(html.match(/data-click="setInsightRange"/g).length, 4);
    assert.match(html, /class="nav-link active"[^>]*aria-selected="true"[^>]*data-range="90"/);
    assert.match(html, /data-range="all"/);
});

test('the key figures are four stat cards', () => {
    const html = app.renderInsightTotals(totals());
    assert.equal(html.match(/class="stat-card"/g).length, 4);
    for (const [label, value] of [['Teilnahmequote', '67 %'], ['No-Show-Quote', '33 %'], ['Ausgewertete Events', '4'], ['Auslastung', '67 %']]) {
        assert.match(html, new RegExp(`${value}</div><div class="stat-label">${label}`), label);
    }
    assert.ok(!html.includes('keine Anwesenheit'));
});

test('without tracked attendance the rates show dashes and a hint', () => {
    const html = app.renderInsightTotals(totals({ trackedEvents: 0, attendanceRate: null, noShowRate: null }));
    assert.match(html, />–<\/div><div class="stat-label">Teilnahmequote/);
    assert.match(html, /In diesem Zeitraum wurde keine Anwesenheit erfasst/);
});

test('the member ranking links members with a profile and escapes names', () => {
    const html = app.renderInsightMembers([
        { id: '1', name: 'Lena', attended: 3, checkedIn: 3, hasProfile: true },
        { id: '2', name: '<b>Gast</b>', attended: 1, checkedIn: 0, hasProfile: false }
    ]);
    assert.match(html, /href="#member\/1">Lena</);
    assert.match(html, /3 Teilnahmen · 3 Check-ins/);
    assert.match(html, /1 Teilnahme · 0 Check-ins/);
    assert.ok(!html.includes('#member/2'));
    assert.ok(!html.includes('<b>'));
    assert.match(app.renderInsightMembers([]), /Noch keine Teilnahmen/);
});

test('categories carry a meter, a German decimal and a dash without rate', () => {
    const html = app.renderInsightCategories([
        { label: 'Gaming', events: 2, registrations: 8, averageAccepted: 3.5, attendanceRate: 50, share: 100 },
        { label: 'Ohne Kategorie', events: 1, registrations: 2, averageAccepted: 2, attendanceRate: null, share: 50 }
    ]);
    assert.match(html, /<progress class="capacity-meter" max="100" value="100"/);
    assert.match(html, /<progress class="capacity-meter" max="100" value="50"/);
    assert.match(html, /Ø 3,5 Teilnehmer/);
    assert.match(html, /2 Events · 8 Anmeldungen/);
    assert.match(html, /1 Event · 2 Anmeldungen/);
    assert.match(html, /Teilnahmequote 50 %/);
    assert.match(html, /Teilnahmequote –/);
    assert.match(html, /Ohne Kategorie/);
});

test('the event table links events, marks the sorted column and shows dashes', () => {
    const html = app.renderInsightTable([
        row('e1'),
        row('e2', { title: '<i>x</i>', noShows: null, attendanceRate: null, occupancyRate: null, placesOffered: 0, category: '' })
    ], { sort: { key: 'date', direction: 'desc' } });
    assert.match(html, /<table class="data-table insights-table">/);
    assert.match(html, /href="#event\/e1"/);
    assert.match(html, /aria-sort="descending"><button type="button" class="data-table-sort" data-click="sortInsights" data-sort="date">/);
    assert.equal(html.match(/data-click="sortInsights"/g).length, 7);
    assert.match(html, /data-label="Quote">80 %</);
    assert.match(html, /data-label="Auslastung">83 %</);
    const second = html.split('<tr>')[3];
    assert.match(second, /data-label="Check-ins">–</);
    assert.match(second, /data-label="No-Shows">–</);
    assert.match(second, /data-label="Quote">–</);
    assert.match(second, /data-label="Auslastung">–</);
    assert.ok(!html.includes('<i>x</i>'));
});

test('an empty range says so', () => {
    assert.match(app.renderInsightsEmpty(), /Keine vergangenen Events in diesem Zeitraum/);
    assert.match(app.renderInsightsError(), /data-click="reloadInsights"/);
});

// ── Page ──────────────────────────────────────────────────────

const answer = (range) => ({
    range,
    totals: totals(),
    members: [{ id: '1', name: 'Lena', attended: 3, checkedIn: 3, hasProfile: true }],
    categories: [{ label: 'Gaming', events: 2, registrations: 8, averageAccepted: 3.5, attendanceRate: 50, share: 100 }],
    events: [row('e1')]
});

test('the page loads 90 days first and reloads for another range', async () => {
    const loaded = await loadFrontendApp({
        '/api/admin/insights?range=90': answer('90'),
        '/api/admin/insights?range=365': { ...answer('365'), events: [row('e1'), row('e2')] }
    });
    await loaded.app.showInsightsSection();
    assert.equal(loaded.element('insights-section').style.display, 'block');
    assert.match(loaded.element('insights-totals').innerHTML, /Teilnahmequote/);
    assert.match(loaded.element('insights-members').innerHTML, /Lena/);
    assert.match(loaded.element('insights-categories').innerHTML, /Gaming/);
    assert.equal(loaded.element('insights-table').innerHTML.match(/<tr>/g).length, 2);

    await loaded.app.setInsightRange('365');
    assert.ok(loaded.requests.some(r => r.url === '/api/admin/insights?range=365'));
    assert.equal(loaded.element('insights-table').innerHTML.match(/<tr>/g).length, 3);
    assert.match(loaded.element('insights-ranges').innerHTML, /class="nav-link active"[^>]*data-range="365"/);
});

test('an empty range shows the empty state instead of the lists', async () => {
    const empty = { range: '30', totals: totals({ events: 0, trackedEvents: 0, attendanceRate: null, noShowRate: null, occupancyRate: null }), members: [], categories: [], events: [] };
    const loaded = await loadFrontendApp({ '/api/admin/insights?range=90': empty });
    await loaded.app.showInsightsSection();
    assert.match(loaded.element('insights-table').innerHTML, /Keine vergangenen Events in diesem Zeitraum/);
});
