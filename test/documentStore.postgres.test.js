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
