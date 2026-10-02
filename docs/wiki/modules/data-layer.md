---
id: data-layer
title: Data layer — firebaseAdmin.js and the SQLite adapter
type: module
tags: [database, firestore, sqlite, better-sqlite3, adapter, query]
sources: [firebaseAdmin.js, db/sqliteAdapter.js]
part_of: [architecture]
see_also: [data-model, conventions, add-collection]
---
# Data layer — firebaseAdmin.js and the SQLite adapter

> TL;DR: All persistence goes through `firebaseAdmin.js`, which exports a subset of the Firestore modular API (`db, collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc, query, where, orderBy, writeBatch`). With all six `FIREBASE_*` variables set it is real Firestore (client SDK); with none set it is `db/sqliteAdapter.js`, a JSON document store in one SQLite table that mimics the same API. Partially set → startup error.

## Backend selection (`firebaseAdmin.js`)

| `FIREBASE_*` values | Result |
|---|---|
| none set | SQLite at `SQLITE_PATH` (default `./data/dems.sqlite`), log "nutze lokale SQLite-Datenbank" |
| all six set | Firestore via `firebase/app` + `firebase/firestore` (client SDK, not `firebase-admin`) |
| some set | `process.exit(1)` with the list of missing keys |

## Supported API (both backends)

| Function | Notes |
|---|---|
| `collection(db, name)` | collection reference |
| `doc(db, name, id)` / `doc(collectionRef, id)` / `doc(collectionRef)` | missing id → 20-char auto id |
| `getDoc(ref)` | snapshot: `exists()`, `data()`, `id`, `ref` |
| `getDocs(collectionOrQuery)` | snapshot: `docs`, `size`, `empty`, `forEach` |
| `addDoc(colRef, data)` | returns `{ id }` |
| `setDoc(ref, data)` | full replace (no `{ merge }` option in the adapter) |
| `updateDoc(ref, partial)` | shallow merge; throws if the document does not exist (like Firestore) |
| `deleteDoc(ref)` | — |
| `query(colRef, ...constraints)` + `where(field, op, value)` + `orderBy(field, 'asc'\|'desc')` | ops: `== != > >= < <= in not-in array-contains array-contains-any`; dotted field paths work |
| `writeBatch(db)` | `set/update/delete` + `commit()` (one SQLite transaction) |

Not available: `limit`, `startAfter`, transactions, subcollections, `serverTimestamp`, Firestore `Timestamp` types → store dates as ISO strings (`new Date().toISOString()`).

## SQLite adapter internals (`db/sqliteAdapter.js`)

- One table `documents(collection, id, data)` with primary key `(collection, id)`; `data` is JSON text. WAL mode.
- Every query loads the whole collection and filters/sorts in JS (fine for one Discord server's data).
- `better-sqlite3` is synchronous; the adapter wraps results in promises so callers stay `await`-based.
- Directory of `SQLITE_PATH` is created on startup.

## Rules

- Import only from `firebaseAdmin.js` (never `better-sqlite3`, never `firebase/firestore` directly).
- Avoid queries that need Firestore composite indexes (multiple `where` on different fields + `orderBy`): fetch with simple constraints, then filter/sort in JS. Existing code follows this everywhere ("Sort in memory to avoid Firestore composite index").
- Every new collection name must be added to the seed/reset list in dev mock mode — see [add-collection](../howto/add-collection.md).

## Gotchas

- `firebaseAdmin.js` is a misnomer: it uses the Firebase **client** SDK. Security then depends on Firestore Security Rules, which are not in this repo (audit M-01).
- `getDocs(collection(...))` on big collections loads everything — no pagination at the data layer.
