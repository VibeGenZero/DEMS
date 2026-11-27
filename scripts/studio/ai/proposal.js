'use strict';
/**
 * Checks an AI proposal in memory before the author sees a diff: path rules, manifest,
 * JS syntax (compile only, plugin code never runs) and the permission scan.
 * Only problems that are new compared with the current files cause a repair round.
 */
const vm = require('node:vm');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { packageEntryError, LIMITS, isJsFile, isClientAsset } = require('../../../plugin-sdk/files');
const { validateManifest, isPlainObject, PERMISSIONS } = require('../../../plugin-sdk/manifest');
const { scanPlugin, comparePermissions, requiredSdk } = require('../../../plugin-sdk/permissionScan');

const MANIFEST_FILE = 'plugin.json';
const BINARY_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.woff2']);
const SPAWN_TIMEOUT_MS = 10000;

const problem = (kind, file, message, detail = message) => ({ key: `${kind}:${file}:${detail}`, file, message });

/** Compile a CommonJS file without running it. @returns {{ line: number, reason: string }|null} */
function checkCommonJs(file, source) {
    try {
        new vm.Script(`(function (exports, require, module, __filename, __dirname) {${source.replace(/^#!.*/, '')}\n})`, { filename: file });
        return null;
    } catch (err) {
        const line = /:(\d+)\n/.exec(String(err.stack || '')); // "<file>:<line>" heads the stack
        return { line: line ? Number(line[1]) : 0, reason: err.message };
    }
}

/** Parse an ES module without running it (`node --check`). @returns {{ line: number, reason: string }|null} */
function checkModule(source) {
    const run = spawnSync(process.execPath, ['--check', '--input-type=module'], {
        input: source, encoding: 'utf8', timeout: SPAWN_TIMEOUT_MS, windowsHide: true
    });
    if (run.status === 0) return null;
    if (run.error || run.status === null) return null; // the check could not run: no verdict, never a syntax error
    const text = String(run.stderr || '');
    const line = /^\[stdin\]:(\d+)/m.exec(text);
    const reason = /^\w*Error: (.*)$/m.exec(text);
    return { line: line ? Number(line[1]) : 0, reason: reason ? reason[1] : 'Syntaxfehler' };
}

const syntaxCache = new Map();
function checkSyntax(file, source, asModule) {
    const cacheKey = `${asModule ? 'm' : 'c'}\0${source}`;
    if (!syntaxCache.has(cacheKey)) {
        if (syntaxCache.size > 200) syntaxCache.clear();
        syntaxCache.set(cacheKey, asModule ? checkModule(source) : checkCommonJs(file, source));
    }
    return syntaxCache.get(cacheKey);
}

/** @returns {number|null} -> The sdk version plugin.json needs when it is higher than the declared one. */
function needsSdk(raw, found, declared) {
    if (typeof raw.sdk !== 'number') return null;
    const wanted = requiredSdk([...declared, ...found], raw.sdk);
    return wanted !== raw.sdk ? wanted : null;
}

/** Parse plugin.json of a file set. @returns {{ raw: object|null, error: string|null }} */
function parseManifest(files) {
    const text = files.get(MANIFEST_FILE);
    if (typeof text !== 'string') return { raw: null, error: 'plugin.json fehlt.' };
    let raw;
    try {
        raw = JSON.parse(text.replace(/^﻿/, ''));
    } catch {
        return { raw: null, error: 'plugin.json ist kein gültiges JSON.' };
    }
    return isPlainObject(raw) ? { raw, error: null } : { raw: null, error: 'plugin.json ist kein Objekt.' };
}

/** Scan the permissions of a file set. @returns {{ found: string[], declared: string[], missing: string[] }} */
function scanSet(files, raw, manifest) {
    const sources = new Map([...files].filter(([name]) => isJsFile(name)));
    const scan = scanPlugin(sources, manifest || {
        server: typeof raw.server === 'string' ? raw.server : '',
        client: typeof raw.client === 'string' ? raw.client : ''
    });
    const declared = Array.isArray(raw.permissions) ? raw.permissions.filter((p) => typeof p === 'string') : [];
    const { missing } = comparePermissions(declared, scan.permissions);
    return { found: scan.permissions, clients: new Set(scan.clients), declared, missing: Object.keys(PERMISSIONS).filter((p) => missing.includes(p)) };
}

/**
 * @param {Map<string, string>} files -> Plugin files by relative path.
 * @returns {{ key: string, file: string, message: string }[]} -> Problems; `key` is stable across runs.
 */
function checkSet(files) {
    const problems = [];
    const { raw, error } = parseManifest(files);
    if (error) problems.push(problem('manifest', MANIFEST_FILE, error));

    let manifest = null;
    if (raw) {
        const folder = typeof raw.id === 'string' ? raw.id : 'plugin';
        const result = validateManifest(raw, folder, { fileExists: (rel) => files.has(rel) });
        if (result.ok) manifest = result.manifest;
        else problems.push(problem('manifest', MANIFEST_FILE, `plugin.json: ${result.reason}`));
    }

    const scanned = raw ? scanSet(files, raw, manifest) : null;
    // without a readable manifest nothing is known to be a client file except assets
    const client = scanned ? scanned.clients : new Set([...files.keys()].filter(isClientAsset));
    for (const [file, source] of files) {
        if (!isJsFile(file)) continue;
        const failed = checkSyntax(file, String(source).replace(/^﻿/, ''), client.has(file));
        if (failed) {
            const where = failed.line ? `${file}:${failed.line}` : file;
            problems.push(problem('syntax', file, `${where}: Syntaxfehler: ${failed.reason}`, `Syntaxfehler: ${failed.reason}`));
        }
    }

    if (raw) {
        const { found, declared, missing } = scanned;
        for (const permission of missing) {
            problems.push(problem('permission', MANIFEST_FILE, `Der Code braucht die Berechtigung „${permission}“, sie fehlt in plugin.json.`));
        }
        const sdk = needsSdk(raw, found, [...declared, ...missing]);
        if (sdk !== null) {
            problems.push(problem('sdk', MANIFEST_FILE, `Die Berechtigungen brauchen "sdk": ${sdk} in plugin.json.`));
        }
    }
    return problems;
}

/** @returns {string|null} -> German reason when the AI may not write `file`, null when it may. */
function dropReason(file, content, count) {
    if (typeof file !== 'string' || typeof content !== 'string') return 'Ungültiger Eintrag.';
    if (file.split('/').includes('..') || file.startsWith('/')) return `Unerlaubter Pfad: ${file}`;
    if (BINARY_EXTENSIONS.has(path.posix.extname(file).toLowerCase())) {
        return `Binärdatei (${file}): Bilder und Schriften kann die KI nicht schreiben, der Autor legt sie selbst ab.`;
    }
    const refused = packageEntryError(file);
    if (refused) return refused;
    if (Buffer.byteLength(content, 'utf8') > LIMITS.entryBytes) return `Datei zu groß: ${file}`;
    if (count > LIMITS.entries) return `Zu viele Dateien im Paket: ${file}`;
    return null;
}

/** Permissions and sdk version the merged manifest still lacks. */
function permissionChangesOf(merged) {
    const { raw } = parseManifest(merged);
    if (!raw) return { added: [], sdk: null };
    const { found, declared, missing } = scanSet(merged, raw, null);
    return { added: missing, sdk: needsSdk(raw, found, [...declared, ...missing]) };
}

/**
 * @param {{ current: Map<string, string>, proposed: { path: string, content: string }[] }} input
 * @returns {{ files: object[], dropped: object[], newProblems: object[], oldProblems: object[], permissionChanges: { added: string[], sdk: number|null } }}
 */
function evaluate({ current, proposed }) {
    const merged = new Map(current);
    const touched = new Map();
    const dropped = [];
    for (const item of proposed) {
        const file = item && item.path;
        const content = item && item.content;
        const reason = dropReason(file, content, merged.size + (merged.has(file) ? 0 : 1));
        if (reason) {
            dropped.push({ path: String(file), reason });
            continue;
        }
        merged.set(file, content);
        touched.set(file, content);
    }
    const files = [...touched]
        .filter(([file, after]) => !current.has(file) || current.get(file) !== after)
        .map(([file, after]) => ({ path: file, before: current.has(file) ? current.get(file) : '', after, isNew: !current.has(file) }));

    const total = [...merged.values()].reduce((sum, s) => sum + Buffer.byteLength(s, 'utf8'), 0);
    if (total > LIMITS.unpackedBytes) {
        for (const f of files) dropped.push({ path: f.path, reason: `Paket wäre entpackt zu groß: ${f.path}` });
        return finish(current, current, [], dropped);
    }
    return finish(current, merged, files, dropped);
}

function finish(current, merged, files, dropped) {
    const oldProblems = checkSet(current);
    const known = new Set(oldProblems.map((p) => p.key));
    const newProblems = checkSet(merged).filter((p) => !known.has(p.key));
    return { files, dropped, newProblems, oldProblems, permissionChanges: permissionChangesOf(merged) };
}

/** @returns {boolean} -> A repair round is worth it: the proposal introduced a problem. */
function needsRepair(result) {
    return result.newProblems.length > 0;
}

/** @returns {string} -> German request to the model that lists what to fix. */
function repairMessage(result) {
    const lines = [
        ...result.newProblems.map((p) => `- ${p.message}`),
        ...result.dropped.map((d) => `- ${d.path} wurde verworfen: ${d.reason}`)
    ];
    return `Bitte korrigiere:\n${lines.join('\n')}\nAntworte mit den korrigierten Dateien vollständig.`;
}

module.exports = { checkSet, evaluate, needsRepair, repairMessage };
