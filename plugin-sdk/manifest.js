/**
 * Plugin manifest (`plugin.json`) validation.
 *
 * Pure module: the only I/O is the injected `fileExists(relPath)`, so
 * discovery and the plugin host decide where a plugin folder lives. A
 * broken manifest yields a German status reason that the admin area shows
 * („Ungültig: …“ or „Inkompatibel (SDK <n>)“); such a plugin is never loaded.
 */

/** SDK major version this DEMS release supports. */
const SDK_VERSION = 1;
/** Newest minor of that major: 1.1 adds registrations, roles, member search and profile badges. */
const SDK_MINOR = 1;
/** Values `plugin.json` may name as `sdk`; 1.x plugins only add to 1.0, so every one of them runs. */
const SDK_VERSIONS = Object.freeze([1, 1.1]);

/** Known permissions of SDK 1.1 with the German label shown to admins. */
const PERMISSIONS = Object.freeze({
    'events:read': 'Events lesen',
    'events:draft': 'Events für das Team vorbereiten',
    'members:read': 'Mitgliedernamen und Avatare lesen',
    'discord:dm': 'Direktnachrichten über den Bot senden',
    'discord:channel': 'Nachrichten in Discord-Kanäle posten',
    network: 'Verbindungen ins Internet aufbauen',
    theme: 'Aussehen der ganzen Seite ändern',
    'registrations:read': 'Anmeldungen lesen',
    'discord:roles': 'Discord-Rollen vergeben und entziehen'
});

/** Permissions a manifest may only declare with `sdk: 1.1`. */
const SDK_1_1_PERMISSIONS = Object.freeze(['registrations:read', 'discord:roles']);

/** Allowed `settings[].type` values. */
const SETTING_TYPES = Object.freeze(['text', 'textarea', 'number', 'boolean', 'select', 'channel', 'role', 'secret']);

const ID_PATTERN = /^[a-z][a-z0-9-]{2,31}$/;
const SETTING_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9]{0,31}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const CLIENT_CSS = 'client.css';

/**
 * @typedef {object} Setting
 * @property {string} key -> Setting key, `^[a-zA-Z][a-zA-Z0-9]{0,31}$`.
 * @property {string} type -> One of `SETTING_TYPES`.
 * @property {string} label -> German label.
 * @property {string} help -> German help text (`''` when absent).
 * @property {boolean} required -> Whether the admin must fill it in.
 * @property {Array<string|{value: string, label: string}>} [options] -> Choices of a `select`.
 */

/**
 * @typedef {object} Manifest
 * @property {string} id
 * @property {string} name
 * @property {string} version
 * @property {number} sdk
 * @property {string} description
 * @property {string} author
 * @property {string} server -> Relative server entry file or `''`.
 * @property {string} client -> Relative client entry file or `''`.
 * @property {string} css -> `'client.css'` when the folder has one, else `''`.
 * @property {string[]} permissions
 * @property {Setting[]} settings
 */

function invalid(reason) {
    return { ok: false, status: 'invalid', reason: `Ungültig: ${reason}` };
}

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Check a text field: absent optional fields become `''`.
 *
 * @returns {string|null} -> The text, or null when it is missing/too long/no string.
 */
function readText(value, maxLength, required) {
    if (value === undefined && !required) return '';
    if (typeof value !== 'string') return null;
    if (required && value.trim() === '') return null;
    if (value.length > maxLength) return null;
    return value;
}

/** A relative file name that stays inside the plugin folder and exists. */
function isSafeFile(value, fileExists) {
    if (typeof value !== 'string' || value === '') return false;
    if (value.includes('..') || value.includes('\\') || value.startsWith('/') || value.includes(':')) return false;
    return fileExists(value) === true;
}

function isValidOption(option) {
    if (typeof option === 'string') return option !== '';
    return isPlainObject(option) && typeof option.value === 'string' && typeof option.label === 'string';
}

/** @returns {Setting|null} -> Normalized setting, or null when it is broken. */
function normalizeSetting(raw) {
    if (!isPlainObject(raw)) return null;
    const { key, type, label, help, required, options } = raw;
    if (typeof key !== 'string' || !SETTING_KEY_PATTERN.test(key)) return null;
    if (!SETTING_TYPES.includes(type)) return null;
    if (typeof label !== 'string' || label.trim() === '') return null;
    if (help !== undefined && typeof help !== 'string') return null;
    if (required !== undefined && typeof required !== 'boolean') return null;
    const setting = { key, type, label, help: help || '', required: required === true };
    if (type === 'select') {
        if (!Array.isArray(options) || options.length === 0 || !options.every(isValidOption)) return null;
        setting.options = options.map((option) => (typeof option === 'string' ? option : { value: option.value, label: option.label }));
    }
    return setting;
}

/**
 * Validate a parsed `plugin.json` and return a normalized copy.
 *
 * @param {unknown} raw -> Parsed JSON of `plugin.json`.
 * @param {string} folderName -> Name of the plugin folder; must equal `id`.
 * @param {{ fileExists: (relPath: string) => boolean }} options -> File check relative to the plugin folder.
 * @returns {{ ok: true, manifest: Manifest } | { ok: false, status: 'invalid'|'incompatible', reason: string }}
 * @example
 * validateManifest({ id: 'demo', name: 'Demo', version: '1.0.0', sdk: 1 }, 'demo', { fileExists: () => true });
 * // { ok: true, manifest: { id: 'demo', ..., permissions: [], settings: [] } }
 */
function validateManifest(raw, folderName, { fileExists }) {
    if (!isPlainObject(raw)) return invalid('plugin.json ist kein Objekt.');

    if (typeof raw.id !== 'string' || !ID_PATTERN.test(raw.id)) return invalid('Die ID ist nicht erlaubt.');
    if (raw.id !== folderName) return invalid('Die ID passt nicht zum Ordnernamen.');

    if (typeof raw.sdk !== 'number' || Number.isNaN(raw.sdk)) return invalid('SDK-Version fehlt.');
    if (!SDK_VERSIONS.includes(raw.sdk)) return { ok: false, status: 'incompatible', reason: `Inkompatibel (SDK ${raw.sdk})` };

    if (typeof raw.version !== 'string' || !VERSION_PATTERN.test(raw.version)) return invalid('Version muss x.y.z sein.');

    const name = readText(raw.name, 40, true);
    if (name === null) return invalid('Name ist zu lang oder fehlt.');
    const description = readText(raw.description, 200, false);
    if (description === null) return invalid('Beschreibung ist zu lang oder fehlt.');
    const author = readText(raw.author, 60, false);
    if (author === null) return invalid('Autor ist zu lang oder fehlt.');

    const files = {};
    for (const field of ['server', 'client']) {
        const value = raw[field];
        if (value === undefined) {
            files[field] = '';
        } else if (!isSafeFile(value, fileExists)) {
            return invalid(`Datei ${String(value)} fehlt oder liegt außerhalb des Plugins.`);
        } else {
            files[field] = value;
        }
    }

    const permissions = raw.permissions === undefined ? [] : raw.permissions;
    if (!Array.isArray(permissions)) return invalid('Berechtigungen müssen eine Liste sein.');
    for (const permission of permissions) {
        if (typeof permission !== 'string' || !Object.hasOwn(PERMISSIONS, permission)) {
            return invalid(`Unbekannte Berechtigung ${String(permission)}.`);
        }
    }
    const newer = raw.sdk === 1 && permissions.find(permission => SDK_1_1_PERMISSIONS.includes(permission));
    if (newer) return invalid(`Die Berechtigung „${newer}“ braucht SDK 1.1.`);

    const rawSettings = raw.settings === undefined ? [] : raw.settings;
    if (!Array.isArray(rawSettings)) return invalid('Einstellungen müssen eine Liste sein.');
    const settings = [];
    const seenKeys = new Set();
    for (const rawSetting of rawSettings) {
        const setting = normalizeSetting(rawSetting);
        if (!setting || seenKeys.has(setting.key)) {
            const key = isPlainObject(rawSetting) ? String(rawSetting.key) : String(rawSetting);
            return invalid(`Einstellung ${key} ist fehlerhaft.`);
        }
        seenKeys.add(setting.key);
        settings.push(setting);
    }

    return {
        ok: true,
        manifest: {
            id: raw.id,
            name,
            version: raw.version,
            sdk: raw.sdk,
            description,
            author,
            server: files.server,
            client: files.client,
            css: fileExists(CLIENT_CSS) === true ? CLIENT_CSS : '',
            permissions: [...permissions],
            settings
        }
    };
}

module.exports = { SDK_VERSION, SDK_MINOR, SDK_VERSIONS, SDK_1_1_PERMISSIONS, PERMISSIONS, SETTING_TYPES, validateManifest };
