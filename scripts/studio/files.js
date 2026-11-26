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

/** An error with a German message that a route can pass on as `{ error }` with `status`. */
class StudioError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.name = 'StudioError';
        this.status = status;
    }
}

const same = (a, b) => (WIN ? a.toLowerCase() === b.toLowerCase() : a === b);

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

function rootOf(dir) {
    try {
        return fs.realpathSync.native(dir);
    } catch {
        throw new StudioError('Der Plugin-Ordner wurde nicht gefunden.', 404);
    }
}

/**
 * Resolve a plugin-relative POSIX path to an absolute one inside the folder.
 *
 * @param {string} dir -> Opened plugin folder.
 * @param {string} rel -> Relative path with `/`.
 * @returns {{ root: string, abs: string, exists: boolean }} -> `abs` is the real path (existing) or the real parent plus the new names.
 * @throws {StudioError} -> Unerlaubter Pfad when the name or any existing segment is not acceptable.
 */
function resolveInside(dir, rel) {
    const reason = packageEntryError(rel);
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
    const relReal = path.relative(root, real);
    if (relReal !== '' && packageEntryError(relReal.split(path.sep).join('/')) !== null) throw unsafe();
    if (relReal === '' && exists) throw unsafe();
    return { root, abs: path.join(real, ...segments.slice(i)), exists };
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
    let raw;
    try {
        raw = JSON.parse(fs.readFileSync(manifestFile, 'utf8').replace(/^﻿/, ''));
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
 * List the files the build would pack (same skip rules as `collectFiles`), without links.
 *
 * @returns {Array<{ path: string, size: number, text: boolean }>}
 */
function listFiles(dir) {
    const root = rootOf(dir);
    const out = [];
    const walk = (rel) => {
        for (const name of fs.readdirSync(path.join(root, rel))) {
            const relName = rel ? `${rel}/${name}` : name;
            if (IGNORED_ENTRY.test(relName) || name.startsWith('.') || name === 'node_modules') continue;
            const file = path.join(root, relName);
            const stat = fs.lstatSync(file);
            if (stat.isSymbolicLink()) continue;
            if (stat.isDirectory()) {
                walk(relName);
            } else if (stat.isFile() && path.extname(name) !== '' && packageEntryError(relName) === null) {
                const text = stat.size <= LIMITS.entryBytes && decodeText(fs.readFileSync(file)) !== null;
                out.push({ path: relName, size: stat.size, text });
            }
        }
    };
    walk('');
    return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** @returns {string} -> File content (UTF-8). */
function readFile(dir, rel) {
    const { abs, exists } = resolveInside(dir, rel);
    if (!exists || !fs.statSync(abs).isFile()) throw notFound(rel);
    const notOpenable = new StudioError(`Kann nicht im Editor geöffnet werden: ${rel}`, 400);
    if (fs.statSync(abs).size > LIMITS.entryBytes) throw notOpenable;
    const text = decodeText(fs.readFileSync(abs));
    if (text === null) throw notOpenable;
    return text;
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
    const { abs, exists } = resolveInside(dir, rel);
    if (exists && !fs.statSync(abs).isFile()) throw new StudioError(`Unerlaubter Pfad: ${rel}`, 400);
    atomicWrite(abs, buffer);
}

/** Write (or create) a text file. */
function writeFile(dir, rel, content) {
    if (typeof content !== 'string') throw new StudioError('Der Inhalt muss Text sein.', 400);
    writeBuffer(dir, rel, Buffer.from(content, 'utf8'));
}

/** Write (or create) a binary file, e.g. an uploaded asset. */
function writeBinary(dir, rel, buffer) {
    if (!Buffer.isBuffer(buffer)) throw new StudioError('Der Inhalt muss eine Datei sein.', 400);
    writeBuffer(dir, rel, buffer);
}

/** Create an empty file; refuses an existing one. */
function createFile(dir, rel) {
    const { abs, exists } = resolveInside(dir, rel);
    if (exists) throw new StudioError(`Die Datei gibt es schon: ${rel}`, 409);
    ensureParent(abs);
    try {
        fs.writeFileSync(abs, '', { flag: 'wx' });
    } catch (err) {
        if (err.code === 'EEXIST') throw new StudioError(`Die Datei gibt es schon: ${rel}`, 409);
        throw err;
    }
}

function renameFile(dir, from, to) {
    const source = resolveInside(dir, from);
    if (!source.exists || !fs.statSync(source.abs).isFile()) throw notFound(from);
    const target = resolveInside(dir, to);
    // A case-only rename on a case-insensitive disk finds the file itself under the new name.
    const sameFile = target.exists && WIN && same(target.abs, source.abs);
    if (target.exists && !sameFile) throw new StudioError(`Die Datei gibt es schon: ${to}`, 409);
    ensureParent(target.abs);
    fs.renameSync(source.abs, target.abs);
}

function deleteFile(dir, rel) {
    const { abs, exists } = resolveInside(dir, rel);
    if (!exists || !fs.statSync(abs).isFile()) throw notFound(rel);
    fs.unlinkSync(abs);
}

module.exports = { StudioError, openPlugin, listFiles, readFile, writeFile, writeBinary, createFile, renameFile, deleteFile };
