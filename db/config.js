/**
 * Which store DEMS uses, read from the environment.
 *
 * PostgreSQL when DATABASE_URL or PGHOST is set (DATABASE_URL wins);
 * otherwise SQLite outside production; production without PostgreSQL
 * refuses to start, so it never writes into a file by accident.
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_PG_PORT = 5432;
const DEFAULT_PG_NAME = 'dems';

// Empty strings count as unset (compose and .env often leave keys empty)
const valueOf = (env, key) => (env[key] ? String(env[key]) : '');

/**
 * Connection settings for pg.Pool, or null when PostgreSQL is not configured.
 *
 * @param {Object} env -> Usually process.env.
 * @returns {Object|null} -> `{ connectionString }` or `{ host, port, database, user, password }`.
 */
function postgresConfigFromEnv(env) {
  const url = valueOf(env, 'DATABASE_URL');
  if (url) return { connectionString: url };

  const host = valueOf(env, 'PGHOST');
  if (!host) return null;

  const passwordFile = valueOf(env, 'PGPASSWORD_FILE');
  const password = passwordFile
    ? fs.readFileSync(passwordFile, 'utf8').trim()
    : (valueOf(env, 'PGPASSWORD') || undefined);

  return {
    host,
    port: Number(valueOf(env, 'PGPORT')) || DEFAULT_PG_PORT,
    database: valueOf(env, 'PGDATABASE') || DEFAULT_PG_NAME,
    user: valueOf(env, 'PGUSER') || DEFAULT_PG_NAME,
    password
  };
}

/**
 * @param {Object} env -> Usually process.env.
 * @returns {'postgres'|'sqlite'|'refuse'}
 */
function selectStoreKind(env) {
  if (valueOf(env, 'DATABASE_URL') || valueOf(env, 'PGHOST')) return 'postgres';
  return env.NODE_ENV === 'production' ? 'refuse' : 'sqlite';
}

/**
 * Store for the startup log line, without any password.
 *
 * @param {Object} env -> Usually process.env.
 * @returns {string} -> e.g. "PostgreSQL (postgres:5432/dems)" or "SQLite (./data/dems.sqlite)".
 */
function describeStore(env) {
  if (selectStoreKind(env) !== 'postgres') {
    return `SQLite (${valueOf(env, 'SQLITE_PATH') || path.join('.', 'data', 'dems.sqlite')})`;
  }
  const url = valueOf(env, 'DATABASE_URL');
  if (url) {
    try {
      const parsed = new URL(url);
      return `PostgreSQL (${parsed.hostname}:${parsed.port || DEFAULT_PG_PORT}${parsed.pathname})`;
    } catch {
      return 'PostgreSQL (DATABASE_URL)';
    }
  }
  const port = valueOf(env, 'PGPORT') || DEFAULT_PG_PORT;
  return `PostgreSQL (${valueOf(env, 'PGHOST')}:${port}/${valueOf(env, 'PGDATABASE') || DEFAULT_PG_NAME})`;
}

module.exports = { postgresConfigFromEnv, selectStoreKind, describeStore };
