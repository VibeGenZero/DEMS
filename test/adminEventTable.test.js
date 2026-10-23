const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadFrontendApp } = require('./helpers');
const { elementsWith, actionTargets, actionElement, assertNoInlineHandlers } = require('./htmlSource');

const ADMIN = { id: 'u-admin', username: 'admin', roles: [], isAdmin: true };
// Admin-set text with everything that breaks unescaped markup
const TRICKY_TEXT = 'Bob\'s "Raid" & <mehr>';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const EMOJI = /\p{Extended_Pictographic}/u;
// setImmediate runs after the microtask queue is drained, so a reload an action starts has settled
const settle = () => new Promise(resolve => setImmediate(resolve));
// The page renders with the real clock, so these events are placed around it
const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();
const places = (fields = {}) => ({ taken: 2, capacity: 10, guests: 0, pending: 0, waitlist: 0, text: '2 von 10 Plätzen belegt', waitlistText: '', ...fields });
const adminEvent = (id, fields = {}) => ({
    id, title: id, status: 'active', category: 'Gaming', accessMode: 'open', approvalMode: 'instant',
    maxParticipants: 10, startDate: iso(3 * DAY), places: places(), ...fields
});

const EVENTS = [
    adminEvent('upcoming', { title: 'Spieleabend' }),
    adminEvent('requests', { title: 'Turnier', category: 'Turnier', approvalMode: 'manual', startDate: iso(5 * DAY), places: places({ pending: 2, text: '2 von 10 Plätzen belegt (2 Anfragen offen)' }) }),
    adminEvent('running', { title: 'Marathon', startDate: iso(-HOUR / 2), autoCreateChannels: true }),
    adminEvent('past', { title: 'Retro', startDate: iso(-7 * DAY) }),
    adminEvent('draft', { title: 'Halloween', status: 'draft' }),
    adminEvent('old', { title: 'Sommerfest', status: 'archived', startDate: iso(-90 * DAY) }),
    adminEvent('s1', { title: 'Training', seriesId: 'series', startDate: iso(1 * DAY) }),
    adminEvent('s2', { title: 'Training', seriesId: 'series', startDate: iso(8 * DAY), places: places({ pending: 1, text: '2 von 10 Plätzen belegt (1 Anfrage offen)' }) })
];

async function openTable(events = EVENTS, routes = {}) {
    const harness = await loadFrontendApp({ '/api/admin/all-events': events, ...routes });
    harness.state.currentUser = ADMIN;
    await harness.app.loadAdminEvents();
    return {
        ...harness,
        table: () => harness.element('admin-events-table').innerHTML,
        tabs: () => harness.element('admin-events-tabs').innerHTML,
        run: (action, dataset = {}, extra = {}) => harness.app.runAction(action, { dataset, ...extra })
    };
}

// Body rows of the table as HTML strings
const rowsOf = (html) => html.split('<tr').slice(1).map(row => `<tr${row}`).filter(row => !row.includes('<th'));
const rowOf = (html, text) => {
    const row = rowsOf(html).find(candidate => candidate.includes(text));
    assert.ok(row, `no row with "${text}"`);
    return row;
};
const isSubRow = (row) => row.includes('class="is-sub');
const titlesOf = (html) => rowsOf(html).filter(row => !isSubRow(row)).map(row => row.match(/class="data-table-title"[^>]*>([^<]*)</)[1]);
const mainButtons = (row) => [...row.matchAll(/class="btn btn-sm (btn-primary|btn-secondary)"[^>]*><i[^>]*><\/i>([^<]+)</g)].map(match => ({ style: match[1], label: match[2] }));
const menuLabels = (row) => [...row.matchAll(/class="dropdown-item[^"]*"[^>]*><i[^>]*><\/i>([^<]+)</g)].map(match => match[1]);

test('the table opens in the active tab with one main action and one menu per row', async () => {
    const { table, tabs, requests, toasts } = await openTable();
    // The running event first, then by date; the past one stands last
    assert.deepEqual(titlesOf(table()), ['Marathon', 'Training', 'Spieleabend', 'Turnier', 'Retro']);
    for (const row of rowsOf(table())) {
        assert.equal(mainButtons(row).length, 1, row);
        assert.equal((row.match(/data-bs-toggle="dropdown"/g) || []).length, 1, row);
        assert.match(row, /aria-label="Weitere Aktionen für „[^"]+“"/);
    }
    assert.match(tabs(), /Entwürfe <span class="chip chip-sm">1<\/span>/);
    assert.match(tabs(), /class="nav-link active"[^>]*data-tab="active"[^>]*>Aktiv <span class="chip chip-sm">5<\/span>/);
    assert.match(tabs(), /Archiv <span class="chip chip-sm">1<\/span>/);
    assert.deepEqual(requests.map(request => request.url), ['/api/admin/all-events']);
    assert.deepEqual(toasts, []);
});

test('the main action follows the state and shows open requests', async () => {
    const { table, run } = await openTable();
    assert.deepEqual(mainButtons(rowOf(table(), '>Turnier<')), [{ style: 'btn-primary', label: 'Anmeldungen · 2 offen' }]);
    assert.deepEqual(mainButtons(rowOf(table(), '>Spieleabend<')), [{ style: 'btn-secondary', label: 'Anmeldungen' }]);
    const past = rowOf(table(), '>Retro<');
    assert.deepEqual(mainButtons(past), [{ style: 'btn-secondary', label: 'Archivieren' }]);
    assert.match(past, /^<tr class="is-muted">/);
    assert.match(past, />Vorbei</);
    assert.match(rowOf(table(), '>Marathon<'), /Läuft gerade/);

    await run('switchAdminTab', { tab: 'drafts' });
    assert.deepEqual(mainButtons(rowOf(table(), '>Halloween<')), [{ style: 'btn-secondary', label: 'Veröffentlichen' }]);
    await run('switchAdminTab', { tab: 'archive' });
    assert.deepEqual(mainButtons(rowOf(table(), '>Sommerfest<')), [{ style: 'btn-secondary', label: 'Anmeldungen' }]);
});

test('the menu has three groups and is the only place to delete', async () => {
    const { table } = await openTable();
    const row = rowOf(table(), '>Spieleabend<');
    assert.deepEqual(menuLabels(row), ['Bearbeiten', 'Ankündigen', 'Nachricht an Teilnehmer …', 'Duplizieren', 'CSV-Export', 'In Discord eintragen …', 'Zurück in Entwürfe', 'Archivieren', 'Löschen …']);
    assert.equal((row.match(/dropdown-divider/g) || []).length, 2);
    assert.match(row, /data-click="showParticipantMessage" data-event-id="[^"]+" data-event-title="Spieleabend[^"]*"/);
    assert.match(row, /<h6 class="dropdown-header">Status<\/h6>/);
    assert.match(row, /class="dropdown-item is-danger" data-click="deleteEvent"/);
    // Outside the menu nothing deletes
    assert.doesNotMatch(row.replace(/<ul class="dropdown-menu[\s\S]*?<\/ul>/, ''), /deleteEvent/);

    assert.deepEqual(menuLabels(rowOf(table(), '>Retro<')).slice(0, 2), ['Anmeldungen', 'Bearbeiten']);
    const running = rowOf(table(), '>Marathon<');
    assert.deepEqual(menuLabels(running).slice(-3), ['Jetzt beenden …', 'Zurück in Entwürfe', 'Löschen …']);
    assert.match(running, /data-click="endEvent" data-event-id="running" data-event-title="Marathon" data-channels="1"/);
});

test('tabs, search, sorting and the series toggle need no request', async () => {
    const { table, tabs, run, requests } = await openTable();
    await run('searchAdminEvents', {}, { value: 'tur' });
    assert.deepEqual(titlesOf(table()), ['Turnier']);
    assert.match(tabs(), /Aktiv <span class="chip chip-sm">1<\/span>/);
    await run('searchAdminEvents', {}, { value: '' });

    await run('sortAdminEvents', { sort: 'title' });
    assert.match(table(), /aria-sort="ascending"><button[^>]*data-sort="title"/);
    assert.deepEqual(titlesOf(table()), ['Marathon', 'Spieleabend', 'Training', 'Turnier', 'Retro']);
    await run('sortAdminEvents', { sort: 'title' });
    assert.match(table(), /aria-sort="descending"><button[^>]*data-sort="title"/);
    assert.deepEqual(titlesOf(table()), ['Turnier', 'Training', 'Spieleabend', 'Marathon', 'Retro']);

    // Each tab keeps its own sorting
    await run('switchAdminTab', { tab: 'archive' });
    assert.match(table(), /aria-sort="descending"><button[^>]*data-sort="date"/);
    await run('switchAdminTab', { tab: 'active' });
    assert.match(table(), /aria-sort="descending"><button[^>]*data-sort="title"/);

    await run('toggleAdminSeries', { seriesId: 'series' });
    assert.deepEqual(requests.map(request => request.url), ['/api/admin/all-events']);
});

test('an unknown tab or sort key changes nothing', async () => {
    const { table, tabs, run } = await openTable();
    const before = table();
    for (const tab of ['constructor', '__proto__', '', undefined]) await run('switchAdminTab', { tab });
    for (const sort of ['constructor', '__proto__', '', undefined]) await run('sortAdminEvents', { sort });
    assert.equal(table(), before);
    assert.match(tabs(), /class="nav-link active"[^>]*data-tab="active"/);
});

test('a search without hits says where the hits are and can be reset', async () => {
    const { table, run, element } = await openTable();
    element('admin-events-search').value = 'sommer';
    await run('searchAdminEvents', {}, { value: 'sommer' });
    assert.match(table(), /Keine Treffer/);
    assert.match(table(), /Treffer in anderen Tabs: Archiv 1/);
    assert.match(table(), /data-click="resetAdminSearch"/);

    await run('resetAdminSearch');
    assert.equal(element('admin-events-search').value, '');
    assert.equal(titlesOf(table()).length, 5);

    await run('searchAdminEvents', {}, { value: '<b>nix</b>' });
    assert.match(table(), /in keinem Tab/);
    assert.doesNotMatch(table(), /<b>nix/);
    assert.match(table(), /&lt;b&gt;nix/);
});

test('a series row opens its dates', async () => {
    const { table, run } = await openTable();
    const closed = rowOf(table(), '>Training<');
    assert.match(closed, /Serie · 2 Termine</);
    assert.match(closed, /data-click="toggleAdminSeries" data-series-id="series" aria-expanded="false"/);
    assert.match(closed, /1 Anfrage offen in weiteren Terminen/);
    assert.deepEqual(menuLabels(closed).slice(-2), ['Termin löschen …', 'Ganze Serie löschen …']);
    assert.match(closed, /data-click="deleteEventSeries" data-series-id="series" data-event-title="Training" data-count="2"/);
    assert.ok(!rowsOf(table()).some(isSubRow));

    await run('toggleAdminSeries', { seriesId: 'series' });
    const subRows = rowsOf(table()).filter(isSubRow);
    assert.deepEqual(subRows.map(row => row.match(/Termin \d von \d/)[0]), ['Termin 1 von 2', 'Termin 2 von 2']);
    assert.deepEqual(mainButtons(subRows[1]), [{ style: 'btn-primary', label: 'Anmeldungen · 1 offen' }]);
    assert.deepEqual(menuLabels(subRows[0]).slice(-1), ['Termin löschen …']);
    // The dialogs name the date, because all dates share the title
    assert.match(subRows[0], /data-click="showRegistrations" data-event-id="s1" data-event-title="Training · [^"]+"/);
    assert.match(rowOf(table(), '>Training<'), /aria-expanded="true"/);

    await run('toggleAdminSeries', { seriesId: 'series' });
    assert.ok(!rowsOf(table()).some(isSubRow));
});

test('a series with one date in the tab is a plain row that can still delete the series', async () => {
    const { table } = await openTable([
        adminEvent('k1', { title: 'Kurs', seriesId: 'kurs', status: 'archived', startDate: iso(-30 * DAY) }),
        adminEvent('k2', { title: 'Kurs', seriesId: 'kurs' })
    ]);
    const row = rowOf(table(), '>Kurs<');
    assert.match(row, /Serie · 1 Termin</);
    assert.doesNotMatch(row, /toggleAdminSeries/);
    assert.match(row, /data-click="deleteEventSeries" data-series-id="kurs" data-event-title="Kurs" data-count="2"/);
});

test('texts of admins are escaped and reach the actions unchanged', async () => {
    const { app, table, element, requests } = await openTable(
        [adminEvent('tricky', { title: TRICKY_TEXT, category: TRICKY_TEXT })],
        { '/api/admin/events/tricky/registrations': { data: [], slots: [] } }
    );
    const html = table();
    assertNoInlineHandlers(html);
    assert.doesNotMatch(html, /<mehr>/);
    for (const { attributes } of elementsWith(html, 'data-click')) {
        if (attributes['data-click'] === 'sortAdminEvents') continue;
        assert.equal(attributes['data-event-id'], 'tricky', `${attributes['data-click']} without its event`);
    }
    const [open] = actionTargets(html, 'showRegistrations');
    await app.runAction('showRegistrations', actionElement(open));
    assert.equal(element('reg-event-title').textContent, TRICKY_TEXT);
    assert.ok(requests.some(request => request.url === '/api/admin/events/tricky/registrations'));
    assert.equal(actionTargets(html, 'deleteEvent')[0].attributes['data-event-title'], TRICKY_TEXT);
});

test('an event without places, date or title still gets its row', async () => {
    const { table, toasts } = await openTable([
        adminEvent('bare', { title: '', category: '', places: undefined, startDate: '' }),
        adminEvent('broken', { title: 'Kaputt', places: { text: 5 }, startDate: 'kein Datum' }),
        adminEvent('fine', { title: 'Gut' })
    ]);
    // Without a date an event sorts last
    assert.deepEqual(titlesOf(table()), ['Gut', '(ohne Titel)', 'Kaputt']);
    const bare = rowOf(table(), '(ohne Titel)');
    assert.match(bare, /Kein Termin/);
    assert.match(bare, /<span class="data-table-meta">–<\/span>/);
    assert.match(rowOf(table(), '>Kaputt<'), /<span class="data-table-meta">–<\/span>/);
    assert.deepEqual(toasts, []);
});

test('the date column tells day, time and distance', async () => {
    const { app } = await loadFrontendApp({});
    // Sunday, 11 October 2026, 16:00; local dates, so every time zone gives the same text
    const now = new Date(2026, 9, 11, 16, 0);
    const at = (year, month, day, hour, minute = 0) => new Date(year, month, day, hour, minute).toISOString();
    const rows = app.buildAdminRows([
        adminEvent('soon', { title: 'Bald', startDate: at(2026, 9, 14, 19) }),
        adminEvent('next-year', { title: 'Neujahr', startDate: at(2027, 0, 1, 18, 30) }),
        adminEvent('live', { title: 'Live', startDate: at(2026, 9, 11, 15, 30) })
    ], { tab: 'active', now });
    const html = app.renderAdminTable(rows, { sort: app.DEFAULT_ADMIN_SORT.active, expanded: [], now });
    assert.match(rowOf(html, '>Bald<'), /Mi\., 14\. Okt\. · 19:00<\/div><div class="data-table-meta">in 3 Tagen</);
    assert.match(rowOf(html, '>Neujahr<'), /Fr\., 1\. Jan\. 2027 · 18:30/);
    assert.match(rowOf(html, '>Live<'), /Läuft gerade<\/span><div class="data-table-meta">seit 15:30</);
});

test('the places column shows the bar, the sentence and the waitlist', async () => {
    const { app } = await loadFrontendApp({});
    const now = new Date();
    const rows = app.buildAdminRows([
        adminEvent('full', { title: 'Voll', places: places({ taken: 5, capacity: 5, waitlist: 3, text: '5 von 5 Plätzen belegt', waitlistText: '3 auf der Warteliste' }) }),
        adminEvent('open', { title: 'Offen', maxParticipants: 0, places: places({ capacity: 0, text: '2 Plätze belegt' }) })
    ], { tab: 'active', now });
    const html = app.renderAdminTable(rows, { sort: app.DEFAULT_ADMIN_SORT.active, expanded: [], now });
    const full = rowOf(html, '>Voll<');
    assert.match(full, /<div class="capacity is-full"><progress class="capacity-meter" max="5" value="5" aria-label="5 von 5 Plätzen belegt"><\/progress><\/div>/);
    assert.match(full, /<div>5 von 5 Plätzen belegt<\/div><div class="data-table-meta">3 auf der Warteliste<\/div>/);
    const open = rowOf(html, '>Offen<');
    assert.doesNotMatch(open, /<progress/);
    assert.match(open, /<div>2 Plätze belegt<\/div>/);
});

test('empty tabs and a failed load say what is going on', async () => {
    const { table, run } = await openTable([adminEvent('only')]);
    await run('switchAdminTab', { tab: 'drafts' });
    assert.match(table(), /Keine Entwürfe/);
    await run('switchAdminTab', { tab: 'archive' });
    assert.match(table(), /Das Archiv ist leer/);
    assert.match((await openTable([])).table(), /Keine aktiven Events/);

    // No route: the request answers 404
    const failing = await loadFrontendApp({});
    failing.state.currentUser = ADMIN;
    await failing.app.loadAdminEvents();
    const html = failing.element('admin-events-table').innerHTML;
    assert.match(html, /Events konnten nicht geladen werden/);
    assert.match(html, /data-click="reloadAdminEvents"/);
});

test('a reload keeps tab and table until the new answer is there', async () => {
    let release;
    let answer = new Promise(resolve => { release = resolve; });
    const harness = await loadFrontendApp({ '/api/admin/all-events': () => answer });
    harness.state.currentUser = ADMIN;
    const table = () => harness.element('admin-events-table').innerHTML;

    const first = harness.app.loadAdminEvents();
    assert.match(table(), /skeleton/);
    release(EVENTS);
    await first;
    assert.doesNotMatch(table(), /skeleton/);

    await harness.app.runAction('switchAdminTab', { dataset: { tab: 'archive' } });
    answer = new Promise(resolve => { release = resolve; });
    const second = harness.app.loadAdminEvents();
    assert.match(table(), /Sommerfest/);
    assert.doesNotMatch(table(), /skeleton/);
    release(EVENTS.filter(event => event.id !== 'old'));
    await second;
    assert.match(table(), /Das Archiv ist leer/);
    assert.match(harness.element('admin-events-tabs').innerHTML, /class="nav-link active"[^>]*data-tab="archive"/);
});

test('the table markup carries no emojis and no style attributes', async () => {
    const { table, tabs, run } = await openTable();
    await run('toggleAdminSeries', { seriesId: 'series' });
    for (const html of [table(), tabs()]) {
        assert.doesNotMatch(html, EMOJI);
        assert.doesNotMatch(html, /style="/);
    }
});

test('handling a request in the dialog updates the row it was opened from', async () => {
    let list = EVENTS;
    const { app, table, requests } = await openTable(EVENTS, {
        '/api/admin/all-events': () => list,
        '/api/admin/registrations/r1/status': { id: 'r1', status: 'accepted' },
        '/api/admin/events/requests/registrations': { data: [], slots: [] }
    });
    assert.deepEqual(mainButtons(rowOf(table(), '>Turnier<')), [{ style: 'btn-primary', label: 'Anmeldungen · 2 offen' }]);

    // The server accepts one of the two requests
    list = EVENTS.map(event => (event.id === 'requests'
        ? { ...event, places: places({ taken: 3, pending: 1, text: '3 von 10 Plätzen belegt (1 Anfrage offen)' }) }
        : event));
    await app.runAction('updateRegStatus', { dataset: { regId: 'r1', status: 'accepted', eventId: 'requests', eventTitle: 'Turnier' } });
    await settle();
    const row = rowOf(table(), '>Turnier<');
    assert.deepEqual(mainButtons(row), [{ style: 'btn-primary', label: 'Anmeldungen · 1 offen' }]);
    assert.match(row, /3 von 10 Plätzen belegt \(1 Anfrage offen\)/);
    assert.equal(requests.filter(request => request.url === '/api/admin/all-events').length, 2);
    assert.ok(requests.some(request => request.url === '/api/admin/stats'));
});
