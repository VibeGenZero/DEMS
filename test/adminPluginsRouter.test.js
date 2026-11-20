// Admin API of the plugins in-process: a real host over temp plugin folders
// (an official plugin needs the official folder, which the server fixes to
// <app>/plugins), the router mounted in a tiny express app.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { createTempDir } = require('./helpers');

// Own, empty SQLite database; the empty cwd keeps a local .env out
const tmpDir = createTempDir('admin-plugins');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
delete process.env.DEV_MOCK;
process.env.SQLITE_PATH = path.join(tmpDir, 'admin-plugins.sqlite');
const PASSWORD = 'richtig-geheim';
process.env.ADMIN_RESET_PASSWORD = PASSWORD;

const { db, collection, getDocs } = require('../firebaseAdmin');
const { createPluginHost } = require('../plugin-sdk/host');
const { writeState } = require('../plugin-sdk/state');
const { createAdminPluginsRouter } = require('../routes/adminPlugins');
const bot = require('../bot');

const ADMIN = { id: '900000000000000001', username: 'chef', isAdmin: true, roles: [] };
const SECRET_VALUE = 'sk-sehr-geheim-1234';

/** Write one plugin folder with a register that stores a document. */
function writePlugin(root, id, manifest = {}, body = `await ctx.data.add('items', { userId: '1', note: 'x' });`) {
    const dir = path.join(root, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'server.js'), `module.exports = { async register(ctx) { ${body} } };`);
    fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({
        id, name: `Plugin ${id}`, version: '1.0.0', sdk: 1, author: 'Test', description: 'Test-Plugin',
        server: 'server.js', ...manifest
    }));
}

const SETTINGS = [
    { key: 'mode', type: 'select', label: 'Modus', options: ['leise', 'laut'] },
    { key: 'token', type: 'secret', label: 'Token' },
    { key: 'limit', type: 'number', label: 'Grenze' }
];

let host;
let safeHost;
let current;
let baseUrl;
let listener;

before(async () => {
    const root = createTempDir('admin-plugins-dirs');
    const officialDir = path.join(root, 'official');
    const customDir = path.join(root, 'custom');
    writePlugin(officialDir, 'offi', { settings: SETTINGS });
    writePlugin(customDir, 'cust');
    writePlugin(customDir, 'broken', {}, "throw new Error('kaputt');");
    host = createPluginHost({ officialDir, customDir });
    await host.start();
    safeHost = createPluginHost({ officialDir, customDir, safeMode: true });
    await safeHost.start();

    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        req.session = { user: ADMIN };
        next();
    });
    app.use('/api/admin', createAdminPluginsRouter(() => current));
    await new Promise(resolve => {
        listener = app.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${listener.address().port}`;
});

after(async () => {
    await new Promise(resolve => listener.close(resolve));
    await bot.client.destroy();
});

beforeEach(() => {
    current = host;
    process.env.ADMIN_RESET_PASSWORD = PASSWORD;
});

function call(pathname, method = 'GET', body) {
    return fetch(baseUrl + pathname, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
}

async function auditOf(action) {
    const snapshot = await getDocs(collection(db, 'auditLogs'));
    return snapshot.docs.map(entry => entry.data()).filter(entry => entry.action === action);
}

const setEnabled = (id, body) => call(`/api/admin/plugins/${id}/enabled`, 'PUT', body);
const saveSettings = (id, body) => call(`/api/admin/plugins/${id}/settings`, 'PUT', body);

test('an official plugin switches on and off at once, both audited', async () => {
    const on = await setEnabled('offi', { enabled: true });
    assert.equal(on.status, 200);
    const { plugin } = await on.json();
    assert.equal(plugin.id, 'offi');
    assert.equal(plugin.official, true);
    assert.equal(plugin.status, 'on');
    assert.equal(host.isEnabled('offi'), true);

    const off = await setEnabled('offi', { enabled: false });
    assert.equal(off.status, 200);
    assert.equal((await off.json()).plugin.status, 'off');

    assert.deepEqual((await auditOf('PLUGIN_ENABLE')).filter(entry => entry.targetId === 'offi')
        .map(({ adminId, details }) => ({ adminId, details })), [{ adminId: ADMIN.id, details: 'Plugin „Plugin offi“ eingeschaltet' }]);
    assert.deepEqual((await auditOf('PLUGIN_DISABLE')).filter(entry => entry.targetId === 'offi')
        .map(({ adminId, details }) => ({ adminId, details })), [{ adminId: ADMIN.id, details: 'Plugin „Plugin offi“ ausgeschaltet' }]);
});

test('switching on a custom plugin needs trust and the right password', async () => {
    const untrusted = await setEnabled('cust', { enabled: true, trust: 'true', password: PASSWORD });
    assert.equal(untrusted.status, 400);
    assert.deepEqual(await untrusted.json(), { error: 'Bitte bestätige, dass du dem Code dieses Plugins vertraust.' });

    const wrong = await setEnabled('cust', { enabled: true, trust: true, password: 'falsch' });
    assert.equal(wrong.status, 401);
    assert.deepEqual(await wrong.json(), { error: 'Ungültiges Admin-Reset-Passwort.' });
    assert.equal(host.isEnabled('cust'), false);

    const res = await setEnabled('cust', { enabled: true, trust: true, password: PASSWORD });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).plugin.status, 'on');
    assert.equal((await setEnabled('cust', { enabled: false })).status, 200);
});

test('without ADMIN_RESET_PASSWORD every password is wrong', async () => {
    delete process.env.ADMIN_RESET_PASSWORD;
    for (const password of [undefined, '', 'undefined']) {
        const res = await setEnabled('cust', { enabled: true, trust: true, password });
        assert.equal(res.status, 401);
    }
    const secret = await saveSettings('offi', { values: { token: 'x' }, password: '' });
    assert.equal(secret.status, 401);
    assert.equal(host.isEnabled('cust'), false);
});

test('a failed register still answers 200 with the error status', async (t) => {
    const errors = t.mock.method(console, 'error', () => {});
    const res = await setEnabled('broken', { enabled: true, trust: true, password: PASSWORD });
    assert.equal(res.status, 200);
    assert.match(String(errors.mock.calls[0].arguments[0]), /\[plugin:broken\] register failed: kaputt/);
    const { plugin } = await res.json();
    assert.equal(plugin.status, 'error');
    assert.equal(plugin.statusText, 'Fehler: kaputt');
});

test('a bad body answers 400, an unknown plugin 404', async () => {
    for (const body of [{}, { enabled: 'true' }, { enabled: 1 }, { enabled: null }]) {
        const res = await setEnabled('offi', body);
        assert.equal(res.status, 400);
        assert.deepEqual(await res.json(), { error: 'Ungültige Eingabe.' });
    }
    for (const body of [{}, { values: null }, { values: [] }, { values: 'x' }]) {
        const res = await saveSettings('offi', body);
        assert.equal(res.status, 400);
        assert.deepEqual(await res.json(), { error: 'Ungültige Eingabe.' });
    }
    for (const res of [
        await setEnabled('nope', { enabled: true }),
        await saveSettings('nope', { values: {} }),
        await call('/api/admin/plugins/nope/data', 'DELETE')
    ]) {
        assert.equal(res.status, 404);
        assert.deepEqual(await res.json(), { error: 'Plugin nicht gefunden.' });
    }
});

test('settings: validation answers 400, a secret needs the password and never comes back', async () => {
    const bad = await saveSettings('offi', { values: { mode: 'brüllend' } });
    assert.equal(bad.status, 400);
    assert.deepEqual(await bad.json(), { error: '„Modus“: Dieser Wert steht nicht zur Auswahl.' });

    for (const token of [SECRET_VALUE, '', null]) {
        const refused = await saveSettings('offi', { values: { token } });
        assert.equal(refused.status, 401);
        assert.deepEqual(await refused.json(), { error: 'Ungültiges Admin-Reset-Passwort.' });
    }

    const plain = await saveSettings('offi', { values: { mode: 'laut', limit: 3 } });
    assert.equal(plain.status, 200);
    assert.deepEqual(await plain.json(), { settings: { mode: 'laut', token: { set: false }, limit: 3 } });

    const secret = await saveSettings('offi', { values: { token: SECRET_VALUE }, password: PASSWORD });
    assert.equal(secret.status, 200);
    const secretText = await secret.text();
    assert.doesNotMatch(secretText, new RegExp(SECRET_VALUE));
    assert.deepEqual(JSON.parse(secretText), { settings: { mode: 'laut', token: { set: true }, limit: 3 } });

    const list = await call('/api/admin/plugins');
    assert.equal(list.status, 200);
    const listText = await list.text();
    assert.doesNotMatch(listText, new RegExp(SECRET_VALUE));
    const offi = JSON.parse(listText).plugins.find(plugin => plugin.id === 'offi');
    assert.deepEqual(offi.settingsValues, { mode: 'laut', token: { set: true }, limit: 3 });

    const audit = await auditOf('PLUGIN_SETTINGS');
    assert.equal(audit.length, 2);
    for (const entry of audit) {
        assert.equal(entry.details, 'Einstellungen von Plugin „Plugin offi“ gespeichert');
        assert.equal(entry.targetId, 'offi');
    }
    const auditText = JSON.stringify(await getDocs(collection(db, 'auditLogs')).then(snap => snap.docs.map(entry => entry.data())));
    assert.doesNotMatch(auditText, new RegExp(SECRET_VALUE));
});

test('GET lists safe mode, every plugin and its public values', async () => {
    const res = await call('/api/admin/plugins');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.safeMode, false);
    assert.deepEqual(body.plugins.map(plugin => plugin.id), ['offi', 'broken', 'cust']);
    assert.deepEqual(body.plugins.find(plugin => plugin.id === 'cust').settingsValues, {});

    current = safeHost;
    const safe = await (await call('/api/admin/plugins')).json();
    assert.equal(safe.safeMode, true);
    const refused = await setEnabled('offi', { enabled: true });
    assert.equal(refused.status, 409);
    assert.deepEqual(await refused.json(), { error: 'Abgesicherter Modus aktiv – Plugins lassen sich nicht einschalten.' });
});

test('safe mode: switching off answers 200 and is audited, switching on 409', async () => {
    const root = createTempDir('admin-plugins-safe');
    const officialDir = path.join(root, 'official');
    writePlugin(officialDir, 'safe-on');
    await writeState('safe-on', { enabled: true });
    current = createPluginHost({ officialDir, customDir: path.join(root, 'custom'), safeMode: true });
    await current.start();

    const listed = (await (await call('/api/admin/plugins')).json()).plugins.find(plugin => plugin.id === 'safe-on');
    assert.equal(listed.enabled, true);

    const off = await setEnabled('safe-on', { enabled: false });
    assert.equal(off.status, 200);
    const { plugin } = await off.json();
    assert.equal(plugin.enabled, false);
    assert.equal(plugin.status, 'safe');
    assert.deepEqual((await auditOf('PLUGIN_DISABLE')).filter(entry => entry.targetId === 'safe-on')
        .map(({ adminId, details }) => ({ adminId, details })), [{ adminId: ADMIN.id, details: 'Plugin „Plugin safe-on“ ausgeschaltet' }]);
    // register would have stored a document
    assert.equal((await getDocs(collection(db, 'plugin:safe-on:items'))).docs.length, 0);

    const on = await setEnabled('safe-on', { enabled: true });
    assert.equal(on.status, 409);
    assert.deepEqual(await on.json(), { error: 'Abgesicherter Modus aktiv – Plugins lassen sich nicht einschalten.' });
});

test('plugin data is deleted only while the plugin is off', async () => {
    assert.equal((await setEnabled('offi', { enabled: true })).status, 200);
    const refused = await call('/api/admin/plugins/offi/data', 'DELETE');
    assert.equal(refused.status, 409);
    assert.deepEqual(await refused.json(), { error: 'Schalte das Plugin zuerst aus.' });

    assert.equal((await setEnabled('offi', { enabled: false })).status, 200);
    const res = await call('/api/admin/plugins/offi/data', 'DELETE');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { deleted: 1 });
    assert.equal((await getDocs(collection(db, 'plugin:offi:items'))).docs.length, 0);
    assert.deepEqual(await host.readPublicSettings('offi'), { token: { set: false } });

    const [entry] = await auditOf('PLUGIN_DELETE_DATA');
    assert.equal(entry.details, 'Daten von Plugin „Plugin offi“ gelöscht');
    assert.equal(entry.targetId, 'offi');
});

test('a failed plugin wipe fails the system reset with 500', async (t) => {
    // The reset route of routes/admin.js in its own app; the host only fails the wipe
    const pluginSdk = require('../plugin-sdk');
    t.mock.method(pluginSdk, 'pluginHost', () => ({ wipeAllData: () => Promise.reject(new Error('Datenbank weg')) }));
    const errors = t.mock.method(console, 'error', () => {});
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        req.session = { user: ADMIN };
        next();
    });
    app.use('/api/admin', require('../routes/admin'));
    const resetListener = await new Promise(resolve => {
        const server = app.listen(0, '127.0.0.1', () => resolve(server));
    });
    t.after(() => new Promise(resolve => resetListener.close(resolve)));

    const res = await fetch(`http://127.0.0.1:${resetListener.address().port}/api/admin/reset`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: PASSWORD, targets: ['pluginData'] })
    });
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: 'System-Reset fehlgeschlagen.' });
    assert.ok(errors.mock.calls.some(call => String(call.arguments[0]).startsWith('System reset error')));
});
