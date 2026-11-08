const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const { defineDocumentStoreContract } = require('./documentStore.contract');
const { createDocumentStore } = require('../db/documentStore');
const { createPostgresStorage } = require('../db/postgresStorage');

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
let schemaCounter = 0;

// Every store gets its own schema, dropped again afterwards
defineDocumentStoreContract('postgres', async () => {
    const schema = `dems_test_${process.pid}_${++schemaCounter}`;
    const storage = createPostgresStorage({ connectionString: TEST_DATABASE_URL }, { schema });
    const cleanup = async () => {
        const client = new Client({ connectionString: TEST_DATABASE_URL });
        await client.connect();
        try {
            await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        } finally {
            await client.end();
        }
    };
    return { api: createDocumentStore(storage), storage, cleanup };
}, { skip: TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL nicht gesetzt' });

test('a connection dropped during a write rejects the write and keeps the process alive', {
    skip: TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL nicht gesetzt'
}, async () => {
    const schema = `dems_test_${process.pid}_drop`;
    const storage = createPostgresStorage({ connectionString: TEST_DATABASE_URL }, { schema });
    const locker = new Client({ connectionString: TEST_DATABASE_URL });
    await locker.connect();
    try {
        await storage.ready();
        await storage.applyBatch([{ type: 'set', collection: 'c', id: 'x', data: { n: 0 } }]);

        // Hold the row lock, so the update below waits inside its transaction
        await locker.query('BEGIN');
        await locker.query(`SELECT 1 FROM "${schema}".documents WHERE id = 'x' FOR UPDATE`);
        const write = storage.applyBatch([{ type: 'update', collection: 'c', id: 'x', data: { n: 1 }, mustExist: true }]);
        const settled = write.then(() => 'resolved', (err) => err);

        // Kill the backend of the waiting write, like a database restart would
        let killed = 0;
        for (let i = 0; i < 50 && killed === 0; i++) {
            const { rows } = await locker.query(
                "SELECT pg_terminate_backend(pid) AS ok FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND wait_event_type = 'Lock' AND query LIKE '%FOR UPDATE%'");
            killed = rows.length;
            if (!killed) await new Promise(resolve => setTimeout(resolve, 50));
        }
        assert.equal(killed, 1, 'the waiting write was never seen');

        const result = await settled;
        assert.ok(result instanceof Error, 'the write must reject');
        await locker.query('ROLLBACK');

        // The pool dropped the broken client: the next write works
        await storage.applyBatch([{ type: 'update', collection: 'c', id: 'x', data: { n: 2 }, mustExist: true }]);
        assert.deepEqual(await storage.read('c', 'x'), { n: 2 });
    } finally {
        await locker.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
        await locker.end();
        await storage.close();
    }
});

test('ready() retries, then gives up with a German message', async () => {
    // Port 1 never answers -> every attempt fails at once
    const storage = createPostgresStorage({ connectionString: 'postgres://dems:x@127.0.0.1:1/dems' }, { retryTimeoutMs: 1500 });
    const startedAt = Date.now();
    try {
        await assert.rejects(storage.ready(), /PostgreSQL nicht erreichbar/);
        assert.ok(Date.now() - startedAt >= 1000, 'ready() gave up without retrying');
    } finally {
        await storage.close();
    }
});

test('an invalid schema name is refused', () => {
    assert.throws(() => createPostgresStorage({}, { schema: 'drop table; --' }), /Ungültiger Schema-Name/);
});
