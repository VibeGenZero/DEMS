const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadFrontendApp } = require('./helpers');

const ADMIN = { id: 'u-admin', username: 'admin', roles: [], isAdmin: true };

const GAME_NIGHT = 'Gemütlicher Abend — jeder ist willkommen!\n\n**Ablauf**\n- 19:00 Treffen in der _Lobby_\n- [Regeln](https://example.com/regeln) lesen';
const GAME_NIGHT_PREVIEW = 'Gemütlicher Abend — jeder ist willkommen! Ablauf 19:00 Treffen in der Lobby Regeln lesen';
const RAID = 'Nur für Mitglieder mit der Rolle **Raid-Team**.';
const RAID_PREVIEW = 'Nur für Mitglieder mit der Rolle Raid-Team.';

const event = (id, description, fields = {}) => ({
    id, title: `Event ${id}`, description, status: 'active', accessMode: 'open', approvalMode: 'instant',
    startDate: '2026-10-20T18:00:00.000Z', maxParticipants: 0, currentParticipants: 0, formFields: [], ...fields
});

test('a preview is one line of plain text without Markdown characters', async () => {
    const { app } = await loadFrontendApp({});
    assert.equal(app.markdownPreview(GAME_NIGHT), GAME_NIGHT_PREVIEW);
    assert.equal(app.markdownPreview(RAID), RAID_PREVIEW);
    assert.equal(app.markdownPreview('# Titel\n> Zitat mit `code` und ~~alt~~'), 'Titel Zitat mit code und alt');
    // Plain text keeps its underscores and stars
    assert.equal(app.markdownPreview('Datei event_name.txt, 5 * 3 = 15'), 'Datei event_name.txt, 5 * 3 = 15');
    assert.equal(app.markdownPreview(''), '');
    assert.equal(app.markdownPreview(undefined), '');
});

test('a long preview is cut on a word with an ellipsis', async () => {
    const { app } = await loadFrontendApp({});
    const preview = app.markdownPreview('Wort '.repeat(40), 30);
    assert.ok(preview.length <= 31, preview);
    assert.match(preview, /^Wort( Wort)*…$/);
});

const UPCOMING = '/api/events?upcoming=1&limit=100';
const page = (data) => ({ data, meta: { total: data.length, page: 1, limit: 100, totalPages: 1 } });

test('the overview shows cards that link to the event, without the description', async () => {
    const { app, element, toasts, state, requests } = await loadFrontendApp({
        [UPCOMING]: page([
            event('game-night', GAME_NIGHT, { category: 'Gaming' }),
            event('raid', RAID, { category: 'Raid', seriesId: 'series-1', seriesDates: [{ id: 'raid', startDate: '2026-10-20T18:00:00.000Z' }, { id: 'raid-2', startDate: '2026-10-27T18:00:00.000Z' }] })
        ])
    });
    state.currentUser = ADMIN;
    await app.showEventsSection();

    const html = element('events-grid').innerHTML;
    assert.ok(html.includes('href="#event/game-night"'));
    assert.ok(html.includes('href="#event/raid"'));
    assert.ok(html.includes('Serie · 2 Termine'));
    assert.ok(!html.includes(GAME_NIGHT_PREVIEW), 'no description on the card');
    assert.deepEqual(requests.map(request => request.url), [UPCOMING]);
    assert.equal(element('events-empty').style.display, 'none');
    assert.deepEqual(toasts, []);
});

test('a cut preview never splits an HTML entity', async () => {
    const { app } = await loadFrontendApp({});
    // 116 letters, then "&": escaping before cutting left a half "&am" at character 120
    assert.doesNotMatch(app.escapeHtml(app.markdownPreview(`${'a'.repeat(116)} & mehr Text danach`)), /&am(?!p;)/);
});

test('the Discord import list shows the preview, no Markdown', async () => {
    const { app, element, state } = await loadFrontendApp({
        '/api/admin/import/discord-events': [{ id: 'd1', name: 'Raid', description: RAID, scheduledStartTimestamp: Date.parse('2026-10-20T18:00:00.000Z'), image: null }]
    });
    state.currentUser = ADMIN;
    await app.fetchDiscordEvents();
    // data-event keeps the original Markdown on purpose: the import copies the description
    const previews = [...element('discord-events-list').innerHTML.matchAll(/<p[^>]*>([^<]*)<\/p>/g)].map(match => match[1]);
    assert.deepEqual(previews, [RAID_PREVIEW]);
});

// "now" of the card tests: Saturday, 10 October 2026, 15:00 local time
const NOW = new Date(2026, 9, 10, 15, 0);
const at = (day, hour, minute = 0, month = 9) => new Date(2026, month, day, hour, minute).toISOString();
const EMOJI = /\p{Extended_Pictographic}/u;
const INLINE_HANDLER = /\son[a-z]+\s*=\s*["']/i;

test('the day of an event is said relative to today, in calendar days', async () => {
    const { app } = await loadFrontendApp({});
    const day = (iso, now = NOW) => app.relativeDay(new Date(iso), now);
    assert.equal(day(at(10, 23, 30)), 'Heute');
    assert.equal(day(at(11, 0, 30)), 'Morgen');
    assert.equal(day(at(12, 20)), 'in 2 Tagen');
    assert.equal(day(at(23, 19)), 'in 13 Tagen');
    assert.equal(day(at(24, 19)), 'in 2 Wochen');
    assert.equal(day(at(30, 19)), 'in 2 Wochen');
    assert.equal(day(at(31, 19)), 'in 3 Wochen');
    assert.equal(day(at(9, 19)), 'Gestern');
    assert.equal(day(at(7, 19)), 'vor 3 Tagen');
    // Clocks go back on 25 October: still two calendar days
    assert.equal(day(at(26, 12), new Date(2026, 9, 24, 12)), 'in 2 Tagen');
});

test('an event runs from its start to its end, without an end for two hours', async () => {
    const { app } = await loadFrontendApp({});
    assert.equal(app.isRunning({ startDate: at(10, 14, 30), endDate: at(10, 17) }, NOW), true);
    assert.equal(app.isRunning({ startDate: at(10, 13, 30) }, NOW), true);
    assert.equal(app.isRunning({ startDate: at(10, 12, 0) }, NOW), false);
    assert.equal(app.isRunning({ startDate: at(11, 19) }, NOW), false);
    assert.equal(app.isRunning({ startDate: '' }, NOW), false);
    assert.equal(app.isRunning({ startDate: 'kein Datum' }, NOW), false);
});

test('the date tile shows weekday, day and month, or LIVE while the event runs', async () => {
    const { app } = await loadFrontendApp({});
    const sunday = app.renderDateTile({ startDate: at(11, 19) }, NOW);
    assert.match(sunday, /class="date-tile"/);
    assert.match(sunday, /date-tile-weekday">So</);
    assert.match(sunday, /date-tile-day">11</);
    assert.match(sunday, /date-tile-month">Okt</);
    const live = app.renderDateTile({ startDate: at(10, 14, 30) }, NOW);
    assert.match(live, /class="date-tile is-live"/);
    assert.match(live, /date-tile-day">LIVE</);
    assert.match(app.renderDateTile({}, NOW), /date-tile-day">–</);
});

test('the time line says when the event starts', async () => {
    const { app } = await loadFrontendApp({});
    assert.equal(app.renderEventWhen({ startDate: at(10, 14, 30) }, NOW), '<p class="event-card-when is-live"><strong>Läuft gerade</strong> · seit 14:30</p>');
    assert.equal(app.renderEventWhen({ startDate: at(11, 19) }, NOW), '<p class="event-card-when"><strong>Morgen</strong> · 19:00</p>');
    assert.equal(app.renderEventWhen({ startDate: at(13, 20) }, NOW), '<p class="event-card-when"><strong>in 3 Tagen</strong> · 20:00</p>');
    assert.equal(app.renderEventWhen({ startDate: '' }, NOW), '<p class="event-card-when">Termin folgt</p>');
});

test('the capacity shows taken places, warns from 80 % and says when it is full', async () => {
    const { app } = await loadFrontendApp({});
    const capacity = (currentParticipants, maxParticipants) => app.renderCapacity({ currentParticipants, maxParticipants });
    assert.equal(capacity(3, 0), '<div class="capacity"><span class="capacity-text">3 Plätze belegt</span></div>');
    assert.equal(capacity(1, 0), '<div class="capacity"><span class="capacity-text">1 Platz belegt</span></div>');
    assert.match(capacity(5, 20), /^<div class="capacity"><progress class="capacity-meter" max="20" value="5" aria-label="5 von 20 Plätzen belegt"><\/progress><span class="capacity-text">5 von 20 belegt<\/span><\/div>$/);
    assert.match(capacity(7, 10), /class="capacity"[^]*7 von 10 belegt/);
    assert.match(capacity(8, 10), /class="capacity is-low"[^]*Noch 2 Plätze/);
    assert.match(capacity(4, 5), /class="capacity is-low"[^]*Noch 1 Platz</);
    assert.match(capacity(5, 5), /class="capacity is-full"[^]*Ausgebucht/);
    // Overbooked by an admin: the bar stays at its end
    assert.match(capacity(7, 5), /class="capacity is-full"[^]*max="5" value="5"/);
    assert.match(capacity(undefined, 4), /value="0"[^]*0 von 4 belegt/);
});

test('the capacity of a card carries the places sentence and the waitlist', async () => {
    const { app } = await loadFrontendApp({});
    const places = (fields) => ({ taken: 5, capacity: 20, guests: 1, pending: 1, waitlist: 0, text: '5 von 20 Plätzen belegt (inkl. 1 Gast, 1 Anfrage offen)', waitlistText: '', ...fields });
    // The API's numbers win over the older count fields
    const html = app.renderCapacity({ currentParticipants: 4, maxParticipants: 20, places: places() });
    assert.match(html, /^<div class="capacity" title="5 von 20 Plätzen belegt \(inkl\. 1 Gast, 1 Anfrage offen\)">/);
    assert.match(html, /value="5" aria-label="5 von 20 Plätzen belegt \(inkl\. 1 Gast, 1 Anfrage offen\)"/);
    assert.match(html, /<span class="capacity-text">5 von 20 belegt<\/span>/);

    const full = app.renderCapacity({ maxParticipants: 5, places: places({ taken: 5, capacity: 5, guests: 0, pending: 0, waitlist: 3, text: '5 von 5 Plätzen belegt', waitlistText: '3 auf der Warteliste' }) });
    assert.match(full, /title="5 von 5 Plätzen belegt · 3 auf der Warteliste"/);
    assert.match(full, /<span class="capacity-text">Ausgebucht · 3 warten<\/span>/);
    const oneWaiting = app.renderCapacity({ maxParticipants: 5, places: places({ taken: 5, capacity: 5, waitlist: 1, text: 'x', waitlistText: '1 auf der Warteliste' }) });
    assert.match(oneWaiting, /Ausgebucht · 1 wartet</);

    const escaped = app.renderCapacity({ maxParticipants: 20, places: places({ text: '"><b>x</b>' }) });
    assert.doesNotMatch(escaped, /<b>/);
});

test('the own status becomes a chip with an icon, anything else none', async () => {
    const { app } = await loadFrontendApp({});
    const expected = {
        accepted: ['chip-success', 'bi-check-circle-fill', 'Angemeldet'],
        pending: ['chip-warning', 'bi-hourglass-split', 'Ausstehend'],
        waitlisted: ['chip-info', 'bi-list-ol', 'Warteliste'],
        guest: ['chip-accent', 'bi-person-plus', 'Als Gast']
    };
    for (const [status, [className, icon, label]] of Object.entries(expected)) {
        assert.equal(app.renderStatusChip(status), `<span class="chip chip-sm ${className}"><i class="bi ${icon}"></i>${label}</span>`);
    }
    for (const status of [null, undefined, '', 'rejected', 'cancelled', 'constructor', '__proto__', 'toString']) {
        assert.equal(app.renderStatusChip(status), '', String(status));
    }
});

test('the banner background uses the event colour, else the gradient of its id', async () => {
    const { app } = await loadFrontendApp({});
    assert.equal(app.bannerBackground({ id: 'a', accentColor: '#8b5cf6' }), 'linear-gradient(135deg, #8b5cf699 0%, #8b5cf6 100%)');
    assert.equal(app.bannerBackground({ id: 'a', accentColor: '#abc' }), 'linear-gradient(135deg, #aabbcc99 0%, #aabbcc 100%)');
    for (const accentColor of ['', 'red', 'red;background:url(x)', '#12345', undefined]) {
        assert.equal(app.bannerBackground({ id: 'ev-1', accentColor }), app.getEventGradient('ev-1'), String(accentColor));
    }
});

test('an event card links to the event and shows banner, date, time and facts', async () => {
    const { app } = await loadFrontendApp({});
    const html = app.renderEventCard({
        id: 'ev-1', title: 'Raid: Schattenfestung', description: 'Nur für das Raid-Team.', category: 'Raid',
        startDate: at(15, 20), bannerUrl: 'https://example.com/raid.png', accessMode: 'role-required',
        maxParticipants: 6, currentParticipants: 2, myStatus: 'waitlisted'
    }, NOW);
    assert.match(html, /^<a class="glass-card event-card" href="#event\/ev-1" data-click="openEventCard" data-event-id="ev-1">/);
    assert.match(html, /<img class="event-card-banner" src="https:\/\/example\.com\/raid\.png" alt="" loading="lazy" data-fallback="hide">/);
    assert.match(html, /event-card-category"><span>Raid<\/span>/);
    assert.match(html, /date-tile-day">15</);
    assert.match(html, /<h3 class="event-card-title">Raid: Schattenfestung<\/h3>/);
    assert.match(html, /<strong>in 5 Tagen<\/strong> · 20:00/);
    assert.match(html, /Warteliste/);
    assert.match(html, /bi-lock"><\/i>Rolle nötig/);
    assert.match(html, /2 von 6 belegt/);
    assert.doesNotMatch(html, /Nur für das Raid-Team/, 'no description on the card');
    assert.doesNotMatch(html, /Serie/);
});

test('a series card counts its dates; an open event without status shows no chip', async () => {
    const { app } = await loadFrontendApp({});
    const series = app.renderEventCard({ id: 's1', title: 'Training', seriesId: 'x', seriesDates: [{ id: 's1' }, { id: 's2' }, { id: 's3' }], startDate: at(11, 19), accessMode: 'open', maxParticipants: 8, currentParticipants: 2, myStatus: null }, NOW);
    assert.match(series, /bi-arrow-repeat"><\/i>Serie · 3 Termine/);
    assert.doesNotMatch(series, /Rolle nötig|Angemeldet|Warteliste|Ausstehend|Als Gast/);
    const last = app.renderEventCard({ id: 's3', title: 'Training', seriesId: 'x', seriesDates: [{ id: 's3' }], startDate: at(11, 19) }, NOW);
    assert.match(last, /Serie · 1 Termin</);
});

test('event cards escape admin texts and drop unsafe banner addresses', async () => {
    const { app } = await loadFrontendApp({});
    const html = app.renderEventCard({
        id: 'ev"1', title: '<img src=x onerror=alert(1)>', category: '"><script>alert(1)</script>',
        bannerUrl: 'https://example.com/a.png" onerror="alert(1)', accentColor: 'red;background:url(x)',
        startDate: at(11, 19), maxParticipants: 0
    }, NOW);
    assert.doesNotMatch(html, INLINE_HANDLER);
    assert.doesNotMatch(html, /<img src=x|<script/);
    assert.match(html, /href="#event\/ev&quot;1"/);
    assert.match(html, /src="https:\/\/example\.com\/a\.png&quot; onerror=&quot;alert\(1\)"/);
    assert.doesNotMatch(html, /red;background/);
    for (const bannerUrl of ['javascript:alert(1)', 'data:image/png;base64,AAAA', '/relative.png', '/uploads/banners/x.png', '']) {
        assert.doesNotMatch(app.renderEventCard({ id: 'b', title: 'B', bannerUrl, startDate: at(11, 19) }, NOW), /<img/, bannerUrl);
    }
    // An uploaded banner (W-12) is a same-origin path
    const uploaded = app.renderEventCard({ id: 'u', title: 'U', bannerUrl: '/uploads/banners/0f8fad5b-d9cb-469f-a165-70867728950e.png', startDate: at(11, 19) }, NOW);
    assert.match(uploaded, /<img class="event-card-banner" src="\/uploads\/banners\/0f8fad5b-d9cb-469f-a165-70867728950e\.png"/);
});

test('cards and skeletons contain no emoji', async () => {
    const { app } = await loadFrontendApp({});
    const statuses = [null, ...Object.keys(app.STATUS_CHIPS)];
    for (const myStatus of statuses) {
        const html = app.renderEventCard({ id: 'e', title: 'Event', category: 'Gaming', seriesId: 's', seriesDates: [{ id: 'e' }], accessMode: 'role-required', startDate: at(10, 14, 30), maxParticipants: 5, currentParticipants: 5, myStatus }, NOW);
        assert.doesNotMatch(html, EMOJI, String(myStatus));
    }
    const skeletons = app.renderEventCardSkeletons(3);
    assert.equal(skeletons.match(/event-card-skeleton-media/g).length, 3);
    assert.match(skeletons, /aria-hidden="true"/);
    assert.doesNotMatch(skeletons, EMOJI);
});

const overviewEvents = () => [
    event('a', 'Party-Games', { title: 'Spieleabend', category: 'Gaming' }),
    event('b', 'Koop', { title: 'Koop-Abend', category: 'Gaming' }),
    event('c', 'Bosse', { title: 'Schattenfestung', category: 'Raid' }),
    event('d', 'OBS', { title: 'Workshop', category: '' })
];
const links = (html) => [...html.matchAll(/href="#event\/([^"]+)"/g)].map(match => match[1]);

test('the category bar counts the upcoming events per category', async () => {
    const { app, element, state } = await loadFrontendApp({ [UPCOMING]: page(overviewEvents()) });
    state.currentUser = ADMIN;
    await app.showEventsSection();
    const bar = element('category-filter-bar').innerHTML;
    const chips = [...bar.matchAll(/data-category="([^"]*)">([^<]*) <span class="chip-count">(\d+)<\/span>/g)].map(match => [match[1], match[2], Number(match[3])]);
    assert.deepEqual(chips, [['', 'Alle', 4], ['Gaming', 'Gaming', 2], ['Raid', 'Raid', 1]]);
    assert.match(bar, /class="chip active" data-click="filterByCategory" data-category=""/);
});

test('search and category filter in the browser, without a new request', async () => {
    const { app, element, state, requests } = await loadFrontendApp({ [UPCOMING]: page(overviewEvents()) });
    state.currentUser = ADMIN;
    await app.showEventsSection();

    await app.runAction('filterByCategory', { dataset: { category: 'Gaming' } });
    assert.deepEqual(links(element('events-grid').innerHTML), ['a', 'b']);

    element('events-search').value = 'KOOP';
    await app.runAction('searchEvents', element('events-search'));
    assert.deepEqual(links(element('events-grid').innerHTML), ['b'], 'title, case-insensitive');

    element('events-search').value = 'obs';
    await app.runAction('filterByCategory', { dataset: { category: '' } });
    assert.deepEqual(links(element('events-grid').innerHTML), ['d'], 'description');

    element('events-search').value = 'raid';
    await app.runAction('searchEvents', element('events-search'));
    assert.deepEqual(links(element('events-grid').innerHTML), ['c'], 'category');

    assert.deepEqual(requests.map(request => request.url), [UPCOMING]);
});

test('no match offers to reset search and category', async () => {
    const { app, element, state } = await loadFrontendApp({ [UPCOMING]: page(overviewEvents()) });
    state.currentUser = ADMIN;
    await app.showEventsSection();
    await app.runAction('filterByCategory', { dataset: { category: 'Raid' } });
    element('events-search').value = 'nichts';
    await app.runAction('searchEvents', element('events-search'));

    assert.equal(element('events-grid').innerHTML, '');
    assert.equal(element('events-empty').style.display, 'block');
    assert.match(element('events-empty').innerHTML, /Keine Treffer/);
    assert.match(element('events-empty').innerHTML, /data-click="resetEventFilters"/);

    await app.runAction('resetEventFilters', {});
    assert.equal(element('events-search').value, '');
    assert.deepEqual(links(element('events-grid').innerHTML), ['a', 'b', 'c', 'd']);
    assert.equal(element('events-empty').style.display, 'none');
});

test('a chosen category without events any more falls back to all', async () => {
    let data = overviewEvents();
    const { app, element, state } = await loadFrontendApp({ [UPCOMING]: () => page(data) });
    state.currentUser = ADMIN;
    await app.showEventsSection();
    await app.runAction('filterByCategory', { dataset: { category: 'Raid' } });
    assert.deepEqual(links(element('events-grid').innerHTML), ['c']);

    data = overviewEvents().filter(entry => entry.category !== 'Raid');
    await app.showEventsSection();
    assert.deepEqual(links(element('events-grid').innerHTML), ['a', 'b', 'd']);
    assert.match(element('category-filter-bar').innerHTML, /class="chip active" data-click="filterByCategory" data-category=""/);
});

test('the overview says when there is nothing or when loading failed', async () => {
    const empty = await loadFrontendApp({ [UPCOMING]: page([]) });
    empty.state.currentUser = ADMIN;
    await empty.app.showEventsSection();
    assert.match(empty.element('events-empty').innerHTML, /Keine anstehenden Events/);
    assert.equal(empty.element('category-filter-bar').innerHTML, '');

    // Unknown URL -> 404 in the test harness
    const failed = await loadFrontendApp({});
    failed.state.currentUser = ADMIN;
    await failed.app.showEventsSection();
    assert.match(failed.element('events-empty').innerHTML, /Events konnten nicht geladen werden/);
    assert.match(failed.element('events-empty').innerHTML, /data-click="showEventsSection"/);
    assert.doesNotMatch(failed.element('events-empty').innerHTML, /Console/);
});

test('the time line of a card can name the place', async () => {
    const { app } = await loadFrontendApp({});
    const now = new Date('2026-10-13T12:00:00.000Z');
    const start = '2026-10-16T12:00:00.000Z';
    assert.match(app.renderEventWhen({ startDate: start }, now, 'Lobby'), /<strong>in 3 Tagen<\/strong> · \d{2}:\d{2} · Lobby<\/p>$/);
    assert.match(app.renderEventWhen({ startDate: '' }, now, 'Lobby'), />Termin folgt · Lobby<\/p>$/);
    assert.match(app.renderEventWhen({ startDate: start }, now, '<b>x</b>'), / · &lt;b&gt;x&lt;\/b&gt;<\/p>$/);
    // Without a place the line stays as it was
    assert.doesNotMatch(app.renderEventWhen({ startDate: start }, now), /\d{2}:\d{2} ·/);
});

test('an end before the start counts as missing on the cards too', async () => {
    const { app } = await loadFrontendApp({});
    assert.equal(app.eventEnd({ startDate: '2026-10-10T18:00:00.000Z', endDate: '2026-10-09T23:00:00.000Z' }).toISOString(), '2026-10-10T20:00:00.000Z');
});

test('the browser deadline helpers answer like the server ones (W-03)', async () => {
    const { app } = await loadFrontendApp({});
    const { NOW, DEADLINE_CASES } = require('./fixtures/deadlineCases');
    for (const [name, event, registrationClosed, unregisterClosed] of DEADLINE_CASES) {
        assert.equal(app.isRegistrationClosed(event, NOW), registrationClosed, `registration: ${name}`);
        assert.equal(app.isUnregisterClosed(event, NOW), unregisterClosed, `unregister: ${name}`);
    }
});
