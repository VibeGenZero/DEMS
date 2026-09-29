/**
 * Entry point of `npm run dev:reset`: wipes the dev database and seeds it
 * again. Works while the dev server is running (SQLite in WAL mode).
 */
process.env.DEV_MOCK = 'true';
require('./mockMode');
const { resetAndSeed } = require('./seed');

resetAndSeed()
    .then((counts) => {
        console.log('✅ Dev-Datenbank zurückgesetzt:', counts);
    })
    .catch((err) => {
        console.error('❌ Reset fehlgeschlagen:', err);
        process.exit(1);
    });
