const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadFrontendApp, REPO_ROOT } = require('./helpers');

// Admin dashboard layout (3.1.0, variant A): two main actions in the header, the
// admin areas in a quiet toolbar below, compact stat tiles with a tone per status.

const STATS = {
    events: { total: 12, active: 4, draft: 1, archived: 7 },
    registrations: { total: 38, pending: 3, accepted: 29, rejected: 0, waitlisted: 4, tentative: 2 }
};

const html = fs.readFileSync(path.join(REPO_ROOT, 'public', 'index.html'), 'utf8');
const adminSection = html.slice(html.indexOf('<section id="admin-section"'), html.indexOf('id="admin-stats"'));

test('the admin header holds only the two main actions', () => {
    const header = adminSection.slice(0, adminSection.indexOf('</div>\n        </div>'));
    const actions = header.match(/data-click="[^"]+"/g);
    assert.deepEqual(actions, ['data-click="showImportDiscordEventsModal"', 'data-click="showCreateEventModal"']);
    assert.match(header, /class="btn btn-accent"[^>]*data-click="showCreateEventModal"/);
});

test('the admin areas sit in a toolbar of quiet buttons that do not wrap their labels', () => {
    const toolbar = adminSection.slice(adminSection.indexOf('<nav class="admin-toolbar"'));
    assert.match(toolbar, /<nav class="admin-toolbar" aria-label="Verwaltung">/);
    for (const target of ['href="#polls"', 'href="#members"', 'href="#insights"', 'href="#system"', 'data-click="showBotMessagesModal"', 'data-click="loadAuditLog"']) {
        assert.match(toolbar, new RegExp(`class="btn btn-ghost btn-sm" ${target}`), target);
    }
    assert.match(toolbar, /class="btn btn-danger-soft btn-sm dropdown-toggle"/);
    assert.doesNotMatch(adminSection, /btn-outline-light/);
});

test('the stats render as compact tiles with a tone per status', async () => {
    const harness = await loadFrontendApp({ '/api/admin/stats': STATS });
    await harness.app.loadAdminStats();
    const markup = harness.element('admin-stats').innerHTML;
    const tiles = [...markup.matchAll(/<div class="stat-card( is-\w+)?">[\s\S]*?<div class="stat-value">(\d+)<\/div>\s*<div class="stat-label">([^<]+)<\/div>/g)]
        .map(([, tone, value, label]) => [label, Number(value), (tone || '').trim()]);
    assert.deepEqual(tiles, [
        ['Events gesamt', 12, ''],
        ['Aktive Events', 4, ''],
        ['Registrierungen', 38, ''],
        ['Ausstehend', 3, 'is-warning'],
        ['Angenommen', 29, 'is-success'],
        ['Warteliste', 4, 'is-info'],
        ['Ersatzbank', 2, 'is-muted']
    ]);
    assert.match(markup, /<div class="stat-body">/, 'value and label share one column next to the icon');
});
