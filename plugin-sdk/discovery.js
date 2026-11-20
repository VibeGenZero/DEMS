/**
 * Plugin discovery: scan the official and the custom plugin folder.
 *
 * Every sub-folder with a `plugin.json` becomes one entry; the manifest is
 * checked by `validateManifest`. Broken plugins stay in the list with a
 * German reason so the admin area can show why they do not load.
 */
const fs = require('fs');
const path = require('path');
const { validateManifest } = require('./manifest');

const MANIFEST_FILE = 'plugin.json';
const REASON_BAD_JSON = 'Ungültig: plugin.json ist kein gültiges JSON.';
const REASON_OFFICIAL_ID = 'Ungültig: Die ID gehört einem offiziellen Plugin.';

/**
 * @typedef {object} PluginEntry
 * @property {string} id -> Folder name (equals the manifest id when valid).
 * @property {string} dir -> Absolute plugin folder.
 * @property {boolean} official -> Shipped with DEMS.
 * @property {import('./manifest').Manifest|null} manifest -> Normalized manifest, null when broken.
 * @property {null|'invalid'|'incompatible'} status -> null when the plugin can load.
 * @property {string} reason -> German reason for the status, `''` when fine.
 */

function isFile(filePath) {
    try {
        return fs.statSync(filePath).isFile();
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
        .filter(entry => entry.isDirectory() && isFile(path.join(root, entry.name, MANIFEST_FILE)))
        .map(entry => entry.name)
        .sort();
}

/** Read and validate one plugin folder. */
function readPlugin(root, id, official) {
    const dir = path.join(root, id);
    const entry = { id, dir, official, manifest: null, status: null, reason: '' };

    let raw;
    try {
        raw = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST_FILE), 'utf8'));
    } catch {
        return { ...entry, status: 'invalid', reason: REASON_BAD_JSON };
    }

    const result = validateManifest(raw, id, { fileExists: rel => isFile(path.join(dir, rel)) });
    if (!result.ok) return { ...entry, status: result.status, reason: result.reason };
    return { ...entry, manifest: result.manifest };
}

/**
 * Find all plugins in the official and the custom folder.
 *
 * @param {{ officialDir: string, customDir?: string }} dirs -> Plugin roots; a missing folder is no error.
 * @returns {PluginEntry[]} -> Official entries first, each group sorted by id.
 * @example
 * discoverPlugins({ officialDir: 'plugins', customDir: 'data/plugins' });
 * // [{ id: 'event-submissions', official: true, manifest: {...}, status: null, reason: '' }, ...]
 */
function discoverPlugins({ officialDir, customDir }) {
    const official = pluginFolders(officialDir).map(id => readPlugin(officialDir, id, true));
    const officialIds = new Set(official.map(entry => entry.id));
    const custom = pluginFolders(customDir).map(id => (officialIds.has(id)
        ? { id, dir: path.join(customDir, id), official: false, manifest: null, status: 'invalid', reason: REASON_OFFICIAL_ID }
        : readPlugin(customDir, id, false)));
    return [...official, ...custom];
}

module.exports = { discoverPlugins };
