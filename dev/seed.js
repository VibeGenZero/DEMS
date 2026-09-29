/**
 * Seeding of the dev mock database.
 *
 * Refuses to load outside the dev mock mode, so the dummy data can never be
 * written into - and a reset never wipe - a real database.
 */
const { IS_MOCK_MODE } = require('./mockMode');

if (!IS_MOCK_MODE) {
    throw new Error('dev/seed.js darf nur im Dev-Mock-Modus (DEV_MOCK=true) geladen werden.');
}

const { db, collection, doc, getDoc, getDocs, writeBatch } = require('../firebaseAdmin');

// Defense in depth: never seed or wipe anything but the local SQLite file
if (db.__type !== 'sqlite-db') {
    throw new Error('dev/seed.js darf nur die lokale SQLite-Datenbank befüllen, nicht Firebase.');
}
const { buildSeedData } = require('./seedData');

/** Every collection the seed writes -> wiped completely by resetAndSeed(). */
const SEED_COLLECTIONS = [
    'events',
    'registrations',
    'users',
    'comments',
    'auditLogs',
    'botMessages',
    'botSettings',
    'maintenanceSettings',
    'devMeta'
];

// Marker document -> its existence means the database was seeded
const MARKER_COLLECTION = 'devMeta';
const MARKER_ID = 'seed';

/**
 * Queue all seed documents plus the marker on a write batch.
 *
 * @param {Object} batch -> Result of writeBatch(db).
 * @param {Date} now -> Reference time of the seed.
 * @returns {Object} -> Number of documents per collection (without the marker).
 */
function addSeedToBatch(batch, now) {
    const counts = {};
    for (const [name, documents] of Object.entries(buildSeedData(now))) {
        counts[name] = 0;
        for (const [id, data] of Object.entries(documents)) {
            batch.set(doc(db, name, id), data);
            counts[name]++;
        }
    }
    batch.set(doc(db, MARKER_COLLECTION, MARKER_ID), { seededAt: now.toISOString() });
    return counts;
}

/**
 * Seed the database unless it was seeded before.
 *
 * @param {Date} [now] -> Reference time of the seed.
 * @returns {Promise<Object|null>} -> Counts per collection, null when nothing was written.
 */
async function seedIfEmpty(now = new Date()) {
    const marker = await getDoc(doc(db, MARKER_COLLECTION, MARKER_ID));
    if (marker.exists()) {
        console.log(`🌱 Dev-Daten vom ${marker.data().seededAt} vorhanden — neu anlegen (Termine auf jetzt): npm run dev:reset`);
        return null;
    }

    const batch = writeBatch(db);
    const counts = addSeedToBatch(batch, now);
    await batch.commit();
    console.log('🌱 Dev-Daten angelegt:', counts);
    return counts;
}

/**
 * Wipe every seed collection and write the seed again, in one transaction.
 *
 * @param {Date} [now] -> Reference time of the seed.
 * @returns {Promise<Object>} -> Counts per collection.
 */
async function resetAndSeed(now = new Date()) {
    const batch = writeBatch(db);
    for (const name of SEED_COLLECTIONS) {
        const snapshot = await getDocs(collection(db, name));
        snapshot.forEach(document => batch.delete(document.ref));
    }
    const counts = addSeedToBatch(batch, now);
    await batch.commit();
    return counts;
}

module.exports = { seedIfEmpty, resetAndSeed, SEED_COLLECTIONS };
