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
const { writeZip } = require('../plugin-sdk/zip');
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
let customDir;
let uploadOn = true;

before(async () => {
    const root = createTempDir('admin-plugins-dirs');
    const officialDir = path.join(root, 'official');
    customDir = path.join(root, 'custom');
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
        // The upload store and the check limit are per session
        req.sessionID = req.get('x-test-session') || 'default';
        next();
    });
    app.use('/api/admin', createAdminPluginsRouter(() => current, { uploadEnabled: () => uploadOn }));
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
    uploadOn = true;
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

// ── Upload, install and remove (.dems packages) ─────────────────────────

const UPLOAD_OFF = 'Das Hochladen von Plugins ist ausgeschaltet (PLUGINS_UPLOAD).';
const SAFE_UPLOAD = 'Im abgesicherten Modus können keine Plugins hochgeladen werden.';
const SWITCH_OFF_FIRST = 'Schalte das Plugin zuerst aus.';

function zipOf(files) {
    return writeZip(Object.entries(files).map(([name, text]) => ({ name, data: Buffer.from(text) })));
}

/** A valid package of plugin `id`; `files` adds or replaces entries. */
function packageOf(id, version = '1.0.0', files = {}) {
    return zipOf({
        'plugin.json': JSON.stringify({
            id, name: `Upload ${id}`, version, sdk: 1, author: 'Test', description: 'Hochgeladen', server: 'server.js'
        }),
        'server.js': 'module.exports = { async register() {} };',
        ...files
    });
}

/** Mark the central directory entry `name` as a symlink (unix mode 0120777). */
function withSymlinkAttr(zip, name) {
    const buf = Buffer.from(zip);
    let pos = 0;
    while ((pos = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), pos)) >= 0) {
        const len = buf.readUInt16LE(pos + 28);
        if (buf.subarray(pos + 46, pos + 46 + len).toString() === name) buf.writeUInt32LE((0o120777 << 16) >>> 0, pos + 38);
        pos += 4;
    }
    return buf;
}

function checkUpload(body, session = 'default', contentType = 'application/octet-stream') {
    return fetch(`${baseUrl}/api/admin/plugins/upload/check`, {
        method: 'POST',
        headers: { 'Content-Type': contentType, 'X-Test-Session': session },
        body
    });
}

function install(body, session = 'default') {
    return fetch(`${baseUrl}/api/admin/plugins/upload/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Test-Session': session },
        body: JSON.stringify(body)
    });
}

const removePlugin = (id, body) => call(`/api/admin/plugins/${id}`, 'DELETE', body);

async function uploadIdOf(buffer, session) {
    const res = await checkUpload(buffer, session);
    assert.equal(res.status, 200);
    const { uploadId } = await res.json();
    assert.match(uploadId, /^[0-9a-f]{32}$/);
    return uploadId;
}

const installedVersion = id => JSON.parse(fs.readFileSync(path.join(customDir, id, 'plugin.json'), 'utf8')).version;

test('with PLUGINS_UPLOAD off upload, install and remove answer 403 and GET says so', async () => {
    uploadOn = false;
    for (const res of [
        await checkUpload(packageOf('upl-off')),
        await install({ uploadId: 'x', password: PASSWORD, replace: false }),
        await removePlugin('cust', { password: PASSWORD })
    ]) {
        assert.equal(res.status, 403);
        assert.deepEqual(await res.json(), { error: UPLOAD_OFF });
    }
    assert.equal((await (await call('/api/admin/plugins')).json()).uploadEnabled, false);
    assert.equal(fs.existsSync(path.join(customDir, 'cust')), true);

    uploadOn = true;
    assert.equal((await (await call('/api/admin/plugins')).json()).uploadEnabled, true);
});

test('safe mode refuses check and install with 409', async () => {
    current = safeHost;
    for (const res of [
        await checkUpload(packageOf('upl-safe')),
        await install({ uploadId: 'x', password: PASSWORD, replace: false })
    ]) {
        assert.equal(res.status, 409);
        assert.deepEqual(await res.json(), { error: SAFE_UPLOAD });
    }
});

test('checking a valid package returns the report with labels and an uploadId, and writes nothing', async () => {
    const res = await checkUpload(packageOf('upl-scan', '1.0.0', {
        'server.js': "module.exports = { register(ctx) { ctx.discord.addRole('1', '2'); } };"
    }), 'scan');
    assert.equal(res.status, 200);
    const { uploadId, report } = await res.json();
    assert.match(uploadId, /^[0-9a-f]{32}$/);
    assert.equal(report.ok, true);
    assert.deepEqual(report.errors, []);
    assert.equal(report.manifest.id, 'upl-scan');
    assert.equal(report.manifest.version, '1.0.0');
    assert.equal(report.fileCount, 2);
    const roles = { key: 'discord:roles', label: 'Discord-Rollen vergeben und entziehen' };
    assert.deepEqual(report.permissions, [roles]);
    assert.deepEqual(report.missing, [roles]);
    assert.deepEqual(report.unused, []);
    assert.equal(report.replaces, null);
    assert.equal(fs.existsSync(path.join(customDir, 'upl-scan')), false);
});

test('a package with a ../ path, a symlink or an HTML file is refused by name without an uploadId', async () => {
    for (const [buffer, name] of [
        [packageOf('upl-bad', '1.0.0', { '../x.js': 'x' }), '../x.js'],
        [withSymlinkAttr(packageOf('upl-bad', '1.0.0', { 'link.js': 'target' }), 'link.js'), 'link.js'],
        [packageOf('upl-bad', '1.0.0', { 'index.html': '<p>x</p>' }), 'index.html']
    ]) {
        const res = await checkUpload(buffer, 'bad');
        assert.equal(res.status, 200);
        const { uploadId, report } = await res.json();
        assert.equal(uploadId, null);
        assert.equal(report.ok, false);
        assert.ok(report.errors.some(error => error.includes(name)), `${name}: ${report.errors.join(' | ')}`);
    }
});

test('a body over 5 MB answers 413, an empty or non-binary body 400', async () => {
    const big = await checkUpload(Buffer.alloc(6 * 1024 * 1024), 'size');
    assert.equal(big.status, 413);
    assert.deepEqual(await big.json(), { error: 'Die Datei ist größer als 5 MB.' });
    for (const res of [
        await checkUpload(Buffer.alloc(0), 'size'),
        await checkUpload(JSON.stringify({ x: 1 }), 'size', 'application/json')
    ]) {
        assert.equal(res.status, 400);
        assert.deepEqual(await res.json(), { error: 'Keine Datei empfangen.' });
    }
});

test('more than 10 checks in 10 minutes per session answer 429', async () => {
    for (let i = 0; i < 10; i++) assert.equal((await checkUpload(Buffer.alloc(0), 'limit')).status, 400);
    const res = await checkUpload(packageOf('upl-limit'), 'limit');
    assert.equal(res.status, 429);
    assert.deepEqual(await res.json(), { error: 'Zu viele Prüfungen. Bitte warte ein paar Minuten.' });
    assert.equal((await checkUpload(Buffer.alloc(0), 'other')).status, 400);
});

test('install: a wrong password keeps the upload, the right one installs it once, audited', async () => {
    const uploadId = await uploadIdOf(packageOf('upl-a'), 'install');
    for (const body of [
        { uploadId: 1, password: PASSWORD, replace: false },
        { uploadId, password: PASSWORD, replace: 'nein' },
        { uploadId, password: PASSWORD }
    ]) {
        const res = await install(body, 'install');
        assert.equal(res.status, 400);
        assert.deepEqual(await res.json(), { error: 'Ungültige Eingabe.' });
    }
    const wrong = await install({ uploadId, password: 'falsch', replace: false }, 'install');
    assert.equal(wrong.status, 401);
    assert.deepEqual(await wrong.json(), { error: 'Ungültiges Admin-Reset-Passwort.' });
    assert.equal(fs.existsSync(path.join(customDir, 'upl-a')), false);

    // Another session cannot use the upload
    const foreign = await install({ uploadId, password: PASSWORD, replace: false }, 'someone-else');
    assert.equal(foreign.status, 410);

    const res = await install({ uploadId, password: PASSWORD, replace: false }, 'install');
    assert.equal(res.status, 200);
    const { plugin } = await res.json();
    assert.equal(plugin.id, 'upl-a');
    assert.equal(plugin.official, false);
    assert.equal(plugin.status, 'off');
    assert.equal(installedVersion('upl-a'), '1.0.0');

    const again = await install({ uploadId, password: PASSWORD, replace: false }, 'install');
    assert.equal(again.status, 410);
    assert.deepEqual(await again.json(), { error: 'Der Upload ist abgelaufen. Bitte lade die Datei erneut hoch.' });

    assert.deepEqual((await auditOf('PLUGIN_UPLOAD')).filter(entry => entry.targetId === 'upl-a')
        .map(({ adminId, details }) => ({ adminId, details })), [{ adminId: ADMIN.id, details: 'Plugin „Upload upl-a“ 1.0.0 hochgeladen' }]);
});

test('install of an existing plugin needs replace, and the plugin must be off', async () => {
    const plain = await uploadIdOf(packageOf('upl-a', '1.1.0'), 'replace');
    const exists = await install({ uploadId: plain, password: PASSWORD, replace: false }, 'replace');
    assert.equal(exists.status, 409);
    assert.deepEqual(await exists.json(), { error: 'Das Plugin ist schon installiert.' });

    assert.equal((await (await setEnabled('upl-a', { enabled: true, trust: true, password: PASSWORD })).json()).plugin.status, 'on');
    const check = await (await checkUpload(packageOf('upl-a', '2.0.0'), 'replace')).json();
    assert.deepEqual(check.report.replaces, { version: '1.0.0', restart: true, enabled: true });
    const whileOn = await install({ uploadId: check.uploadId, password: PASSWORD, replace: true }, 'replace');
    assert.equal(whileOn.status, 409);
    assert.deepEqual(await whileOn.json(), { error: SWITCH_OFF_FIRST });
    assert.equal(installedVersion('upl-a'), '1.0.0');
    assert.equal(host.isEnabled('upl-a'), true);

    assert.equal((await setEnabled('upl-a', { enabled: false })).status, 200);
    const uploadId = await uploadIdOf(packageOf('upl-a', '2.0.0'), 'replace');
    const res = await install({ uploadId, password: PASSWORD, replace: true }, 'replace');
    assert.equal(res.status, 200);
    const { plugin } = await res.json();
    assert.equal(plugin.status, 'restart');
    assert.equal(plugin.statusText, 'Neustart nötig');
    assert.equal(plugin.version, '2.0.0');
    assert.equal(plugin.enabled, false);
    assert.equal(installedVersion('upl-a'), '2.0.0');

    assert.deepEqual((await auditOf('PLUGIN_UPLOAD')).filter(entry => entry.targetId === 'upl-a').map(entry => entry.details).sort(),
        ['Plugin „Upload upl-a“ 1.0.0 hochgeladen', 'Plugin „Upload upl-a“ 2.0.0 ersetzt']);
});

test('remove: official 409, unknown 404, on 409, wrong password 401, then the folder goes and the state stays', async () => {
    const official = await removePlugin('offi', { password: PASSWORD });
    assert.equal(official.status, 409);
    assert.deepEqual(await official.json(), { error: 'Offizielle Plugins können nicht entfernt werden.' });

    const unknown = await removePlugin('nope', { password: PASSWORD });
    assert.equal(unknown.status, 404);
    assert.deepEqual(await unknown.json(), { error: 'Plugin nicht gefunden.' });

    assert.equal((await setEnabled('cust', { enabled: true, trust: true, password: PASSWORD })).status, 200);
    const on = await removePlugin('cust', { password: PASSWORD });
    assert.equal(on.status, 409);
    assert.deepEqual(await on.json(), { error: SWITCH_OFF_FIRST });
    assert.equal((await setEnabled('cust', { enabled: false })).status, 200);
    assert.equal(fs.existsSync(path.join(customDir, 'cust')), true);

    const wrong = await removePlugin('upl-a', { password: 'falsch' });
    assert.equal(wrong.status, 401);
    assert.equal(fs.existsSync(path.join(customDir, 'upl-a')), true);

    const res = await removePlugin('upl-a', { password: PASSWORD });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { removed: true });
    assert.equal(fs.existsSync(path.join(customDir, 'upl-a')), false);
    const listed = (await (await call('/api/admin/plugins')).json()).plugins.find(plugin => plugin.id === 'upl-a');
    assert.equal(listed.status, 'orphaned');

    const [entry] = (await auditOf('PLUGIN_REMOVE')).filter(item => item.targetId === 'upl-a');
    assert.equal(entry.details, 'Plugin „Upload upl-a“ entfernt');
    assert.equal(entry.adminId, ADMIN.id);

    const gone = await removePlugin('upl-a', { password: PASSWORD });
    assert.equal(gone.status, 404);
});
