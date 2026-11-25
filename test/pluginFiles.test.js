const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const files = require('../plugin-sdk/files');

test('packageEntryError refuses unsafe paths', () => {
    for (const name of ['../x.js', '/x.js', 'C:/x.js', 'a\\b.js', 'a//b.js', 'a\0b.js', '']) {
        assert.equal(files.packageEntryError(name), `Unerlaubter Pfad: ${name}`, name);
    }
});

test('packageEntryError refuses hidden files, node_modules and other types', () => {
    assert.equal(files.packageEntryError('.env'), 'Versteckte Datei: .env');
    assert.equal(files.packageEntryError('lib/.hidden.js'), 'Versteckte Datei: lib/.hidden.js');
    assert.equal(files.packageEntryError('.DS_Store'), 'Versteckte Datei: .DS_Store');
    assert.equal(
        files.packageEntryError('node_modules/x/index.js'),
        'node_modules wird nicht unterstützt: node_modules/x/index.js'
    );
    for (const name of ['index.html', 'assets/logo.svg', 'assets/sub/x.js']) {
        assert.equal(files.packageEntryError(name), `Nicht erlaubte Datei: ${name}`, name);
    }
});

test('packageEntryError allows plugin files', () => {
    for (const name of ['plugin.json', 'server.js', 'lib/engine.js', 'README.md', 'assets/view.js', 'assets/font.woff2', 'a/b.css', 'notes.txt', 'data/x.json']) {
        assert.equal(files.packageEntryError(name), null, name);
    }
});

test('isClientAsset matches only assets/<name>.js', () => {
    assert.equal(files.isClientAsset('assets/view.js'), true);
    assert.equal(files.isClientAsset('assets/view.css'), false);
    assert.equal(files.isClientAsset('assets/sub/view.js'), false);
    assert.equal(files.isClientAsset('view.js'), false);
});

test('IGNORED_ENTRY and LIMITS', () => {
    assert.ok(files.IGNORED_ENTRY.test('__MACOSX/x'));
    assert.ok(files.IGNORED_ENTRY.test('a/.DS_Store'));
    assert.ok(!files.IGNORED_ENTRY.test('a/b.js'));
    assert.equal(files.LIMITS.unpackedBytes, 20971520);
    assert.ok(Object.isFrozen(files.LIMITS));
});

function tmp() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'dems-files-'));
}

test('readPluginSourcesSync collects allowed js and strips the BOM', () => {
    const dir = tmp();
    try {
        fs.mkdirSync(path.join(dir, 'lib'));
        fs.mkdirSync(path.join(dir, 'assets'));
        fs.mkdirSync(path.join(dir, 'node_modules'));
        fs.mkdirSync(path.join(dir, '.git'));
        fs.writeFileSync(path.join(dir, 'server.js'), '\uFEFFconst a = 1;');
        fs.writeFileSync(path.join(dir, 'lib', 'a.js'), 'b');
        fs.writeFileSync(path.join(dir, 'assets', 'view.js'), 'c');
        fs.writeFileSync(path.join(dir, 'node_modules', 'x.js'), 'd');
        fs.writeFileSync(path.join(dir, '.git', 'y.js'), 'e');
        fs.writeFileSync(path.join(dir, 'plugin.json'), '{}');
        const { sources, tooBig } = files.readPluginSourcesSync(dir);
        assert.equal(tooBig, false);
        assert.deepEqual([...sources.keys()].sort(), ['assets/view.js', 'lib/a.js', 'server.js']);
        assert.equal(sources.get('server.js'), 'const a = 1;');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('readPluginSourcesSync sets tooBig past the unpacked limit', () => {
    const dir = tmp();
    try {
        fs.writeFileSync(path.join(dir, 'big.js'), Buffer.alloc(21 * 1024 * 1024, 97));
        assert.equal(files.readPluginSourcesSync(dir).tooBig, true);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('readPluginSourcesSync follows a symlinked root but not links inside', (t) => {
    const real = tmp();
    const outside = tmp();
    const link = path.join(os.tmpdir(), `dems-link-${process.pid}-${Date.now()}`);
    try {
        fs.writeFileSync(path.join(real, 'server.js'), 'a');
        fs.writeFileSync(path.join(outside, 'secret.js'), 's');
        try {
            fs.symlinkSync(real, link, 'junction');
            fs.symlinkSync(outside, path.join(real, 'linked'), 'junction');
            fs.symlinkSync(path.join(outside, 'secret.js'), path.join(real, 'l.js'), 'file');
        } catch {
            if (!fs.existsSync(link)) return t.skip('symlinks not available');
        }
        const { sources } = files.readPluginSourcesSync(link);
        assert.ok(sources.has('server.js'));
        assert.ok(![...sources.keys()].some((k) => k.startsWith('linked') || k === 'l.js'));
    } finally {
        try { fs.rmSync(link, { force: true, recursive: false }); } catch { /* ignore */ }
        fs.rmSync(real, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
    }
});
