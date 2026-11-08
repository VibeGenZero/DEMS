/**
 * Schema migrations: numbered steps in db/migrations/, run once each at startup.
 *
 * A step file `NNN-<kebab-name>.js` exports { id, description, up(api) },
 * where api is the Firestore-style API of firebaseAdmin.js, so a step runs
 * on PostgreSQL and SQLite alike. Applied steps are recorded in the
 * collection `schemaMigrations` (document id = step id). A failing step
 * stops the run; later steps never run before it succeeds. Rules for
 * writing steps: db/migrations/README.md.
 */
const fs = require('fs');
const path = require('path');

const STEP_FILE = /^\d{3}-[a-z0-9-]+\.js$/;
const DEFAULT_DIR = path.join(__dirname, 'migrations');

/**
 * Apply all pending steps in number order.
 *
 * @param {Object} api -> Firestore-style API (firebaseAdmin.js or createDocumentStore()).
 * @param {Object} [options] -> `{ dir = db/migrations, log = console.log }`.
 * @returns {Promise<string[]>} -> Ids of the steps applied in this run.
 */
async function runMigrations(api, { dir = DEFAULT_DIR, log = console.log } = {}) {
  const { db, collection, doc, getDocs, setDoc } = api;
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((file) => STEP_FILE.test(file)).sort() : [];
  if (files.length === 0) return [];

  const done = new Set((await getDocs(collection(db, 'schemaMigrations'))).docs.map((snap) => snap.id));
  const applied = [];

  for (const file of files) {
    const expectedId = file.slice(0, -'.js'.length);
    if (done.has(expectedId)) continue;

    // Always load the current file, never a cached older version
    const modulePath = path.join(dir, file);
    delete require.cache[require.resolve(modulePath)];
    const step = require(modulePath);
    if (step.id !== expectedId) {
      throw new Error(`Migration ${file}: id passt nicht zum Dateinamen`);
    }

    log(`🔧 Migration ${step.id}: ${step.description}`);
    try {
      await step.up(api);
    } catch (err) {
      throw new Error(`Migration ${step.id} fehlgeschlagen: ${err.message}`);
    }
    await setDoc(doc(db, 'schemaMigrations', step.id), {
      appliedAt: new Date().toISOString(),
      description: step.description
    });
    applied.push(step.id);
  }
  return applied;
}

module.exports = { runMigrations };
