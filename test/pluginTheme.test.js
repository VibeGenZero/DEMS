const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir } = require('./helpers');

// Own, empty SQLite database; the empty cwd keeps a local .env out
const tmpDir = createTempDir('plugin-theme');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.SQLITE_PATH = path.join(tmpDir, 'plugin-theme.sqlite');

const { db, collection, doc, getDoc, getDocs, setDoc, deleteDoc } = require('../firebaseAdmin');
const { PluginPermissionError, PluginHttpError } = require('../plugin-sdk/errors');
const { PERMISSIONS, validateManifest } = require('../plugin-sdk/manifest');
const data = require('../plugin-sdk/data');
const {
    THEME_COLLECTION,
    createThemeApi,
    readThemeSheets,
    deleteTheme
} = require('../plugin-sdk/theme');

beforeEach(async () => {
    for (const name of [THEME_COLLECTION, 'plugin:a:pluginThemes']) {
        const snapshot = await getDocs(collection(db, name));
        for (const item of snapshot.docs) await deleteDoc(doc(db, name, item.id));
    }
});

test('theme permission is known and labelled', () => {
    assert.equal(PERMISSIONS.theme, 'Aussehen der ganzen Seite ändern');
    const res = validateManifest({
        id: 'custom-design',
        name: 'Design anpassen',
        version: '1.0.0',
        sdk: 1,
        permissions: ['theme']
    }, 'custom-design', { fileExists: () => false });
    assert.equal(res.ok, true);
    assert.deepEqual(res.manifest.permissions, ['theme']);
});

test('ctx.theme without the permission rejects with PluginPermissionError', async () => {
    const theme = createThemeApi('a', { granted: new Set() });
    await assert.rejects(theme.saveDraft('.a{}'), PluginPermissionError);
    await assert.rejects(theme.discardDraft(), PluginPermissionError);
    await assert.rejects(theme.publish('.a{}'), PluginPermissionError);
    await assert.rejects(theme.clear(), PluginPermissionError);
});

test('invalid css rejects with a German 400 PluginHttpError and stores nothing', async () => {
    const theme = createThemeApi('a', { granted: new Set(['theme']) });
    await assert.rejects(
        theme.publish('@import "x.css";'),
        err => err instanceof PluginHttpError
            && err.status === 400
            && err.message === 'Zeile 1: @import ist nicht erlaubt.'
    );
    await assert.rejects(
        theme.saveDraft('.a { background: url(x); }'),
        err => err instanceof PluginHttpError
            && err.status === 400
            && err.message === 'Zeile 1: url() ist nicht erlaubt – eigene Bilder und Schriften können nicht eingebunden werden.'
    );
    assert.equal((await getDoc(doc(db, THEME_COLLECTION, 'a'))).exists(), false);
});

test('draft, publish and clear are stored per plugin', async () => {
    const a = createThemeApi('a', { granted: new Set(['theme']) });
    const b = createThemeApi('b', { granted: new Set(['theme']) });

    await a.publish('.a{}');
    await b.publish('.b{}');
    assert.equal(
        await readThemeSheets(['a', 'b']),
        '/* plugin: a */\n.a{}\n/* plugin: b */\n.b{}\n'
    );

    await a.saveDraft('.d{}');
    assert.equal(
        await readThemeSheets(['a', 'b']),
        '/* plugin: a */\n.a{}\n/* plugin: b */\n.b{}\n'
    );
    assert.equal(
        await readThemeSheets(['a', 'b'], { preview: true }),
        '/* plugin: a */\n.d{}\n/* plugin: b */\n.b{}\n'
    );

    await a.discardDraft();
    assert.equal(
        await readThemeSheets(['a', 'b'], { preview: true }),
        '/* plugin: a */\n.a{}\n/* plugin: b */\n.b{}\n'
    );

    await a.saveDraft('.d2{}');
    await a.publish('.a2{}');
    assert.equal(
        await readThemeSheets(['a'], { preview: true }),
        '/* plugin: a */\n.a2{}\n',
        'publish clears the draft'
    );

    await a.clear();
    assert.equal(await readThemeSheets(['a']), '');
    assert.equal(await readThemeSheets(['a', 'b']), '/* plugin: b */\n.b{}\n');

    await deleteTheme('b');
    assert.equal(await readThemeSheets(['a', 'b']), '');
});

test('a stored sheet that fails the filter is never served', async () => {
    await setDoc(doc(db, THEME_COLLECTION, 'a'), {
        css: '.a{background:url(x)}',
        publishedAt: '2026-11-20T10:00:00.000Z',
        draft: '',
        draftAt: ''
    });
    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
        assert.equal(await readThemeSheets(['a']), '');
    } finally {
        console.warn = origWarn;
    }
    assert.ok(warnings.some(line => line.includes('[plugin:a] Stored theme refused:')));
});

test('ctx.data cannot reach pluginThemes', async () => {
    const api = data.createDataApi('a', { recordCollection: async () => {} });
    await api.set('pluginThemes', 'a', { css: '.evil{}' });
    assert.equal(await readThemeSheets(['a']), '');
    assert.equal((await getDoc(doc(db, THEME_COLLECTION, 'a'))).exists(), false);
});
