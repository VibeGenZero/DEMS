const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createTempDir } = require('./helpers');

const { discoverPlugins, readCustomPlugin } = require('../plugin-sdk/discovery');
const { LIMITS } = require('../plugin-sdk/files');

/** Write a plugin folder; `manifest` is an object (JSON) or a raw string. */
function writePlugin(root, folder, manifest, files = {}) {
    const dir = path.join(root, folder);
    fs.mkdirSync(dir, { recursive: true });
    if (manifest !== undefined) {
        const text = typeof manifest === 'string' ? manifest : JSON.stringify(manifest);
        fs.writeFileSync(path.join(dir, 'plugin.json'), text);
    }
    for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
    return dir;
}

function manifest(id, extra = {}) {
    return { id, name: `Plugin ${id}`, version: '1.0.0', sdk: 1, ...extra };
}

function setup() {
    const root = createTempDir('plugin-discovery');
    const officialDir = path.join(root, 'official');
    const customDir = path.join(root, 'custom');
    fs.mkdirSync(officialDir);
    fs.mkdirSync(customDir);
    return { officialDir, customDir };
}

test('official and custom plugins are found, official first, then by id', () => {
    const { officialDir, customDir } = setup();
    writePlugin(officialDir, 'zeta-official', manifest('zeta-official'));
    writePlugin(officialDir, 'alpha-official', manifest('alpha-official', { server: 'server.js' }), { 'server.js': '' });
    writePlugin(customDir, 'beta-custom', manifest('beta-custom'), { 'client.css': '' });
    writePlugin(customDir, 'aaa-custom', manifest('aaa-custom'));

    const entries = discoverPlugins({ officialDir, customDir });

    assert.deepEqual(entries.map(entry => [entry.id, entry.official]), [
        ['alpha-official', true],
        ['zeta-official', true],
        ['aaa-custom', false],
        ['beta-custom', false]
    ]);
    const alpha = entries[0];
    assert.equal(alpha.dir, path.join(officialDir, 'alpha-official'));
    assert.equal(alpha.status, null);
    assert.equal(alpha.reason, '');
    assert.equal(alpha.manifest.server, 'server.js');
    assert.equal(entries[3].manifest.css, 'client.css');
});

test('a manifest file that does not exist in the folder makes the plugin invalid', () => {
    const { officialDir, customDir } = setup();
    writePlugin(customDir, 'no-server', manifest('no-server', { server: 'server.js' }));
    fs.mkdirSync(path.join(customDir, 'no-server', 'server.js'));

    const [entry] = discoverPlugins({ officialDir, customDir });

    assert.equal(entry.status, 'invalid');
    assert.equal(entry.manifest, null);
    assert.match(entry.reason, /^Ungültig: Datei server\.js/);
});

test('a custom plugin with the id of an official one is invalid', () => {
    const { officialDir, customDir } = setup();
    writePlugin(officialDir, 'event-submissions', manifest('event-submissions'));
    writePlugin(customDir, 'event-submissions', manifest('event-submissions'));

    const entries = discoverPlugins({ officialDir, customDir });

    assert.equal(entries.length, 2);
    assert.equal(entries[0].official, true);
    assert.equal(entries[0].status, null);
    assert.deepEqual(
        { official: entries[1].official, status: entries[1].status, reason: entries[1].reason, manifest: entries[1].manifest, permissionCheck: entries[1].permissionCheck },
        { official: false, status: 'invalid', reason: 'Ungültig: Die ID gehört einem offiziellen Plugin.', manifest: null, permissionCheck: null }
    );
});

test('a folder without plugin.json and loose files are skipped', () => {
    const { officialDir, customDir } = setup();
    writePlugin(customDir, 'empty-folder', undefined, { 'readme.txt': 'x' });
    fs.writeFileSync(path.join(customDir, 'loose.json'), '{}');
    writePlugin(customDir, 'real-one', manifest('real-one'));

    const entries = discoverPlugins({ officialDir, customDir });

    assert.deepEqual(entries.map(entry => entry.id), ['real-one']);
});

test('broken JSON makes the plugin invalid', () => {
    const { officialDir, customDir } = setup();
    writePlugin(customDir, 'broken-json', '{ "id": "broken-json", ');

    const [entry] = discoverPlugins({ officialDir, customDir });

    assert.deepEqual(entry, {
        id: 'broken-json',
        dir: path.join(customDir, 'broken-json'),
        official: false,
        manifest: null,
        status: 'invalid',
        reason: 'Ungültig: plugin.json ist kein gültiges JSON.',
        permissionCheck: null
    });
});

test('an incompatible SDK version keeps the status of the manifest check', () => {
    const { officialDir, customDir } = setup();
    writePlugin(customDir, 'future-one', manifest('future-one', { sdk: 2 }));

    const [entry] = discoverPlugins({ officialDir, customDir });

    assert.equal(entry.status, 'incompatible');
    assert.equal(entry.reason, 'Inkompatibel (SDK 2)');
});

test('a missing custom folder yields only the official plugins', () => {
    const { officialDir } = setup();
    writePlugin(officialDir, 'only-official', manifest('only-official'));

    const entries = discoverPlugins({ officialDir, customDir: path.join(officialDir, '..', 'does-not-exist') });

    assert.deepEqual(entries.map(entry => entry.id), ['only-official']);
});

test('dot folders are skipped, also a complete plugin left in .old-* or .incoming-*', () => {
    const { officialDir, customDir } = setup();
    writePlugin(customDir, path.join('.incoming-x', 'demo'), manifest('demo'));
    writePlugin(customDir, '.old-abc', manifest('demo'));
    writePlugin(customDir, 'real-one', manifest('real-one'));

    const entries = discoverPlugins({ officialDir, customDir });

    assert.deepEqual(entries.map(entry => entry.id), ['real-one']);
});

test('a plugin folder that is a directory link (junction) is listed', () => {
    const { officialDir, customDir } = setup();
    const target = writePlugin(createTempDir('plugin-discovery-target'), 'linked', manifest('linked'));
    fs.symlinkSync(target, path.join(customDir, 'linked'), 'junction');

    const entries = discoverPlugins({ officialDir, customDir });

    assert.deepEqual(entries.map(entry => [entry.id, entry.status]), [['linked', null]]);
    assert.equal(entries[0].dir, path.join(customDir, 'linked'));
});

test('a valid custom plugin gets a permission check of its code; official ones are not scanned', () => {
    const { officialDir, customDir } = setup();
    const code = "module.exports = { register(ctx) { ctx.discord.sendDM('1', 'Hallo'); } };";
    writePlugin(officialDir, 'shipped', manifest('shipped', { server: 'server.js' }), { 'server.js': code });
    writePlugin(customDir, 'dm-sender', manifest('dm-sender', { server: 'server.js', permissions: ['theme'] }), { 'server.js': code });

    const [official, custom] = discoverPlugins({ officialDir, customDir });

    assert.equal(official.permissionCheck, null);
    assert.deepEqual(custom.permissionCheck, { missing: ['discord:dm'], unused: ['theme'], warnings: [], tooBig: false });
});

test('scanner warnings arrive as text with file and line', () => {
    const { officialDir, customDir } = setup();
    const code = "module.exports = { register(ctx) {\n  const area = 'discord';\n  ctx[area].sendDM('1', 'x');\n} };";
    writePlugin(customDir, 'dynamic', manifest('dynamic', { server: 'server.js' }), { 'server.js': code });

    const [entry] = discoverPlugins({ officialDir, customDir });

    assert.equal(entry.permissionCheck.tooBig, false);
    assert.ok(entry.permissionCheck.warnings.length > 0);
    assert.match(entry.permissionCheck.warnings[0], /^server\.js:3: /);
});

test('a plugin with too much code is not scanned and says so', () => {
    const { officialDir, customDir } = setup();
    writePlugin(customDir, 'huge', manifest('huge', { server: 'server.js' }), {
        'server.js': "module.exports = { register(ctx) { ctx.discord.sendDM('1', 'x'); } };",
        'big.js': Buffer.alloc(LIMITS.unpackedBytes + 1, 0x20)
    });

    const [entry] = discoverPlugins({ officialDir, customDir });

    assert.deepEqual(entry.permissionCheck, { missing: [], unused: [], warnings: [], tooBig: true });
});

test('readCustomPlugin reads one custom folder and refuses an official id', () => {
    const { customDir } = setup();
    writePlugin(customDir, 'single', manifest('single', { version: '2.0.0' }));
    writePlugin(customDir, 'event-submissions', manifest('event-submissions'));

    const entry = readCustomPlugin(customDir, 'single', new Set(['event-submissions']));
    const clash = readCustomPlugin(customDir, 'event-submissions', new Set(['event-submissions']));

    assert.equal(entry.official, false);
    assert.equal(entry.manifest.version, '2.0.0');
    assert.deepEqual(entry.permissionCheck, { missing: [], unused: [], warnings: [], tooBig: false });
    assert.equal(clash.status, 'invalid');
    assert.equal(clash.reason, 'Ungültig: Die ID gehört einem offiziellen Plugin.');
    assert.equal(clash.permissionCheck, null);
});
