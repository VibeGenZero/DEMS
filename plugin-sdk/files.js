/**
 * The one allow-list of plugin files, shared by the static file route and the
 * `.dems` packaging code. Which files may be served, packed and unpacked is
 * decided here and nowhere else.
 */
const fs = require('fs');
const path = require('path');

/** Hard limits of a `.dems` package. */
const LIMITS = Object.freeze({
    packedBytes: 5242880,
    unpackedBytes: 20971520,
    entries: 300,
    entryBytes: 2097152
});

const ASSET_NAME = /^[A-Za-z0-9_-]+\.(js|css|png|jpg|jpeg|webp|gif|json|woff2)$/;

const CONTENT_TYPES = {
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.woff2': 'font/woff2'
};

/** OS litter inside archives: skipped silently, not refused. */
const IGNORED_ENTRY = /(^|\/)(__MACOSX\/|\.DS_Store$)/;

const TEXT_EXTENSIONS = new Set(['.js', '.json', '.css', '.md', '.txt']);

/**
 * Windows device names, with or without an extension; Windows cannot create such a file.
 * COM and LPT also take the superscript digits \u00b9 \u00b2 \u00b3, which Windows treats as devices too.
 */
const DEVICE_NAME = /^(con|prn|aux|nul|conin\$|conout\$|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3])(\.|$)/i;

/** @returns {boolean} -> `name` ends in `.js`, in any case (`A.JS` runs like `a.js`). */
function isJsFile(name) {
    return String(name).toLowerCase().endsWith('.js');
}

/**
 * @param {string} name -> Package path with forward slashes, relative to the plugin root.
 * @returns {string|null} -> German reason why the path is not allowed, null when it is.
 */
function packageEntryError(name) {
    const unsafe = `Unerlaubter Pfad: ${name}`;
    if (typeof name !== 'string' || name.startsWith('/') || /^[A-Za-z]:/.test(name)) return unsafe;
    if (name.includes('\\') || /[\x00-\x1f\x7f]/.test(name)) return unsafe;
    const segments = name.split('/');
    if (segments.some((s) => s === '' || s === '..')) return unsafe;
    if (segments.some((s) => s.includes(':') || s.endsWith('.') || s.endsWith(' '))) return unsafe;
    if (segments.some((s) => DEVICE_NAME.test(s))) return unsafe;
    if (segments.some((s) => s.startsWith('.'))) return `Versteckte Datei: ${name}`;
    if (segments.includes('node_modules')) return `node_modules wird nicht unterstützt: ${name}`;
    const notAllowed = `Nicht erlaubte Datei: ${name}`;
    if (name === 'plugin.json') return null;
    if (segments[0] === 'assets') {
        return segments.length === 2 && ASSET_NAME.test(segments[1]) ? null : notAllowed;
    }
    return TEXT_EXTENSIONS.has(path.posix.extname(name).toLowerCase()) ? null : notAllowed;
}

/** @returns {boolean} -> `name` is `assets/<ASSET_NAME>` with a `.js` extension. */
function isClientAsset(name) {
    const parts = String(name).split('/');
    return parts.length === 2 && parts[0] === 'assets' && ASSET_NAME.test(parts[1]) && parts[1].endsWith('.js');
}

/**
 * Read every allowed `.js` file of a plugin folder (BOM stripped).
 * The root is resolved once (it may itself be a link); links inside are never followed.
 *
 * @param {string} dir -> Plugin root.
 * @returns {{ sources: Map<string, string>, tooBig: boolean }} -> Relative POSIX path to text.
 */
function readPluginSourcesSync(dir) {
    const root = fs.realpathSync(dir);
    const sources = new Map();
    let total = 0;
    let tooBig = false;

    const walk = (rel) => {
        const entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
        for (const entry of entries) {
            if (tooBig) return;
            if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
            if (entry.isSymbolicLink()) continue;
            const relName = rel ? `${rel}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                walk(relName);
            } else if (entry.isFile() && isJsFile(relName) && packageEntryError(relName) === null) {
                const abs = path.join(root, relName);
                total += fs.statSync(abs).size;
                if (total > LIMITS.unpackedBytes) {
                    tooBig = true;
                    return;
                }
                sources.set(relName, fs.readFileSync(abs, 'utf8').replace(/^\uFEFF/, ''));
            }
        }
    };
    walk('');
    return { sources, tooBig };
}

module.exports = {
    LIMITS,
    ASSET_NAME,
    CONTENT_TYPES,
    IGNORED_ENTRY,
    TEXT_EXTENSIONS,
    packageEntryError,
    isJsFile,
    isClientAsset,
    readPluginSourcesSync
};
