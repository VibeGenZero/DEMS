/**
 * Optional bridge to the local plugin studio (`dev/studioEvents.js`).
 * dev/ may be absent and the studio is optional: without it every call is a no-op.
 */
const fs = require('fs');
const path = require('path');

/** @returns {object|null} -> The studioEvents module while the studio is active, else null. */
function studio() {
    try {
        const events = require('../dev/studioEvents');
        return events.isActive() ? events : null;
    } catch {
        return null;
    }
}

/** Send one event to the studio; never throws. */
function studioEmit(type, pluginId, data) {
    const events = studio();
    if (events) events.emit(type, pluginId, data);
}

/** Real path of a plugin folder (junctions and links resolved, as `require` reports them), cached. */
const rootCache = new Map();
function realRoot(dir) {
    if (!rootCache.has(dir)) {
        let real = path.resolve(dir);
        try {
            real = fs.realpathSync(real);
        } catch {
            // keep the plain path
        }
        rootCache.set(dir, real);
    }
    return rootCache.get(dir);
}

// `at fn (<file>:<line>:<col>)` or `at <file>:<line>:<col>`
const FRAME = /\(?((?:[A-Za-z]:)?[^():]+):(\d+):\d+\)?\s*$/;
// A SyntaxError from require starts with `<abs file>:<line>` before the source excerpt
const HEADER = /^(.+):(\d+)$/;

/**
 * First stack line that points into the plugin folder.
 *
 * @param {Error} err
 * @param {string} dir -> Plugin folder.
 * @returns {{ file?: string, line?: number }} -> `file` relative with `/`, or `{}`.
 */
function pluginFrame(err, dir) {
    try {
        if (!err || typeof err.stack !== 'string' || !dir) return {};
        const root = realRoot(dir);
        const same = text => (process.platform === 'win32' ? text.toLowerCase() : text);
        const inside = (candidate, line) => {
            const file = path.resolve(candidate);
            if (!same(file).startsWith(same(root + path.sep))) return null;
            return { file: path.relative(root, file).split(path.sep).join('/'), line: Number(line) };
        };
        const lines = err.stack.split(/\r?\n/);
        const header = HEADER.exec(lines[0].trim());
        if (header && path.isAbsolute(header[1])) {
            const found = inside(header[1], header[2]);
            if (found) return found;
        }
        for (const line of lines.slice(1)) {
            const match = FRAME.exec(line.trim().replace(/^at\s+/, ''));
            if (!match) continue;
            const found = inside(match[1], match[2]);
            if (found) return found;
        }
    } catch {
        // best effort
    }
    return {};
}

/** `pluginFrame` while the studio listens, else `{}` (no file system work outside the studio). */
function studioFrame(err, dir) {
    return studio() ? pluginFrame(err, dir) : {};
}

module.exports = { studio, studioEmit, pluginFrame, studioFrame };
