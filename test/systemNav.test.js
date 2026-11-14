const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadFrontendApp, httpAnswer, isHidden, REPO_ROOT } = require('./helpers');

const HTML = fs.readFileSync(path.join(REPO_ROOT, 'public', 'index.html'), 'utf8');
const CATEGORY_IDS = ['overview', 'discord', 'server', 'security', 'ai', 'privacy'];

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
    await go(harness, 'info/abc');
    assert.deepEqual(asked, [['info', 'abc']]);
    assert.equal(harness.location.hash, '#info/abc');
    // Answered at once: the route is shown in the same step and the history is never rewritten
    assert.equal(harness.element('info-section').style.display, 'block');
    assert.deepEqual(harness.historyCalls, []);

    // The guard is used up: the next change is not asked again
    await go(harness, 'privacy');
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

// ─── Saving per category, marks for unsaved input, leave question ───

const group = (name) => ({ dataset: { group: name } });

async function openSystem(options = {}, put = { success: true, changed: [], restartRequired: false }) {
    const harness = await loadFrontendApp({
        '/api/admin/system/settings': (request) => (request.method === 'PUT' ? put : { settings: SETTINGS }),
        '/api/privacy': { markdown: 'Alt', version: 1, updatedAt: '2026-11-01T10:00:00.000Z' }
    }, options);
    harness.state.currentUser = { id: 'a', isAdmin: true };
    harness.state.csrfToken = 'token';
    await go(harness, 'system/server');
    return harness;
}

/** Type into a field like an admin does: value plus the input action of the field. */
async function type(harness, key, value, groupName) {
    harness.element(`system-${key}`).value = value;
    await harness.app.runAction('systemFieldChanged', group(groupName));
}

async function save(harness, groupName) {
    await harness.app.runAction('saveSystemSettings', group(groupName));
    harness.element('system-reset-password').value = 'geheim';
    await harness.app.runAction('confirmSystemSave', {});
}

test('every editable category has its own save button', () => {
    for (const name of ['discord', 'server', 'security']) {
        assert.match(HTML, new RegExp(`id="system-save-${name}" data-click="saveSystemSettings" data-group="${name}"`), name);
    }
    assert.doesNotMatch(HTML, /id="system-save-bar"/);
});

test('saving the server category sends only server keys', async () => {
    const harness = await openSystem();
    await type(harness, 'SERVER_NAME', 'Neu', 'server');
    await type(harness, 'DISCORD_CLIENT_ID', '999999999999999999', 'discord');
    await save(harness, 'server');
    const put = harness.requests.find(request => request.method === 'PUT');
    assert.deepEqual(JSON.parse(put.body), { password: 'geheim', values: { SERVER_NAME: 'Neu' } });
});

test('after saving one category the typed value of another is still there and still marked', async () => {
    const harness = await openSystem();
    await type(harness, 'SERVER_NAME', 'Neu', 'server');
    await type(harness, 'DISCORD_CLIENT_ID', '999999999999999999', 'discord');
    await save(harness, 'server');
    assert.equal(harness.element('system-DISCORD_CLIENT_ID').value, '999999999999999999');
    assert.deepEqual([...harness.app.dirtyCategories()], ['discord']);
    assert.equal(isHidden(harness.element('system-panel-server')), false);
});

test('typing marks the category, restoring the loaded value clears the mark', async () => {
    const harness = await openSystem();
    await type(harness, 'SERVER_NAME', 'Neu', 'server');
    assert.deepEqual([...harness.app.dirtyCategories()], ['server']);
    assert.equal(isHidden(harness.element('system-nav-dot-server')), false);
    await type(harness, 'SERVER_NAME', 'Gilde', 'server');
    assert.deepEqual([...harness.app.dirtyCategories()], []);
    assert.equal(isHidden(harness.element('system-nav-dot-server')), true);
});

test('the privacy text marks its category while it differs from the stored one', async () => {
    const harness = await openSystem();
    harness.element('system-privacy-text').value = 'Neu';
    await harness.app.runAction('previewSystemPrivacy', {});
    assert.deepEqual([...harness.app.dirtyCategories()], ['privacy']);
    harness.element('system-privacy-text').value = 'Alt';
    await harness.app.runAction('previewSystemPrivacy', {});
    assert.deepEqual([...harness.app.dirtyCategories()], []);
});

test('a category locked by .env has a disabled save button', async () => {
    const harness = await openSystem();
    assert.equal(harness.element('system-save-security').disabled, true);
    assert.equal(harness.element('system-save-server').disabled, false);
});

test('switching the category keeps typed values, never asks and loads nothing again', async () => {
    const harness = await openSystem();
    await type(harness, 'SERVER_NAME', 'Neu', 'server');
    const loads = () => harness.requests.filter(request => request.url === '/api/admin/system/settings').length;
    const before = loads();
    await go(harness, 'system/discord');
    assert.equal(isHidden(harness.element('system-panel-discord')), false);
    assert.deepEqual(harness.historyCalls, []);
    assert.equal(harness.element('system-SERVER_NAME').value, 'Neu');
    assert.equal(harness.dialogs.length, 0);
    assert.equal(loads(), before);
    assert.deepEqual([...harness.app.dirtyCategories()], ['server']);
});

test('leaving with unsaved changes asks once; "Abbrechen" stays', async () => {
    const harness = await openSystem({ confirm: false });
    await type(harness, 'SERVER_NAME', 'Neu', 'server');
    await go(harness, 'info');
    assert.equal(harness.dialogs.length, 1);
    assert.equal(harness.dialogs[0].text, 'Ungespeicherte Änderungen verwerfen?');
    assert.equal(harness.dialogs[0].label, 'Verwerfen');
    assert.equal(harness.location.hash, '#system/server');
    assert.equal(harness.element('system-section').style.display, 'block');
    assert.equal(harness.element('system-SERVER_NAME').value, 'Neu');
});

test('confirming the question leaves and forgets the marks', async () => {
    const harness = await openSystem();
    await type(harness, 'SERVER_NAME', 'Neu', 'server');
    await go(harness, 'info');
    assert.equal(harness.dialogs.length, 1);
    assert.equal(harness.location.hash, '#info');
    // The dialog answered later: the address was put back once and the target replaces it, nothing is pushed
    assert.deepEqual(harness.historyCalls, ['replaceState #system/server', 'replace #info']);
    // The browser routes on the hash change
    assert.notEqual(harness.element('info-section').style.display, 'block');
    await harness.app.handleRoute();
    assert.deepEqual([...harness.app.dirtyCategories()], []);
    assert.equal(harness.element('info-section').style.display, 'block');
});

test('leaving without changes does not ask and leaves the history alone', async () => {
    const harness = await openSystem();
    await go(harness, 'info');
    assert.equal(harness.dialogs.length, 0);
    assert.equal(harness.location.hash, '#info');
    assert.deepEqual(harness.historyCalls, []);
    assert.equal(harness.element('info-section').style.display, 'block');
});

test('a refused save keeps input and mark', async () => {
    const harness = await openSystem({}, httpAnswer(401, { error: 'Ungültiges Admin-Reset-Passwort.' }));
    await type(harness, 'SERVER_NAME', 'Neu', 'server');
    await save(harness, 'server');
    assert.equal(harness.element('system-SERVER_NAME').value, 'Neu');
    assert.deepEqual([...harness.app.dirtyCategories()], ['server']);
});

// ─── Findings of the branch review ───

test('onRouteLeave tells a page once that another route is shown, not on its own parameter change', async () => {
    const harness = await openApp();
    await go(harness, 'info');
    let left = 0;
    harness.app.onRouteLeave(() => { left++; });
    await go(harness, 'info/abc');
    assert.equal(left, 0);
    await go(harness, 'privacy');
    assert.equal(left, 1);
    await go(harness, 'news');
    assert.equal(left, 1);
});

test('the system page is loaded again on the next visit even when its guard was replaced', async () => {
    const harness = await openSystem();
    const loads = () => harness.requests.filter(request => request.url === '/api/admin/system/settings').length;
    harness.app.setLeaveGuard(null);
    await go(harness, 'info');
    const before = loads();
    await go(harness, 'system');
    assert.equal(loads(), before + 1);
});

test('a failed settings load is tried again on the next category switch', async () => {
    let calls = 0;
    const harness = await loadFrontendApp({
        '/api/admin/system/settings': () => (++calls === 1 ? httpAnswer(500, { error: 'Kaputt' }) : { settings: SETTINGS })
    });
    harness.state.currentUser = { id: 'a', isAdmin: true };
    await go(harness, 'system');
    assert.deepEqual(harness.toasts, ['Kaputt']);
    assert.equal(harness.element('system-SERVER_NAME'), null);
    await go(harness, 'system/server');
    assert.equal(calls, 2);
    assert.equal(harness.element('system-SERVER_NAME').value, 'Gilde');
});

test('after "Verwerfen" the fields show the stored values again, also when the next load fails', async () => {
    let fail = false;
    const harness = await loadFrontendApp({
        '/api/admin/system/settings': () => (fail ? httpAnswer(500, { error: 'Kaputt' }) : { settings: SETTINGS }),
        '/api/privacy': { markdown: 'Alt', version: 1, updatedAt: '2026-11-01T10:00:00.000Z' }
    });
    harness.state.currentUser = { id: 'a', isAdmin: true };
    await go(harness, 'system/server');
    await type(harness, 'SERVER_NAME', 'Verworfen', 'server');
    harness.element('system-privacy-text').value = 'Verworfen';
    await harness.app.runAction('previewSystemPrivacy', {});
    await go(harness, 'info');
    await harness.app.handleRoute();
    fail = true;
    await go(harness, 'system/server');
    assert.equal(harness.element('system-SERVER_NAME').value, 'Gilde');
    assert.equal(harness.element('system-privacy-text').value, 'Alt');
    assert.deepEqual([...harness.app.dirtyCategories()], []);
});

test('leaving forgets a save that waited for the password', async () => {
    const harness = await openSystem();
    await type(harness, 'SERVER_NAME', 'Neu', 'server');
    await harness.app.runAction('saveSystemSettings', group('server'));
    await go(harness, 'info');
    await harness.app.handleRoute();
    harness.element('system-reset-password').value = 'geheim';
    await harness.app.runAction('confirmSystemSave', {});
    assert.equal(harness.requests.filter(request => request.method === 'PUT').length, 0);
});
