/**
 * Namespaced data API for plugins (`ctx.data`).
 *
 * Every collection a plugin uses is stored as `plugin:<id>:<coll>`, so two
 * plugins can use the same `coll` without seeing each other's documents.
 * Collection names, document ids, operators and values are validated before
 * anything reaches `firebaseAdmin.js`; documents go in and out as deep
 * copies. The host records which collections a plugin used (injected
 * `recordCollection`) so it can purge a user's data or wipe a plugin later.
 */
const {
    db, collection, doc, getDoc, getDocs, query, where, addDoc, setDoc, updateDoc, deleteDoc, writeBatch
} = require('../firebaseAdmin');
const { PluginDataError } = require('./errors');

const COLLECTION_PATTERN = /^[a-z][a-zA-Z0-9]{0,31}$/;
const WHERE_OPS = new Set(['==', '!=', '<', '<=', '>', '>=', 'in']);
const MAX_ID_LENGTH = 128;
const BATCH_SIZE = 500;

/** @returns {string} -> Stored collection name, e.g. `plugin:event-submissions:items`. */
function collectionName(pluginId, coll) {
    return `plugin:${pluginId}:${coll}`;
}

const isValidCollection = coll => typeof coll === 'string' && COLLECTION_PATTERN.test(coll);

function checkCollection(coll) {
    if (!isValidCollection(coll)) throw new PluginDataError(`Ungültiger Sammlungsname: ${coll}`);
}

function checkId(id) {
    if (typeof id !== 'string' || id.length < 1 || id.length > MAX_ID_LENGTH || id.includes('/')) {
        throw new PluginDataError('Ungültige Dokument-ID.');
    }
}

/** @returns {object} -> Deep copy of a plain object; anything else throws. */
function copyInput(value) {
    const proto = value !== null && typeof value === 'object' ? Object.getPrototypeOf(value) : undefined;
    if (proto !== Object.prototype && proto !== null) {
        throw new PluginDataError('Ungültige Daten: Es wird ein Objekt erwartet.');
    }
    return structuredClone(value);
}

/** @returns {object} -> `{ id, ...data }` as a copy; the document id wins over a stored `id` field. */
function toPlain(id, data) {
    const { id: _storedId, ...rest } = structuredClone(data);
    return { id, ...rest };
}

/**
 * Data API for one plugin.
 *
 * @param {string} pluginId -> Manifest id of the plugin.
 * @param {{ recordCollection: (coll: string) => Promise<void> }} options -> Called once per
 *     collection before its first write.
 * @example
 * const data = createDataApi('event-submissions', { recordCollection });
 * const item = await data.add('submissions', { userId: '123', title: 'Raid' });
 */
function createDataApi(pluginId, { recordCollection }) {
    const recorded = new Map();
    const ref = coll => collection(db, collectionName(pluginId, coll));

    /** Await recordCollection once per coll; a failed call is retried on the next write. */
    function record(coll) {
        if (!recorded.has(coll)) {
            const pending = Promise.resolve().then(() => recordCollection(coll));
            pending.catch(() => recorded.delete(coll));
            recorded.set(coll, pending);
        }
        return recorded.get(coll);
    }

    async function get(coll, id) {
        checkCollection(coll);
        checkId(id);
        const snap = await getDoc(doc(ref(coll), id));
        return snap.exists() ? toPlain(snap.id, snap.data()) : null;
    }

    async function list(coll) {
        checkCollection(coll);
        const snapshot = await getDocs(ref(coll));
        return snapshot.docs.map(entry => toPlain(entry.id, entry.data()));
    }

    async function whereDocs(coll, field, op, value) {
        checkCollection(coll);
        if (typeof field !== 'string' || field === '') throw new PluginDataError('Ungültiges Feld.');
        if (!WHERE_OPS.has(op)) throw new PluginDataError(`Ungültiger Vergleichsoperator: ${op}`);
        if (op === 'in' && !Array.isArray(value)) {
            throw new PluginDataError('Ungültiger Wert: „in“ erwartet eine Liste.');
        }
        const snapshot = await getDocs(query(ref(coll), where(field, op, value)));
        return snapshot.docs.map(entry => toPlain(entry.id, entry.data()));
    }

    async function add(coll, obj) {
        checkCollection(coll);
        const data = copyInput(obj);
        await record(coll);
        const { id } = await addDoc(ref(coll), data);
        return toPlain(id, data);
    }

    async function set(coll, id, obj) {
        checkCollection(coll);
        checkId(id);
        const data = copyInput(obj);
        await record(coll);
        await setDoc(doc(ref(coll), id), data);
        return toPlain(id, data);
    }

    async function update(coll, id, patch) {
        checkCollection(coll);
        checkId(id);
        const data = copyInput(patch);
        await record(coll);
        const target = doc(ref(coll), id);
        if (!(await getDoc(target)).exists()) throw new PluginDataError(`Dokument nicht gefunden: ${id}`);
        await updateDoc(target, data);
        const snap = await getDoc(target);
        return toPlain(id, snap.data());
    }

    async function remove(coll, id) {
        checkCollection(coll);
        checkId(id);
        await record(coll);
        await deleteDoc(doc(ref(coll), id));
    }

    return { get, list, where: whereDocs, add, set, update, delete: remove };
}

/** Delete `refs` in batches of BATCH_SIZE. @returns {Promise<number>} -> Deleted count. */
async function deleteInBatches(refs) {
    for (let start = 0; start < refs.length; start += BATCH_SIZE) {
        const batch = writeBatch(db);
        for (const entry of refs.slice(start, start + BATCH_SIZE)) batch.delete(entry);
        await batch.commit();
    }
    return refs.length;
}

/**
 * Delete every document whose `userId` equals `userId` (compared as strings)
 * in the listed collections of each plugin. Invalid collection names are skipped.
 *
 * @param {string} userId -> Discord user id.
 * @param {Map<string, string[]>} collectionsByPlugin -> Plugin id → collections it used.
 * @returns {Promise<number>} -> Number of deleted documents.
 */
async function purgeUserData(userId, collectionsByPlugin) {
    const wanted = String(userId);
    const refs = [];
    for (const [pluginId, collections] of collectionsByPlugin) {
        for (const coll of collections) {
            if (!isValidCollection(coll)) continue;
            const snapshot = await getDocs(collection(db, collectionName(pluginId, coll)));
            for (const entry of snapshot.docs) {
                const owner = entry.data().userId;
                if (owner !== undefined && owner !== null && String(owner) === wanted) refs.push(entry.ref);
            }
        }
    }
    return deleteInBatches(refs);
}

/**
 * Delete every document in the listed collections of one plugin.
 * Invalid collection names are skipped.
 *
 * @returns {Promise<number>} -> Number of deleted documents.
 */
async function wipePluginData(pluginId, collections) {
    const refs = [];
    for (const coll of collections) {
        if (!isValidCollection(coll)) continue;
        const snapshot = await getDocs(collection(db, collectionName(pluginId, coll)));
        for (const entry of snapshot.docs) refs.push(entry.ref);
    }
    return deleteInBatches(refs);
}

module.exports = { collectionName, createDataApi, purgeUserData, wipePluginData };
