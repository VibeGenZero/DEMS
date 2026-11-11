---
id: data-layer
title: Data layer — firebaseAdmin.js, document store, PostgreSQL and SQLite
type: module
tags: [database, postgresql, sqlite, pg, better-sqlite3, adapter, query, migrations]
sources: [firebaseAdmin.js, db/config.js, db/documentStore.js, db/postgresStorage.js, db/sqliteStorage.js, db/sqliteAdapter.js, db/migrate.js, db/migrations/README.md]
part_of: [architecture]
see_also: [data-model, conventions, add-collection]
---
# Data layer — firebaseAdmin.js, document store, PostgreSQL and SQLite

> TL;DR: All persistence goes through `firebaseAdmin.js`, which exports a Firestore-style API (`db, collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc, query, where, orderBy, writeBatch`, plus `ready`, `close`, `storeName`). The name is historical — Firestore is gone since 3.0. `db/documentStore.js` implements the API once on top of a small storage interface; `db/postgresStorage.js` (production) and `db/sqliteStorage.js` (dev mock mode, tests) store JSON text in one `documents` table. Schema migrations in `db/migrations/` run at startup.

## Store selection (`firebaseAdmin.js`, rules in `db/config.js`)

| Environment | Result |
|---|---|
| `DATABASE_URL` or `PGHOST` set (`DATABASE_URL` wins) | PostgreSQL; `PGPASSWORD_FILE` (file content, trimmed) or `PGPASSWORD` |
| neither, `NODE_ENV=production` | `process.exit(1)`: "Keine PostgreSQL-Verbindung konfiguriert …" |
| neither, otherwise | SQLite at `SQLITE_PATH` (default `./data/dems.sqlite`) |
| `DEV_MOCK=true` | always SQLite: `dev/mockMode.js` blanks `DATABASE_URL` and `PG*` |

Empty values count as unset. The startup log names the store without the password (`✅ Datenspeicher: PostgreSQL (postgres:5432/dems)`). `compose.yaml` sets `PGHOST` & co. itself — see [docker](../ops/docker.md).

## Supported API (both stores)

| Function | Notes |
|---|---|
| `collection(db, name)` | collection reference |
| `doc(db, name, id)` / `doc(collectionRef, id)` / `doc(collectionRef)` | missing id → 20-char auto id |
| `getDoc(ref)` | snapshot: `exists()`, `data()`, `id`, `ref` |
| `getDocs(collectionOrQuery)` | snapshot: `docs`, `size`, `empty`, `forEach`; without `orderBy` in id order (byte order) |
| `addDoc(colRef, data)` | returns `{ id }` |
| `setDoc(ref, data)` | full replace (no `{ merge }` option) |
| `updateDoc(ref, partial)` | shallow merge in one transaction; throws `Dokument nicht gefunden: <collection>/<id>` if missing |
| `deleteDoc(ref)` | — |
| `query(colRef, ...constraints)` + `where(field, op, value)` + `orderBy(field, 'asc'\|'desc')` | ops: `== != > >= < <= in not-in array-contains array-contains-any`; dotted field paths work |
| `writeBatch(db)` | `set/update/delete` + `commit()` in one transaction; a batch `update` creates a missing doc |
| `ready()` / `close()` | connect (PostgreSQL retries up to 60 s) / close the pool or file; `server.js` awaits `ready()` before it listens |
| `storeName` | `'postgres'` or `'sqlite'` |

Not available: `limit`, `startAfter`, subcollections, `serverTimestamp`, `Timestamp` types → store dates as ISO strings (`new Date().toISOString()`).

## Internals

- `db/documentStore.js`: references, snapshots, `where`/`orderBy` evaluation, merge rule (`mergeUpdate`). Every query loads the whole collection and filters/sorts in JS (fine for one Discord server's data). The storage interface is documented at the top of the file.
- Table on both stores: `documents (collection TEXT, id TEXT, data TEXT, PRIMARY KEY (collection, id))`. `data` is JSON **text**, never `JSONB`: `JSONB` would reorder object keys, and form answers keyed by label rely on their order.
- `db/postgresStorage.js` (`pg` pool): reads `ORDER BY id COLLATE "C"` (byte order like SQLite), batches in `BEGIN`/`COMMIT` with `SELECT … FOR UPDATE` for updates, `connectionTimeoutMillis` 5 s per attempt. An optional `schema` option isolates the contract tests.
- `db/sqliteStorage.js` (`better-sqlite3`, WAL): synchronous, wrapped in promises; batches in `sqlite.transaction`. `db/sqliteAdapter.js` opens `SQLITE_PATH` with it.
- The `db` sentinel is `{ __type: 'sqlite-db' | 'postgres-db' }`; `dev/seed.js` refuses anything but `sqlite-db`.
- `test/documentStore.contract.js` is the behaviour both stores must share; it runs on SQLite always and on PostgreSQL with `TEST_DATABASE_URL` — see [testing](../ops/testing.md).

## Schema migrations (`db/migrate.js`)

- `runMigrations(api)` runs at every start, after `ready()` and before HTTP, bot and schedulers.
- Steps are `db/migrations/NNN-<kebab-name>.js` exporting `{ id, description, up(api) }`; `id` = file name without `.js`. Applied ids are documents in `schemaMigrations` (`{ appliedAt, description }`).
- A failing step aborts the start (`Migration <id> fehlgeschlagen: …`); later steps do not run. Rules for writing steps: `db/migrations/README.md`.
- 3.0 ships no steps: the PostgreSQL database starts empty.

## Rules

- Import only from `firebaseAdmin.js` (never `pg`, `better-sqlite3` or a `db/*Storage.js` directly; tests excepted).
- Keep queries simple and filter/sort in JS; no composite-index style queries, no `limit`.
- Every new collection name must be added to the seed/reset list in dev mock mode — see [add-collection](../howto/add-collection.md).
- Reshaping stored data for a release → a migration step, not ad-hoc code at startup.

## Gotchas

- `firebaseAdmin.js` keeps its name only to avoid touching ~80 call sites; it has nothing to do with Firebase.
- `getDocs(collection(...))` on big collections loads everything — no pagination at the data layer.
