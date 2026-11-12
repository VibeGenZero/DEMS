/**
 * The one entry point to the data store.
 *
 * The name is historical: DEMS once ran on Firebase Firestore. Today this
 * file only picks the store and re-exports its Firestore-style API (see
 * db/documentStore.js): PostgreSQL when a connection is configured
 * (compose.yaml), otherwise the built-in SQLite file: a single container,
 * dev mock mode and tests (rules in db/config.js). Callers only ever
 * require this file.
 */
const { postgresConfigFromEnv, selectStoreKind, describeStore } = require('./db/config');

const kind = selectStoreKind(process.env);

console.log(`✅ Datenspeicher: ${describeStore(process.env)}`);

// A single container (docker run) has no PostgreSQL next to it. It must not
// lose its data with the container, so the log names the volume.
if (kind === 'sqlite' && process.env.NODE_ENV === 'production') {
  console.log('ℹ️  Keine PostgreSQL-Verbindung konfiguriert: DEMS nutzt die eingebaute Datenbank (SQLite-Datei). '
    + 'Im Container liegt sie unter /app/data. Starte ihn mit einem Volume (-v dems-data:/app/data), '
    + 'damit die Daten das Löschen des Containers überleben. '
    + 'Für PostgreSQL: compose.yaml nutzen oder DATABASE_URL bzw. PGHOST setzen.');
}

if (kind === 'postgres') {
  const { createDocumentStore } = require('./db/documentStore');
  const { createPostgresStorage } = require('./db/postgresStorage');
  module.exports = createDocumentStore(createPostgresStorage(postgresConfigFromEnv(process.env)));
} else {
  module.exports = require('./db/sqliteAdapter');
}
