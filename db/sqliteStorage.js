/**
 * SQLite storage for db/documentStore.js (dev mock mode and tests).
 *
 * One table `documents (collection, id, data)`; data is JSON text, so the
 * key order of stored objects survives like in PostgreSQL.
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { mergeUpdate, missingDocumentError } = require('./documentStore');

/**
 * Open (or create) a SQLite database file as a storage.
 *
 * @param {string} filePath -> Path of the database file; missing folders are created.
 * @returns {Object} -> Storage, see db/documentStore.js.
 */
function createSqliteStorage(filePath) {
  const dir = path.dirname(filePath);
  if (dir && dir !== '.' && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const sqlite = new Database(filePath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      collection TEXT NOT NULL,
      id         TEXT NOT NULL,
      data       TEXT NOT NULL,
      PRIMARY KEY (collection, id)
    );
    CREATE INDEX IF NOT EXISTS idx_documents_collection ON documents(collection);
  `);

  const stmtGet = sqlite.prepare('SELECT data FROM documents WHERE collection = ? AND id = ?');
  const stmtAll = sqlite.prepare('SELECT id, data FROM documents WHERE collection = ? ORDER BY id');
  const stmtUpsert = sqlite.prepare(
    'INSERT INTO documents (collection, id, data) VALUES (?, ?, ?) ' +
    'ON CONFLICT(collection, id) DO UPDATE SET data = excluded.data'
  );
  const stmtDelete = sqlite.prepare('DELETE FROM documents WHERE collection = ? AND id = ?');

  const readSync = (collection, id) => {
    const row = stmtGet.get(collection, id);
    return row ? JSON.parse(row.data) : undefined;
  };

  const runBatch = sqlite.transaction((ops) => {
    for (const op of ops) {
      if (op.type === 'set') {
        stmtUpsert.run(op.collection, op.id, JSON.stringify(op.data));
      } else if (op.type === 'update') {
        const existing = readSync(op.collection, op.id);
        if (existing === undefined && op.mustExist) throw missingDocumentError(op.collection, op.id);
        stmtUpsert.run(op.collection, op.id, JSON.stringify(mergeUpdate(existing, op.data)));
      } else if (op.type === 'delete') {
        stmtDelete.run(op.collection, op.id);
      } else {
        throw new Error(`sqliteStorage: unbekannte Operation "${op.type}"`);
      }
    }
  });

  return {
    name: 'sqlite',
    async ready() {},
    async read(collection, id) {
      return readSync(collection, id);
    },
    async readAll(collection) {
      return stmtAll.all(collection).map((row) => ({ id: row.id, data: JSON.parse(row.data) }));
    },
    async applyBatch(ops) {
      runBatch(ops);
    },
    async close() {
      if (sqlite.open) sqlite.close();
    }
  };
}

module.exports = { createSqliteStorage };
