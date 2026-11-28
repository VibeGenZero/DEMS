/**
 * Admin views of plugins (System › Plugins).
 *
 * Pure: turns a discovered entry and the host's record of it into the plain
 * `PluginView` the admin API answers with. Status texts are German.
 */
const { PERMISSIONS } = require('./manifest');
const { normalizeState } = require('./state');

const STATUS_TEXT = {
    off: 'Aus',
    on: 'An',
    confirm: 'Bestätigung nötig',
    orphaned: 'Verwaist',
    safe: 'Abgesicherter Modus aktiv',
    restart: 'Neustart nötig'
};

const labelled = keys => keys.map(key => ({ key, label: PERMISSIONS[key] }));

/** The entry's permission check with labels; null when the entry has none. */
function permissionCheckView(entry) {
    const check = entry && entry.permissionCheck;
    if (!check) return null;
    return {
        missing: labelled(check.missing),
        unused: labelled(check.unused),
        warnings: [...check.warnings],
        tooBig: check.tooBig
    };
}

/**
 * @typedef {object} PluginView
 * @property {string} id
 * @property {string} name
 * @property {string} version
 * @property {string} author
 * @property {string} description
 * @property {boolean} official
 * @property {{ key: string, label: string }[]} permissions
 * @property {'off'|'on'|'error'|'confirm'|'restart'|'invalid'|'incompatible'|'orphaned'|'safe'} status
 * @property {string} statusText -> German.
 * @property {boolean} enabled -> Stored switch (`pluginState.enabled`); in safe mode the only sign which plugins are on.
 * @property {string} lastError
 * @property {string} lastErrorAt -> ISO date or `''`.
 * @property {string|null} limitWarning -> „Nachrichtengrenze erreicht (bis HH:MM)“ while the budget is used up.
 * @property {import('./manifest').Setting[]} settings
 * @property {boolean} hasClient
 * @property {string[]} collections
 * @property {null|{ missing: { key: string, label: string }[], unused: { key: string, label: string }[], warnings: string[], tooBig: boolean }} permissionCheck
 *   -> Server-side code check of a valid custom plugin (discovery); null for official and broken ones.
 */

/**
 * Build the view of one plugin.
 *
 * Status order: no folder → `orphaned`; safe mode → `safe`; a broken
 * manifest → its status and reason; else the record's runtime status
 * (`off`, `on`, `confirm`, `restart`, `error` with the load error).
 *
 * @param {object} options
 * @param {import('./discovery').PluginEntry|null} options.entry -> Null for an orphaned state entry.
 * @param {{ id: string, state: object|null, runtime: string, loadError: string }|null} options.record -> Host record; null for a duplicate folder.
 * @param {boolean} options.safeMode
 * @param {string|null} options.limitWarning -> From the message limiter.
 * @returns {PluginView}
 */
function buildView({ entry, record, safeMode, limitWarning }) {
    const id = entry ? entry.id : record.id;
    const stored = normalizeState((record && record.state) || {});
    const manifest = entry ? entry.manifest : null;
    let status;
    let statusText;
    if (!entry) status = 'orphaned';
    else if (safeMode) status = 'safe';
    else if (entry.status) {
        status = entry.status;
        statusText = entry.reason;
    } else status = record.runtime;
    if (status === 'error') statusText = `Fehler: ${record.loadError}`;
    return {
        id,
        name: manifest ? manifest.name : id,
        version: manifest ? manifest.version : '',
        author: manifest ? manifest.author : '',
        description: manifest ? manifest.description : '',
        official: entry ? entry.official : false,
        permissions: labelled(manifest ? manifest.permissions : []),
        status,
        statusText: statusText || STATUS_TEXT[status],
        enabled: stored.enabled,
        lastError: stored.lastError,
        lastErrorAt: stored.lastErrorAt,
        limitWarning,
        settings: structuredClone(manifest ? manifest.settings : []),
        hasClient: Boolean(manifest && manifest.client),
        collections: [...stored.collections],
        permissionCheck: permissionCheckView(entry)
    };
}

module.exports = { buildView };
