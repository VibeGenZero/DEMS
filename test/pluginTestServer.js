/**
 * Shared setup of the suites that run the real server (dev mock mode) with
 * the fixture plugins: `hook-recorder` switched on (seeded or through the
 * admin API), its copy `idle-recorder` off.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createTempDir, startServer, createClient, runNode, repoPath } = require('./helpers');

const FIXTURES = path.join(__dirname, 'fixtures', 'plugins');
const PLUGIN = 'hook-recorder';
// A second, never switched on copy of the fixture
const IDLE_PLUGIN = 'idle-recorder';

/**
 * Copy the fixture plugins into a temp dir; `idle-recorder` is a copy that stays off.
 *
 * @param {string} tmpDir -> Temp directory of the server.
 * @returns {string} -> The plugins directory for `PLUGINS_DIR`.
 */
function preparePluginsDir(tmpDir) {
    // Below a dot-named folder, like a git worktree or ~/.local: plugin files must still be served
    const pluginsDir = path.join(tmpDir, '.dems', 'plugins');
    fs.cpSync(FIXTURES, pluginsDir, { recursive: true });
    const idleDir = path.join(pluginsDir, IDLE_PLUGIN);
    fs.cpSync(path.join(pluginsDir, PLUGIN), idleDir, { recursive: true });
    const manifestFile = path.join(idleDir, 'plugin.json');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    fs.writeFileSync(manifestFile, JSON.stringify({ ...manifest, id: IDLE_PLUGIN }));
    return pluginsDir;
}

/**
 * Switch hook-recorder on before the server starts, as the admin would
 * (`pluginState` with the confirmed version and permissions).
 *
 * @param {string} dbPath -> SQLite file of the server.
 */
function seedEnabledState(dbPath) {
    const code = `
        require(${repoPath('plugin-sdk/state')}).writeState(${JSON.stringify(PLUGIN)}, {
            enabled: true, confirmedVersion: '1.0.0', confirmedPermissions: ['events:read', 'events:draft']
        }).then(() => require(${repoPath('firebaseAdmin')}).close()).then(() => console.log('ok'));
    `;
    const result = runNode(code, { SQLITE_PATH: dbPath });
    assert.equal(result.status, 0, result.stderr);
}

/**
 * Start dev/start.js with its own database and the fixture plugins.
 *
 * @param {Object} [env] -> Extra environment variables.
 * @param {{ seed?: boolean }} [options] -> `seed: false` starts with every plugin off (switch on with `enableCustom`).
 * @returns {Promise<Object>} -> See `startServer` in test/helpers.js.
 */
async function startPluginServer(env = {}, { seed = true } = {}) {
    const tmpDir = createTempDir('plugin-server');
    const dbPath = path.join(tmpDir, 'dev.sqlite');
    const pluginsDir = preparePluginsDir(tmpDir);
    if (seed) seedEnabledState(dbPath);
    return startServer('dev/start.js', {
        DEV_SQLITE_PATH: dbPath,
        DEV_UPLOAD_DIR: path.join(tmpDir, 'uploads'),
        PLUGINS_DIR: pluginsDir,
        ...env
    });
}

/**
 * A client logged in as a dev persona.
 *
 * @param {string} baseUrl -> Base URL of the server.
 * @param {string} personaId -> `admin`, `raider`, `member` or `newbie`.
 * @returns {Promise<Object>} -> See `createClient` in test/helpers.js.
 */
async function loginAt(baseUrl, personaId) {
    const client = createClient(baseUrl);
    const res = await client.request(`/auth/dev-login/${personaId}`);
    assert.equal(res.status, 302);
    return client;
}

/**
 * Switch a custom plugin on through the admin API, as the admin would in
 * System › Plugins (trust confirmed, dev reset password `dev`).
 *
 * @param {string} baseUrl -> Base URL of the server.
 * @param {string} pluginId -> Id of the custom plugin.
 * @returns {Promise<Object>} -> The plugin view of the answer.
 */
async function enableCustom(baseUrl, pluginId) {
    const admin = await loginAt(baseUrl, 'admin');
    const res = await admin.send('PUT', `/api/admin/plugins/${pluginId}/enabled`, { enabled: true, trust: true, password: 'dev' });
    assert.equal(res.status, 200, await res.clone().text());
    const { plugin } = await res.json();
    assert.equal(plugin.status, 'on');
    return plugin;
}

module.exports = { PLUGIN, IDLE_PLUGIN, preparePluginsDir, seedEnabledState, startPluginServer, loginAt, enableCustom };
