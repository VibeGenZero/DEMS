const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createTempDir, repoPath, runNode, parseLastLine } = require('./helpers');
const { postgresConfigFromEnv, selectStoreKind, describeStore } = require('../db/config');

const PRINT_STORE = `console.log(JSON.stringify(require(${repoPath('firebaseAdmin')}).storeName))`;

test('DATABASE_URL wins over PGHOST', () => {
    assert.deepEqual(
        postgresConfigFromEnv({ DATABASE_URL: 'postgres://u:p@h/db', PGHOST: 'x' }),
        { connectionString: 'postgres://u:p@h/db' });
});

test('reads and trims PGPASSWORD_FILE', () => {
    const file = path.join(createTempDir('pgpass'), 'db_password');
    fs.writeFileSync(file, 'geheim\n');

    const config = postgresConfigFromEnv({ PGHOST: 'postgres', PGPASSWORD: 'ignoriert', PGPASSWORD_FILE: file });
    assert.equal(config.password, 'geheim');
});

test('PGHOST with defaults', () => {
    assert.deepEqual(postgresConfigFromEnv({ PGHOST: 'postgres' }),
        { host: 'postgres', port: 5432, database: 'dems', user: 'dems', password: undefined });
    assert.deepEqual(postgresConfigFromEnv({ PGHOST: 'db', PGPORT: '6543', PGDATABASE: 'x', PGUSER: 'y', PGPASSWORD: 'z' }),
        { host: 'db', port: 6543, database: 'x', user: 'y', password: 'z' });
});

test('empty values count as unset', () => {
    const env = { DATABASE_URL: '', PGHOST: '' };
    assert.equal(postgresConfigFromEnv(env), null);
    assert.equal(selectStoreKind(env), 'sqlite');
    assert.equal(selectStoreKind({ ...env, NODE_ENV: 'production' }), 'refuse');
    assert.equal(selectStoreKind({ PGHOST: 'postgres', NODE_ENV: 'production' }), 'postgres');
});

test('production without PostgreSQL refuses to start', () => {
    const result = runNode(`require(${repoPath('firebaseAdmin')})`, { NODE_ENV: 'production' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Keine PostgreSQL-Verbindung konfiguriert/);
});

test('production with DATABASE_URL uses PostgreSQL', () => {
    const result = runNode(PRINT_STORE, { NODE_ENV: 'production', DATABASE_URL: 'postgres://dems:x@127.0.0.1:1/dems' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(parseLastLine(result.stdout), 'postgres');
});

test('development without PostgreSQL uses SQLite', () => {
    const result = runNode(PRINT_STORE, { SQLITE_PATH: path.join(createTempDir('select'), 'db.sqlite') });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(parseLastLine(result.stdout), 'sqlite');
});

test('describeStore never prints the password', () => {
    const text = describeStore({ DATABASE_URL: 'postgres://u:secret@h:5432/db' });
    assert.match(text, /^PostgreSQL/);
    assert.doesNotMatch(text, /secret/);
    assert.doesNotMatch(describeStore({ PGHOST: 'postgres', PGPASSWORD: 'secret' }), /secret/);
    assert.match(describeStore({ SQLITE_PATH: '/tmp/x.sqlite' }), /^SQLite \(\/tmp\/x\.sqlite\)$/);
});
