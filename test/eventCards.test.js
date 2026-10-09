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
