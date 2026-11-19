/**
 * Client files of plugins at `/plugins/<pluginId>/…`.
 *
 * Only switched-on plugins, and only an allow-list: `client.js` (the
 * manifest's client file), `client.css` and `assets/<name>` with a plain
 * name and a known extension. Paths with `..`, backslashes, NUL bytes or
 * encoded slashes are refused before anything touches the disk, and the
 * resolved file must stay inside the plugin folder (also after symlinks).
 * Everything else answers a plain 404 without a listing. Mounted after the
 * session and CSRF middleware, before the role refresh; a file request
 * creates no session (`saveUninitialized: false`).
 */
const fs = require('fs');
const path = require('path');

const PLUGIN_ID = /^[a-z][a-z0-9-]{2,31}$/;
const ASSET_NAME = /^[A-Za-z0-9_-]+\.(js|css|png|jpg|jpeg|webp|gif|json|woff2)$/;
const ENCODED_SEPARATOR = /%(2f|5c)/i;

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

/** @returns {string|null} -> The decoded path below `/plugins`, null when it is malformed or tricky. */
function safeDecodedPath(rawPath) {
    if (ENCODED_SEPARATOR.test(rawPath)) return null;
    let decoded;
    try {
        decoded = decodeURIComponent(rawPath);
    } catch {
        return null;
    }
    if (decoded.includes('..') || decoded.includes('\\') || decoded.includes('\0')) return null;
    return decoded;
}

/**
 * Map the requested name to a file of the plugin.
 *
 * @returns {{ file: string, type: string }|null} -> File relative to the plugin folder and its content type.
 */
function allowedFile(manifest, parts) {
    if (parts.length === 1 && parts[0] === 'client.js' && manifest.client) {
        return { file: manifest.client, type: CONTENT_TYPES['.js'] };
    }
    if (parts.length === 1 && parts[0] === 'client.css' && manifest.css) {
        return { file: manifest.css, type: CONTENT_TYPES['.css'] };
    }
    if (parts.length === 2 && parts[0] === 'assets' && ASSET_NAME.test(parts[1])) {
        return { file: `assets/${parts[1]}`, type: CONTENT_TYPES[path.extname(parts[1]).toLowerCase()] };
    }
    return null;
}

/** @returns {Promise<boolean>} -> `target` is a file inside `dir`, symlinks resolved. */
async function isInside(dir, target) {
    try {
        const [realDir, realTarget] = await Promise.all([fs.promises.realpath(dir), fs.promises.realpath(target)]);
        return realTarget.startsWith(realDir + path.sep) && (await fs.promises.stat(realTarget)).isFile();
    } catch {
        return false;
    }
}

/**
 * Middleware mounted at `/plugins`.
 *
 * @param {() => object} getHost -> Returns the plugin host; throws while it is not started.
 * @returns {import('express').RequestHandler}
 * @example
 * app.use('/plugins', createPluginStatic(() => pluginHost()));
 */
function createPluginStatic(getHost) {
    return async function pluginStatic(req, res) {
        const notFound = () => res.status(404).end();
        try {
            if (req.method !== 'GET' && req.method !== 'HEAD') return notFound();
            const decoded = safeDecodedPath(req.path);
            if (!decoded) return notFound();
            const [empty, pluginId, ...parts] = decoded.split('/');
            if (empty !== '' || !PLUGIN_ID.test(pluginId || '')) return notFound();

            let host;
            try {
                host = getHost();
            } catch {
                return notFound();
            }
            if (!host.isEnabled(pluginId)) return notFound();
            const entry = host.entryOf(pluginId);
            if (!entry || !entry.manifest) return notFound();
            const allowed = allowedFile(entry.manifest, parts);
            if (!allowed) return notFound();

            const pluginDir = path.resolve(entry.dir);
            const absPath = path.resolve(pluginDir, allowed.file);
            if (!absPath.startsWith(pluginDir + path.sep) || !(await isInside(pluginDir, absPath))) return notFound();

            res.setHeader('Content-Type', allowed.type);
            // root = plugin folder: send checks only the segments below it for dotfiles, so a
            // dot-named parent (git worktree, ~/.local, PLUGINS_DIR=/srv/.dems/…) still works
            const options = { root: pluginDir, dotfiles: 'deny', headers: { 'Cache-Control': 'no-cache' } };
            res.sendFile(path.relative(pluginDir, absPath), options, (err) => {
                if (err && !res.headersSent) {
                    res.removeHeader('Content-Type');
                    notFound();
                }
            });
        } catch (err) {
            console.error('Plugin file error:', err);
            if (!res.headersSent) notFound();
        }
    };
}

module.exports = { createPluginStatic };
