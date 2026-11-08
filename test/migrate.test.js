const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createTempDir, startServer } = require('./helpers');
const { createDocumentStore } = require('../db/documentStore');
const { createSqliteStorage } = require('../db/sqliteStorage');
const { runMigrations } = require('../db/migrate');

const quiet = () => {};

// Fresh SQLite store per test
function makeStore() {
    return createDocumentStore(createSqliteStorage(path.join(createTempDir('migrate'), 'db.sqlite')));
}

// Write step files into a new folder: { '001-a': 'source of up(api)' }
function writeSteps(steps, dir = createTempDir('steps')) {
    for (const [id, body] of Object.entries(steps)) {
        fs.writeFileSync(path.join(dir, `${id}.js`),
            `module.exports = { id: '${id}', description: 'Test ${id}', async up(api) { ${body} } };\n`);
    }
    return dir;
}

// Step body that appends its id to the document log/order
const recordStep = (id) => `
    const { db, doc, getDoc, setDoc } = api;
    const snap = await getDoc(doc(db, 'log', 'order'));
    const ids = snap.exists() ? snap.data().ids : [];
    await setDoc(doc(db, 'log', 'order'), { ids: [...ids, '${id}'] });`;

async function loggedOrder(api) {
    const snap = await api.getDoc(api.doc(api.db, 'log', 'order'));
    return snap.exists() ? snap.data().ids : [];
}

test('applies pending steps in number order and records them', async () => {
    const api = makeStore();
    const dir = writeSteps({ '002-b': recordStep('002-b'), '001-a': recordStep('001-a') });
    fs.writeFileSync(path.join(dir, 'README.md'), 'not a step');

    assert.deepEqual(await runMigrations(api, { dir, log: quiet }), ['001-a', '002-b']);
    assert.deepEqual(await loggedOrder(api), ['001-a', '002-b']);

    const records = (await api.getDocs(api.collection(api.db, 'schemaMigrations'))).docs;
    assert.deepEqual(records.map(d => d.id), ['001-a', '002-b']);
    for (const record of records) {
        assert.ok(!Number.isNaN(Date.parse(record.data().appliedAt)), 'appliedAt is an ISO date');
        assert.equal(record.data().description, `Test ${record.id}`);
    }
    await api.close();
});

test('runs each step only once', async () => {
    const api = makeStore();
    const dir = writeSteps({ '001-a': recordStep('001-a') });
    await runMigrations(api, { dir, log: quiet });

    assert.deepEqual(await runMigrations(api, { dir, log: quiet }), []);
    assert.deepEqual(await loggedOrder(api), ['001-a']);
    await api.close();
});

test('stops at a failing step and never runs later ones', async () => {
    const api = makeStore();
    const dir = writeSteps({
        '001-ok': recordStep('001-ok'),
        '002-boom': "throw new Error('kaputt');",
        '003-later': recordStep('003-later')
    });

    await assert.rejects(runMigrations(api, { dir, log: quiet }), /Migration 002-boom fehlgeschlagen: kaputt/);
    assert.deepEqual(await loggedOrder(api), ['001-ok']);
    assert.equal((await api.getDoc(api.doc(api.db, 'schemaMigrations', '002-boom'))).exists(), false);
    await api.close();
});

test('continues after the failing step was fixed', async () => {
    const api = makeStore();
    const dir = writeSteps({ '001-ok': recordStep('001-ok'), '002-boom': "throw new Error('kaputt');", '003-later': recordStep('003-later') });
    await assert.rejects(runMigrations(api, { dir, log: quiet }));

    writeSteps({ '002-boom': recordStep('002-boom') }, dir);
    // A fresh require of the fixed file: the runner must not serve the cached broken module
    assert.deepEqual(await runMigrations(api, { dir, log: quiet }), ['002-boom', '003-later']);
    assert.deepEqual(await loggedOrder(api), ['001-ok', '002-boom', '003-later']);
    await api.close();
});

test('rejects a step whose id does not match its file name', async () => {
    const api = makeStore();
    const dir = createTempDir('steps');
    fs.writeFileSync(path.join(dir, '001-a.js'), "module.exports = { id: '001-b', description: 'x', async up() {} };\n");

    await assert.rejects(runMigrations(api, { dir, log: quiet }), /Migration 001-a\.js: id passt nicht zum Dateinamen/);
    await api.close();
});

test('the shipped migrations folder applies cleanly to an empty database', async () => {
    const api = makeStore();
    const applied = await runMigrations(api, { log: quiet });

    assert.ok(Array.isArray(applied));
    assert.deepEqual(await runMigrations(api, { log: quiet }), []);
    await api.close();
});

test('server does not listen until migrations are done', async () => {
    const dir = createTempDir('slow-migration');
    const server = await startServer('test/fixtures/slowMigrationServer.js', {
        SESSION_SECRET: 'migrate-test-secret',
        SQLITE_PATH: path.join(dir, 'db.sqlite')
    });
    try {
        const output = server.output();
        const done = output.indexOf('MIGRATION_DONE');
        const listening = output.indexOf('DEMS Server running');
        assert.ok(done >= 0, `migrations never ran:\n${output}`);
        assert.ok(listening > done, `server listened before the migrations finished:\n${output}`);
    } finally {
        await server.stop();
    }
});
