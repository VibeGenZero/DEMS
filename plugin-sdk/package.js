/**
 * `.dems` plugin packages: analyse a plugin folder, build a package from it,
 * check an uploaded package without running anything, install and remove it.
 *
 * `checkPackage` and `installPackage` handle hostile uploads: names are
 * validated by the one allow-list in `files.js`, sources are scanned from the
 * in-memory entries and nothing touches the disk before the check passed.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PackageError } = require('./errors');
const { PERMISSIONS, ID_PATTERN, isPlainObject, validateManifest } = require('./manifest');
const { IGNORED_ENTRY, packageEntryError, readPluginSourcesSync } = require('./files');
const { scanPlugin, comparePermissions, requiredSdk, formatWarning } = require('./permissionScan');
const { readZip, writeZip } = require('./zip');

const MANIFEST_FILE = 'plugin.json';
const BOM = /^﻿/;

function randomHex() {
    return crypto.randomBytes(4).toString('hex');
}

/**
 * Compare a plugin folder's manifest with what its code really uses.
 *
 * @param {string} dir -> Plugin root (may itself be a link; links inside are never followed).
 * @returns {{ raw: object, manifest: object|null, errors: string[], found: string[], warnings: object[], missing: string[], unused: string[], sdk: number, nextRaw: object, changed: boolean }}
 * @throws {Error} -> When `plugin.json` is unreadable or no JSON object.
 */
function analyzePlugin(dir) {
    const root = fs.realpathSync(dir);
    const text = fs.readFileSync(path.join(root, MANIFEST_FILE), 'utf8').replace(BOM, '');
    let raw;
    try {
        raw = JSON.parse(text);
    } catch {
        throw new PackageError('plugin.json ist kein gültiges JSON.');
    }
    if (!isPlainObject(raw)) throw new PackageError('plugin.json ist kein Objekt.');

    const isFile = (rel) => {
        try {
            return fs.statSync(path.join(root, rel)).isFile();
        } catch {
            return false;
        }
    };
    const result = validateManifest(raw, typeof raw.id === 'string' ? raw.id : path.basename(root), { fileExists: isFile });
    const manifest = result.ok ? result.manifest : null;
    const errors = result.ok ? [] : [result.reason];

    const { sources, tooBig } = readPluginSourcesSync(root);
    if (tooBig) errors.push('Entpackt zu groß.');
    const entries = {
        server: typeof raw.server === 'string' ? raw.server : '',
        client: typeof raw.client === 'string' ? raw.client : ''
    };
    const scan = scanPlugin(sources, manifest || entries);
    const declared = Array.isArray(raw.permissions) ? raw.permissions.filter((p) => typeof p === 'string') : [];
    const { missing, unused } = comparePermissions(declared, scan.permissions);

    const added = Object.keys(PERMISSIONS).filter((p) => missing.includes(p));
    const nextRaw = { ...raw };
    if (Array.isArray(raw.permissions) || added.length) {
        nextRaw.permissions = [...(Array.isArray(raw.permissions) ? raw.permissions : []), ...added];
    }
    const sdk = typeof raw.sdk === 'number' ? requiredSdk([...declared, ...added], raw.sdk) : raw.sdk;
    if (sdk !== undefined) nextRaw.sdk = sdk;

    return {
        raw,
        manifest,
        errors,
        found: scan.permissions,
        warnings: scan.warnings,
        missing,
        unused,
        sdk,
        nextRaw,
        changed: JSON.stringify(nextRaw) !== JSON.stringify(raw)
    };
}

/**
 * Write `nextRaw` as `plugin.json`, keeping the file's line ending and BOM.
 *
 * @param {string} dir -> Plugin root.
 * @param {object} nextRaw -> Manifest object to store.
 */
function writeManifest(dir, nextRaw) {
    const file = path.join(fs.realpathSync(dir), MANIFEST_FILE);
    const old = fs.readFileSync(file, 'utf8');
    let text = `${JSON.stringify(nextRaw, null, 2)}\n`;
    if (old.includes('\r\n')) text = text.replace(/\n/g, '\r\n');
    if (BOM.test(old)) text = `﻿${text}`;
    fs.writeFileSync(file, text);
}

/** Collect the files of a plugin folder: refused paths are listed, a symlink stops at once. */
function collectFiles(root) {
    const files = [];
    const problems = [];
    const walk = (rel) => {
        for (const name of fs.readdirSync(path.join(root, rel)).sort()) {
            const relName = rel ? `${rel}/${name}` : name;
            if (IGNORED_ENTRY.test(relName)) continue;
            const stat = fs.lstatSync(path.join(root, relName));
            if (stat.isSymbolicLink()) throw new PackageError(`Symlinks werden nicht unterstützt: ${relName}`);
            if (stat.isDirectory()) {
                if (name.startsWith('.')) problems.push(`Versteckte Datei: ${relName}`);
                else if (name === 'node_modules') problems.push(`node_modules wird nicht unterstützt: ${relName}`);
                else walk(relName);
            } else {
                const reason = packageEntryError(relName);
                if (reason) problems.push(reason);
                else files.push(relName);
            }
        }
    };
    walk('');
    return { files, problems };
}

/**
 * @param {string} dir -> Plugin root.
 * @returns {{ buffer: Buffer, fileName: string }}
 * @throws {PackageError} -> Refused paths, symlinks, an invalid manifest or a broken limit.
 */
function packPlugin(dir) {
    const root = fs.realpathSync(dir);
    const { files, problems } = collectFiles(root);
    if (problems.length) throw new PackageError(problems.join(' · '));
    const analysis = analyzePlugin(root);
    if (!analysis.manifest) throw new PackageError(analysis.errors[0]);
    const entries = files.map((name) => ({ name, data: fs.readFileSync(path.join(root, name)) }));
    const buffer = writeZip(entries);
    readZip(buffer); // the package must pass the limits it will meet on upload
    return { buffer, fileName: `${analysis.manifest.id}-${analysis.manifest.version}.dems` };
}

function emptyReport(buffer) {
    return {
        ok: false,
        errors: [],
        manifest: null,
        fileCount: 0,
        packedBytes: Buffer.isBuffer(buffer) ? buffer.length : 0,
        unpackedBytes: 0,
        permissions: [],
        missing: [],
        unused: [],
        warnings: [],
        exists: false,
        installedVersion: ''
    };
}

function readInstalledVersion(dir) {
    try {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST_FILE), 'utf8').replace(BOM, ''));
        return typeof raw.version === 'string' ? raw.version : '';
    } catch {
        return '';
    }
}

/** Read a package and normalise entry names to NFC; returns the entries and every structural error. */
function prepareEntries(buffer) {
    let zipEntries;
    try {
        zipEntries = readZip(buffer);
    } catch (err) {
        if (err instanceof PackageError) return { errors: [err.message], entries: [] };
        throw err;
    }
    const errors = [];
    const entries = [];
    const seen = new Set();
    for (const entry of zipEntries) {
        const name = entry.name.normalize('NFC');
        const key = name.toLowerCase();
        if (seen.has(key)) {
            errors.push(`Doppelte Datei: ${name}`);
            continue;
        }
        seen.add(key);
        const reason = entry.symlink ? `Symlinks werden nicht unterstützt: ${name}` : packageEntryError(name);
        if (reason) errors.push(reason);
        entries.push({ name, data: entry.data });
    }
    // a file may not also be the directory of another entry (Windows and Linux both refuse that)
    const folders = new Set();
    for (const { name } of entries) {
        const parts = name.toLowerCase().split('/');
        for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join('/'));
    }
    for (const { name } of entries) {
        if (folders.has(name.toLowerCase())) errors.push(`Doppelte Datei: ${name}`);
    }
    if (!entries.length && !errors.length) errors.push('Das Paket ist leer.');
    return { errors, entries };
}

/**
 * Check an uploaded package without extracting it; never throws for bad input.
 *
 * @param {Buffer} buffer -> `.dems` bytes (untrusted).
 * @param {{ officialIds: Set<string>, customDir: string }} context
 * @returns {object} -> Report with `ok`, `errors`, manifest summary, sizes, permission comparison and install state.
 */
function checkPackage(buffer, { officialIds, customDir }) {
    const report = emptyReport(buffer);
    const { errors, entries } = prepareEntries(buffer);
    report.errors.push(...errors);
    report.fileCount = entries.length;
    report.unpackedBytes = entries.reduce((sum, e) => sum + e.data.length, 0);
    if (!entries.length) return report;

    const byName = new Map(entries.map((e) => [e.name, e.data]));
    if (!byName.has(MANIFEST_FILE)) {
        const wrapped = [...byName.keys()].filter((n) => /^[^/]+\/plugin\.json$/.test(n));
        report.errors.push(wrapped.length === 1
            ? 'plugin.json muss im Hauptverzeichnis der ZIP liegen (nicht in einem Unterordner).'
            : 'plugin.json fehlt.');
        return report;
    }

    let raw;
    try {
        raw = JSON.parse(byName.get(MANIFEST_FILE).toString('utf8').replace(BOM, ''));
    } catch {
        report.errors.push('plugin.json ist kein gültiges JSON.');
        return report;
    }

    const fileExists = (rel) => byName.has(path.posix.normalize(String(rel)));
    const result = validateManifest(raw, isPlainObject(raw) ? raw.id : '', { fileExists });
    if (!result.ok) {
        report.errors.push(result.reason);
        return report;
    }
    const manifest = result.manifest;
    if (officialIds.has(manifest.id)) report.errors.push('Die ID gehört einem offiziellen Plugin.');

    const sources = new Map();
    for (const [name, data] of byName) {
        if (name.endsWith('.js') && packageEntryError(name) === null) sources.set(name, data.toString('utf8').replace(BOM, ''));
    }
    const scan = scanPlugin(sources, manifest);
    const { missing, unused } = comparePermissions(manifest.permissions, scan.permissions);

    const installed = path.join(customDir, manifest.id);
    report.exists = fs.existsSync(installed);
    if (report.exists) report.installedVersion = readInstalledVersion(installed);
    report.manifest = {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        sdk: manifest.sdk,
        author: manifest.author,
        description: manifest.description
    };
    report.permissions = scan.permissions;
    report.missing = missing;
    report.unused = unused;
    report.warnings = scan.warnings.map(formatWarning);
    report.ok = report.errors.length === 0;
    return report;
}

async function removeQuietly(target) {
    try {
        await fs.promises.rm(target, { recursive: true, force: true });
    } catch {
        // best effort: leftovers carry the .incoming-/.old- prefix and are ignored by discovery
    }
}

/**
 * Install a checked package into `customDir/<id>`; the old folder is swapped, never half-written.
 *
 * @param {Buffer} buffer -> `.dems` bytes.
 * @param {{ officialIds: Set<string>, customDir: string, replace: boolean }} options
 * @returns {Promise<{ id: string, replaced: boolean }>}
 * @throws {PackageError} -> The first check error, or „Das Plugin ist schon installiert.“.
 */
async function installPackage(buffer, { officialIds, customDir, replace }) {
    const report = checkPackage(buffer, { officialIds, customDir });
    if (!report.ok) throw new PackageError(report.errors[0]);
    if (report.exists && !replace) throw new PackageError('Das Plugin ist schon installiert.');

    const id = report.manifest.id;
    const { entries } = prepareEntries(buffer);
    const incoming = path.join(customDir, `.incoming-${randomHex()}`);
    const target = path.join(customDir, id);
    const staged = path.join(incoming, id);
    let oldDir = null;
    try {
        await fs.promises.mkdir(staged, { recursive: true });
        for (const { name, data } of entries) {
            const file = path.join(staged, ...name.split('/'));
            if (path.relative(staged, file).startsWith('..')) throw new PackageError(`Unerlaubter Pfad: ${name}`);
            await fs.promises.mkdir(path.dirname(file), { recursive: true });
            await fs.promises.writeFile(file, data);
        }
        if (report.exists) {
            oldDir = path.join(customDir, `.old-${randomHex()}`);
            await fs.promises.rename(target, oldDir);
        }
        try {
            await fs.promises.rename(staged, target);
        } catch (err) {
            if (oldDir) {
                await fs.promises.rename(oldDir, target).catch(() => {
                    console.error(`Plugin ${id}: rollback failed, the previous version is kept in ${oldDir}`);
                });
            }
            throw err;
        }
    } catch (err) {
        await removeQuietly(incoming);
        if (err instanceof PackageError) throw err;
        console.error(`Plugin ${id}: install failed`, err);
        throw new PackageError('Das Plugin konnte nicht installiert werden.');
    }
    await removeQuietly(incoming);
    if (oldDir) await removeQuietly(oldDir);
    return { id, replaced: report.exists };
}

/**
 * @param {string} customDir -> Folder of custom plugins.
 * @param {string} id -> Plugin id.
 * @throws {PackageError} -> When `id` is not a valid plugin id.
 */
async function removePluginFolder(customDir, id) {
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw new PackageError('Ungültige Plugin-ID.');
    await fs.promises.rm(path.join(customDir, id), { recursive: true, force: true });
}

module.exports = { analyzePlugin, writeManifest, packPlugin, checkPackage, installPackage, removePluginFolder };
