# Schema migrations

DEMS runs every pending step in this folder at startup (`db/migrate.js`), before the server listens. The step ids it has applied are stored in the collection `schemaMigrations`.

## Rules

- File name `NNN-<kebab-name>.js` (e.g. `001-add-event-category.js`); the number sets the order.
- The module exports `{ id, description, up(api) }`. `id` is the file name without `.js`.
- `up(api)` changes data only through `api`, the Firestore-style API of `firebaseAdmin.js` (`collection`, `doc`, `getDocs`, `writeBatch`, …). The same step then runs on PostgreSQL (production) and SQLite (dev mock mode, tests).
- A step must be safe to run twice. DEMS can stop after `up` and before the step is recorded, and then it runs `up` again on the next start.
- Never edit or rename a step once it has run anywhere. Write a new step instead.
- A failing step stops the start with `Migration <id> fehlgeschlagen: …`, and later steps do not run. Fix the step, and the next start continues there.
- Test every step with `node:test` on a SQLite store (see `test/migrate.test.js`).
