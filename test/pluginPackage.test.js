const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyzePlugin, writeManifest, packPlugin, checkPackage, installPackage, removePluginFolder } = require('../plugin-sdk/package');
const { readZip, writeZip } = require('../plugin-sdk/zip');
const { PackageError } = require('../plugin-sdk/errors');

const tmp = [];
function tempDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dems-pkg-'));
    tmp.push(dir);
    return dir;
}
test.after(() => tmp.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

const MANIFEST = { id: 'demo', name: 'Demo', version: '1.0.0', sdk: 1, homepage: 'x', permissions: ['theme'], server: 'index.js' };

/** Plugin folder using `ctx.discord.addRole` (needs discord:roles) next to a declared `theme`. */
function makePlugin(manifest = MANIFEST, files = {}) {
    const dir = path.join(tempDir(), 'demo');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify(manifest, null, 2));
    const all = { 'index.js': 'module.exports = (ctx) => { ctx.discord.addRole("1", "2"); };', ...files };
    for (const [name, text] of Object.entries(all)) {
        fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
        fs.writeFileSync(path.join(dir, name), text);
    }
    return dir;
}

function zipOf(manifest, files = {}) {
    const all = { 'plugin.json': JSON.stringify(manifest), 'index.js': 'module.exports = () => {};', ...files };
    return writeZip(Object.entries(all).map(([name, text]) => ({ name, data: Buffer.from(text) })));
}

const GOOD = { id: 'demo', name: 'Demo', version: '1.0.0', sdk: 1, server: 'index.js' };

test('analyzePlugin finds missing and unused permissions and builds nextRaw', () => {
    const a = analyzePlugin(makePlugin());
    assert.deepEqual(a.missing, ['discord:roles']);
    assert.deepEqual(a.unused, ['theme']);
    assert.equal(a.nextRaw.sdk, 1.1);
    assert.deepEqual(a.nextRaw.permissions, ['theme', 'discord:roles']);
    assert.deepEqual(Object.keys(a.nextRaw), Object.keys(MANIFEST));
    assert.equal(a.changed, true);
});

test('analyzePlugin is stable after writeManifest, keeps CRLF and reads a BOM', () => {
    const dir = makePlugin();
    fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify(MANIFEST, null, 2).replace(/\n/g, '\r\n'));
    writeManifest(dir, analyzePlugin(dir).nextRaw);
    const text = fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8');
    assert.ok(text.includes('\r\n') && !/[^\r]\n/.test(text));
    assert.equal(analyzePlugin(dir).changed, false);

    fs.writeFileSync(path.join(dir, 'plugin.json'), `﻿${JSON.stringify(MANIFEST)}`);
    assert.equal(analyzePlugin(dir).manifest.id, 'demo');
});

test('analyzePlugin accepts a plugin root that is itself a link', (t) => {
    const dir = makePlugin();
    const link = path.join(tempDir(), 'link');
    try {
        fs.symlinkSync(dir, link, 'junction');
    } catch {
        return t.skip('no link permission');
    }
    assert.deepEqual(analyzePlugin(link).missing, ['discord:roles']);
});

test('packPlugin builds a root-level package named after id and version', () => {
    const dir = makePlugin({ ...MANIFEST, permissions: ['theme', 'discord:roles'], sdk: 1.1 }, { '__MACOSX/x.js': 'x', '.DS_Store': 'x' });
    const { buffer, fileName } = packPlugin(dir);
    assert.equal(fileName, 'demo-1.0.0.dems');
    assert.deepEqual(readZip(buffer).map((e) => e.name).sort(), ['index.js', 'plugin.json']);
});

test('packPlugin refuses index.html and symlinks', (t) => {
    assert.throws(() => packPlugin(makePlugin(MANIFEST, { 'index.html': '<p>' })), (e) => e instanceof PackageError && e.message.includes('index.html'));
    assert.throws(() => packPlugin(makePlugin(MANIFEST, { 'index.html': '<p>', '.gitignore': 'x', LICENSE: 'x' })), /Nicht erlaubte Datei: index\.html/);
    const dir = makePlugin();
    try {
        fs.symlinkSync(tempDir(), path.join(dir, 'link.js'), 'junction');
    } catch {
        return t.skip('no link permission');
    }
    assert.throws(() => packPlugin(dir), /Symlinks werden nicht unterstützt: link\.js/);
});

test('checkPackage reports wrapped folders, official ids and missing permissions', () => {
    const ctx = { officialIds: new Set(['official']), customDir: tempDir() };
    const wrapped = writeZip([{ name: 'demo/plugin.json', data: Buffer.from(JSON.stringify(GOOD)) }]);
    assert.ok(checkPackage(wrapped, ctx).errors[0].includes('Hauptverzeichnis'));
    assert.deepEqual(checkPackage(writeZip([{ name: 'a.js', data: Buffer.from('x') }]), ctx).errors, ['plugin.json fehlt.']);
    assert.deepEqual(checkPackage(Buffer.from('nope'), ctx).errors.length, 1);
    assert.deepEqual(checkPackage(zipOf({ ...GOOD, id: 'official' }), ctx).errors, ['Die ID gehört einem offiziellen Plugin.']);

    const report = checkPackage(zipOf({ ...GOOD, sdk: 1.1 }, { 'index.js': 'module.exports = (ctx) => { ctx.discord.addRole(1, 2); };' }), ctx);
    assert.equal(report.ok, true);
    assert.deepEqual(report.missing, ['discord:roles']);
    assert.equal(report.manifest.id, 'demo');
    assert.equal(report.fileCount, 2);
});

test('checkPackage refuses names that collide after Unicode normalisation', () => {
    const ctx = { officialIds: new Set(), customDir: tempDir() };
    const nfc = 'café.js';
    const nfd = 'café.js';
    const zip = zipOf(GOOD, { [nfc]: 'x', [nfd]: 'y' });
    assert.ok(checkPackage(zip, ctx).errors.some((e) => e.startsWith('Doppelte Datei')));
});

test('checkPackage reports an existing install', async () => {
    const ctx = { officialIds: new Set(), customDir: tempDir() };
    await installPackage(zipOf(GOOD), { ...ctx, replace: false });
    const report = checkPackage(zipOf({ ...GOOD, version: '1.1.0' }), ctx);
    assert.equal(report.exists, true);
    assert.equal(report.installedVersion, '1.0.0');
});

test('installPackage installs, refuses duplicates and replaces without leftovers', async () => {
    const ctx = { officialIds: new Set(), customDir: tempDir() };
    assert.deepEqual(await installPackage(zipOf(GOOD), { ...ctx, replace: false }), { id: 'demo', replaced: false });
    assert.ok(fs.existsSync(path.join(ctx.customDir, 'demo', 'index.js')));
    await assert.rejects(installPackage(zipOf(GOOD), { ...ctx, replace: false }), /Das Plugin ist schon installiert\./);

    const next = zipOf({ ...GOOD, version: '2.0.0' }, { 'index.js': 'module.exports = () => { /* new */ };' });
    assert.deepEqual(await installPackage(next, { ...ctx, replace: true }), { id: 'demo', replaced: true });
    assert.match(fs.readFileSync(path.join(ctx.customDir, 'demo', 'index.js'), 'utf8'), /new/);
    assert.deepEqual(fs.readdirSync(ctx.customDir), ['demo']);
});

test('installPackage keeps the old folder when the swap fails', async () => {
    const ctx = { officialIds: new Set(), customDir: tempDir() };
    await installPackage(zipOf(GOOD), { ...ctx, replace: false });
    const original = fs.promises.rename;
    const logged = console.error;
    console.error = () => {};
    let calls = 0;
    fs.promises.rename = async (...args) => {
        calls++;
        if (calls === 2) throw new Error('boom');
        return original(...args);
    };
    try {
        await assert.rejects(installPackage(zipOf({ ...GOOD, version: '2.0.0' }), { ...ctx, replace: true }), /konnte nicht installiert werden/);
    } finally {
        fs.promises.rename = original;
        console.error = logged;
    }
    assert.equal(JSON.parse(fs.readFileSync(path.join(ctx.customDir, 'demo', 'plugin.json'), 'utf8')).version, '1.0.0');
    assert.deepEqual(fs.readdirSync(ctx.customDir), ['demo']);
});

test('installPackage throws the first check error and writes nothing', async () => {
    const ctx = { officialIds: new Set(['demo']), customDir: tempDir() };
    await assert.rejects(installPackage(zipOf(GOOD), { ...ctx, replace: false }), /offiziellen/);
    assert.deepEqual(fs.readdirSync(ctx.customDir), []);
});

test('removePluginFolder deletes the folder and refuses bad ids', async () => {
    const ctx = { officialIds: new Set(), customDir: tempDir() };
    await installPackage(zipOf(GOOD), { ...ctx, replace: false });
    await assert.rejects(removePluginFolder(ctx.customDir, '../x'), PackageError);
    await removePluginFolder(ctx.customDir, 'demo');
    assert.deepEqual(fs.readdirSync(ctx.customDir), []);
});

// ---- fix round 1 ----
function withSymlinkAttr(zip, name) {
    const buf = Buffer.from(zip);
    let pos = 0;
    while ((pos = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), pos)) >= 0) {
        const len = buf.readUInt16LE(pos + 28);
        if (buf.subarray(pos + 46, pos + 46 + len).toString() === name) buf.writeUInt32LE((0o120777 << 16) >>> 0, pos + 38);
        pos += 4;
    }
    return buf;
}

test('an empty package is refused with a message', async () => {
    const ctx = { officialIds: new Set(), customDir: tempDir() };
    const onlyLitter = writeZip([{ name: '__MACOSX/a.js', data: Buffer.from('x') }]);
    for (const zip of [writeZip([]), onlyLitter]) {
        assert.deepEqual(checkPackage(zip, ctx).errors, ['Das Paket ist leer.']);
        await assert.rejects(installPackage(zip, { ...ctx, replace: false }), /Das Paket ist leer\./);
    }
});

test('a file that is also a directory prefix is refused, unexpected fs errors are wrapped', async () => {
    const ctx = { officialIds: new Set(), customDir: tempDir() };
    const zip = zipOf(GOOD, { 'index.js/b.js': 'x' });
    assert.ok(checkPackage(zip, ctx).errors.some((e) => e.startsWith('Doppelte Datei')));
    const original = fs.promises.writeFile;
    const logged = console.error;
    console.error = () => {};
    fs.promises.writeFile = async () => { throw new Error(`EEXIST ${ctx.customDir}`); };
    try {
        await assert.rejects(installPackage(zipOf(GOOD), { ...ctx, replace: false }), (e) => e instanceof PackageError && e.message === 'Das Plugin konnte nicht installiert werden.');
    } finally {
        fs.promises.writeFile = original;
        console.error = logged;
    }
    assert.deepEqual(fs.readdirSync(ctx.customDir), []);
});

test('analyzePlugin turns bad JSON into a PackageError', () => {
    const dir = makePlugin();
    fs.writeFileSync(path.join(dir, 'plugin.json'), '{ nope');
    assert.throws(() => analyzePlugin(dir), (e) => e instanceof PackageError && e.message === 'plugin.json ist kein gültiges JSON.');
});

test('rollback failure does not hide the original error', async () => {
    const ctx = { officialIds: new Set(), customDir: tempDir() };
    await installPackage(zipOf(GOOD), { ...ctx, replace: false });
    const original = fs.promises.rename;
    const logged = console.error;
    console.error = () => {};
    let calls = 0;
    fs.promises.rename = async (...args) => {
        if (++calls >= 2) throw new Error('boom');
        return original(...args);
    };
    try {
        await assert.rejects(installPackage(zipOf({ ...GOOD, version: '2.0.0' }), { ...ctx, replace: true }), PackageError);
    } finally {
        fs.promises.rename = original;
        console.error = logged;
    }
});

test('checkPackage refuses symlink entries, case collisions, bad JSON and hostile names', async () => {
    const ctx = { officialIds: new Set(), customDir: tempDir() };
    const link = withSymlinkAttr(zipOf(GOOD, { 'link.js': 'target' }), 'link.js');
    assert.ok(checkPackage(link, ctx).errors.includes('Symlinks werden nicht unterstützt: link.js'));
    assert.ok(checkPackage(zipOf(GOOD, { 'A.js': 'x', 'a.js': 'y' }), ctx).errors.some((e) => e.startsWith('Doppelte Datei')));
    assert.ok(checkPackage(writeZip([{ name: 'plugin.json', data: Buffer.from('{ nope') }]), ctx).errors.includes('plugin.json ist kein gültiges JSON.'));
    const hostile = zipOf(GOOD, { '../x.js': 'x' });
    assert.ok(checkPackage(hostile, ctx).errors.includes('Unerlaubter Pfad: ../x.js'));
    await assert.rejects(installPackage(hostile, { ...ctx, replace: false }), /Unerlaubter Pfad: \.\.\/x\.js/);
    assert.deepEqual(fs.readdirSync(ctx.customDir), []);
});

test('packPlugin skips dot entries, node_modules and extension-less files and lists them', () => {
    const dir = makePlugin(MANIFEST, {
        '.git/config': 'x',
        '.git/objects/ab.js': 'x',
        '.gitignore': 'node_modules/',
        '.vscode/settings.json': '{}',
        LICENSE: 'MIT',
        'node_modules/x.js': 'x',
        'lib/.eslintrc.json': '{}',
        'lib/NOTES': 'x',
        'lib/a.js': ''
    });
    const expected = ['.git', '.gitignore', '.vscode', 'LICENSE', 'lib/.eslintrc.json', 'lib/NOTES', 'node_modules'];
    const { buffer, skipped } = packPlugin(dir);
    assert.deepEqual(readZip(buffer).map((e) => e.name).sort(), ['index.js', 'lib/a.js', 'plugin.json']);
    assert.deepEqual(skipped, expected);
    assert.deepEqual(analyzePlugin(dir).skipped, expected);
});

test('an uploaded package still refuses what a build skips', () => {
    const ctx = { officialIds: new Set(), customDir: tempDir() };
    const { errors } = checkPackage(zipOf(GOOD, { '.gitignore': 'x', LICENSE: 'x', 'node_modules/x.js': 'x' }), ctx);
    assert.ok(errors.includes('Versteckte Datei: .gitignore'), errors.join(' | '));
    assert.ok(errors.includes('Nicht erlaubte Datei: LICENSE'), errors.join(' | '));
    assert.ok(errors.includes('node_modules wird nicht unterstützt: node_modules/x.js'), errors.join(' | '));
});
