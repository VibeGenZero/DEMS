# PostgreSQL statt Firestore — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** DEMS runs on PostgreSQL in production (set up automatically by `compose.yaml`), keeps SQLite for dev mock and tests, drops Firestore completely and gains startup schema migrations.

**Architecture:** The storage-independent half of `db/sqliteAdapter.js` (references, snapshots, `where`/`orderBy` evaluation, merge rules) moves into `db/documentStore.js`, which wraps a small async *storage* interface. `db/sqliteStorage.js` (better-sqlite3) and `db/postgresStorage.js` (`pg`) implement that interface on the same `documents` table, so both behave identically by construction; a shared contract test proves it. `firebaseAdmin.js` keeps its name and API and only picks the storage.

**Tech Stack:** Node ≥ 22 (CommonJS), Express 5, better-sqlite3, `pg` (new), `node:test`, Docker Compose, PostgreSQL 18 (`postgres:18-alpine`).

**Spec:** `docs/superpowers/specs/2026-11-08-postgres-replaces-firestore-design.md`

## Global Constraints

- Everything users or operators read (log lines at startup/abort, thrown store errors, `.env.example` comments) in German; code, comments, commits, wiki in English.
- Data access only through `firebaseAdmin.js`; no other file imports `pg`, `better-sqlite3` or a storage module (tests excepted).
- Exported API of `firebaseAdmin.js` stays: `db, collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc, query, where, orderBy, writeBatch`; new: `ready()`, `close()`, `storeName` (`'sqlite'` | `'postgres'`).
- Table on both stores: `documents (collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (collection, id))`; `data` is `JSON.stringify` text, never `JSONB`.
- Store choice: `DATABASE_URL` or `PGHOST` non-empty → PostgreSQL (`DATABASE_URL` wins); else `NODE_ENV=production` → German error on stderr + `process.exit(1)`; else SQLite at `SQLITE_PATH` (default `./data/dems.sqlite`).
- `DEV_MOCK=true` always uses SQLite: mock mode blanks `DATABASE_URL`, `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PGPASSWORD_FILE`.
- Only new dependency: `pg` (caret on the current 8.x).
- Postgres is never published to the host (`compose.yaml` has no `ports:` on it).
- Migration step files `db/migrations/NNN-<kebab-name>.js`, applied ids in collection `schemaMigrations`; a failing step stops the start, later steps never run.
- TDD: write the test, see it fail, implement, see it pass, commit. Branch: `101-r-01-datenmigration-und-abwärtskompatibilität`, PR against `release/3.0`.
- Commits: English imperative subject, why in the body, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Unordered `getDocs` order changes.** A `getDocs` without `orderBy` must return the same order on both stores → both read with `ORDER BY id` (Postgres `COLLATE "C"`, byte order like SQLite). Pinned in Task 1 (`returns documents in id order without orderBy`, mixed-case ids) and run on Postgres in Task 2.
2. **Interleaved `updateDoc` calls lose a write.** Two concurrent `updateDoc` on one document with different fields must keep both → the read-merge-write runs inside one storage transaction. Pinned in Task 1 (`concurrent updateDoc calls keep both fields`).
3. **Postgres not ready yet when the DEMS container starts** (first boot initialises the cluster). DEMS must retry instead of crash-looping → Task 2 (`ready() retries, then gives up with a German message`: against an unreachable port it keeps trying for the timeout before it rejects); the compose `depends_on: service_healthy` in Task 5 covers the normal case.
4. **Password file with trailing newline** (`echo`/`base64` output). Must be trimmed, or authentication fails → Task 3 (`reads and trims PGPASSWORD_FILE`).
5. **A request arriving before migrations finished.** Nothing may listen or run schedulers/bot before `ready()` and migrations resolve → Task 4 (`server does not listen until migrations are done`, a slow migration fixture delays `/healthz`).

---

### Task 1: Shared document store core + SQLite storage

**Files:**
- Create: `db/documentStore.js`, `db/sqliteStorage.js`, `test/documentStore.contract.js` (shared test list, not a `*.test.js`), `test/documentStore.sqlite.test.js`
- Modify: `db/sqliteAdapter.js` (becomes a thin module)
- Test: `test/sqliteAdapter.test.js` stays unchanged and must stay green

**Interfaces:**
- Produces — storage interface (every method async):
  - `name: 'sqlite' | 'postgres'`
  - `ready(): Promise<void>` (creates table/index if missing)
  - `read(collection: string, id: string): Promise<object | undefined>`
  - `readAll(collection: string): Promise<Array<{ id: string, data: object }>>` — ordered by `id` (byte order)
  - `applyBatch(ops: Op[]): Promise<void>` — atomic; `Op` = `{ type: 'set', collection, id, data }` | `{ type: 'update', collection, id, data, mustExist: boolean }` | `{ type: 'delete', collection, id }`; `update` writes `mergeUpdate(existing, data)`; `mustExist` + missing document → throws `Error('Dokument nicht gefunden: <collection>/<id>')` and rolls back the whole batch
  - `close(): Promise<void>`
- Produces — `db/documentStore.js`:
  - `createDocumentStore(storage) -> api` with `db, collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc, query, where, orderBy, writeBatch, ready, close, storeName`
  - `mergeUpdate(existing: object | undefined, updates: object) -> object` (`{ ...(existing || {}), ...updates }`) — storages import it, so the merge rule exists once
  - `generateId() -> string` (20 chars, alphabet as today)
- Produces — `db/sqliteStorage.js`: `createSqliteStorage(filePath: string) -> storage` (creates the parent folder, WAL, table + `idx_documents_collection`, `applyBatch` inside `sqlite.transaction`)
- Produces — `test/documentStore.contract.js`: `defineDocumentStoreContract(label: string, makeStore: () => Promise<{ api, storage, cleanup?: () => Promise<void> }>, options?: { skip?: string | false })`; each test gets a fresh, empty store (`api = createDocumentStore(storage)`), then calls `api.close()` and `cleanup()`.
- `db/sqliteAdapter.js` exports `createDocumentStore(createSqliteStorage(process.env.SQLITE_PATH || path.join(process.cwd(), 'data', 'dems.sqlite')))`.

- [ ] **Step 1: Write the shared contract and the SQLite runner**

`test/documentStore.sqlite.test.js` calls `defineDocumentStoreContract('sqlite', makeStore)` with a store on a new temp file (`createTempDir('store')` from `test/helpers.js`). The contract (inside `describe(label, { skip }, …)`) contains these tests:

```js
test('setDoc and getDoc round-trip, missing doc reports exists() false', ...)
    // setDoc(doc(db,'events','e1'), { title: 'A', n: 1 }) -> getDoc: exists() true, data() deepEqual
    // getDoc(doc(db,'events','nope')).exists() === false, data() === undefined
test('addDoc returns a 20-character id that getDoc finds', ...)
test('updateDoc merges fields and throws on a missing document', ...)
    // await assert.rejects(updateDoc(doc(db,'events','nope'), { a: 1 }), /Dokument nicht gefunden: events\/nope/)
test('deleteDoc removes the document', ...)
test('keeps the key order of stored objects', ...)
    // setDoc with answers { 'Zweitens': 'b', 'Erstens': 'a', '10': 'x' } -> Object.keys(data().answers) deepEqual ['10', 'Zweitens', 'Erstens'] (JS integer-key rule, same as JSON.parse)
test('returns documents in id order without orderBy', ...)
    // ids 'b', 'B', 'a', 'A1' -> getDocs(collection(db,'c')).docs.map(d => d.id) deepEqual ['A1', 'B', 'a', 'b']
test('where supports every operator', ...)
    // one assertion each for == != > >= < <= in not-in array-contains array-contains-any, incl. nested 'meta.level'
test('orderBy sorts by several fields and puts missing values first ascending', ...)
    // orderBy('rank'), orderBy('name','desc'); a doc without 'rank' comes first
test('writeBatch applies set, update and delete together; update creates a missing doc', ...)
test('applyBatch rolls back everything when one operation fails', ...)
    // storage.applyBatch([{ type: 'set', collection: 'c', id: 'x', data: {} },
    //                     { type: 'update', collection: 'c', id: 'missing', data: {}, mustExist: true }])
    // rejects /Dokument nicht gefunden: c\/missing/ ; storage.read('c', 'x') === undefined
test('concurrent updateDoc calls keep both fields', ...)
    // setDoc(d, {}) ; await Promise.all([updateDoc(d,{a:1}), updateDoc(d,{b:2})]) ; data() deepEqual { a: 1, b: 2 }
test('storeName names the storage', ...)
```

`writeBatch().update` keeps today's behaviour (missing doc → created from the update), so it sends `mustExist: false`; `updateDoc` sends `mustExist: true`.

- [ ] **Step 2: Run it and see it fail**

Run: `node --test test/documentStore.sqlite.test.js`
Expected: FAIL — `Cannot find module '../db/documentStore'`.

- [ ] **Step 3: Implement `db/documentStore.js` and `db/sqliteStorage.js`**

Move `getFieldValue`, `matchesWhere`, the sort loop, snapshot builders, `generateId` and the reference builders from `db/sqliteAdapter.js` into `db/documentStore.js` unchanged; the unknown-operator error becomes `documentStore: nicht unterstützter where-Operator "${op}"`. Every API function first awaits `storage.ready()` (memoised promise inside the store). Every write (`addDoc`, `setDoc`, `updateDoc`, `deleteDoc`, `writeBatch().commit()`) goes through `storage.applyBatch`. `readAll` in SQLite: `SELECT id, data FROM documents WHERE collection = ? ORDER BY id`.

- [ ] **Step 4: Rewrite `db/sqliteAdapter.js` as the thin module** (header comment in English: "SQLite store for dev mock mode and tests").

- [ ] **Step 5: Run the store tests and the whole suite**

Run: `node --test test/documentStore.sqlite.test.js test/sqliteAdapter.test.js` → PASS; then `npm test` → PASS (no suite relied on insertion order; if one did, fix the suite only if it asserted an order the code never promised, otherwise stop and report).

- [ ] **Step 6: Commit** — `Extract a shared document store core from the SQLite adapter`

### Task 2: PostgreSQL storage + contract tests in CI

**Files:**
- Create: `db/postgresStorage.js`, `test/documentStore.postgres.test.js`
- Modify: `package.json`, `package-lock.json` (`npm install pg`), `.github/workflows/ci.yml` (job `test`), `.gitlab-ci.yml` (job `test`)

**Interfaces:**
- Consumes: storage interface, `mergeUpdate` (Task 1); `defineDocumentStoreContract` (Task 1)
- Produces: `createPostgresStorage(config: object, options?: { schema?: string, retryTimeoutMs?: number }) -> storage` — `config` goes to `new pg.Pool(config)`; `schema` default `'public'`, must match `/^[a-z_][a-z0-9_]*$/` (else throw), table is `"<schema>".documents`; `ready()` runs `CREATE SCHEMA IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS` (columns as in Global Constraints) and `CREATE INDEX IF NOT EXISTS idx_documents_collection`; `retryTimeoutMs` default `60000`.

- [ ] **Step 1: Write the Postgres runner**

`test/documentStore.postgres.test.js` calls `defineDocumentStoreContract('postgres', makeStore, { skip: process.env.TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL nicht gesetzt' })`. `makeStore` uses `{ connectionString: TEST_DATABASE_URL }` and schema `dems_test_<pid>_<counter>`; its `cleanup` drops the schema (`DROP SCHEMA … CASCADE` via its own `pg.Client`). Plus one Postgres-only test that needs no server (never skipped):

```js
test('ready() retries, then gives up with a German message', ...)
    // createPostgresStorage({ connectionString: 'postgres://dems:x@127.0.0.1:1/dems' }, { retryTimeoutMs: 1500 })
    // await assert.rejects(storage.ready(), /PostgreSQL nicht erreichbar/) ; elapsed >= 1000 ms (it retried)
```

- [ ] **Step 2: Run without and with a database**

Run: `node --test test/documentStore.postgres.test.js` → FAIL — `Cannot find module '../db/postgresStorage'` (the contract part reports skipped with reason `TEST_DATABASE_URL nicht gesetzt` once the module exists).

- [ ] **Step 3: Implement `db/postgresStorage.js`**

`readAll`: `SELECT id, data FROM <table> WHERE collection = $1 ORDER BY id COLLATE "C"`. `applyBatch`: one pooled client, `BEGIN`; for `update` `SELECT data … FOR UPDATE`; `COMMIT`, `ROLLBACK` on any error, release the client. Upsert: `INSERT … ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data`. `ready()`: retry connect + DDL with backoff 500 ms doubling to max 5 s until `retryTimeoutMs`, then throw `Error('PostgreSQL nicht erreichbar: <last error message>')`; memoised. `close()`: `pool.end()`. Register `pool.on('error', …)` logging German so an idle-client error never crashes the process.

- [ ] **Step 4: Wire Postgres into both CI test jobs**

GitHub `test` job: `services.postgres` (`image: postgres:18-alpine`, env `POSTGRES_USER/PASSWORD/DB = dems/dems/dems_test`, health options `pg_isready`, port `5432:5432`), job env `TEST_DATABASE_URL: postgres://dems:dems@localhost:5432/dems_test`. GitLab `test` job: `services: [{ name: postgres:18-alpine, alias: postgres }]`, variables `POSTGRES_USER/PASSWORD/DB` as above, `TEST_DATABASE_URL: postgres://dems:dems@postgres:5432/dems_test`.

- [ ] **Step 5: Verify** — `npm test` locally → PASS with the Postgres suite skipped; push the branch and confirm the GitHub `test` job shows the Postgres contract tests as passed (not skipped).

- [ ] **Step 6: Commit** — `Add a PostgreSQL storage behind the shared document store`

### Task 3: Store selection, Firestore removal, mock mode and config

**Files:**
- Create: `db/config.js`, `test/storeSelection.test.js`
- Modify: `firebaseAdmin.js` (rewrite), `dev/mockMode.js`, `test/mockMode.test.js`, `test/helpers.js` (`LEAKING_PREFIXES`, `LEAKING_KEYS`), `test/login.test.js` (production cookie test), `package.json`/`package-lock.json` (`npm uninstall firebase`), `.env.example`

**Interfaces:**
- Consumes: `createDocumentStore` (Task 1), `createPostgresStorage` (Task 2), `db/sqliteAdapter.js`
- Produces — `db/config.js`:
  - `postgresConfigFromEnv(env) -> object | null` — `DATABASE_URL` → `{ connectionString }`; else `PGHOST` → `{ host, port: Number(PGPORT) || 5432, database: PGDATABASE || 'dems', user: PGUSER || 'dems', password }` with `password` = trimmed content of `PGPASSWORD_FILE` if set, else `PGPASSWORD`; empty strings count as unset; else `null`
  - `selectStoreKind(env) -> 'postgres' | 'sqlite' | 'refuse'`
  - `describeStore(env) -> string` — startup line without secrets, e.g. `PostgreSQL (postgres:5432/dems)` / `SQLite (<path>)`
- Produces — `firebaseAdmin.js`: the API listed in Global Constraints; on `'refuse'` it prints `❌ Keine PostgreSQL-Verbindung konfiguriert. In Produktion braucht DEMS PostgreSQL: DATABASE_URL oder PGHOST setzen (compose.yaml macht das automatisch).` to stderr and exits 1.

- [ ] **Step 1: Write the failing tests**

`test/storeSelection.test.js` (pure functions + `runNode` from `test/helpers.js`):

```js
test('DATABASE_URL wins over PGHOST', ...)          // postgresConfigFromEnv({ DATABASE_URL: 'postgres://u:p@h/db', PGHOST: 'x' }) deepEqual { connectionString: 'postgres://u:p@h/db' }
test('reads and trims PGPASSWORD_FILE', ...)        // file content 'geheim\n' -> password === 'geheim'; PGPASSWORD ignored when the file is set
test('PGHOST with defaults', ...)                   // { PGHOST: 'postgres' } -> { host: 'postgres', port: 5432, database: 'dems', user: 'dems', password: undefined }
test('empty values count as unset', ...)            // { DATABASE_URL: '', PGHOST: '' } -> null; selectStoreKind -> 'sqlite'
test('production without PostgreSQL refuses to start', ...)
    // runNode(`require(${repoPath('firebaseAdmin')})`, { NODE_ENV: 'production' }) -> status 1, stderr matches /Keine PostgreSQL-Verbindung konfiguriert/
test('development without PostgreSQL uses SQLite', ...)
    // runNode prints require(firebaseAdmin).storeName with SQLITE_PATH in a temp dir -> 'sqlite'
test('describeStore never prints the password', ...) // DATABASE_URL 'postgres://u:secret@h:5432/db' -> output does not include 'secret'
```

`test/mockMode.test.js`: replace the `FIREBASE_*` keys and assertions with `DATABASE_URL`, `PGHOST`, `PGPASSWORD_FILE` (forced to `''`); add `test('mock mode uses SQLite even with DATABASE_URL set', …)` → `storeName === 'sqlite'` with `DATABASE_URL: 'postgres://x@127.0.0.1:1/x'`. `test/login.test.js`: the production server gets `DATABASE_URL: process.env.TEST_DATABASE_URL`; the test is `{ skip: !process.env.TEST_DATABASE_URL && 'TEST_DATABASE_URL nicht gesetzt' }`.

- [ ] **Step 2: Run and see them fail** — `node --test test/storeSelection.test.js test/mockMode.test.js` → FAIL (`Cannot find module '../db/config'`, mock assertions on `DATABASE_URL`).

- [ ] **Step 3: Implement** `db/config.js`, rewrite `firebaseAdmin.js` (English header comment: the name is historical, the file only picks the store), replace `FIREBASE_KEYS` in `dev/mockMode.js` by `POSTGRES_KEYS` (the seven variables) and change its log line to `🧪 DEV-MOCK-MODUS aktiv — kein Discord, SQLite: <path>`; `test/helpers.js`: `LEAKING_PREFIXES = ['DISCORD_', 'DEV_', 'PG']`, add `DATABASE_URL` to `LEAKING_KEYS`; `npm uninstall firebase`.

- [ ] **Step 4: `.env.example`** — replace the Firebase block by a German “Datenbank” block: compose sets everything itself; for an external server `DATABASE_URL=` (example `postgres://dems:passwort@host:5432/dems`) or `PGHOST`/`PGPORT`/`PGDATABASE`/`PGUSER`/`PGPASSWORD`/`PGPASSWORD_FILE`; production without PostgreSQL does not start. `SQLITE_PATH` stays, comment “nur Entwicklung und Tests”.

- [ ] **Step 5: Verify** — `npm test` → PASS; `git grep -n -i "firebase/\|FIREBASE_" -- . ":!docs" ":!openspec/changes/archive"` → no hits outside docs (docs follow in Task 6).

- [ ] **Step 6: Commit** — `Pick PostgreSQL or SQLite in firebaseAdmin.js and drop Firestore`

### Task 4: Migration runner and async server startup

**Files:**
- Create: `db/migrate.js`, `db/migrations/README.md`, `test/migrate.test.js`, `test/fixtures/slowMigrationServer.js`
- Modify: `server.js` (startup block at the end, `gracefulShutdown`)

**Interfaces:**
- Consumes: `ready()`, `close()` and the API of `firebaseAdmin.js` (Task 3)
- Produces: `runMigrations(api, options?: { dir?: string, log?: (line: string) => void }) -> Promise<string[]>` — `dir` default `path.join(__dirname, 'migrations')`; returns the ids applied in this run. Step module shape `{ id: string, description: string, up(api): Promise<void> }`; `id` must equal the file name without `.js`, files must match `/^\d{3}-[a-z0-9-]+\.js$/` (others ignored: `README.md`); applied record `setDoc(doc(db, 'schemaMigrations', id), { appliedAt: new Date().toISOString(), description })`. Errors: id mismatch → `Error('Migration <file>: id passt nicht zum Dateinamen')`; failing `up` → `Error('Migration <id> fehlgeschlagen: <message>')`.
- `server.js`: `async function start()` awaits `ready()` then `runMigrations(api)`, then `app.listen`, `startBot`, schedulers and `sweepOrphanBanners` (moved inside, order unchanged). A rejection logs `❌ Start abgebrochen: <message>` and exits 1. `gracefulShutdown` awaits `close()` after stopping bot and schedulers. Env `DEMS_MIGRATIONS_DIR` is **not** added; the fixture below injects its own dir.

- [ ] **Step 1: Write the failing tests** (`test/migrate.test.js`, stores from `db/sqliteStorage.js` on temp files, steps written into temp dirs per test):

```js
test('applies pending steps in number order and records them', ...)
    // 002-b.js and 001-a.js each push their id to a doc -> order ['001-a', '002-b']; schemaMigrations has both with ISO appliedAt
test('runs each step only once', ...)        // second runMigrations returns []
test('stops at a failing step and never runs later ones', ...)
    // 001 ok, 002 throws 'kaputt', 003 writes a marker -> rejects /Migration 002-boom fehlgeschlagen: kaputt/; 003 marker absent; 002 not recorded
test('continues after the failing step was fixed', ...)  // replace 002 with a working one -> returns ['002-boom', '003-later']
test('rejects a step whose id does not match its file name', ...)
test('an empty migrations folder applies nothing', ...)  // runMigrations(api) with the real db/migrations -> []
test('server does not listen until migrations are done', ...)
    // startServer('test/fixtures/slowMigrationServer.js', { SQLITE_PATH, SESSION_SECRET }) ; the fixture patches
    // db/migrate.js's runMigrations (require cache) to wait 1500 ms and log 'MIGRATION_DONE', then requires server.js;
    // assert output() shows 'MIGRATION_DONE' before the 'DEMS Server running' line
```

- [ ] **Step 2: Run and see them fail** — `node --test test/migrate.test.js` → FAIL (`Cannot find module '../db/migrate'`).

- [ ] **Step 3: Implement `db/migrate.js`**, write `db/migrations/README.md` (English: naming, never edit an applied step, steps must be safe to run twice, data only through the `firebaseAdmin.js` API, a failing step stops the start), restructure the end of `server.js` as described.

- [ ] **Step 4: Verify** — `node --test test/migrate.test.js` → PASS; `npm test` → PASS; `npm run dev:mock` starts, `http://localhost:3000/healthz` answers `{ "status": "ok" }`, then stop it.

- [ ] **Step 5: Commit** — `Run schema migrations at startup before the server listens`

### Task 5: Compose with PostgreSQL and CI smoke test

**Files:**
- Modify: `compose.yaml`, `Dockerfile` (runtime stage), `compose.dev.yaml` (header comment only), `.github/workflows/ci.yml` (job `docker-build`), `.gitlab-ci.yml` (job `docker-build`)

**Interfaces:**
- Consumes: `PGHOST`/`PGPORT`/`PGDATABASE`/`PGUSER`/`PGPASSWORD_FILE` handling (Task 3); startup retry (Task 2)
- Produces: volumes `dems-data` (uploads), `dems-pg` (Postgres data), `dems-secrets` (password file `db_password`)

- [ ] **Step 1: `compose.yaml`** — three services:
  - `db-secret`: `image: postgres:18-alpine`, `restart: "no"`, volume `dems-secrets:/secrets`, command (sh): if `/secrets/db_password` is missing or empty, write 32 random bytes as URL-safe base64 without padding/newline (`head -c 32 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=\n'`), then `chmod 0444 /secrets/db_password`; an existing file stays unchanged.
  - `postgres`: `image: postgres:18-alpine`, `restart: unless-stopped`, env `POSTGRES_DB: dems`, `POSTGRES_USER: dems`, `POSTGRES_PASSWORD_FILE: /run/dems-secrets/db_password`, volumes `dems-pg:/var/lib/postgresql` (PG 18 image layout) and `dems-secrets:/run/dems-secrets:ro`, healthcheck `pg_isready -U dems -d dems` (interval 5s, retries 12), `depends_on: { db-secret: { condition: service_completed_successfully } }`, no `ports:`.
  - `dems`: as today minus `SQLITE_PATH`, plus env `PGHOST: postgres`, `PGPORT: 5432`, `PGDATABASE: dems`, `PGUSER: dems`, `PGPASSWORD_FILE: /run/dems-secrets/db_password`, volume `dems-secrets:/run/dems-secrets:ro`, `depends_on: { postgres: { condition: service_healthy } }`.
- [ ] **Step 2: `Dockerfile`** — drop `SQLITE_PATH` from the runtime `ENV`, volume comment “uploaded banners live on a volume”. `compose.dev.yaml` header: “Dev mock mode: no Discord, SQLite, dummy data, auto-reload.”
- [ ] **Step 3: CI `docker-build`** (GitHub and GitLab): keep both `docker build` lines; replace the single `docker run` by `printf 'SESSION_SECRET=ci-only-secret\n' > .env` and `docker compose -f compose.yaml up --detach --build`, then poll `docker inspect --format '{{.State.Health.Status}}' "$(docker compose -f compose.yaml ps -q dems)"` with the existing loop; on failure print `docker compose -f compose.yaml logs`. GitHub path filter regex and GitLab `changes:` also include `db/`.
- [ ] **Step 4: Verify** — `docker compose -f compose.yaml config` renders without errors (where Docker is available); push and confirm the GitHub `docker-build` job reports `health: healthy`. Second check in the same job: `docker compose -f compose.yaml restart dems` and wait for healthy again (the existing password file is reused).
- [ ] **Step 5: Commit** — `Start PostgreSQL with generated credentials in compose.yaml`

### Task 6: Docs, wiki and leftover Firestore mentions

**Files:**
- Modify: `CLAUDE.md` (intro sentence, Rules → Data access, Commands unchanged), `README.md`, `openspec/config.yaml`, code comments/log lines naming Firebase/Firestore as a live store (`utils/sessionStore.js`, `server.js`, `bot/*.js`, `utils/*.js`, `routes/*.js`, `middleware/maintenance.js`, `dev/*.js`, `public/index.html` if user-visible); `updates.json` stays (release news belong to the release ticket)
- Wiki: `docs/wiki/modules/data-layer.md` (new files, storage interface, store choice table), `ops/configuration.md` (new variables, `FIREBASE_*` removed), `ops/docker.md` (three services, volumes), `ops/deployment.md` (Hostinger compose example with the three services, Traefik labels only on `dems`; backup `docker compose exec postgres pg_dump -U dems dems > dems-backup.sql` plus the uploads volume tar), `ops/testing.md` (`TEST_DATABASE_URL`, that its schemas `dems_test_*` and its public `documents` table get written), `ops/ci.md`, `overview/architecture.md`, `overview/directory-map.md`, `concepts/data-model.md`, `concepts/security.md`, `howto/add-collection.md`, `howto/run-and-debug.md`, `modules/dev-mock-mode.md`, `modules/utils.md`, `modules/bot.md`, `howto/add-api-endpoint.md`, `reference/conventions.md`, `docs/wiki/index.md`; `reference/decisions.md` one row “PostgreSQL replaces Firestore (R-01, 2026-11-08)” noting that the Admin-SDK switch (audit M-01) is obsolete; `reference/known-issues.md` remove Firestore-only entries if any.
- Do not touch: `docs/security/SECURITY_AUDIT_2026-04-22.md`, `openspec/changes/archive/`, older specs and plans.

- [ ] **Step 1: Find every mention** — `git grep -n -i "firebase\|firestore" -- . ":!docs/security" ":!openspec/changes/archive" ":!docs/superpowers" ":!package-lock.json"`; the phrase “Firestore-style API” and the file name `firebaseAdmin.js` may stay, every claim that Firestore is a supported store goes.
- [ ] **Step 2: Edit the files above**, add the new source files (`db/*.js`) to the `sources:` of `data-layer.md`.
- [ ] **Step 3: `npm run wiki`**, then `npm test` → PASS (wiki validation included).
- [ ] **Step 4: Re-run Step 1's grep** — only allowed hits remain (API naming, file name, historical docs excluded).
- [ ] **Step 5: Commit** — `Document PostgreSQL as the production store and drop Firestore docs`
- [ ] **Step 6: Open the PR** against `release/3.0` (German: Problem / Ursache / Änderung / Verifikation; `Closes #101`; mention that the VPS compose in `/docker/dems/` must be updated by hand from `docs/wiki/ops/deployment.md`).
