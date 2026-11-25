const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createTempDir } = require('./helpers');

// Own, empty SQLite database; the empty cwd keeps a local .env out
const tmpDir = createTempDir('plugin-host');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
delete process.env.DEV_MOCK;
process.env.SQLITE_PATH = path.join(tmpDir, 'plugin-host.sqlite');

const { db, collection, doc, getDoc, getDocs, setDoc, deleteDoc } = require('../firebaseAdmin');
const { PluginHostError } = require('../plugin-sdk/errors');
const hooks = require('../plugin-sdk/hooks');
const state = require('../plugin-sdk/state');
const { createPluginHost } = require('../plugin-sdk/host');

const CORE = ['pluginState', 'pluginSettings'];
const SAFE_SENTENCE = 'Abgesicherter Modus aktiv – Plugins lassen sich nicht einschalten.';
const CANNOT_SENTENCE = 'Dieses Plugin kann nicht eingeschaltet werden.';

let logs;
let originals;
let usedCollections;
let usedIds;

/** Fresh official + custom roots for one test. */
function roots() {
    const root = createTempDir('plugin-host-dirs');
    const officialDir = path.join(root, 'official');
    const customDir = path.join(root, 'custom');
    fs.mkdirSync(officialDir);
    fs.mkdirSync(customDir);
    return { officialDir, customDir };
}

/**
 * Server code that counts register calls in `globalThis.__hostTest[id]`,
 * keeps the ctx there and runs `body` inside register.
 */
function serverSource(id, body = '', top = '') {
    return `${top}
const rec = (globalThis.__hostTest ||= {})[${JSON.stringify(id)}] ||= { registers: 0, disabled: 0, ctx: null };
module.exports = {
    async register(ctx) {
        rec.registers += 1;
        rec.ctx = ctx;
        ctx.onDisable(() => { rec.disabled += 1; });
        ${body}
    }
};`;
}

function writePlugin(root, id, { manifest = {}, server = serverSource(id), client = false } = {}) {
    const dir = path.join(root, id);
    fs.mkdirSync(dir, { recursive: true });
    const json = { id, name: `Plugin ${id}`, version: '1.0.0', sdk: 1, author: 'Test', description: 'Test-Plugin', ...manifest };
    if (server !== null) {
        json.server = 'server.js';
        fs.writeFileSync(path.join(dir, 'server.js'), server);
    }
    if (client) {
        json.client = 'client.js';
        fs.writeFileSync(path.join(dir, 'client.js'), 'export default {};');
        fs.writeFileSync(path.join(dir, 'client.css'), '');
    }
    fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify(json));
    usedIds.add(id);
    return dir;
}

/** Fixture `good`: a route, a hook, a setting schema. */
function writeGood(root, id = 'good', manifest = {}) {
    return writePlugin(root, id, {
        client: true,
        manifest: {
            permissions: ['events:read'],
            settings: [
                { key: 'mode', type: 'select', label: 'Modus', options: ['leise', { value: 'laut', label: 'Laut' }] },
                { key: 'token', type: 'secret', label: 'Token' },
                { key: 'limit', type: 'number', label: 'Grenze' },
                { key: 'active', type: 'boolean', label: 'Aktiv' },
                { key: 'channel', type: 'channel', label: 'Kanal' }
            ],
            ...manifest
        },
        server: serverSource(id, `
        ctx.routes.get('/ping', { access: 'member' }, () => ({ pong: true }));
        ctx.hooks.on('event.created', ({ event }) => { (rec.events ||= []).push(event.id); });`)
    });
}

function marker(root, id) {
    return path.join(root, `${id}.loaded`);
}

/** Custom plugin whose server.js writes a marker file when it is required. */
function writeMarked(root, id, manifest = {}) {
    const file = marker(root, id);
    return writePlugin(root, id, {
        manifest,
        server: serverSource(id, '', `require('fs').writeFileSync(${JSON.stringify(file)}, 'x');`)
    });
}

const record = id => (globalThis.__hostTest || {})[id];
const view = (host, id) => host.list().find(item => item.id === id);

async function enabledState(id, extra = {}) {
    await state.writeState(id, { enabled: true, enabledAt: '2026-11-01T10:00:00.000Z', enabledBy: 'admin', ...extra });
}

beforeEach(async () => {
    usedIds = new Set();
    usedCollections = [];
    for (const name of CORE) {
        const snapshot = await getDocs(collection(db, name));
        for (const item of snapshot.docs) await deleteDoc(doc(db, name, item.id));
    }
    globalThis.__hostTest = {};
    logs = { log: [], warn: [], error: [] };
    originals = { log: console.log, warn: console.warn, error: console.error };
    for (const kind of Object.keys(logs)) console[kind] = (...args) => logs[kind].push(args.map(String).join(' '));
});

afterEach(async () => {
    await hooks.whenHooksIdle();
    for (const id of usedIds) hooks.clearHooks(id);
    hooks.setHookGate(null);
    hooks.setHookErrorReporter(null);
    for (const name of usedCollections) {
        const snapshot = await getDocs(collection(db, name));
        for (const item of snapshot.docs) await deleteDoc(item.ref);
    }
    Object.assign(console, originals);
});

test('a disabled custom plugin is listed but its server.js is never required', async () => {
    const { officialDir, customDir } = roots();
    writeMarked(customDir, 'quiet');
    const host = createPluginHost({ officialDir, customDir });
    await host.start();

    assert.equal(fs.existsSync(marker(customDir, 'quiet')), false);
    const item = view(host, 'quiet');
    assert.equal(item.status, 'off');
    assert.equal(item.statusText, 'Aus');
    assert.equal(host.isEnabled('quiet'), false);
});

test('an enabled and confirmed custom plugin is loaded once and listed', async () => {
    const { officialDir, customDir } = roots();
    writeGood(customDir);
    await enabledState('good', { confirmedVersion: '1.0.0', confirmedPermissions: ['events:read'] });
    const host = createPluginHost({ officialDir, customDir });
    await host.start();

    assert.equal(record('good').registers, 1);
    assert.equal(host.isEnabled('good'), true);
    const item = view(host, 'good');
    assert.equal(item.status, 'on');
    assert.equal(item.statusText, 'An');
    assert.equal(item.name, 'Plugin good');
    assert.equal(item.version, '1.0.0');
    assert.equal(item.author, 'Test');
    assert.equal(item.official, false);
    assert.equal(item.hasClient, true);
    assert.equal(item.limitWarning, null);
    assert.deepEqual(item.permissions, [{ key: 'events:read', label: 'Events lesen' }]);
    assert.deepEqual(item.settings.map(setting => setting.key), ['mode', 'token', 'limit', 'active', 'channel']);
    assert.deepEqual(item.collections, []);

    const routes = host.routesOf('good');
    assert.deepEqual(routes.map(route => [route.method, route.path, route.access]), [['GET', '/ping', 'member']]);
    assert.deepEqual(await routes[0].handler(), { pong: true });
    assert.deepEqual(host.clients(), [{
        id: 'good', name: 'Plugin good', version: '1.0.0', official: false, permissions: ['events:read'], hasCss: true
    }]);
    assert.equal(host.entryOf('good').dir, path.join(customDir, 'good'));
    assert.equal(host.entryOf('missing'), null);
});

test('confirmed permissions are compared as a set', async () => {
    const { officialDir, customDir } = roots();
    writeGood(customDir, 'good', { permissions: ['events:read', 'members:read'] });
    await enabledState('good', { confirmedVersion: '1.0.0', confirmedPermissions: ['members:read', 'events:read'] });
    const host = createPluginHost({ officialDir, customDir });
    await host.start();
    assert.equal(view(host, 'good').status, 'on');
});

test('a register that throws marks the plugin as failed; the others still load', async () => {
    const { officialDir, customDir } = roots();
    writePlugin(customDir, 'throws', { server: serverSource('throws', "throw new Error('kaputt');") });
    writeGood(customDir);
    await enabledState('throws', { confirmedVersion: '1.0.0', confirmedPermissions: [] });
    await enabledState('good', { confirmedVersion: '1.0.0', confirmedPermissions: ['events:read'] });
    const host = createPluginHost({ officialDir, customDir });
    await host.start();

    const item = view(host, 'throws');
    assert.equal(item.status, 'error');
    assert.equal(item.statusText, 'Fehler: kaputt');
    assert.equal(item.lastError, 'kaputt');
    assert.match(item.lastErrorAt, /^\d{4}-\d\d-\d\dT/);
    assert.equal(host.isEnabled('throws'), false);
    assert.equal(record('throws').disabled, 1, 'onDisable callbacks clean up after a failed register');
    const stored = (await getDoc(doc(db, 'pluginState', 'throws'))).data();
    assert.equal(stored.enabled, true);
    assert.equal(stored.lastError, 'kaputt');
    assert.equal(view(host, 'good').status, 'on');
    assert.ok(logs.error.some(line => line.includes('[plugin:throws]') && line.includes('kaputt')));
});

test('a server.js that throws while it is required marks the plugin as failed', async () => {
    const { officialDir, customDir } = roots();
    writePlugin(customDir, 'broken', { server: "throw new Error('Syntax kaputt');" });
    await enabledState('broken', { confirmedVersion: '1.0.0', confirmedPermissions: [] });
    const host = createPluginHost({ officialDir, customDir });
    await host.start();
    assert.equal(view(host, 'broken').statusText, 'Fehler: Syntax kaputt');
});

test('a register that hangs times out and start() still resolves', async () => {
    const { officialDir, customDir } = roots();
    writePlugin(customDir, 'hangs', { server: serverSource('hangs', 'await new Promise(() => {});') });
    await enabledState('hangs', { confirmedVersion: '1.0.0', confirmedPermissions: [] });
    const host = createPluginHost({ officialDir, customDir, registerTimeoutMs: 50 });
    await host.start();

    const item = view(host, 'hangs');
    assert.equal(item.status, 'error');
    assert.equal(item.statusText, 'Fehler: register() hat nicht innerhalb von 0,05 s geantwortet.');
    assert.equal(host.isEnabled('hangs'), false);
    // A late registration of the hung register is refused
    assert.throws(() => record('hangs').ctx.routes.get('/late', { access: 'member' }, () => {}), /nur während register/);
    assert.deepEqual(host.routesOf('hangs'), []);
});

test('a custom plugin with a new version needs a confirmation and is not required', async () => {
    const { officialDir, customDir } = roots();
    writeMarked(customDir, 'bumped', { version: '1.1.0' });
    await enabledState('bumped', { confirmedVersion: '1.0.0', confirmedPermissions: [] });
    const host = createPluginHost({ officialDir, customDir });
    await host.start();

    const item = view(host, 'bumped');
    assert.equal(item.status, 'confirm');
    assert.equal(item.statusText, 'Bestätigung nötig');
    assert.equal(fs.existsSync(marker(customDir, 'bumped')), false);
    assert.equal(host.isEnabled('bumped'), false);
});

test('a custom plugin that asks for more permissions needs a confirmation', async () => {
    const { officialDir, customDir } = roots();
    writeMarked(customDir, 'needs-dm', { permissions: ['discord:dm'] });
    await enabledState('needs-dm', { confirmedVersion: '1.0.0', confirmedPermissions: [] });
    const host = createPluginHost({ officialDir, customDir });
    await host.start();

    assert.equal(view(host, 'needs-dm').status, 'confirm');
    assert.equal(fs.existsSync(marker(customDir, 'needs-dm')), false);

    // Switching it on confirms the new code and loads it
    const item = await host.setEnabled('needs-dm', true, { adminId: 'admin-2' });
    assert.equal(item.status, 'on');
    assert.equal(fs.existsSync(marker(customDir, 'needs-dm')), true);
    const stored = (await getDoc(doc(db, 'pluginState', 'needs-dm'))).data();
    assert.equal(stored.confirmedVersion, '1.0.0');
    assert.deepEqual(stored.confirmedPermissions, ['discord:dm']);
    assert.equal(stored.enabledBy, 'admin-2');
});

test('an official plugin with a new version and more permissions stays on', async () => {
    const { officialDir, customDir } = roots();
    writePlugin(officialDir, 'shipped', { manifest: { version: '2.0.0', permissions: ['discord:dm'] } });
    await enabledState('shipped', { confirmedVersion: '1.0.0', confirmedPermissions: [] });
    const host = createPluginHost({ officialDir, customDir });
    await host.start();
    assert.equal(view(host, 'shipped').status, 'on');
    assert.equal(view(host, 'shipped').official, true);
});

test('safe mode loads nothing, refuses switching on and allows switching off without running code', async () => {
    const { officialDir, customDir } = roots();
    writeMarked(customDir, 'custom-on');
    writePlugin(officialDir, 'shipped');
    await enabledState('custom-on', { confirmedVersion: '1.0.0', confirmedPermissions: [] });
    await enabledState('shipped');
    const host = createPluginHost({ officialDir, customDir, safeMode: true, mockMode: true });
    await host.start();

    assert.equal(fs.existsSync(marker(customDir, 'custom-on')), false);
    assert.equal(record('shipped'), undefined);
    for (const item of host.list()) {
        assert.equal(item.status, 'safe');
        assert.equal(item.statusText, 'Abgesicherter Modus aktiv');
    }
    assert.equal(host.isEnabled('shipped'), false);
    assert.deepEqual(host.clients(), []);
    await assert.rejects(host.setEnabled('custom-on', true, { adminId: 'a' }), { name: 'PluginHostError', message: SAFE_SENTENCE });
    assert.equal(view(host, 'shipped').enabled, true);

    // The way out of a plugin that breaks the start: switch it off while no plugin code runs
    const off = await host.setEnabled('shipped', false, { adminId: 'a' });
    assert.equal(off.status, 'safe');
    assert.equal(off.enabled, false);
    assert.equal((await getDoc(doc(db, 'pluginState', 'shipped'))).data().enabled, false);
    assert.equal(record('shipped'), undefined);
    await host.setEnabled('custom-on', false, { adminId: 'a' });
    assert.equal(fs.existsSync(marker(customDir, 'custom-on')), false);
    assert.equal(view(host, 'custom-on').enabled, false);
    assert.equal(host.isEnabled('custom-on'), false);
    await assert.rejects(host.setEnabled('shipped', true, { adminId: 'a' }), { name: 'PluginHostError', message: SAFE_SENTENCE });
});

test('mock mode switches an official plugin without state on and stores it', async () => {
    const { officialDir, customDir } = roots();
    writePlugin(officialDir, 'shipped');
    writeMarked(customDir, 'custom-new');
    const host = createPluginHost({ officialDir, customDir, mockMode: true });
    await host.start();

    assert.equal(view(host, 'shipped').status, 'on');
    assert.equal(record('shipped').registers, 1);
    assert.equal((await getDoc(doc(db, 'pluginState', 'shipped'))).data().enabled, true);
    assert.equal(view(host, 'custom-new').status, 'off');
    assert.equal(fs.existsSync(marker(customDir, 'custom-new')), false);
});

test('outside mock mode a new official plugin starts off and gets no state', async () => {
    const { officialDir, customDir } = roots();
    writePlugin(officialDir, 'shipped');
    const host = createPluginHost({ officialDir, customDir });
    await host.start();

    assert.equal(view(host, 'shipped').status, 'off');
    assert.equal(record('shipped'), undefined);
    assert.equal((await getDoc(doc(db, 'pluginState', 'shipped'))).exists(), false);
});

test('mock mode keeps an official plugin off that was switched off', async () => {
    const { officialDir, customDir } = roots();
    writePlugin(officialDir, 'shipped');
    await state.writeState('shipped', { enabled: false });
    const host = createPluginHost({ officialDir, customDir, mockMode: true });
    await host.start();
    assert.equal(view(host, 'shipped').status, 'off');
});

test('switching off runs onDisable and skips hooks; switching on again reuses the registration', async () => {
    const { officialDir, customDir } = roots();
    writeGood(officialDir);
    await enabledState('good');
    const host = createPluginHost({ officialDir, customDir });
    await host.start();

    hooks.emitHook('event.created', { event: { id: 'e1' } });
    await hooks.whenHooksIdle();
    assert.deepEqual(record('good').events, ['e1']);

    const off = await host.setEnabled('good', false, { adminId: 'admin' });
    assert.equal(off.status, 'off');
    assert.equal(host.isEnabled('good'), false);
    assert.equal(record('good').disabled, 1);
    assert.deepEqual(host.clients(), []);
    assert.equal((await getDoc(doc(db, 'pluginState', 'good'))).data().enabled, false);

    hooks.emitHook('event.created', { event: { id: 'e2' } });
    await hooks.whenHooksIdle();
    assert.deepEqual(record('good').events, ['e1']);

    const on = await host.setEnabled('good', true, { adminId: 'admin' });
    assert.equal(on.status, 'on');
    assert.equal(record('good').registers, 1);
    assert.equal(host.routesOf('good').length, 1);
    hooks.emitHook('event.created', { event: { id: 'e3' } });
    await hooks.whenHooksIdle();
    assert.deepEqual(record('good').events, ['e1', 'e3']);
});

test('an onDisable callback that hangs or throws does not block switching off', async () => {
    const { officialDir, customDir } = roots();
    writePlugin(officialDir, 'stubborn', {
        server: serverSource('stubborn', `
        ctx.onDisable(() => new Promise(() => {}));
        ctx.onDisable(() => { throw new Error('aufräumen kaputt'); });`)
    });
    await enabledState('stubborn');
    const host = createPluginHost({ officialDir, customDir, disableTimeoutMs: 30 });
    await host.start();

    const item = await host.setEnabled('stubborn', false, { adminId: 'admin' });
    assert.equal(item.status, 'off');
    assert.equal(record('stubborn').disabled, 1);
    assert.ok(logs.error.some(line => line.includes('aufräumen kaputt')));
});

test('switching a failed plugin on again retries register and clears the error', async () => {
    const { officialDir, customDir } = roots();
    writePlugin(customDir, 'flaky', {
        server: serverSource('flaky', `
        if (!globalThis.__hostTest.ready) throw new Error('Kanal fehlt');
        ctx.routes.get('/ok', { access: 'member' }, () => ({ ok: true }));`)
    });
    await enabledState('flaky', { confirmedVersion: '1.0.0', confirmedPermissions: [] });
    const host = createPluginHost({ officialDir, customDir });
    await host.start();
    assert.equal(view(host, 'flaky').statusText, 'Fehler: Kanal fehlt');

    // Still broken: the retry fails again and keeps the plugin off
    assert.equal((await host.setEnabled('flaky', true, { adminId: 'a' })).statusText, 'Fehler: Kanal fehlt');
    assert.equal(record('flaky').registers, 2);
    assert.equal(host.isEnabled('flaky'), false);

    // The admin fixed the cause: off and on again loads it
    globalThis.__hostTest.ready = true;
    assert.equal((await host.setEnabled('flaky', false, { adminId: 'a' })).status, 'off');
    const item = await host.setEnabled('flaky', true, { adminId: 'a' });
    assert.equal(item.status, 'on');
    assert.equal(item.lastError, '');
    assert.equal(item.lastErrorAt, '');
    assert.equal(record('flaky').registers, 3);
    assert.equal(host.isEnabled('flaky'), true);
    assert.deepEqual(host.routesOf('flaky').map(route => route.path), ['/ok']);
    const stored = (await getDoc(doc(db, 'pluginState', 'flaky'))).data();
    assert.equal(stored.lastError, '');
    assert.equal(stored.lastErrorAt, '');
});

test('a retry after a hung register gets a fresh ctx; the hung one stays sealed', async () => {
    const { officialDir, customDir } = roots();
    writePlugin(customDir, 'slow', {
        server: serverSource('slow', `
        if (rec.registers === 1) {
            rec.first = ctx;
            await new Promise(() => {});
        }
        try {
            rec.first.routes.get('/old', { access: 'member' }, () => ({}));
            rec.oldOpen = true;
        } catch {
            rec.oldOpen = false;
        }
        ctx.routes.get('/new', { access: 'member' }, () => ({}));`)
    });
    await enabledState('slow', { confirmedVersion: '1.0.0', confirmedPermissions: [] });
    const host = createPluginHost({ officialDir, customDir, registerTimeoutMs: 50 });
    await host.start();
    assert.equal(view(host, 'slow').status, 'error');

    const item = await host.setEnabled('slow', true, { adminId: 'a' });
    assert.equal(item.status, 'on');
    assert.equal(record('slow').registers, 2);
    assert.notEqual(record('slow').ctx, record('slow').first);
    assert.equal(record('slow').oldOpen, false, 'the hung ctx cannot register during the retry');
    assert.deepEqual(host.routesOf('slow').map(route => route.path), ['/new']);
});

test('a successful register at start clears an old error', async () => {
    const { officialDir, customDir } = roots();
    writePlugin(officialDir, 'healed');
    await enabledState('healed', { lastError: 'alt', lastErrorAt: '2026-11-01T10:00:00.000Z' });
    const host = createPluginHost({ officialDir, customDir });
    await host.start();
    assert.equal(view(host, 'healed').lastError, '');
    await host.saveSettings('healed', {});
    assert.equal((await getDoc(doc(db, 'pluginState', 'healed'))).data().lastError, '');
});

test('invalid, incompatible and unknown plugins cannot be switched', async () => {
    const { officialDir, customDir } = roots();
    fs.mkdirSync(path.join(customDir, 'broken-json'));
    fs.writeFileSync(path.join(customDir, 'broken-json', 'plugin.json'), '{');
    writePlugin(customDir, 'future', { manifest: { sdk: 2 } });
    const host = createPluginHost({ officialDir, customDir });
    await host.start();

    assert.equal(view(host, 'broken-json').status, 'invalid');
    assert.equal(view(host, 'broken-json').statusText, 'Ungültig: plugin.json ist kein gültiges JSON.');
    assert.equal(view(host, 'future').status, 'incompatible');
    assert.equal(view(host, 'future').statusText, 'Inkompatibel (SDK 2)');
    await assert.rejects(host.setEnabled('broken-json', true, { adminId: 'a' }), { name: 'PluginHostError', message: CANNOT_SENTENCE });
    await assert.rejects(host.setEnabled('future', true, { adminId: 'a' }), { message: CANNOT_SENTENCE });
    await assert.rejects(host.setEnabled('nobody', true, { adminId: 'a' }), { message: 'Plugin nicht gefunden.' });
});

test('a state entry without a folder is orphaned; deleteData removes its data and state', async () => {
    const { officialDir, customDir } = roots();
    await state.writeState('gone', { enabled: true, collections: ['items', 'votes'] });
    await state.writeSettings('gone', { token: 'x' });
    await setDoc(doc(db, 'plugin:gone:items', 'a'), { userId: '1' });
    await setDoc(doc(db, 'plugin:gone:votes', 'b'), { userId: '2' });
    usedCollections.push('plugin:gone:items', 'plugin:gone:votes');
    const host = createPluginHost({ officialDir, customDir });
    await host.start();

    const item = view(host, 'gone');
    assert.equal(item.status, 'orphaned');
    assert.equal(item.statusText, 'Verwaist');
    assert.deepEqual(item.collections, ['items', 'votes']);
    assert.deepEqual(item.settings, []);
    await assert.rejects(host.setEnabled('gone', true, { adminId: 'a' }), { message: CANNOT_SENTENCE });

    assert.equal(await host.deleteData('gone'), 2);
    assert.equal((await getDocs(collection(db, 'plugin:gone:items'))).docs.length, 0);
    assert.equal((await getDocs(collection(db, 'plugin:gone:votes'))).docs.length, 0);
    assert.equal((await getDoc(doc(db, 'pluginState', 'gone'))).exists(), false);
    assert.equal((await getDoc(doc(db, 'pluginSettings', 'gone'))).exists(), false);
    assert.equal(view(host, 'gone'), undefined);
});

test('ctx.data records each collection once, also for parallel writes', async () => {
    const { officialDir, customDir } = roots();
    writePlugin(officialDir, 'writer');
    await enabledState('writer');
    usedCollections.push('plugin:writer:items', 'plugin:writer:votes', 'plugin:writer:notes');
    const host = createPluginHost({ officialDir, customDir });
    await host.start();

    const { ctx } = record('writer');
    await Promise.all([
        ctx.data.add('items', { userId: '1' }),
        ctx.data.add('votes', { userId: '1' }),
        ctx.data.add('notes', { userId: '2' }),
        ctx.data.add('items', { userId: '2' })
    ]);
    host.reportError('writer', 'parallel');
    await host.saveSettings('writer', {});

    assert.deepEqual([...view(host, 'writer').collections].sort(), ['items', 'notes', 'votes']);
    const stored = (await getDoc(doc(db, 'pluginState', 'writer'))).data();
    assert.deepEqual([...stored.collections].sort(), ['items', 'notes', 'votes']);
    assert.equal(stored.lastError, 'parallel');
    assert.equal(stored.enabled, true);
});

test('deleteData of a discovered plugin wipes its documents and settings, keeps its state', async () => {
    const { officialDir, customDir } = roots();
    writePlugin(officialDir, 'writer');
    await enabledState('writer');
    usedCollections.push('plugin:writer:items');
    const host = createPluginHost({ officialDir, customDir });
    await host.start();
    await record('writer').ctx.data.add('items', { userId: '1' });
    await state.writeSettings('writer', { a: 1 });

    assert.equal(await host.deleteData('writer'), 1);
    assert.equal((await getDocs(collection(db, 'plugin:writer:items'))).docs.length, 0);
    assert.equal((await getDoc(doc(db, 'pluginSettings', 'writer'))).exists(), false);
    assert.equal((await getDoc(doc(db, 'pluginState', 'writer'))).data().enabled, true);
    await assert.rejects(host.deleteData('nobody'), { message: 'Plugin nicht gefunden.' });
});

test('purgeUser deletes a member\'s documents of every plugin; wipeAllData keeps the state', async () => {
    const { officialDir, customDir } = roots();
    writePlugin(officialDir, 'writer');
    await enabledState('writer');
    await state.writeState('gone', { collections: ['items'] });
    await setDoc(doc(db, 'plugin:gone:items', 'g1'), { userId: '1' });
    usedCollections.push('plugin:writer:items', 'plugin:gone:items');
    const host = createPluginHost({ officialDir, customDir });
    await host.start();
    const { ctx } = record('writer');
    await ctx.data.set('items', 'mine', { userId: '1' });
    await ctx.data.set('items', 'other', { userId: '2' });
    await state.writeSettings('writer', { a: 1 });
    await state.writeSettings('gone', { b: 2 });

    assert.equal(await host.purgeUser('1'), 2);
    assert.deepEqual((await ctx.data.list('items')).map(item => item.id), ['other']);
    assert.equal((await getDocs(collection(db, 'plugin:gone:items'))).docs.length, 0);

    await host.wipeAllData();
    assert.deepEqual(await ctx.data.list('items'), []);
    assert.equal((await getDocs(collection(db, 'pluginSettings'))).docs.length, 0);
    assert.equal((await getDoc(doc(db, 'pluginState', 'writer'))).data().enabled, true);
    assert.equal((await getDoc(doc(db, 'pluginState', 'gone'))).exists(), true);
});

test('reportError stores the last error and keeps the plugin on; hook errors reach it', async () => {
    const { officialDir, customDir } = roots();
    writePlugin(officialDir, 'noisy', {
        manifest: { permissions: ['events:read'] },
        server: serverSource('noisy', "ctx.hooks.on('event.created', () => { throw new Error('Hook kaputt'); });")
    });
    await enabledState('noisy');
    const host = createPluginHost({ officialDir, customDir });
    await host.start();

    host.reportError('noisy', 'Route kaputt');
    let item = view(host, 'noisy');
    assert.equal(item.status, 'on');
    assert.equal(item.lastError, 'Route kaputt');
    assert.match(item.lastErrorAt, /^\d{4}-/);

    hooks.emitHook('event.created', { event: { id: 'e1' } });
    await hooks.whenHooksIdle();
    item = view(host, 'noisy');
    assert.equal(item.status, 'on');
    assert.equal(item.lastError, 'Hook kaputt');
    await host.saveSettings('noisy', {});
    assert.equal((await getDoc(doc(db, 'pluginState', 'noisy'))).data().lastError, 'Hook kaputt');
    host.reportError('unknown-plugin', 'egal');
});

test('saveSettings validates per schema, drops unknown keys and keeps a secret left out', async () => {
    const { officialDir, customDir } = roots();
    writeGood(customDir);
    const host = createPluginHost({ officialDir, customDir });
    await host.start();

    await host.saveSettings('good', {
        mode: 'laut', token: 'geheim', limit: 3, active: true, channel: '111111111111111111', extra: 'weg'
    });
    assert.deepEqual(await state.readSettings('good'), {
        mode: 'laut', token: 'geheim', limit: 3, active: true, channel: '111111111111111111'
    });
    assert.deepEqual(await host.readPublicSettings('good'), {
        mode: 'laut', token: { set: true }, limit: 3, active: true, channel: '111111111111111111'
    });

    // A left-out secret stays, an empty value clears a field
    await host.saveSettings('good', { mode: 'leise', token: undefined, limit: null, active: false, channel: '' });
    assert.deepEqual(await state.readSettings('good'), { mode: 'leise', token: 'geheim', active: false });
    await host.saveSettings('good', { token: '' });
    assert.deepEqual((await host.readPublicSettings('good')).token, { set: false });

    const bad = [
        [{ mode: 'mittel' }, /Modus/],
        [{ limit: Infinity }, /Grenze/],
        [{ limit: '3' }, /Grenze/],
        [{ active: 'ja' }, /Aktiv/],
        [{ channel: 'general' }, /Kanal/],
        [{ token: 42 }, /Token/]
    ];
    for (const [values, message] of bad) {
        await assert.rejects(host.saveSettings('good', values), error => error instanceof PluginHostError && message.test(error.message));
    }
    await assert.rejects(host.saveSettings('good', 'nope'), PluginHostError);
    assert.deepEqual(await state.readSettings('good'), { mode: 'leise', active: false });
});

test('saveSettings refuses an empty required setting', async () => {
    const { officialDir, customDir } = roots();
    writePlugin(customDir, 'strict', { manifest: { settings: [{ key: 'name', type: 'text', label: 'Name', required: true }] } });
    const host = createPluginHost({ officialDir, customDir });
    await host.start();
    await assert.rejects(host.saveSettings('strict', { name: '  ' }), { message: '„Name“ ist ein Pflichtfeld.' });
    await host.saveSettings('strict', { name: 'Hallo' });
    assert.deepEqual(await host.readPublicSettings('strict'), { name: 'Hallo' });
});

test('start() never rejects, even when it runs twice', async () => {
    const { officialDir, customDir } = roots();
    writePlugin(officialDir, 'shipped');
    await enabledState('shipped');
    const host = createPluginHost({ officialDir, customDir });
    await Promise.all([host.start(), host.start()]);
    assert.equal(record('shipped').registers, 1);
});

test('a plugin without server.js can be switched on and off', async () => {
    const { officialDir, customDir } = roots();
    writePlugin(customDir, 'client-only', { server: null, client: true });
    const host = createPluginHost({ officialDir, customDir });
    await host.start();
    assert.equal((await host.setEnabled('client-only', true, { adminId: 'a' })).status, 'on');
    assert.deepEqual(host.clients().map(item => item.id), ['client-only']);
    assert.deepEqual(host.routesOf('client-only'), []);
});

test('initPlugins starts the host behind pluginHost()', async () => {
    const sdk = require('../plugin-sdk');
    assert.throws(() => sdk.pluginHost(), /not initialized/);
    const { officialDir, customDir } = roots();
    writePlugin(officialDir, 'shipped');
    await enabledState('shipped');
    const host = await sdk.initPlugins({ officialDir, customDir });
    assert.equal(sdk.pluginHost(), host);
    assert.equal(host.isEnabled('shipped'), true);
});

test('themeSources lists enabled theme plugins only, sorted, and deleteData/wipeAllData remove the theme document', async () => {
    const { officialDir, customDir } = roots();
    writePlugin(officialDir, 'zebra', { manifest: { permissions: ['theme'] } });
    writePlugin(officialDir, 'alpha', { manifest: { permissions: ['theme'] } });
    writePlugin(officialDir, 'plain', { manifest: { permissions: ['events:read'] } });
    await enabledState('zebra');
    await enabledState('alpha');
    await enabledState('plain');
    usedCollections.push('pluginThemes');

    const host = createPluginHost({ officialDir, customDir });
    await host.start();

    assert.deepEqual(host.themeSources(), ['alpha', 'zebra']);
    await record('alpha').ctx.theme.publish('.alpha{}');
    await record('zebra').ctx.theme.publish('.zebra{}');
    assert.equal((await getDoc(doc(db, 'pluginThemes', 'alpha'))).exists(), true);

    await host.setEnabled('alpha', false);
    assert.deepEqual(host.themeSources(), ['zebra']);
    await host.deleteData('alpha');
    assert.equal((await getDoc(doc(db, 'pluginThemes', 'alpha'))).exists(), false);

    await host.wipeAllData();
    assert.equal((await getDoc(doc(db, 'pluginThemes', 'zebra'))).exists(), false);
});

const RESTART_SENTENCE = 'Starte DEMS neu, bevor du das Plugin wieder einschaltest.';

test('reloadPlugin of a never loaded plugin shows the new version, off, in id order', async () => {
    const { officialDir, customDir } = roots();
    writePlugin(officialDir, 'shipped');
    writeMarked(customDir, 'zeta');
    const host = createPluginHost({ officialDir, customDir });
    await host.start();
    assert.equal(host.customDir, customDir);
    assert.deepEqual([...host.officialIds()], ['shipped']);

    writeMarked(customDir, 'alpha', { version: '1.0.0' });
    let item = host.reloadPlugin('alpha');
    assert.equal(item.status, 'off');
    assert.equal(item.version, '1.0.0');
    assert.deepEqual(host.list().map(entry => entry.id), ['shipped', 'alpha', 'zeta']);

    writeMarked(customDir, 'alpha', { version: '1.1.0' });
    item = host.reloadPlugin('alpha');
    assert.deepEqual([item.status, item.statusText, item.version], ['off', 'Aus', '1.1.0']);
    assert.equal(view(host, 'alpha').version, '1.1.0');
    assert.deepEqual([item.permissionCheck.missing, item.permissionCheck.unused, item.permissionCheck.tooBig], [[], [], false]);
    assert.equal(host.wasLoaded('alpha'), false);
    assert.equal(fs.existsSync(marker(customDir, 'alpha')), false);
    assert.deepEqual(host.list().map(entry => entry.id), ['shipped', 'alpha', 'zeta']);
});

test('reloadPlugin of a loaded plugin marks it „Neustart nötig“ and refuses switching on', async () => {
    const { officialDir, customDir } = roots();
    writeGood(customDir);
    const host = createPluginHost({ officialDir, customDir });
    await host.start();
    await host.setEnabled('good', true, { adminId: 'a' });
    await host.setEnabled('good', false, { adminId: 'a' });
    assert.equal(host.wasLoaded('good'), true);

    writeGood(customDir, 'good', { version: '2.0.0' });
    const item = host.reloadPlugin('good');

    assert.deepEqual([item.status, item.statusText, item.version], ['restart', 'Neustart nötig', '2.0.0']);
    await assert.rejects(host.setEnabled('good', true, { adminId: 'a' }), { name: 'PluginHostError', message: RESTART_SENTENCE });
    assert.equal(view(host, 'good').status, 'restart');
    assert.equal(host.isEnabled('good'), false);
    assert.equal(record('good').registers, 1);
    assert.equal((await host.setEnabled('good', false, { adminId: 'a' })).status, 'restart');
});

test('a failed register also counts as loaded', async () => {
    const { officialDir, customDir } = roots();
    writePlugin(customDir, 'thrower', { server: serverSource('thrower', "throw new Error('kaputt');") });
    const host = createPluginHost({ officialDir, customDir });
    await host.start();
    await host.setEnabled('thrower', true, { adminId: 'a' });
    await host.setEnabled('thrower', false, { adminId: 'a' });
    assert.equal(host.wasLoaded('thrower'), true);
    assert.equal(host.reloadPlugin('thrower').status, 'restart');
    assert.equal(host.wasLoaded('nobody'), false);
});

test('reloadPlugin refuses an official id and a folder without plugin.json', async () => {
    const { officialDir, customDir } = roots();
    writePlugin(officialDir, 'shipped');
    writePlugin(customDir, 'shipped');
    const host = createPluginHost({ officialDir, customDir });
    await host.start();
    assert.throws(() => host.reloadPlugin('shipped'), { name: 'PluginHostError', message: 'Plugin nicht gefunden.' });
    assert.throws(() => host.reloadPlugin('missing'), { name: 'PluginHostError', message: 'Plugin nicht gefunden.' });
    writePlugin(path.dirname(customDir), 'outside');
    for (const bad of ['../outside', '.old-abc', '']) {
        assert.throws(() => host.reloadPlugin(bad), { message: 'Plugin nicht gefunden.' }, bad);
    }
    assert.equal(host.list().filter(entry => entry.id === 'shipped').length, 2);
    assert.equal(view(host, 'shipped').official, true);
});

test('forgetPlugin keeps a plugin with state as orphan and drops one without state', async () => {
    const { officialDir, customDir } = roots();
    writeMarked(customDir, 'kept');
    writeMarked(customDir, 'dropped');
    await state.writeState('kept', { enabled: false, collections: ['items'] });
    const host = createPluginHost({ officialDir, customDir });
    await host.start();

    host.forgetPlugin('kept');
    host.forgetPlugin('dropped');

    assert.equal(view(host, 'kept').status, 'orphaned');
    assert.deepEqual(view(host, 'kept').collections, ['items']);
    assert.equal(view(host, 'dropped'), undefined);
    assert.deepEqual(host.list().map(entry => entry.id), ['kept']);
    assert.equal(host.entryOf('kept'), null);
});

test('mock mode switches the plugin under development on and confirms it', async () => {
    const { officialDir, customDir } = roots();
    writeMarked(customDir, 'demo', { permissions: ['events:read'] });
    writeMarked(customDir, 'other');
    const host = createPluginHost({ officialDir, customDir, mockMode: true, devPluginId: 'demo' });
    await host.start();

    assert.equal(view(host, 'demo').status, 'on');
    assert.equal(fs.existsSync(marker(customDir, 'demo')), true);
    const stored = (await getDoc(doc(db, 'pluginState', 'demo'))).data();
    assert.equal(stored.enabled, true);
    assert.equal(stored.confirmedVersion, '1.0.0');
    assert.deepEqual(stored.confirmedPermissions, ['events:read']);
    assert.equal(view(host, 'other').status, 'off');
});

test('the plugin under development is not switched on outside mock mode', async () => {
    const { officialDir, customDir } = roots();
    writeMarked(customDir, 'demo');
    const host = createPluginHost({ officialDir, customDir, mockMode: false, devPluginId: 'demo' });
    await host.start();

    assert.equal(view(host, 'demo').status, 'off');
    assert.equal(fs.existsSync(marker(customDir, 'demo')), false);
    assert.equal((await getDoc(doc(db, 'pluginState', 'demo'))).exists(), false);
});

test('the view carries the permission check with labels; official plugins have none', async () => {
    const { officialDir, customDir } = roots();
    const dm = "module.exports = { register(ctx) { ctx.discord.sendDM('1', 'Hallo'); } };";
    writePlugin(officialDir, 'shipped', { server: dm });
    writePlugin(customDir, 'dm-sender', { manifest: { permissions: ['theme'] }, server: dm });
    const host = createPluginHost({ officialDir, customDir });
    await host.start();

    assert.equal(view(host, 'shipped').permissionCheck, null);
    assert.deepEqual(view(host, 'dm-sender').permissionCheck, {
        missing: [{ key: 'discord:dm', label: 'Direktnachrichten über den Bot senden' }],
        unused: [{ key: 'theme', label: 'Aussehen der ganzen Seite ändern' }],
        warnings: [],
        tooBig: false
    });
});
