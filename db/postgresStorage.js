/**
 * PostgreSQL storage for db/documentStore.js (production).
 *
 * Same single table as SQLite: `documents (collection, id, data)` with data
 * as JSON text (not JSONB, which would reorder object keys). Reads are
 * ordered by id in byte order (COLLATE "C"), like SQLite's BINARY collation.
 */
const { Pool } = require('pg');
const { mergeUpdate, missingDocumentError } = require('./documentStore');

const SCHEMA_PATTERN = /^[a-z_][a-z0-9_]*$/;
const FIRST_RETRY_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 5000;
const DEFAULT_RETRY_TIMEOUT_MS = 60000;
const DEFAULT_CONNECT_TIMEOUT_MS = 5000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Create a PostgreSQL storage. Connects lazily on ready().
 *
 * @param {Object} config -> Passed to new pg.Pool(), e.g. { connectionString } or { host, port, database, user, password }.
 * @param {Object} [options] -> `{ schema = 'public', retryTimeoutMs = 60000 }`.
 * @returns {Object} -> Storage, see db/documentStore.js.
 */
function createPostgresStorage(config, { schema = 'public', retryTimeoutMs = DEFAULT_RETRY_TIMEOUT_MS } = {}) {
  if (!SCHEMA_PATTERN.test(schema)) {
    throw new Error(`postgresStorage: Ungültiger Schema-Name "${schema}"`);
  }
  const table = `"${schema}".documents`;

  const pool = new Pool({ connectionTimeoutMillis: DEFAULT_CONNECT_TIMEOUT_MS, ...config });
  // An idle client that loses its connection must not crash the process
  pool.on('error', (err) => {
    console.error('⚠️ PostgreSQL-Verbindung unterbrochen:', err.message);
  });

  // Run fn with a checked-out client. pg-pool listens for client errors only while a
  // client is idle, so a connection dropped during fn would otherwise emit an unhandled
  // 'error' and crash the process. A broken client is destroyed instead of reused.
  async function withClient(fn) {
    const client = await pool.connect();
    let broken = null;
    const onError = (err) => {
      broken = err;
      console.error('⚠️ PostgreSQL-Verbindung unterbrochen:', err.message);
    };
    client.on('error', onError);
    try {
      return await fn(client, () => { broken = broken || new Error('Verbindung unbrauchbar'); });
    } finally {
      client.off('error', onError);
      client.release(broken || undefined);
    }
  }

  async function createTable() {
    await withClient(async (client) => {
      if (schema !== 'public') await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${table} (
          collection TEXT NOT NULL,
          id         TEXT NOT NULL,
          data       TEXT NOT NULL,
          PRIMARY KEY (collection, id)
        )`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_documents_collection ON ${table} (collection)`);
    });
  }

  // Retry with growing pauses, e.g. while the Postgres container still starts
  async function connectWithRetry() {
    const deadline = Date.now() + retryTimeoutMs;
    let delay = FIRST_RETRY_DELAY_MS;
    for (;;) {
      try {
        await createTable();
        return;
      } catch (err) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error(`PostgreSQL nicht erreichbar: ${err.message}`);
        await sleep(Math.min(delay, remaining));
        delay = Math.min(delay * 2, MAX_RETRY_DELAY_MS);
      }
    }
  }

  let readyPromise = null;
  let closed = false;

  async function runBatch(client, ops) {
    for (const op of ops) {
      if (op.type === 'set') {
        await upsert(client, op.collection, op.id, op.data);
      } else if (op.type === 'update') {
        const { rows } = await client.query(
          `SELECT data FROM ${table} WHERE collection = $1 AND id = $2 FOR UPDATE`, [op.collection, op.id]);
        const existing = rows.length ? JSON.parse(rows[0].data) : undefined;
        if (existing === undefined && op.mustExist) throw missingDocumentError(op.collection, op.id);
        await upsert(client, op.collection, op.id, mergeUpdate(existing, op.data));
      } else if (op.type === 'delete') {
        await client.query(`DELETE FROM ${table} WHERE collection = $1 AND id = $2`, [op.collection, op.id]);
      } else {
        throw new Error(`postgresStorage: unbekannte Operation "${op.type}"`);
      }
    }
  }

  function upsert(client, collection, id, data) {
    return client.query(
      `INSERT INTO ${table} (collection, id, data) VALUES ($1, $2, $3) ` +
      'ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data',
      [collection, id, JSON.stringify(data)]);
  }

  return {
    name: 'postgres',
    ready() {
      if (!readyPromise) {
        readyPromise = connectWithRetry().catch((err) => {
          readyPromise = null;
          throw err;
        });
      }
      return readyPromise;
    },
    async read(collection, id) {
      const { rows } = await pool.query(
        `SELECT data FROM ${table} WHERE collection = $1 AND id = $2`, [collection, id]);
      return rows.length ? JSON.parse(rows[0].data) : undefined;
    },
    async readAll(collection) {
      const { rows } = await pool.query(
        `SELECT id, data FROM ${table} WHERE collection = $1 ORDER BY id COLLATE "C"`, [collection]);
      return rows.map((row) => ({ id: row.id, data: JSON.parse(row.data) }));
    },
    async applyBatch(ops) {
      await withClient(async (client, markBroken) => {
        try {
          await client.query('BEGIN');
          await runBatch(client, ops);
          await client.query('COMMIT');
        } catch (err) {
          // A failed ROLLBACK means the connection itself is gone
          await client.query('ROLLBACK').catch(markBroken);
          throw err;
        }
      });
    },
    async close() {
      if (closed) return;
      closed = true;
      await pool.end();
    }
  };
}

module.exports = { createPostgresStorage };
