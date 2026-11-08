---
id: add-collection
title: How to add a data collection
type: howto
tags: [howto, database, collection, seed, reset, migrations]
sources: [firebaseAdmin.js, dev/seed.js, dev/seedData.js, test/seed.test.js, routes/admin.js]
depends_on: [data-layer, data-model, dev-mock-mode]
see_also: [conventions]
---
# How to add a data collection

> TL;DR: Collections need no migration — just use a new name through the `firebaseAdmin.js` API. To keep tooling consistent, also add it to `SEED_COLLECTIONS` in `dev/seed.js` (so `npm run dev:reset` wipes it), optionally seed sample documents in `dev/seedData.js` (and update `EXPECTED_COUNTS` in `test/seed.test.js`), decide whether the admin system reset should wipe it, and document the shape in the data-model node.

## Checklist

| # | File | Change |
|---|---|---|
| 1 | your code | `collection(db, 'myThings')`, `doc(db, 'myThings', id)`; camelCase plural names like the existing ones |
| 2 | `dev/seed.js` | add to `SEED_COLLECTIONS` |
| 3 | `dev/seedData.js` | optional: `myThings: { 'dev-thing-1': {...} }` in `buildSeedData` |
| 4 | `test/seed.test.js` | update `EXPECTED_COUNTS` if you seeded documents |
| 5 | `routes/admin.js` | optional: add to the `collections` map in `DELETE /reset` (and to the reset modal in `index.html`) |
| 6 | wiki | section in [data-model](../concepts/data-model.md) with producer + fields; `npm run wiki` |

## Rules

- Store dates as ISO strings, ids as strings, booleans as booleans.
- Design queries for in-memory filtering: one or two `where` clauses, sort in JS (no composite indexes, no `limit` in the adapter).
- Singleton settings → one document with a fixed id (pattern: `botSettings/config`).
- Reshaping existing documents of a collection for a release (new required field, renamed field) → a migration step in `db/migrations/` — see [data-layer](../modules/data-layer.md).
