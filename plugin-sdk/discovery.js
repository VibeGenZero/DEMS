/**
 * Plugin discovery: scan the official and the custom plugin folder.
 *
 * Every sub-folder (or directory link) with a `plugin.json` becomes one
 * entry; dot folders (`.incoming-*`, `.old-*` of an install) are skipped. The
 * manifest is checked by `validateManifest`. Broken plugins stay in the list
 * with a German reason so the admin area can show why they do not load. A
 * valid custom plugin gets a `permissionCheck`: its code is read (never run)
 * and the permissions it uses are compared with the declared ones.
 */
const fs = require('fs');
const path = require('path');
const { validateManifest } = require('./manifest');
const { readPluginSourcesSync } = require('./files');
const { scanPlugin, comparePermissions, formatWarning } = require('./permissionScan');

const MANIFEST_FILE = 'plugin.json';
const REASON_BAD_JSON = 'Ungültig: plugin.json ist kein gültiges JSON.';
const REASON_OFFICIAL_ID = 'Ungültig: Die ID gehört einem offiziellen Plugin.';

/**
 * @typedef {object} PermissionCheck
 * @property {string[]} missing -> Used in the code but not declared.
 * @property {string[]} unused -> Declared but not found in the code.
 * @property {string[]} warnings -> Scanner hints as „<file>:<line>: <German message>“.
 * @property {boolean} tooBig -> The code is over the size limit and was not scanned.
 */

/**
 * @typedef {object} PluginEntry
 * @property {string} id -> Folder name (equals the manifest id when valid).
 * @property {string} dir -> Absolute plugin folder.
 * @property {boolean} official -> Shipped with DEMS.
 * @property {import('./manifest').Manifest|null} manifest -> Normalized manifest, null when broken.
 * @property {null|'invalid'|'incompatible'} status -> null when the plugin can load.
 * @property {string} reason -> German reason for the status, `''` when fine.
 * @property {PermissionCheck|null} permissionCheck -> Custom and valid only, else null.
 */

function isFile(filePath) {
    try {
        return fs.statSync(filePath).isFile();
    } catch {
        return false;
    }
}

/** A real directory, or a link (symlink, junction) that points at one. */
function isDirectoryEntry(root, entry) {
    if (entry.isDirectory()) return true;
    if (!entry.isSymbolicLink()) return false;
    try {
        return fs.statSync(path.join(root, entry.name)).isDirectory();
    } catch {
        return false;
    }
}

/** Sub-folders of `root` that contain a `plugin.json`, sorted by name; `[]` when `root` is missing. */
function pluginFolders(root) {
    if (!root) return [];
    let names;
    try {
        names = fs.readdirSync(root, { withFileTypes: true });
    } catch {
        return [];
    }
    return names
        .filter(entry => !entry.name.startsWith('.') && isDirectoryEntry(root, entry)
            && isFile(path.join(root, entry.name, MANIFEST_FILE)))
        .map(entry => entry.name)
        .sort();
}

/** @returns {PermissionCheck|null} -> Null when the code cannot be read. */
function checkPermissions(dir, manifest) {
    try {
        const { sources, tooBig } = readPluginSourcesSync(dir);
        if (tooBig) return { missing: [], unused: [], warnings: [], tooBig: true };
        const scan = scanPlugin(sources, manifest);
        const { missing, unused } = comparePermissions(manifest.permissions, scan.permissions);
        return { missing, unused, warnings: scan.warnings.map(formatWarning), tooBig: false };
    } catch (err) {
        console.error(`[plugin:${manifest.id}] Permission check failed: ${err.message}`);
        return null;
    }
}

/** Read and validate one plugin folder. */
function readPlugin(root, id, official) {
    const dir = path.join(root, id);
    const entry = { id, dir, official, manifest: null, status: null, reason: '', permissionCheck: null };

    let raw;
    try {
        raw = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST_FILE), 'utf8'));
    } catch {
        return { ...entry, status: 'invalid', reason: REASON_BAD_JSON };
    }

    const result = validateManifest(raw, id, { fileExists: rel => isFile(path.join(dir, rel)) });
    if (!result.ok) return { ...entry, status: result.status, reason: result.reason };
    const permissionCheck = official ? null : checkPermissions(dir, result.manifest);
    return { ...entry, manifest: result.manifest, permissionCheck };
}

/**
 * Read one custom plugin folder, e.g. again after an upload.
 *
 * @param {string} customDir -> Root of the custom plugins.
 * @param {string} id -> Folder name.
 * @param {Set<string>} officialIds -> Ids of the official plugins; such a folder is invalid.
 * @returns {PluginEntry}
 * @example
 * readCustomPlugin('data/plugins', 'feedback-plus', new Set(['event-submissions']));
 * // { id: 'feedback-plus', official: false, manifest: {...}, permissionCheck: { missing: [], ... } }
 */
function readCustomPlugin(customDir, id, officialIds) {
    if (officialIds.has(id)) {
        return {
            id, dir: path.join(customDir, id), official: false, manifest: null,
            status: 'invalid', reason: REASON_OFFICIAL_ID, permissionCheck: null
        };
    }
    return readPlugin(customDir, id, false);
}

/**
 * Find all plugins in the official and the custom folder.
 *
 * @param {{ officialDir: string, customDir?: string }} dirs -> Plugin roots; a missing folder is no error.
 * @returns {PluginEntry[]} -> Official entries first, each group sorted by id.
 * @example
 * discoverPlugins({ officialDir: 'plugins', customDir: 'data/plugins' });
 * // [{ id: 'event-submissions', official: true, manifest: {...}, status: null, reason: '', permissionCheck: null }, ...]
 */
function discoverPlugins({ officialDir, customDir }) {
    const official = pluginFolders(officialDir).map(id => readPlugin(officialDir, id, true));
    const officialIds = new Set(official.map(entry => entry.id));
    const custom = pluginFolders(customDir).map(id => readCustomPlugin(customDir, id, officialIds));
    return [...official, ...custom];
}

module.exports = { discoverPlugins, readCustomPlugin };
