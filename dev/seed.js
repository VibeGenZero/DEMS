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
    throw new Error('dev/seed.js darf nur die lokale SQLite-Datenbank befüllen, nicht PostgreSQL.');
}
const { buildSeedData, buildPluginSeedData } = require('./seedData');
const { collectionName } = require('../plugin-sdk/data');

// Stored names of the plugin collections the seed writes (plugin:<id>:<coll>)
const PLUGIN_SEED_COLLECTIONS = Object.entries(buildPluginSeedData())
    .flatMap(([pluginId, collections]) => Object.keys(collections).map(coll => collectionName(pluginId, coll)));

/** Every collection the seed writes -> wiped completely by resetAndSeed(). */
const SEED_COLLECTIONS = [
    'events',
    'registrations',
    'users',
    'comments',
    'auditLogs',
    'polls',
    'pollVotes',
    'eventTemplates',
    'botMessages',
    'botSettings',
    'maintenanceSettings',
    'calendarFeeds',
    ...PLUGIN_SEED_COLLECTIONS,
    'devMeta'
];

// Marker document -> its existence means the database was seeded
const MARKER_COLLECTION = 'devMeta';
const MARKER_ID = 'seed';
const PLUGIN_STATE_COLLECTION = 'pluginState';

/**
 * Queue all seed documents, the plugin state of seeded plugins and the
 * marker on a write batch.
 *
 * @param {Object} batch -> Result of writeBatch(db).
 * @param {Date} now -> Reference time of the seed.
 * @returns {Promise<Object>} -> Number of documents per collection (without the marker and the plugin state).
 */
async function addSeedToBatch(batch, now) {
    const counts = {};
    const add = (name, documents) => {
        counts[name] = 0;
        for (const [id, data] of Object.entries(documents)) {
            batch.set(doc(db, name, id), data);
            counts[name]++;
        }
    };
    for (const [name, documents] of Object.entries(buildSeedData(now))) add(name, documents);
    for (const [pluginId, collections] of Object.entries(buildPluginSeedData(now))) {
        for (const [coll, documents] of Object.entries(collections)) add(collectionName(pluginId, coll), documents);
        await addPluginStateToBatch(batch, pluginId, Object.keys(collections), now);
    }
    batch.set(doc(db, MARKER_COLLECTION, MARKER_ID), { seededAt: now.toISOString() });
    return counts;
}

/**
 * Record the seeded collections in `pluginState/<id>` (merged, other fields
 * kept), so the account purge and the data wipe see the seeded documents.
 * Without a state yet the plugin is switched on, as the dev mock mode does
 * for official plugins (a state without `enabled` would leave it off).
 */
async function addPluginStateToBatch(batch, pluginId, collections, now) {
    const ref = doc(db, PLUGIN_STATE_COLLECTION, pluginId);
    const snap = await getDoc(ref);
    const current = snap.exists() ? snap.data() : { enabled: true, enabledAt: now.toISOString(), enabledBy: '' };
    const known = Array.isArray(current.collections) ? current.collections : [];
    batch.set(ref, { ...current, collections: [...new Set([...known, ...collections])] });
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
    const counts = await addSeedToBatch(batch, now);
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
    const counts = await addSeedToBatch(batch, now);
    await batch.commit();
    return counts;
}

module.exports = { seedIfEmpty, resetAndSeed, SEED_COLLECTIONS };
