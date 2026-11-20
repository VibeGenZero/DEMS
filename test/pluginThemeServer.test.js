const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir, startServer, createClient, runNode, repoPath } = require('./helpers');
const { preparePluginsDir, seedEnabledState, loginAt } = require('./pluginTestServer');

let server;
let safeServer;

function seedTheme(dbPath) {
    const code = `
        const { createThemeApi } = require(${repoPath('plugin-sdk/theme')});
        const state = require(${repoPath('plugin-sdk/state')});
        const theme = createThemeApi('custom-design', { granted: new Set(['theme']) });
        Promise.all([
            state.writeState('custom-design', { enabled: true }),
            theme.publish(':root{--accent:#123456}.a::before{content:"→ Neu"}')
        ])
            .then(() => theme.saveDraft(':root{--accent:#654321}'))
            .then(() => require(${repoPath('firebaseAdmin')}).close())
            .then(() => console.log('ok'));
    `;
    const res = runNode(code, { SQLITE_PATH: dbPath });
    assert.equal(res.status, 0, res.stderr);
}

async function startSeededServer(extraEnv = {}) {
    const tmpDir = createTempDir('theme-server');
    const dbPath = path.join(tmpDir, 'dev.sqlite');
    const pluginsDir = preparePluginsDir(tmpDir);
    seedEnabledState(dbPath);
    seedTheme(dbPath);
    return startServer('dev/start.js', {
        DEV_SQLITE_PATH: dbPath,
        DEV_UPLOAD_DIR: path.join(tmpDir, 'uploads'),
        PLUGINS_DIR: pluginsDir,
        ...extraEnv
    });
}

before(async () => {
    [server, safeServer] = await Promise.all([
        startSeededServer(),
        startSeededServer({ PLUGINS_SAFE_MODE: 'true' })
    ]);
});

after(() => Promise.all([server.stop(), safeServer.stop()]));

test('theme.css serves the published sheet to anyone without creating a session', async () => {
    const anon = createClient(server.baseUrl);
    const res = await anon.request('/theme.css');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/css; charset=utf-8');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('cache-control'), 'no-cache');
    assert.equal(res.headers.get('set-cookie'), null);
    const body = await res.text();
    assert.match(body, /\/\* plugin: custom-design \*\//);
    assert.match(body, /#123456/);
    assert.match(body, /→ Neu/);
    assert.doesNotMatch(body, /#654321/);
});

test('a repeated request with the ETag answers 304', async () => {
    const anon = createClient(server.baseUrl);
    const first = await anon.request('/theme.css');
    const etag = first.headers.get('etag');
    assert.ok(etag, 'missing ETag header');
    const second = await anon.request('/theme.css', { headers: { 'If-None-Match': etag } });
    assert.equal(second.status, 304);
});

test('theme.css is reachable while maintenance mode is on', async () => {
    const admin = await loginAt(server.baseUrl, 'admin');
    const on = await admin.send('PUT', '/api/admin/maintenance', {
        warningEnabled: true,
        warningText: 'Wartung',
        loginDisabled: true,
        registrationDisabled: true
    });
    assert.equal(on.status, 200);
    try {
        const res = await createClient(server.baseUrl).request('/theme.css');
        assert.equal(res.status, 200);
        assert.match(await res.text(), /#123456/);
    } finally {
        await admin.send('PUT', '/api/admin/maintenance', {
            warningEnabled: false,
            warningText: '',
            loginDisabled: false,
            registrationDisabled: false
        });
    }
});

test('preview is for admins only', async () => {
    const anon = await createClient(server.baseUrl).request('/theme-preview.css');
    assert.equal(anon.status, 404);

    const member = await loginAt(server.baseUrl, 'member');
    assert.equal((await member.request('/theme-preview.css')).status, 404);

    const admin = await loginAt(server.baseUrl, 'admin');
    const res = await admin.request('/theme-preview.css');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/css; charset=utf-8');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.match(await res.text(), /#654321/);
});

test('switching the plugin off empties theme.css and switching back on restores it', async () => {
    const admin = await loginAt(server.baseUrl, 'admin');
    const off = await admin.send('PUT', '/api/admin/plugins/custom-design/enabled', { enabled: false });
    assert.equal(off.status, 200);
    try {
        const res = await createClient(server.baseUrl).request('/theme.css');
        assert.equal(res.status, 200);
        assert.equal(await res.text(), '');
    } finally {
        const on = await admin.send('PUT', '/api/admin/plugins/custom-design/enabled', { enabled: true });
        assert.equal(on.status, 200);
    }
    assert.match(await (await createClient(server.baseUrl).request('/theme.css')).text(), /#123456/);
});

test('safe mode empties theme.css', async () => {
    const res = await createClient(safeServer.baseUrl).request('/theme.css');
    assert.equal(res.status, 200);
    assert.equal(await res.text(), '');
});
