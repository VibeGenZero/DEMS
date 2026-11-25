const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadFrontendApp, httpAnswer, isHidden, REPO_ROOT } = require('./helpers');

// Category "Plugins" of the admin page "System" (public/js/admin/system-plugins.js)
const HTML = fs.readFileSync(path.join(REPO_ROOT, 'public', 'index.html'), 'utf8').replace(/\r\n/g, '\n');

/** A plugin view like GET /api/admin/plugins answers it (plugin-sdk/views.js + settingsValues). */
function view(overrides = {}) {
    return {
        id: 'event-submissions', name: 'Event einreichen', version: '1.0.0', author: 'DEMS',
        description: 'Mitglieder schlagen Events vor.', official: true,
        permissions: [{ key: 'events:draft', label: 'Events für das Team vorbereiten' }],
        status: 'off', statusText: 'Aus', lastError: '', lastErrorAt: '', limitWarning: null,
        settings: [], hasClient: true, collections: [], permissionCheck: null, settingsValues: {},
        ...overrides
    };
}

const CUSTOM = view({ id: 'hook-recorder', name: 'Hook-Rekorder', official: false, author: 'Jemand', permissions: [{ key: 'network', label: 'Verbindungen ins Internet aufbauen' }] });

async function openPlugins(plugins, routes = {}, { safeMode = false, options } = {}) {
    const harness = await loadFrontendApp({
        '/api/admin/plugins': { safeMode, plugins },
        '/api/admin/channels': [{ id: 'c1', name: 'vorschlaege', type: 'text' }, { id: 'v1', name: 'Sprache', type: 'voice' }],
        '/api/admin/roles': [{ id: 'r1', name: 'Raider' }],
        ...routes
    }, options);
    harness.state.currentUser = { id: 'a', isAdmin: true };
    await harness.app.loadPluginsPanel();
    return harness;
}

const putsTo = (requests, url) => requests.filter(request => request.url === url && request.method === 'PUT');

test('the category Plugins sits after KI, has its panel, the privacy hint and the trust dialog', async () => {
    const harness = await loadFrontendApp({
        '/api/admin/plugins': { safeMode: false, plugins: [view()] },
        '/api/admin/system/settings': { settings: [] }
    });
    harness.state.currentUser = { id: 'a', isAdmin: true };
    await harness.app.showSystemSection('plugins');
    const nav = harness.element('system-nav').innerHTML;
    assert.ok(nav.indexOf('href="#system/ai"') < nav.indexOf('href="#system/plugins"'));
    assert.ok(nav.indexOf('href="#system/plugins"') < nav.indexOf('href="#system/privacy"'));
    assert.match(nav, /bi-puzzle[\s\S]*<span class="settings-nav-label">Plugins<\/span>\s*<span class="settings-nav-sub">Erweiterungen ein- und ausschalten<\/span>/);
    assert.equal(isHidden(harness.element('system-panel-plugins')), false);
    assert.match(harness.element('plugins-list').innerHTML, /Event einreichen/);
    assert.match(HTML, /id="plugins-privacy-hint"[^>]*>Plugins können Daten von Mitgliedern speichern\. Erwähne eingeschaltete Plugins in deiner Datenschutzerklärung\.</);
    assert.match(HTML, /Nicht offizielles Plugin einschalten\?/);
    assert.match(HTML, /<span id="plugin-trust-name"><\/span> stammt nicht aus dem DEMS-Projekt\. Es läuft mit vollem Zugriff auf DEMS,\s+den Discord-Bot und die Datenbank, und im Browser jedes angemeldeten Mitglieds mit dessen\s+Rechten — bei Admins also mit Admin-Rechten\. Die Berechtigungen unten zeigen, was es nutzen\s+möchte, verhindern aber nichts\. Schalte es nur ein, wenn du dem Code vertraust\./);
    assert.match(HTML, /Ich vertraue dem Code dieses Plugins/);
    assert.match(HTML, /id="plugin-trust-confirm"[^>]*data-click="confirmPluginTrust"[^>]* disabled>/);
});

test('an official card shows its facts and switches on with one PUT without a password', async () => {
    const on = view({ status: 'on', statusText: 'An' });
    const { app, element, requests, toasts } = await openPlugins([view()], { '/api/admin/plugins/event-submissions/enabled': { plugin: on } });
    const card = element('plugins-list').innerHTML;
    assert.match(card, /<i class="bi bi-patch-check[^"]*"[^>]*><\/i>Offiziell/);
    assert.doesNotMatch(card, /Nicht offiziell/);
    assert.match(card, /1\.0\.0/);
    assert.match(card, /DEMS/);
    assert.match(card, /Mitglieder schlagen Events vor\./);
    assert.match(card, /<li>[^<]*<i[^>]*><\/i>Events für das Team vorbereiten<\/li>/);
    assert.match(card, /<span class="chip chip-sm">Aus<\/span>/);
    assert.match(card, /data-change="togglePlugin" data-plugin-id="event-submissions"/);
    await app.runAction('togglePlugin', { checked: true, dataset: { pluginId: 'event-submissions' } });
    const puts = putsTo(requests, '/api/admin/plugins/event-submissions/enabled');
    assert.equal(puts.length, 1);
    assert.deepEqual(JSON.parse(puts[0].body), { enabled: true });
    assert.ok(puts[0].headers['X-CSRF-TOKEN'] !== undefined);
    assert.deepEqual(toasts, ['Plugin „Event einreichen“ eingeschaltet.']);
    assert.match(element('plugin-slot-0').innerHTML, /<span class="chip chip-sm chip-success">An<\/span>/);
    assert.match(element('plugin-slot-0').innerHTML, / checked/);
});

test('switching off toasts „ausgeschaltet“; a server error toasts its message and keeps the card', async () => {
    const ok = await openPlugins([view({ status: 'on', statusText: 'An' })], { '/api/admin/plugins/event-submissions/enabled': { plugin: view() } });
    await ok.app.runAction('togglePlugin', { checked: false, dataset: { pluginId: 'event-submissions' } });
    assert.deepEqual(JSON.parse(putsTo(ok.requests, '/api/admin/plugins/event-submissions/enabled')[0].body), { enabled: false });
    assert.deepEqual(ok.toasts, ['Plugin „Event einreichen“ ausgeschaltet.']);
    const bad = await openPlugins([view()], { '/api/admin/plugins/event-submissions/enabled': httpAnswer(409, { error: 'Geht gerade nicht.' }) });
    await bad.app.runAction('togglePlugin', { checked: true, dataset: { pluginId: 'event-submissions' } });
    assert.deepEqual(bad.toasts, ['Geht gerade nicht.']);
    assert.match(bad.element('plugin-slot-0').innerHTML, /chip chip-sm">Aus</);
});

test('a custom plugin opens the trust dialog; confirming sends trust and the password', async () => {
    const on = { ...CUSTOM, status: 'on', statusText: 'An' };
    const { app, element, requests, toasts } = await openPlugins([CUSTOM], { '/api/admin/plugins/hook-recorder/enabled': { plugin: on } });
    assert.match(element('plugins-list').innerHTML, /<span class="chip chip-sm chip-warning"><i class="bi bi-exclamation-triangle[^"]*"[^>]*><\/i>Nicht offiziell<\/span>/);
    const sw = { checked: true, dataset: { pluginId: 'hook-recorder' } };
    await app.runAction('togglePlugin', sw);
    assert.equal(putsTo(requests, '/api/admin/plugins/hook-recorder/enabled').length, 0);
    assert.equal(sw.checked, false);
    assert.equal(element('plugin-trust-name').textContent, '„Hook-Rekorder“');
    assert.match(element('plugin-trust-permissions').innerHTML, /Verbindungen ins Internet aufbauen/);
    const confirm = element('plugin-trust-confirm');
    assert.equal(confirm.disabled, true);
    element('plugin-trust-check').checked = true;
    await app.runAction('pluginTrustInput', element('plugin-trust-check'));
    assert.equal(confirm.disabled, true);
    element('plugin-trust-password').value = 'geheim-genug';
    await app.runAction('pluginTrustInput', element('plugin-trust-password'));
    assert.equal(confirm.disabled, false);
    await app.runAction('confirmPluginTrust', confirm);
    const puts = putsTo(requests, '/api/admin/plugins/hook-recorder/enabled');
    assert.equal(puts.length, 1);
    assert.deepEqual(JSON.parse(puts[0].body), { enabled: true, trust: true, password: 'geheim-genug' });
    assert.equal(element('plugin-trust-password').value, '');
    assert.deepEqual(toasts, ['Plugin „Hook-Rekorder“ eingeschaltet.']);
});

test('a wrong password keeps the trust dialog, the switch stays off', async () => {
    const { app, element, toasts } = await openPlugins([CUSTOM], { '/api/admin/plugins/hook-recorder/enabled': httpAnswer(401, { error: 'Ungültiges Admin-Reset-Passwort.' }) });
    await app.runAction('togglePlugin', { checked: true, dataset: { pluginId: 'hook-recorder' } });
    element('plugin-trust-check').checked = true;
    element('plugin-trust-password').value = 'falsch';
    await app.runAction('pluginTrustInput', element('plugin-trust-password'));
    await app.runAction('confirmPluginTrust', element('plugin-trust-confirm'));
    assert.deepEqual(toasts, ['Ungültiges Admin-Reset-Passwort.']);
    assert.equal(element('plugin-trust-confirm').disabled, true);
    assert.doesNotMatch(element('plugin-slot-0').innerHTML, / checked/);
});

test('hostile plugin texts are escaped', async () => {
    const hostile = '<img src=x onerror=1>';
    const { element } = await openPlugins([view({ name: hostile, author: hostile, description: hostile, version: hostile, lastError: hostile, status: 'on', statusText: 'An' })]);
    const card = element('plugins-list').innerHTML;
    assert.doesNotMatch(card, /<img/);
    assert.match(card, /&lt;img src=x onerror=1&gt;/);
});

test('an error status shows „Fehler: …“, a returned error view toasts a warning', async () => {
    const failed = view({ status: 'error', statusText: 'Fehler: register brach ab', lastError: 'register brach ab' });
    const { app, element, toasts } = await openPlugins([view()], { '/api/admin/plugins/event-submissions/enabled': { plugin: failed } });
    await app.runAction('togglePlugin', { checked: true, dataset: { pluginId: 'event-submissions' } });
    assert.match(element('plugin-slot-0').innerHTML, /<span class="chip chip-sm chip-danger">Fehler: register brach ab<\/span>/);
    assert.deepEqual(toasts, ['Plugin „Event einreichen“ konnte nicht gestartet werden: register brach ab']);
});

test('a runtime error and the message limit show as warning lines on a running plugin', async () => {
    const { element } = await openPlugins([view({ status: 'on', statusText: 'An', lastError: 'Hook kaputt', lastErrorAt: '2026-11-19T10:00:00.000Z', limitWarning: 'Nachrichtengrenze erreicht (bis 11:00)' })]);
    const card = element('plugins-list').innerHTML;
    assert.match(card, /Hook kaputt/);
    assert.match(card, /Nachrichtengrenze erreicht \(bis 11:00\)/);
});

test('„Daten löschen“ is hidden while on, asks with the plugin name and sends DELETE', async () => {
    const running = await openPlugins([view({ status: 'on', statusText: 'An' })]);
    assert.doesNotMatch(running.element('plugins-list').innerHTML, /deletePluginData/);
    const { app, element, dialogs, requests, toasts } = await openPlugins([view()], { '/api/admin/plugins/event-submissions/data': { deleted: 3 } });
    assert.match(element('plugins-list').innerHTML, /data-click="deletePluginData" data-plugin-id="event-submissions"/);
    await app.runAction('deletePluginData', { dataset: { pluginId: 'event-submissions' } });
    assert.equal(dialogs.length, 1);
    assert.match(dialogs[0].text, /„Event einreichen“/);
    assert.equal(dialogs[0].danger, true);
    assert.equal(requests.filter(request => request.url === '/api/admin/plugins/event-submissions/data' && request.method === 'DELETE').length, 1);
    assert.deepEqual(toasts, ['Daten von Plugin „Event einreichen“ gelöscht.']);
});

test('a dismissed delete dialog sends nothing', async () => {
    const { app, requests } = await openPlugins([view()], {}, { options: { confirm: false } });
    await app.runAction('deletePluginData', { dataset: { pluginId: 'event-submissions' } });
    assert.equal(requests.some(request => request.method === 'DELETE'), false);
});

test('an orphaned plugin has no switch and no settings, but „Daten löschen“', async () => {
    const orphan = view({ id: 'weg', name: 'weg', version: '', author: '', description: '', official: false, permissions: [], status: 'orphaned', statusText: 'Verwaist' });
    const card = (await openPlugins([orphan])).element('plugins-list').innerHTML;
    assert.doesNotMatch(card, /togglePlugin/);
    assert.match(card, /Verwaist/);
    assert.match(card, /deletePluginData/);
});

test('safe mode disables every switch and says so', async () => {
    const safe = (overrides) => view({ status: 'safe', statusText: 'Abgesicherter Modus aktiv', ...overrides });
    const { element } = await openPlugins([safe(), safe({ ...CUSTOM, status: 'safe', statusText: 'Abgesicherter Modus aktiv' })], {}, { safeMode: true });
    const list = element('plugins-list').innerHTML;
    assert.match(list, /Abgesicherter Modus aktiv/);
    const switches = [...list.matchAll(/<input[^>]*data-change="togglePlugin"[^>]*>/g)].map(match => match[0]);
    assert.equal(switches.length, 2);
    for (const input of switches) assert.match(input, / disabled/);
});

test('safe mode enables only the off switch of a plugin that is stored on', async () => {
    const safe = (overrides) => view({ status: 'safe', statusText: 'Abgesicherter Modus aktiv', ...overrides });
    const { element } = await openPlugins([safe({ enabled: true }), safe({ ...CUSTOM, status: 'safe', statusText: 'Abgesicherter Modus aktiv', enabled: false })], {}, { safeMode: true });
    const list = element('plugins-list').innerHTML;
    const switches = [...list.matchAll(/<input[^>]*data-change="togglePlugin"[^>]*>/g)].map(match => match[0]);
    assert.equal(switches.length, 2);
    assert.doesNotMatch(switches[0], / disabled/);
    assert.match(switches[0], / checked/);
    assert.match(switches[1], / disabled/);
    assert.doesNotMatch(switches[1], / checked/);
});

test('settings render from the manifest and save only changed keys with their types', async () => {
    const settings = [
        { key: 'title', type: 'text', label: 'Titel', help: 'Kurz.', required: false },
        { key: 'max', type: 'number', label: 'Höchstens', help: '', required: false },
        { key: 'open', type: 'boolean', label: 'Offen', help: '', required: false },
        { key: 'channel', type: 'channel', label: 'Kanal', help: '', required: false },
        { key: 'role', type: 'role', label: 'Rolle', help: '', required: false },
        { key: 'mode', type: 'select', label: 'Modus', help: '', required: false, options: ['a', { value: 'b', label: 'B <fett>' }] },
        { key: 'token', type: 'secret', label: 'Token', help: '', required: false }
    ];
    const stored = { title: 'Alt', max: 3, open: false, channel: 'c1', mode: 'a', token: { set: true } };
    const plugin = view({ status: 'on', statusText: 'An', settings, settingsValues: stored });
    const saved = { title: '', max: 5, open: true, channel: 'c1', mode: 'a', token: { set: true } };
    const { app, element, requests, toasts } = await openPlugins([plugin], { '/api/admin/plugins/event-submissions/settings': { settings: saved } });
    const card = element('plugins-list').innerHTML;
    assert.match(card, /data-group="plugin:event-submissions"/);
    assert.match(card, /<option value="c1">#vorschlaege<\/option>/);
    assert.doesNotMatch(card, /Sprache/);
    assert.match(card, /<option value="r1">Raider<\/option>/);
    assert.match(card, /<option value="">Keine Auswahl<\/option>/);
    assert.match(card, /B &lt;fett&gt;/);
    assert.match(card, /type="password"/);
    assert.match(card, /chip-success">gesetzt</);
    const field = (key) => element(`plugin-event-submissions-setting-${key}`);
    assert.equal(field('title').value, 'Alt');
    assert.equal(field('max').value, '3');
    assert.equal(field('channel').value, 'c1');
    field('title').value = '';
    field('max').value = '5';
    field('open').checked = true;
    await app.runAction('savePluginSettings', { dataset: { pluginId: 'event-submissions' } });
    const put = putsTo(requests, '/api/admin/plugins/event-submissions/settings')[0];
    assert.deepEqual(JSON.parse(put.body), { values: { title: '', max: 5, open: true } });
    assert.deepEqual(toasts, ['Einstellungen von „Event einreichen“ gespeichert.']);
    assert.equal(field('max').value, '5');
});

test('a typed secret needs the reset password of the card', async () => {
    const settings = [{ key: 'token', type: 'secret', label: 'Token', help: '', required: false }];
    const plugin = view({ settings, settingsValues: { token: { set: false } } });
    const { app, element, requests, toasts } = await openPlugins([plugin], { '/api/admin/plugins/event-submissions/settings': { settings: { token: { set: true } } } });
    assert.match(element('plugins-list').innerHTML, />nicht gesetzt</);
    element('plugin-event-submissions-setting-token').value = 'abc';
    await app.runAction('savePluginSettings', { dataset: { pluginId: 'event-submissions' } });
    assert.equal(putsTo(requests, '/api/admin/plugins/event-submissions/settings').length, 0);
    assert.equal(toasts.length, 1);
    element('plugin-event-submissions-password').value = 'reset-pw';
    await app.runAction('savePluginSettings', { dataset: { pluginId: 'event-submissions' } });
    const put = putsTo(requests, '/api/admin/plugins/event-submissions/settings')[0];
    assert.deepEqual(JSON.parse(put.body), { values: { token: 'abc' }, password: 'reset-pw' });
    assert.match(element('plugin-slot-0').innerHTML, /chip-success">gesetzt</);
});

test('saving without a change sends nothing', async () => {
    const settings = [{ key: 'title', type: 'text', label: 'Titel', help: '', required: false }];
    const { app, requests, toasts } = await openPlugins([view({ settings, settingsValues: { title: 'x' } })]);
    await app.runAction('savePluginSettings', { dataset: { pluginId: 'event-submissions' } });
    assert.equal(putsTo(requests, '/api/admin/plugins/event-submissions/settings').length, 0);
    assert.deepEqual(toasts, ['Keine Änderungen zum Speichern.']);
});

test('a custom duplicate of an official id is shown read-only', async () => {
    const duplicate = view({ official: false, status: 'invalid', statusText: 'Ungültig: Die ID gehört einem offiziellen Plugin.', permissions: [], description: '', version: '' });
    const list = (await openPlugins([view(), duplicate])).element('plugins-list').innerHTML;
    assert.equal([...list.matchAll(/data-change="togglePlugin"/g)].length, 1);
    assert.equal([...list.matchAll(/data-click="deletePluginData"/g)].length, 1);
    assert.match(list, /chip-danger">Ungültig: Die ID gehört einem offiziellen Plugin\.</);
});

test('a failed load shows the message in the list', async () => {
    const { element } = await openPlugins([], { '/api/admin/plugins': httpAnswer(500, { error: 'Plugins konnten nicht geladen werden.' }) });
    assert.match(element('plugins-list').innerHTML, /Plugins konnten nicht geladen werden\./);
});
