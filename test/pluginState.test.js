const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir } = require('./helpers');

// Own, empty SQLite database; the empty cwd keeps a local .env out
const tmpDir = createTempDir('plugin-state');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.SQLITE_PATH = path.join(tmpDir, 'plugin-state.sqlite');

const { db, collection, doc, getDoc, getDocs, deleteDoc } = require('../firebaseAdmin');
const state = require('../plugin-sdk/state');

const DEFAULTS = {
    enabled: false,
    enabledAt: '',
    enabledBy: '',
    confirmedVersion: '',
    confirmedPermissions: [],
    collections: [],
    lastError: '',
    lastErrorAt: ''
};

beforeEach(async () => {
    for (const name of ['pluginState', 'pluginSettings']) {
        const snapshot = await getDocs(collection(db, name));
        for (const entry of snapshot.docs) await deleteDoc(doc(db, name, entry.id));
    }
});

test('writeState merges a patch into the stored state', async () => {
    await state.writeState('alpha', { enabled: true, enabledBy: 'admin-1' });
    await state.writeState('alpha', { lastError: 'x' });

    const stored = (await getDoc(doc(db, 'pluginState', 'alpha'))).data();
    assert.equal(stored.enabled, true);
    assert.equal(stored.enabledBy, 'admin-1');
    assert.equal(stored.lastError, 'x');
});

test('readStates returns a map of every plugin with defaults filled in', async () => {
    await state.writeState('alpha', { enabled: true, confirmedPermissions: ['discord:dm'] });
    await state.writeState('beta', { lastError: 'Fehler', lastErrorAt: '2026-11-19T10:00:00.000Z' });

    const states = await state.readStates();

    assert.ok(states instanceof Map);
    assert.deepEqual([...states.keys()].sort(), ['alpha', 'beta']);
    assert.deepEqual(states.get('alpha'), { ...DEFAULTS, enabled: true, confirmedPermissions: ['discord:dm'] });
    assert.deepEqual(states.get('beta'), { ...DEFAULTS, lastError: 'Fehler', lastErrorAt: '2026-11-19T10:00:00.000Z' });
});

test('readStates is an empty map without stored states', async () => {
    const states = await state.readStates();
    assert.equal(states.size, 0);
});

test('deleteState removes the state', async () => {
    await state.writeState('alpha', { enabled: true });
    await state.deleteState('alpha');

    assert.equal((await getDoc(doc(db, 'pluginState', 'alpha'))).exists(), false);
    assert.equal((await state.readStates()).has('alpha'), false);
});

test('settings round-trip, are stored as { values } and can be deleted', async () => {
    assert.deepEqual(await state.readSettings('alpha'), {});

    await state.writeSettings('alpha', { notifyChannel: '123', maxOpen: 3 });
    assert.deepEqual(await state.readSettings('alpha'), { notifyChannel: '123', maxOpen: 3 });
    assert.deepEqual((await getDoc(doc(db, 'pluginSettings', 'alpha'))).data(), { values: { notifyChannel: '123', maxOpen: 3 } });

    await state.writeSettings('alpha', { notifyChannel: '456' });
    assert.deepEqual(await state.readSettings('alpha'), { notifyChannel: '456' });

    await state.deleteSettings('alpha');
    assert.deepEqual(await state.readSettings('alpha'), {});
    assert.equal((await getDoc(doc(db, 'pluginSettings', 'alpha'))).exists(), false);
});

test('deleting a missing state or settings document is no error', async () => {
    await state.deleteState('missing');
    await state.deleteSettings('missing');
});
