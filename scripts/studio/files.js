'use strict';
/**
 * The studio's file API. This module is the only code that reads or writes files of the
 * opened plugin folder; every path goes through `resolveInside`, which keeps it inside
 * the folder, refuses links on the way and accepts only names the build would pack.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { LIMITS, IGNORED_ENTRY, packageEntryError } = require('../../plugin-sdk/files');
const { validateManifest } = require('../../plugin-sdk/manifest');

const MANIFEST_FILE = 'plugin.json';
const WIN = process.platform === 'win32';
const NOT_ALLOWED = 'Nicht erlaubte Datei';

/** An error with a German message that a route can pass on as `{ error }` with `status`. */
class StudioError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.name = 'StudioError';
        this.status = status;
    }
}

function isInside(rootReal, real) {
    const rel = path.relative(rootReal, real);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function lstatOrNull(file) {
    try {
        return fs.lstatSync(file);
    } catch (err) {
        if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null;
        throw err;
    }
}

/** The folder as the disk spells it; a swapped-in link or a moved folder makes it differ from `dir`. */
function rootOf(dir) {
    let real;
    try {
        real = fs.realpathSync.native(dir);
    } catch {
        throw new StudioError('Der Plugin-Ordner wurde nicht gefunden.', 404);
    }
    if (real !== dir) throw new StudioError('Der Plugin-Ordner hat sich verändert. Bitte neu öffnen.', 400);
    return real;
}

/** A name is acceptable for delete / rename-from when only its extension keeps the build from packing it. */
function nameError(rel, { lenient }) {
    const reason = packageEntryError(rel);
    if (reason === null) return null;
    if (lenient && reason.startsWith(NOT_ALLOWED) && path.posix.extname(rel) !== '') return null;
    return reason;
}

/**
 * Resolve a plugin-relative POSIX path to an absolute one inside the folder.
 *
 * @param {string} dir -> Opened plugin folder (as returned by `openPlugin`).
 * @param {string} rel -> Relative path with `/`.
 * @param {{ lenient?: boolean }} options -> `lenient`: also accept names the build would not pack (delete, rename from).
 * @returns {{ root: string, abs: string, exists: boolean }} -> `abs` is the real path (existing) or the real parent plus the new names.
 * @throws {StudioError} -> Unerlaubter Pfad when the name or any existing segment is not acceptable.
 */
function resolveInside(dir, rel, { lenient = false } = {}) {
    const reason = typeof rel === 'string' && IGNORED_ENTRY.test(rel) ? `Unerlaubter Pfad: ${rel}` : nameError(rel, { lenient });
    if (reason) throw new StudioError(reason, 400);
    const unsafe = () => new StudioError(`Unerlaubter Pfad: ${rel}`, 400);
    const root = rootOf(dir);
    const segments = rel.split('/');
    let current = root;
    let i = 0;
    for (; i < segments.length; i++) {
        const next = path.join(current, segments[i]);
        const stat = lstatOrNull(next);
        if (!stat) break;
        if (stat.isSymbolicLink()) throw unsafe();
        if (i < segments.length - 1 && !stat.isDirectory()) throw unsafe();
        current = next;
    }
    const exists = i === segments.length;
    // Long names and real case (8.3 short names must not open dot files); re-check what the disk really holds.
    const real = fs.realpathSync.native(current);
    if (real !== root && !isInside(root, real)) throw unsafe();
    const abs = path.join(real, ...segments.slice(i));
    const relReal = path.relative(root, abs);
    if (relReal === '' || relReal.startsWith('..') || path.isAbsolute(relReal)) throw unsafe();
    if (nameError(relReal.split(path.sep).join('/'), { lenient }) !== null) throw unsafe();
    return { root, abs, exists };
}

function notFound(rel) {
    return new StudioError(`Datei nicht gefunden: ${rel}`, 404);
}

function decodeText(buffer) {
    try {
        return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer);
    } catch {
        return null;
    }
}

/** Run `fn`; anything that is not a StudioError becomes a German one without paths (the original is logged). */
function guard(verb, fn) {
    return (...args) => {
        try {
            return fn(...args);
        } catch (err) {
            if (err instanceof StudioError) throw err;
            console.error(`studio files: ${err && err.stack ? err.stack : err}`);
            throw new StudioError(`Die Datei konnte nicht ${verb} werden.`, 500);
        }
    };
}

/**
 * Open a plugin folder: resolve it once and read a valid `plugin.json`.
 *
 * @param {string} folder -> Folder path (any form the OS accepts).
 * @returns {{ dir: string, manifest: object, id: string, version: string }}
 */
function openPlugin(folder) {
    if (typeof folder !== 'string' || folder.trim() === '') throw new StudioError('Bitte einen Ordner angeben.', 400);
    let dir;
    try {
        dir = fs.realpathSync.native(path.resolve(folder));
    } catch {
        throw new StudioError('Der Ordner wurde nicht gefunden.', 404);
    }
    if (!fs.statSync(dir).isDirectory()) throw new StudioError('Das ist kein Ordner.', 400);
    const manifestFile = path.join(dir, MANIFEST_FILE);
    const stat = lstatOrNull(manifestFile);
    if (!stat || !stat.isFile()) throw new StudioError('Im Ordner liegt keine plugin.json.', 400);
    if (stat.size > LIMITS.entryBytes) throw new StudioError('Die plugin.json ist zu groß.', 400);
    let raw;
    try {
        raw = JSON.parse(fs.readFileSync(manifestFile, 'utf8').replace(/^\uFEFF/, ''));
    } catch {
        throw new StudioError('Die plugin.json ist kein gültiges JSON.', 400);
    }
    const fileExists = (rel) => {
        const s = lstatOrNull(path.join(dir, rel));
        return !!s && s.isFile();
    };
    const result = validateManifest(raw, path.basename(dir), { fileExists });
    if (!result.ok) throw new StudioError(`Die plugin.json ist ungültig: ${result.reason}`, 400);
    return { dir, manifest: result.manifest, id: result.manifest.id, version: result.manifest.version };
}

/**
 * Visit every file the build skip rules do not hide (no dot entries, `node_modules`,
 * extension-less files, OS litter, links). `allowed` tells whether the build would pack it.
 */
function walkFiles(root, visit) {
    const walk = (rel) => {
        for (const name of fs.readdirSync(path.join(root, rel))) {
            const relName = rel ? `${rel}/${name}` : name;
            if (IGNORED_ENTRY.test(relName) || name.startsWith('.') || name === 'node_modules') continue;
            const file = path.join(root, relName);
            const stat = fs.lstatSync(file);
            if (stat.isSymbolicLink()) continue;
            if (stat.isDirectory()) {
                walk(relName);
            } else if (stat.isFile() && path.extname(name) !== '') {
                const reason = packageEntryError(relName);
                if (reason === null) visit(relName, file, stat.size, true);
                else if (reason.startsWith(NOT_ALLOWED)) visit(relName, file, stat.size, false);
            }
        }
    };
    walk('');
}

/**
 * List the files of the folder; `allowed: false` marks safe files the build would not pack
 * (they can be deleted or renamed, not edited).
 *
 * @returns {Array<{ path: string, size: number, text: boolean, allowed: boolean }>}
 */
const listFiles = guard('gelesen', (dir) => {
    const root = rootOf(dir);
    const out = [];
    walkFiles(root, (rel, file, size, allowed) => {
        const text = allowed && size <= LIMITS.entryBytes && decodeText(fs.readFileSync(file)) !== null;
        out.push({ path: rel, size, text, allowed });
    });
    return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
});

/** @returns {string} -> File content (UTF-8). */
const readFile = guard('gelesen', (dir, rel) => {
    const { abs, exists } = resolveInside(dir, rel);
    if (!exists || !fs.statSync(abs).isFile()) throw notFound(rel);
    const notOpenable = new StudioError(`Kann nicht im Editor geöffnet werden: ${rel}`, 400);
    if (fs.statSync(abs).size > LIMITS.entryBytes) throw notOpenable;
    const text = decodeText(fs.readFileSync(abs));
    if (text === null) throw notOpenable;
    return text;
});

/** sha256 (hex) of the file's bytes; null when the file is missing. */
const fileHash = guard('gelesen', (dir, rel) => {
    const { abs, exists } = resolveInside(dir, rel);
    if (!exists || !fs.statSync(abs).isFile()) return null;
    return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
});

/** The folder (what the build would pack) must stay within the package limits after the change. */
function checkFolderLimits(root, { addCount, addBytes }) {
    let count = addCount;
    let bytes = addBytes;
    walkFiles(root, (rel, file, size, allowed) => {
        if (!allowed) return;
        count += 1;
        bytes += size;
    });
    if (count > LIMITS.entries || bytes > LIMITS.unpackedBytes) {
        throw new StudioError(`Das Plugin wird zu groß (höchstens ${LIMITS.entries} Dateien / ${LIMITS.unpackedBytes / 1048576} MB).`, 400);
    }
}

function ensureParent(abs) {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
}

/** Write via a dot-named temp file in the same folder, then rename, so a crash leaves no half file. */
function atomicWrite(abs, buffer) {
    ensureParent(abs);
    const temp = path.join(path.dirname(abs), `.${path.basename(abs)}.${crypto.randomBytes(6).toString('hex')}.tmp`);
    try {
        fs.writeFileSync(temp, buffer, { flag: 'wx' });
        fs.renameSync(temp, abs);
    } catch (err) {
        fs.rmSync(temp, { force: true });
        throw err;
    }
}

function writeBuffer(dir, rel, buffer) {
    if (buffer.length > LIMITS.entryBytes) throw new StudioError(`Datei zu groß: ${rel}`, 400);
    const { root, abs, exists } = resolveInside(dir, rel);
    if (exists && !fs.statSync(abs).isFile()) throw new StudioError(`Unerlaubter Pfad: ${rel}`, 400);
    checkFolderLimits(root, { addCount: exists ? 0 : 1, addBytes: buffer.length - (exists ? fs.statSync(abs).size : 0) });
    atomicWrite(abs, buffer);
}

/** Write (or create) a text file. */
const writeFile = guard('gespeichert', (dir, rel, content) => {
    if (typeof content !== 'string') throw new StudioError('Der Inhalt muss Text sein.', 400);
    writeBuffer(dir, rel, Buffer.from(content, 'utf8'));
});

/** Write (or create) a binary file, e.g. an uploaded asset. */
const writeBinary = guard('gespeichert', (dir, rel, buffer) => {
    if (!Buffer.isBuffer(buffer)) throw new StudioError('Der Inhalt muss eine Datei sein.', 400);
    writeBuffer(dir, rel, buffer);
});

/** Create an empty file; refuses an existing one. */
const createFile = guard('gespeichert', (dir, rel) => {
    const { root, abs, exists } = resolveInside(dir, rel);
    if (exists) throw new StudioError(`Die Datei gibt es schon: ${rel}`, 409);
    checkFolderLimits(root, { addCount: 1, addBytes: 0 });
    ensureParent(abs);
    try {
        fs.writeFileSync(abs, '', { flag: 'wx' });
    } catch (err) {
        if (err.code === 'EEXIST') throw new StudioError(`Die Datei gibt es schon: ${rel}`, 409);
        throw err;
    }
});

/** Rename or move a file; the source may be a safe file the build would not pack, the target must be a packable name. */
const renameFile = guard('gespeichert', (dir, from, to) => {
    const source = resolveInside(dir, from, { lenient: true });
    if (!source.exists || !fs.statSync(source.abs).isFile()) throw notFound(from);
    const target = resolveInside(dir, to);
    let destination = target.abs;
    if (target.exists) {
        const a = fs.statSync(source.abs);
        const b = fs.statSync(target.abs);
        const sameFile = a.dev === b.dev && a.ino === b.ino && a.ino !== 0 && target.abs.toLowerCase() === source.abs.toLowerCase();
        if (!sameFile) throw new StudioError(`Die Datei gibt es schon: ${to}`, 409);
        // Same file under another case: rename to the spelling that was asked for.
        destination = path.join(path.dirname(target.abs), path.posix.basename(to));
    }
    ensureParent(destination);
    fs.renameSync(source.abs, destination);
});

const deleteFile = guard('gespeichert', (dir, rel) => {
    const { abs, exists } = resolveInside(dir, rel, { lenient: true });
    if (!exists || !fs.statSync(abs).isFile()) throw notFound(rel);
    fs.unlinkSync(abs);
});

module.exports = { StudioError, openPlugin, listFiles, readFile, fileHash, writeFile, writeBinary, createFile, renameFile, deleteFile };
