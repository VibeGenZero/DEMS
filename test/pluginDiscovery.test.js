const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createTempDir } = require('./helpers');

const { discoverPlugins } = require('../plugin-sdk/discovery');

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
        { official: entries[1].official, status: entries[1].status, reason: entries[1].reason, manifest: entries[1].manifest },
        { official: false, status: 'invalid', reason: 'Ungültig: Die ID gehört einem offiziellen Plugin.', manifest: null }
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
        reason: 'Ungültig: plugin.json ist kein gültiges JSON.'
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
