/**
 * Entry point of the dev mock mode (`npm run dev:mock`).
 *
 * Forces the mock environment, seeds the dev database on the first start and
 * then starts the regular server.
 */
process.env.DEV_MOCK = 'true';
require('./mockMode');
const { seedIfEmpty } = require('./seed');

seedIfEmpty().then(
    () => require('../server'),
    (err) => {
        console.error('❌ Dev-Seed fehlgeschlagen:', err);
        process.exit(1);
    }
);
