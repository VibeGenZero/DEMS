const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadFrontendApp } = require('./helpers');

const ADMIN = { id: 'u-admin', username: 'admin', roles: [], isAdmin: true };

const GAME_NIGHT = 'Gemütlicher Abend — jeder ist willkommen!\n\n**Ablauf**\n- 19:00 Treffen in der _Lobby_\n- [Regeln](https://example.com/regeln) lesen';
const GAME_NIGHT_PREVIEW = 'Gemütlicher Abend — jeder ist willkommen! Ablauf 19:00 Treffen in der Lobby Regeln lesen';
const RAID = 'Nur für Mitglieder mit der Rolle **Raid-Team**.';
const RAID_PREVIEW = 'Nur für Mitglieder mit der Rolle Raid-Team.';

// Characters that only appear when Markdown is shown raw
const RAW_MARKDOWN = /\*\*|\]\(|^\s*[-#>] /m;

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

test('event cards in the overview show the preview, no Markdown', async () => {
    const { app, element, toasts, state } = await loadFrontendApp({
        '/api/events/categories': [],
        '/api/events': {
            data: [
                event('game-night', GAME_NIGHT),
                event('raid', RAID, { seriesId: 'series-1', seriesDates: [{ id: 'raid', startDate: '2026-10-20T18:00:00.000Z' }, { id: 'raid-2', startDate: '2026-10-27T18:00:00.000Z' }] })
            ],
            meta: { total: 2, page: 1, limit: 20, totalPages: 1 }
        }
    });
    state.currentUser = ADMIN;
    await app.showEventsSection();

    const html = element('events-grid').innerHTML;
    assert.ok(html.includes(GAME_NIGHT_PREVIEW), 'standard card');
    assert.ok(html.includes(RAID_PREVIEW), 'series card');
    assert.doesNotMatch(html, RAW_MARKDOWN);
    assert.deepEqual(toasts, []);
});

test('admin cards show the preview, no Markdown', async () => {
    const { app, element, toasts, state } = await loadFrontendApp({
        '/api/admin/all-events': [
            event('game-night', GAME_NIGHT),
            event('raid-1', RAID, { seriesId: 'series-1' }),
            event('raid-2', RAID, { seriesId: 'series-1', startDate: '2026-10-27T18:00:00.000Z' })
        ]
    });
    state.currentUser = ADMIN;
    await app.loadAdminEvents();

    const html = element('admin-events-grid').innerHTML;
    assert.ok(html.includes(GAME_NIGHT_PREVIEW), 'standard card');
    assert.ok(html.includes(RAID_PREVIEW), 'series card');
    assert.doesNotMatch(html, RAW_MARKDOWN);
    assert.deepEqual(toasts, []);
});

test('a cut preview never splits an HTML entity', async () => {
    // 116 letters, then "&": escaping before cutting left a half "&am" at character 120
    const { app, element, state } = await loadFrontendApp({ '/api/admin/all-events': [event('amp', `${'a'.repeat(116)} & mehr Text danach`)] });
    state.currentUser = ADMIN;
    await app.loadAdminEvents();
    assert.doesNotMatch(element('admin-events-grid').innerHTML, /&am(?!p;)/);
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
    assert.equal(capacity(3, 0), '<div class="capacity"><span class="capacity-text">Unbegrenzt</span></div>');
    assert.match(capacity(5, 20), /^<div class="capacity"><progress class="capacity-meter" max="20" value="5" aria-label="5 von 20 Plätzen belegt"><\/progress><span class="capacity-text">5\/20<\/span><\/div>$/);
    assert.match(capacity(7, 10), /class="capacity"[^]*7\/10/);
    assert.match(capacity(8, 10), /class="capacity is-low"[^]*Noch 2 Plätze/);
    assert.match(capacity(4, 5), /class="capacity is-low"[^]*Noch 1 Platz</);
    assert.match(capacity(5, 5), /class="capacity is-full"[^]*Ausgebucht/);
    // Overbooked by an admin: the bar stays at its end
    assert.match(capacity(7, 5), /class="capacity is-full"[^]*max="5" value="5"/);
    assert.match(capacity(undefined, 4), /value="0"[^]*0\/4/);
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
    assert.match(html, /^<a class="glass-card event-card" href="#event\/ev-1">/);
    assert.match(html, /<img class="event-card-banner" src="https:\/\/example\.com\/raid\.png" alt="" loading="lazy" data-fallback="hide">/);
    assert.match(html, /event-card-category"><span>Raid<\/span>/);
    assert.match(html, /date-tile-day">15</);
    assert.match(html, /<h3 class="event-card-title">Raid: Schattenfestung<\/h3>/);
    assert.match(html, /<strong>in 5 Tagen<\/strong> · 20:00/);
    assert.match(html, /Warteliste/);
    assert.match(html, /bi-lock"><\/i>Rolle nötig/);
    assert.match(html, /2\/6/);
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
    for (const bannerUrl of ['javascript:alert(1)', 'data:image/png;base64,AAAA', '/relative.png', '']) {
        assert.doesNotMatch(app.renderEventCard({ id: 'b', title: 'B', bannerUrl, startDate: at(11, 19) }, NOW), /<img/, bannerUrl);
    }
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
