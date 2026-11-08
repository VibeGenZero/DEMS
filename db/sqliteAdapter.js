/**
 * SQLite store for dev mock mode and tests.
 *
 * The Firestore-style API from db/documentStore.js on a SQLite file
 * (SQLITE_PATH, default ./data/dems.sqlite). firebaseAdmin.js loads this
 * module when no PostgreSQL connection is configured outside production.
 */
const path = require('path');
const { createDocumentStore } = require('./documentStore');
const { createSqliteStorage } = require('./sqliteStorage');

const dbPath = process.env.SQLITE_PATH || path.join(process.cwd(), 'data', 'dems.sqlite');

module.exports = createDocumentStore(createSqliteStorage(dbPath));
