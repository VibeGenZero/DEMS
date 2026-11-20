/**
 * Stored plugin state and settings.
 *
 * `pluginState/<id>` holds whether a plugin is switched on, what the admin
 * confirmed and its last error; `pluginSettings/<id>` holds `{ values }`
 * with the admin's settings. Both documents use the plugin id as key.
 */
const { db, collection, doc, getDoc, getDocs, setDoc, deleteDoc } = require('../firebaseAdmin');

const STATE_COLLECTION = 'pluginState';
const SETTINGS_COLLECTION = 'pluginSettings';

/**
 * @typedef {object} PluginState
 * @property {boolean} enabled
 * @property {string} enabledAt -> ISO date or `''`.
 * @property {string} enabledBy -> Admin user id or `''`.
 * @property {string} confirmedVersion -> Version the admin confirmed, or `''`.
 * @property {string[]} confirmedPermissions -> Permissions the admin confirmed.
 * @property {string[]} collections -> Data collections the plugin has used.
 * @property {string} lastError
 * @property {string} lastErrorAt -> ISO date or `''`.
 */

const text = value => (typeof value === 'string' ? value : '');
const list = value => (Array.isArray(value) ? [...value] : []);

/** @returns {PluginState} -> Stored data with missing fields defaulted. */
function normalizeState(data = {}) {
    return {
        enabled: data.enabled === true,
        enabledAt: text(data.enabledAt),
        enabledBy: text(data.enabledBy),
        confirmedVersion: text(data.confirmedVersion),
        confirmedPermissions: list(data.confirmedPermissions),
        collections: list(data.collections),
        lastError: text(data.lastError),
        lastErrorAt: text(data.lastErrorAt)
    };
}

/** @returns {Promise<Map<string, PluginState>>} -> State of every plugin that has one, by id. */
async function readStates() {
    const snapshot = await getDocs(collection(db, STATE_COLLECTION));
    const states = new Map();
    for (const entry of snapshot.docs) states.set(entry.id, normalizeState(entry.data()));
    return states;
}

/**
 * Merge `patch` into the stored state of a plugin.
 *
 * @param {string} id -> Plugin id.
 * @param {Partial<PluginState>} patch -> Fields to change.
 * @example
 * await writeState('event-submissions', { lastError: 'Timeout', lastErrorAt: new Date().toISOString() });
 */
async function writeState(id, patch) {
    const ref = doc(db, STATE_COLLECTION, id);
    const snap = await getDoc(ref);
    const current = snap.exists() ? snap.data() : {};
    await setDoc(ref, { ...current, ...patch });
}

/** Remove the stored state of a plugin (no error when there is none). */
async function deleteState(id) {
    await deleteDoc(doc(db, STATE_COLLECTION, id));
}

/** @returns {Promise<object>} -> Stored setting values of a plugin, `{}` when none. */
async function readSettings(id) {
    const snap = await getDoc(doc(db, SETTINGS_COLLECTION, id));
    const values = snap.exists() ? snap.data().values : null;
    return values && typeof values === 'object' && !Array.isArray(values) ? { ...values } : {};
}

/** Replace the stored setting values of a plugin. */
async function writeSettings(id, values) {
    await setDoc(doc(db, SETTINGS_COLLECTION, id), { values: { ...values } });
}

/** Remove the stored settings of a plugin (no error when there are none). */
async function deleteSettings(id) {
    await deleteDoc(doc(db, SETTINGS_COLLECTION, id));
}

module.exports = { readStates, writeState, deleteState, readSettings, writeSettings, deleteSettings, normalizeState };
