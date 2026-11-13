const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadFrontendApp, isHidden, REPO_ROOT } = require('./helpers');

const HTML = fs.readFileSync(path.join(REPO_ROOT, 'public', 'index.html'), 'utf8');
const CATEGORY_IDS = ['overview', 'discord', 'server', 'security', 'privacy'];

// Categories of the admin page "System" (#system/<category>) and the leave guard of the router

const SETTINGS = [
    { key: 'DISCORD_CLIENT_ID', group: 'discord', secret: false, value: '123456789012345678', isSet: true, source: 'db', locked: false, applies: 'live' },
    { key: 'SERVER_NAME', group: 'server', secret: false, value: 'Gilde', isSet: true, source: 'db', locked: false, applies: 'live' },
    { key: 'ADMIN_RESET_PASSWORD', group: 'security', secret: true, value: null, isSet: true, source: 'env', locked: true, applies: 'live' }
];

async function openApp(options = {}) {
    const harness = await loadFrontendApp({ '/api/admin/system/settings': { settings: SETTINGS } }, options);
    harness.state.currentUser = { id: 'a', isAdmin: true };
    return harness;
}

/** Show a route like the browser does after a hash change. */
async function go(harness, hash) {
    harness.location.hash = '#' + hash;
    await harness.app.handleRoute();
}

test('a leave guard that answers false keeps the page and restores the address', async () => {
    const harness = await openApp();
    await go(harness, 'system');
    harness.app.setLeaveGuard(() => false);
    await go(harness, 'event/abc');
    assert.equal(harness.element('system-section').style.display, 'block');
    assert.notEqual(harness.element('event-detail-section').style.display, 'block');
    assert.equal(harness.location.hash, '#system');
});

test('a leave guard that answers true lets the navigation through and is asked with the next route', async () => {
    const harness = await openApp();
    await go(harness, 'system');
    const asked = [];
    // Copied field by field: the object comes from the module realm of the harness
    harness.app.setLeaveGuard((next) => { asked.push([next.route, next.param]); return true; });
    await go(harness, 'event/abc');
    assert.deepEqual(asked, [['event', 'abc']]);
    assert.equal(harness.location.hash, '#event/abc');

    // The guard is used up: the next change is not asked again
    await go(harness, 'info');
    assert.equal(asked.length, 1);
});

test('a guard may answer later, like a confirm dialog', async () => {
    const harness = await openApp();
    await go(harness, 'system');
    harness.app.setLeaveGuard(() => Promise.resolve(false));
    await go(harness, 'info');
    assert.equal(harness.location.hash, '#system');
    assert.equal(harness.element('system-section').style.display, 'block');
});

test('setLeaveGuard(null) removes the guard', async () => {
    const harness = await openApp();
    await go(harness, 'system');
    let asked = 0;
    harness.app.setLeaveGuard(() => { asked++; return false; });
    harness.app.setLeaveGuard(null);
    await go(harness, 'info');
    assert.equal(asked, 0);
    assert.equal(harness.location.hash, '#info');
});

test('categoryOf falls back to the overview', async () => {
    const { app } = await openApp();
    assert.equal(app.categoryOf('discord'), 'discord');
    for (const param of [undefined, '', 'nope', '__proto__', 'constructor']) assert.equal(app.categoryOf(param), 'overview', String(param));
});

test('every category has a panel in index.html', () => {
    for (const id of CATEGORY_IDS) assert.match(HTML, new RegExp(`<section class="settings-panel[^"]*" id="system-panel-${id}"`), id);
    assert.match(HTML, /<nav class="settings-nav" id="system-nav" aria-label="System-Kategorien">/);
});

test('#system/server shows only the server panel and marks its entry', async () => {
    const harness = await openApp();
    await harness.app.showSystemSection('server');
    for (const id of CATEGORY_IDS) assert.equal(isHidden(harness.element(`system-panel-${id}`)), id !== 'server', id);
    const nav = harness.element('system-nav').innerHTML;
    assert.match(nav, /<a class="settings-nav-item" href="#system\/server" aria-current="page">/);
    assert.equal(nav.split('aria-current="page"').length - 1, 1);
    for (const id of CATEGORY_IDS) assert.match(nav, new RegExp(`href="#system/${id}"`), id);
    assert.match(nav, /<span class="settings-nav-label">Server<\/span>\s*<span class="settings-nav-sub">Adresse, Zeitzone<\/span>/);
});

test('#system shows the overview; an unknown category too', async () => {
    const harness = await openApp();
    for (const param of [undefined, 'gibt-es-nicht']) {
        await harness.app.showSystemSection(param);
        for (const id of CATEGORY_IDS) assert.equal(isHidden(harness.element(`system-panel-${id}`)), id !== 'overview', `${param}: ${id}`);
    }
});

test('the entries carry a hidden mark for unsaved changes', async () => {
    const harness = await openApp();
    await harness.app.showSystemSection('discord');
    const nav = harness.element('system-nav').innerHTML;
    assert.equal(nav.split('class="settings-nav-dot is-hidden"').length - 1, CATEGORY_IDS.length);
    assert.match(nav, /<span class="visually-hidden">ungespeicherte Änderungen<\/span>/);
});
