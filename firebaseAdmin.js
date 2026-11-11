/**
 * The one entry point to the data store.
 *
 * The name is historical: DEMS once ran on Firebase Firestore. Today this
 * file only picks the store and re-exports its Firestore-style API (see
 * db/documentStore.js): PostgreSQL in production, SQLite for dev mock mode
 * and tests (rules in db/config.js). Callers only ever require this file.
 */
const { postgresConfigFromEnv, selectStoreKind, describeStore } = require('./db/config');

const kind = selectStoreKind(process.env);

if (kind === 'refuse') {
  console.error('❌ Keine PostgreSQL-Verbindung konfiguriert. In Produktion braucht DEMS PostgreSQL: '
    + 'DATABASE_URL oder PGHOST setzen (compose.yaml macht das automatisch).');
  process.exit(1);
}

console.log(`✅ Datenspeicher: ${describeStore(process.env)}`);

if (kind === 'postgres') {
  const { createDocumentStore } = require('./db/documentStore');
  const { createPostgresStorage } = require('./db/postgresStorage');
  module.exports = createDocumentStore(createPostgresStorage(postgresConfigFromEnv(process.env)));
} else {
  module.exports = require('./db/sqliteAdapter');
}
