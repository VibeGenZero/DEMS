/**
 * Starts server.js with migrations that take 1.5 s, so a test can check
 * that the server only listens once they are done.
 */
const migrate = require('../../db/migrate');

const runMigrations = migrate.runMigrations;
migrate.runMigrations = async (...args) => {
    await new Promise(resolve => setTimeout(resolve, 1500));
    const applied = await runMigrations(...args);
    console.log('MIGRATION_DONE');
    return applied;
};

require('../../server');
