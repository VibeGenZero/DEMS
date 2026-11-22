/**
 * Plugin host: the lifecycle of every plugin in one DEMS process.
 *
 * At `start()` it discovers the plugin folders, reads `pluginState` and
 * requires only the `server.js` of plugins that are switched on and
 * confirmed; `register(ctx)` gets a timeout, and one broken plugin never
 * stops the others or the start of DEMS. At runtime it switches plugins on
 * and off (Node cannot unload a module, so switching on again reuses the
 * first registration), builds the admin views, validates settings and
 * deletes plugin data. All state writes of one plugin go through one promise
 * chain, because `writeState` is a read-merge-write without a transaction.
 */
const path = require('path');
const { discoverPlugins } = require('./discovery');
const state = require('./state');
const { purgeUserData, wipePluginData } = require('./data');
const { deleteTheme } = require('./theme');
const { createMessageLimiter } = require('./discord');
const { setHookGate, setHookErrorReporter, clearHooks } = require('./hooks');
const { createContext } = require('./context');
const { buildView } = require('./views');
const { PluginHostError } = require('./errors');

const DEFAULT_REGISTER_TIMEOUT_MS = 5000;
const DEFAULT_DISABLE_TIMEOUT_MS = 2000;
const MAX_ERROR_LENGTH = 500;
const MAX_SETTING_LENGTH = 4000;
const SNOWFLAKE = /^\d{17,20}$/;

const MESSAGES = {
    notFound: 'Plugin nicht gefunden.',
    cannotEnable: 'Dieses Plugin kann nicht eingeschaltet werden.',
    safeMode: 'Abgesicherter Modus aktiv – Plugins lassen sich nicht einschalten.',
    noSettings: 'Für dieses Plugin lassen sich keine Einstellungen speichern.',
    badValues: 'Die Einstellungen müssen ein Objekt sein.'
};

/** @typedef {import('./views').PluginView} PluginView */

const nowIso = () => new Date().toISOString();
const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const errorMessage = err => String((err && err.message) || err || 'Unbekannter Fehler').slice(0, MAX_ERROR_LENGTH);
const seconds = ms => String(ms / 1000).replace('.', ',');

/** Resolve with `promise`, or reject with `message` after `ms`. */
async function withTimeout(promise, ms, message) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
    });
    try {
        return await Promise.race([promise, timeout]);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Check one submitted setting value against its schema entry.
 *
 * @returns {unknown} -> The value to store, undefined for "empty" (`null`, `''`).
 */
function checkSetting(setting, raw) {
    const fail = reason => {
        throw new PluginHostError(`„${setting.label}“: ${reason}`);
    };
    if (raw === null) return undefined;
    if (setting.type === 'boolean') {
        if (typeof raw !== 'boolean') fail('Erwartet Ja oder Nein.');
        return raw;
    }
    if (setting.type === 'number') {
        if (raw === '') return undefined;
        if (typeof raw !== 'number' || !Number.isFinite(raw)) fail('Erwartet eine Zahl.');
        return raw;
    }
    if (typeof raw !== 'string') fail('Erwartet einen Text.');
    if (raw.trim() === '') return undefined;
    if (raw.length > MAX_SETTING_LENGTH) fail(`Höchstens ${MAX_SETTING_LENGTH} Zeichen.`);
    if (setting.type === 'select') {
        const values = setting.options.map(option => (typeof option === 'string' ? option : option.value));
        if (!values.includes(raw)) fail('Dieser Wert steht nicht zur Auswahl.');
    }
    if ((setting.type === 'channel' || setting.type === 'role') && !SNOWFLAKE.test(raw)) fail('Erwartet eine Discord-ID.');
    return raw;
}

/**
 * Create the plugin host.
 *
 * @param {object} options
 * @param {string} options.officialDir -> Folder of the official plugins (`<app>/plugins`).
 * @param {string} [options.customDir] -> Folder of the custom plugins (`PLUGINS_DIR`).
 * @param {boolean} [options.safeMode=false] -> Load no plugin code at all.
 * @param {boolean} [options.mockMode=false] -> Dev mock mode: official plugins without state start on.
 * @param {number} [options.registerTimeoutMs=5000]
 * @param {number} [options.disableTimeoutMs=2000] -> Per `onDisable` callback.
 * @param {(file: string) => object} [options.requireModule=require] -> Loads a plugin's `server.js`.
 * @example
 * const host = createPluginHost({ officialDir: 'plugins', customDir: 'data/plugins' });
 * await host.start();
 * host.list(); // [{ id: 'event-submissions', status: 'off', statusText: 'Aus', ... }]
 */
function createPluginHost({
    officialDir, customDir, safeMode = false, mockMode = false,
    registerTimeoutMs = DEFAULT_REGISTER_TIMEOUT_MS, disableTimeoutMs = DEFAULT_DISABLE_TIMEOUT_MS,
    requireModule = require
}) {
    const limiter = createMessageLimiter();
    /** @type {import('./discovery').PluginEntry[]} every discovered folder, in discovery order */
    let entries = [];
    /** @type {Map<string, object>} plugin id -> record (discovered plugin or orphaned state entry) */
    const records = new Map();
    /** @type {Map<string, Promise<unknown>>} plugin id -> tail of its state/settings write chain */
    const writeChains = new Map();
    /** @type {Map<string, Promise<unknown>>} plugin id -> tail of its switch chain */
    const switchChains = new Map();
    let started = null;

    function chain(chains, id, task) {
        const run = (chains.get(id) || Promise.resolve()).then(task);
        chains.set(id, run.catch(() => {}));
        return run;
    }

    const serializeWrite = (id, task) => chain(writeChains, id, task);

    /** Apply `patch` to the in-memory state now and store it in order with the plugin's other writes. */
    function persist(record, patch) {
        record.state = { ...state.normalizeState(record.state || {}), ...patch };
        return serializeWrite(record.id, () => state.writeState(record.id, patch));
    }

    function newRecord(id, entry, storedState) {
        return {
            id,
            entry,
            state: storedState,
            runtime: 'off',
            registered: false,
            loadError: '',
            loading: null,
            ctx: null,
            routes: [],
            disableCallbacks: [],
            profileProvider: null
        };
    }

    const isLoadable = record => Boolean(record.entry && record.entry.manifest && !record.entry.status);

    /** A custom plugin needs a new confirmation when its version or permissions changed. */
    function needsConfirmation(record) {
        const { entry } = record;
        if (entry.official) return false;
        const confirmed = state.normalizeState(record.state || {});
        const known = new Set(confirmed.confirmedPermissions);
        return confirmed.confirmedVersion !== entry.manifest.version
            || entry.manifest.permissions.some(permission => !known.has(permission));
    }

    /**
     * What one ctx shares with the host. Each ctx has its own open flag: a ctx
     * whose register failed stays sealed, also while a retry runs with a new one.
     */
    function contextHost(record, attempt) {
        return {
            limiter,
            routes: record.routes,
            disableCallbacks: record.disableCallbacks,
            isRegistering: () => attempt.open,
            setProfileProvider: provider => { record.profileProvider = provider; },
            recordCollection: async coll => {
                const current = state.normalizeState(record.state || {}).collections;
                if (current.includes(coll)) return;
                await persist(record, { collections: [...current, coll] });
            }
        };
    }

    async function runDisableCallbacks(record) {
        for (const fn of record.disableCallbacks) {
            try {
                await withTimeout(Promise.resolve().then(fn), disableTimeoutMs,
                    `onDisable hat nicht innerhalb von ${seconds(disableTimeoutMs)} s geantwortet.`);
            } catch (err) {
                console.error(`[plugin:${record.id}] onDisable failed: ${errorMessage(err)}`);
            }
        }
    }

    /** Store that the last register attempt worked: an old register error is no longer shown. */
    async function clearLoadError(record) {
        const stored = state.normalizeState(record.state || {});
        if (!stored.lastError && !stored.lastErrorAt) return;
        try {
            await persist(record, { lastError: '', lastErrorAt: '' });
        } catch (err) {
            console.error(`[plugin:${record.id}] Clearing the error failed:`, err.message);
        }
    }

    /**
     * Require `server.js` and run `register(ctx)`. The ctx is built once; only a
     * retry after a failed register gets a fresh one (with fresh route and
     * callback lists), so the failed ctx cannot add anything during the retry.
     */
    async function register(record) {
        const { entry } = record;
        if (record.loadError) {
            record.loadError = '';
            record.routes = [];
            record.disableCallbacks = [];
            record.profileProvider = null;
        }
        if (!entry.manifest.server) {
            record.registered = true;
            return;
        }
        // register runs again only after a failed attempt, so a working plugin keeps its one ctx
        const attempt = { open: true };
        record.ctx = createContext({ entry, host: contextHost(record, attempt) });
        try {
            const mod = requireModule(path.join(entry.dir, entry.manifest.server));
            if (!mod || typeof mod.register !== 'function') throw new Error('server.js exportiert keine Funktion register(ctx).');
            await withTimeout(Promise.resolve().then(() => mod.register(record.ctx)), registerTimeoutMs,
                `register() hat nicht innerhalb von ${seconds(registerTimeoutMs)} s geantwortet.`);
            record.registered = true;
        } catch (err) {
            record.loadError = errorMessage(err);
            console.error(`[plugin:${record.id}] register failed: ${record.loadError}`);
        } finally {
            attempt.open = false;
        }
        if (record.registered) {
            await clearLoadError(record);
            return;
        }
        // Drop what the failed register left behind; switching on again retries with a fresh ctx
        clearHooks(record.id);
        record.routes.length = 0;
        record.profileProvider = null;
        await runDisableCallbacks(record);
        record.disableCallbacks.length = 0;
        try {
            await persist(record, { lastError: record.loadError, lastErrorAt: nowIso() });
        } catch (err) {
            console.error(`[plugin:${record.id}] Storing the error failed:`, err.message);
        }
    }

    /** Switch a loadable record on: register on first use (or after a failed one), reuse it afterwards. */
    async function load(record) {
        if (!record.registered) {
            if (!record.loading) record.loading = register(record).finally(() => { record.loading = null; });
            await record.loading;
        }
        record.runtime = record.registered ? 'on' : 'error';
    }

    async function startPlugin(record) {
        if (!record.state && record.entry.official && mockMode) {
            await persist(record, { enabled: true, enabledAt: nowIso(), enabledBy: '' });
        }
        if (!record.state || !record.state.enabled) return;
        if (needsConfirmation(record)) {
            record.runtime = 'confirm';
            return;
        }
        await load(record);
    }

    async function run() {
        setHookGate(id => isEnabled(id));
        setHookErrorReporter((id, message) => reportError(id, message));
        try {
            entries = discoverPlugins({ officialDir, customDir });
        } catch (err) {
            console.error('Plugin discovery failed:', err.message);
        }
        let states = new Map();
        try {
            states = await state.readStates();
        } catch (err) {
            console.error('Reading the plugin state failed:', err.message);
        }
        for (const entry of entries) {
            // A custom folder with an official id is listed as invalid, the official one owns the id
            if (!records.has(entry.id)) records.set(entry.id, newRecord(entry.id, entry, states.get(entry.id) || null));
        }
        for (const [id, storedState] of states) {
            if (!records.has(id)) records.set(id, newRecord(id, null, storedState));
        }
        if (safeMode) return;
        for (const record of records.values()) {
            if (!isLoadable(record)) continue;
            try {
                await startPlugin(record);
            } catch (err) {
                console.error(`[plugin:${record.id}] start failed: ${errorMessage(err)}`);
            }
        }
    }

    /** @returns {Promise<void>} -> Never rejects; a second call returns the first run. */
    function start() {
        if (!started) started = run().catch(err => console.error('Starting the plugins failed:', err));
        return started;
    }

    function isEnabled(id) {
        if (safeMode) return false;
        const record = records.get(id);
        return Boolean(record && record.runtime === 'on');
    }

    /** @returns {PluginView} */
    function viewOf(entry, record) {
        const id = entry ? entry.id : record.id;
        return buildView({ entry, record, safeMode, limitWarning: limiter.warning(id) });
    }

    /** @returns {PluginView[]} -> Discovered plugins in discovery order, then orphaned ones by id. */
    function list() {
        const views = entries.map(entry => {
            const record = records.get(entry.id);
            return viewOf(entry, record && record.entry === entry ? record : null);
        });
        const orphans = [...records.values()].filter(record => !record.entry).sort((a, b) => a.id.localeCompare(b.id));
        return [...views, ...orphans.map(record => viewOf(null, record))];
    }

    function recordOf(id) {
        const record = records.get(id);
        if (!record) throw new PluginHostError(MESSAGES.notFound);
        return record;
    }

    /**
     * Switch a plugin on or off and store it. Switching on a custom plugin
     * confirms its current version and permissions. Safe mode refuses only
     * switching on: switching off is the way out of a plugin that breaks the
     * start, and runs no plugin code (nothing was registered).
     *
     * @returns {Promise<PluginView>}
     */
    async function setEnabled(id, enabled, { adminId = '' } = {}) {
        const record = recordOf(id);
        if (safeMode && enabled) throw new PluginHostError(MESSAGES.safeMode);
        if (!isLoadable(record)) throw new PluginHostError(MESSAGES.cannotEnable);
        return chain(switchChains, id, async () => {
            const { manifest, official } = record.entry;
            if (enabled) {
                const patch = { enabled: true, enabledAt: nowIso(), enabledBy: String(adminId || '') };
                if (!official) {
                    patch.confirmedVersion = manifest.version;
                    patch.confirmedPermissions = [...manifest.permissions];
                }
                await persist(record, patch);
                await load(record);
            } else {
                await persist(record, { enabled: false });
                const wasOn = record.runtime === 'on';
                record.runtime = 'off';
                if (wasOn) await runDisableCallbacks(record);
            }
            return viewOf(record.entry, record);
        });
    }

    /** Store a runtime error of a plugin (route, hook); the plugin stays on. */
    function reportError(id, message) {
        const record = records.get(id);
        if (!record) return;
        persist(record, { lastError: errorMessage(message), lastErrorAt: nowIso() })
            .catch(err => console.error(`[plugin:${id}] Storing the error failed:`, err.message));
    }

    /** @returns {Promise<object>} -> Setting values by key; secrets only as `{ set: boolean }`. */
    async function readPublicSettings(id) {
        const record = recordOf(id);
        const schema = record.entry && record.entry.manifest ? record.entry.manifest.settings : [];
        const stored = await state.readSettings(id);
        const values = {};
        for (const setting of schema) {
            if (setting.type === 'secret') {
                values[setting.key] = { set: typeof stored[setting.key] === 'string' && stored[setting.key] !== '' };
            } else if (Object.hasOwn(stored, setting.key)) {
                values[setting.key] = stored[setting.key];
            }
        }
        return values;
    }

    /**
     * Validate and store setting values. A key left out (or `undefined`) keeps
     * its stored value, `null`/`''` clears it, unknown keys are dropped.
     *
     * @throws {PluginHostError} -> German message naming the bad field.
     */
    async function saveSettings(id, values) {
        const record = recordOf(id);
        const manifest = record.entry && record.entry.manifest;
        if (!manifest) throw new PluginHostError(MESSAGES.noSettings);
        if (!isPlainObject(values)) throw new PluginHostError(MESSAGES.badValues);
        await serializeWrite(id, async () => {
            const current = await state.readSettings(id);
            const next = {};
            for (const setting of manifest.settings) {
                const raw = Object.hasOwn(values, setting.key) ? values[setting.key] : undefined;
                const value = raw === undefined ? current[setting.key] : checkSetting(setting, raw);
                if (value === undefined) {
                    if (setting.required) throw new PluginHostError(`„${setting.label}“ ist ein Pflichtfeld.`);
                    continue;
                }
                next[setting.key] = value;
            }
            await state.writeSettings(id, next);
            if (!record.state) {
                // A state entry makes the settings findable when the folder disappears (orphaned)
                record.state = state.normalizeState({});
                await state.writeState(id, {});
            }
        });
    }

    /**
     * Delete a plugin's documents and settings; an orphaned plugin loses its state entry too.
     *
     * @returns {Promise<number>} -> Deleted documents.
     */
    async function deleteData(id) {
        const record = recordOf(id);
        return serializeWrite(id, async () => {
            const collections = state.normalizeState(record.state || {}).collections;
            const deleted = await wipePluginData(id, collections);
            await deleteTheme(id);
            await state.deleteSettings(id);
            if (!record.entry) {
                await state.deleteState(id);
                records.delete(id);
            }
            return deleted;
        });
    }

    /** @returns {Promise<number>} -> Deleted documents with `userId` of the member, over all plugins. */
    async function purgeUser(userId) {
        const collectionsByPlugin = new Map();
        for (const [id, record] of records) {
            const { collections } = state.normalizeState(record.state || {});
            if (collections.length) collectionsByPlugin.set(id, collections);
        }
        return purgeUserData(userId, collectionsByPlugin);
    }

    /** Delete the data and settings of every plugin; `pluginState` stays. @returns {Promise<number>} */
    async function wipeAllData() {
        let deleted = 0;
        for (const [id, record] of records) {
            deleted += await serializeWrite(id, async () => {
                const count = await wipePluginData(id, state.normalizeState(record.state || {}).collections);
                await deleteTheme(id);
                await state.deleteSettings(id);
                return count;
            });
        }
        return deleted;
    }

    return {
        start,
        /** @returns {boolean} -> `PLUGINS_SAFE_MODE`: no plugin code runs, no plugin can be switched on. */
        get safeMode() {
            return safeMode;
        },
        list,
        isEnabled,
        entryOf: id => {
            const record = records.get(id);
            return record && record.entry ? record.entry : null;
        },
        /** @returns {import('./context').RouteDef[]} */
        routesOf: id => {
            const record = records.get(id);
            return record ? record.routes.map(route => ({ ...route })) : [];
        },
        clients: () => [...records.values()]
            .filter(record => isEnabled(record.id) && record.entry.manifest.client)
            .map(({ entry: { id, official, manifest } }) => ({
                id, name: manifest.name, version: manifest.version, official,
                permissions: [...manifest.permissions], hasCss: Boolean(manifest.css)
            })),
        /** @returns {Array<{ id: string, provider: Function }>} -> Profile badge providers of switched-on plugins (none in safe mode). */
        profileProviders: () => [...records.values()]
            .filter(record => record.profileProvider && isEnabled(record.id))
            .map(record => ({ id: record.id, provider: record.profileProvider })),
        themeSources: () => [...records.values()]
            .filter(record => isEnabled(record.id) && record.entry.manifest.permissions.includes('theme'))
            .map(record => record.id)
            .sort(),
        setEnabled,
        reportError,
        readPublicSettings,
        saveSettings,
        deleteData,
        purgeUser,
        wipeAllData
    };
}

module.exports = { createPluginHost };
