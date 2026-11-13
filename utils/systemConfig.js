/**
 * Configuration stored in the database (issue #138): the values the setup
 * wizard and the admin "System" view write, laid over process.env at start.
 *
 * Code keeps reading process.env everywhere; this module only fills the keys
 * the environment leaves empty. A non-empty environment value always wins and
 * is reported as locked. One document `systemSettings/config`:
 * `{ values: { KEY: string }, setupCompletedAt, setupSource, updatedAt, updatedBy }`.
 * The cached copy is exact because DEMS runs as one process.
 */
const crypto = require('crypto');
const { db, doc, getDoc, setDoc } = require('../firebaseAdmin');

const CONFIG_DOC = ['systemSettings', 'config'];

/**
 * Keys that may live in the database. `applies`: `live` = in effect at once,
 * `bot` = the bot logs in again, `restart` = needs a restart of DEMS.
 */
const MANAGED_KEYS = Object.freeze({
    DISCORD_CLIENT_ID: { group: 'discord', secret: false, applies: 'live' },
    DISCORD_CLIENT_SECRET: { group: 'discord', secret: true, applies: 'live' },
    DISCORD_BOT_TOKEN: { group: 'discord', secret: true, applies: 'bot' },
    DISCORD_GUILD_ID: { group: 'discord', secret: false, applies: 'bot' },
    DISCORD_ADMIN_ROLE_ID: { group: 'discord', secret: false, applies: 'live' },
    DISCORD_ANNOUNCE_CHANNEL_ID: { group: 'discord', secret: false, applies: 'live' },
    DISCORD_EVENT_CATEGORY_ID: { group: 'discord', secret: false, applies: 'live' },
    // The Message Content intent is fixed when the bot client is built
    DISCORD_THREAD_SYNC: { group: 'discord', secret: false, applies: 'restart' },
    SERVER_NAME: { group: 'server', secret: false, applies: 'live' },
    BASE_URL: { group: 'server', secret: false, applies: 'live' },
    TIMEZONE: { group: 'server', secret: false, applies: 'live' },
    ADMIN_RESET_PASSWORD: { group: 'security', secret: true, applies: 'live' },
    AI_PROVIDER: { group: 'ai', secret: false, applies: 'live' },
    AI_BASE_URL: { group: 'ai', secret: false, applies: 'live' },
    AI_API_KEY: { group: 'ai', secret: true, applies: 'live' },
    AI_MODEL: { group: 'ai', secret: false, applies: 'live' },
    AI_MODEL_ADMIN: { group: 'ai', secret: false, applies: 'live' }
});

// Generated on the first start without SESSION_SECRET; never listed or editable
const SESSION_SECRET_KEY = 'SESSION_SECRET';

// Without these the login cannot work -> the installation is not set up
const REQUIRED_DISCORD_KEYS = ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'DISCORD_GUILD_ID'];

let cached = null;
let lockedKeys = new Set();

/** Error of saveSystemValues: `code` is `unknown_key` or `locked_key`, `key` names the key. */
class SystemConfigError extends Error {
    constructor(code, key) {
        super(`${code}: ${key}`);
        this.code = code;
        this.key = key;
    }
}

const isFilled = (value) => typeof value === 'string' && value.trim() !== '';

async function readConfig() {
    if (cached) return cached;
    const snap = await getDoc(doc(db, ...CONFIG_DOC));
    const data = snap.exists() ? snap.data() : {};
    cached = { ...data, values: { ...(data.values || {}) } };
    return cached;
}

async function writeConfig(next) {
    await setDoc(doc(db, ...CONFIG_DOC), next);
    cached = { ...next, values: { ...next.values } };
}

/**
 * Whether an environment holds the Discord values the login needs.
 *
 * @param {Object} env -> Environment to check.
 * @returns {boolean}
 */
function hasRequiredDiscordValues(env) {
    return REQUIRED_DISCORD_KEYS.every(key => isFilled(env[key]));
}

/**
 * Lay the stored values over the environment. Runs once at start, after the
 * migrations: remembers which keys the environment sets (locked), fills the
 * others from the database, generates SESSION_SECRET when nobody has one, and
 * marks an installation with a complete .env as set up.
 *
 * @param {Object} [options] -> `{ env }` replaces process.env (tests).
 * @returns {Promise<{ fromEnv: number, fromDb: number }>} -> Counts for the start log.
 */
async function loadSystemConfig({ env = process.env } = {}) {
    const config = await readConfig();
    lockedKeys = new Set(Object.keys(MANAGED_KEYS).filter(key => isFilled(env[key])));

    let fromDb = 0;
    for (const key of Object.keys(MANAGED_KEYS)) {
        if (lockedKeys.has(key) || !isFilled(config.values[key])) continue;
        env[key] = config.values[key];
        fromDb++;
    }

    let next = null;
    if (!isFilled(env[SESSION_SECRET_KEY])) {
        if (!isFilled(config.values[SESSION_SECRET_KEY])) {
            next = { ...config, values: { ...config.values, [SESSION_SECRET_KEY]: crypto.randomBytes(32).toString('hex') } };
        }
        env[SESSION_SECRET_KEY] = (next || config).values[SESSION_SECRET_KEY];
    }

    if (!config.setupCompletedAt && hasRequiredDiscordValues(env) && REQUIRED_DISCORD_KEYS.every(key => lockedKeys.has(key))) {
        next = { ...(next || config), setupCompletedAt: new Date().toISOString(), setupSource: 'env' };
    }
    if (next) await writeConfig(next);

    return { fromEnv: lockedKeys.size, fromDb };
}

/**
 * Whether a key is set by the environment and therefore cannot be changed.
 *
 * @param {string} key -> Managed key.
 * @returns {boolean}
 */
function isLocked(key) {
    return lockedKeys.has(key);
}

/**
 * Store changed values and apply them to the environment. Validates every key
 * first, so a refused call changes nothing.
 *
 * @param {Object<string, string>} values -> Key → new value; '' deletes the key.
 * @param {Object} [options] -> `{ by }` admin id, `{ env }` replaces process.env (tests).
 * @returns {Promise<{ changed: string[], applies: Set<string> }>} -> Changed keys and their `applies` classes.
 * @throws {SystemConfigError} -> Unknown or locked key.
 */
async function saveSystemValues(values, { by = null, env = process.env } = {}) {
    const entries = Object.entries(values || {});
    for (const [key] of entries) {
        if (!Object.hasOwn(MANAGED_KEYS, key)) throw new SystemConfigError('unknown_key', key);
        if (lockedKeys.has(key)) throw new SystemConfigError('locked_key', key);
    }

    const config = await readConfig();
    const nextValues = { ...config.values };
    const changed = [];
    for (const [key, raw] of entries) {
        const value = typeof raw === 'string' ? raw.trim() : '';
        if ((nextValues[key] || '') === value) continue;
        if (value) nextValues[key] = value;
        else delete nextValues[key];
        changed.push(key);
    }
    if (changed.length === 0) return { changed, applies: new Set() };

    await writeConfig({ ...config, values: nextValues, updatedAt: new Date().toISOString(), updatedBy: by });
    for (const key of changed) {
        if (nextValues[key]) env[key] = nextValues[key];
        else delete env[key];
    }
    return { changed, applies: new Set(changed.map(key => MANAGED_KEYS[key].applies)) };
}

/**
 * Every managed key with its source, for the admin "System" view. Secrets
 * carry only `isSet`, never their value.
 *
 * @param {Object} [options] -> `{ env }` replaces process.env (tests).
 * @returns {Array<Object>} -> `{ key, group, secret, value, isSet, source, locked, applies }` per key.
 */
function listSystemSettings({ env = process.env } = {}) {
    const values = (cached && cached.values) || {};
    return Object.entries(MANAGED_KEYS).map(([key, meta]) => {
        const locked = lockedKeys.has(key);
        const current = isFilled(env[key]) ? env[key] : '';
        const source = locked ? 'env' : (isFilled(values[key]) ? 'db' : 'none');
        return {
            key,
            group: meta.group,
            secret: meta.secret,
            value: meta.secret ? null : current,
            isSet: current !== '',
            source,
            locked,
            applies: meta.applies
        };
    });
}

/** Whether the setup was completed (wizard or complete .env). */
async function isSetupCompleted() {
    return !!(await readConfig()).setupCompletedAt;
}

/**
 * Record that the setup is done.
 *
 * @param {'wizard'|'env'} source -> Who completed it.
 * @param {string|null} [by] -> Admin or session marker.
 */
async function markSetupCompleted(source, by = null) {
    const config = await readConfig();
    await writeConfig({ ...config, setupCompletedAt: new Date().toISOString(), setupSource: source, updatedAt: new Date().toISOString(), updatedBy: by });
}

/** Drop the cache and the locked keys (tests). */
function forgetSystemConfig() {
    cached = null;
    lockedKeys = new Set();
}

module.exports = {
    MANAGED_KEYS,
    REQUIRED_DISCORD_KEYS,
    SystemConfigError,
    hasRequiredDiscordValues,
    loadSystemConfig,
    isLocked,
    saveSystemValues,
    listSystemSettings,
    isSetupCompleted,
    markSetupCompleted,
    forgetSystemConfig
};
