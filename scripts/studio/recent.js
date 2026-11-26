'use strict';
/** The studio's list of recently opened plugin folders (newest first, at most 10). */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const FILE = 'recent.json';
const MAX = 10;

/** @returns {string} -> Folder of `recent.json`: `%APPDATA%/dems-studio` or `$XDG_CONFIG_HOME|~/.config/dems-studio`. */
function configDir(env = process.env, platform = process.platform) {
    const p = platform === 'win32' ? path.win32 : path.posix;
    const home = env.HOME || env.USERPROFILE || os.homedir();
    if (platform === 'win32') return p.join(env.APPDATA || p.join(home, 'AppData', 'Roaming'), 'dems-studio');
    return p.join(env.XDG_CONFIG_HOME || p.join(home, '.config'), 'dems-studio');
}

const isText = (v) => typeof v === 'string' && v !== '';
const newestFirst = (a, b) => (a.openedAt < b.openedAt ? 1 : a.openedAt > b.openedAt ? -1 : 0);

function readEntries(dir) {
    try {
        const list = JSON.parse(fs.readFileSync(path.join(dir, FILE), 'utf8').replace(/^﻿/, ''));
        if (!Array.isArray(list)) return [];
        return list
            .filter((e) => e && isText(e.dir) && isText(e.id))
            .map((e) => ({ dir: e.dir, id: e.id, name: typeof e.name === 'string' ? e.name : e.id, openedAt: typeof e.openedAt === 'string' ? e.openedAt : '' }));
    } catch {
        return [];
    }
}

function store(dir, entries) {
    fs.mkdirSync(dir, { recursive: true });
    const temp = path.join(dir, `.${FILE}.${crypto.randomBytes(6).toString('hex')}.tmp`);
    try {
        fs.writeFileSync(temp, `${JSON.stringify(entries, null, 2)}\n`);
        fs.renameSync(temp, path.join(dir, FILE));
    } catch (err) {
        fs.rmSync(temp, { force: true });
        throw err;
    }
}

const key = (dir) => (process.platform === 'win32' ? path.resolve(dir).toLowerCase() : path.resolve(dir));

function isFolder(dir) {
    try {
        return fs.statSync(dir).isDirectory();
    } catch {
        return false;
    }
}

/** @returns {Array<{ dir: string, id: string, name: string, openedAt: string, exists: boolean }>} */
function load(dir) {
    return readEntries(dir).sort(newestFirst).slice(0, MAX).map((e) => ({ ...e, exists: isFolder(e.dir) }));
}

/** Add or refresh an entry (deduped by folder); keeps the newest 10. */
function add(dir, entry) {
    const next = { dir: entry.dir, id: entry.id, name: entry.name || entry.id, openedAt: entry.openedAt || new Date().toISOString() };
    const rest = readEntries(dir).filter((e) => key(e.dir) !== key(next.dir));
    store(dir, [next, ...rest].sort(newestFirst).slice(0, MAX));
}

function remove(dir, folder) {
    store(dir, readEntries(dir).filter((e) => key(e.dir) !== key(folder)));
}

module.exports = { configDir, load, add, remove };
