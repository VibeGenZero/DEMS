// Plugin routes and client files through the real server (dev mock mode).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createClient } = require('./helpers');
const { PLUGIN, IDLE_PLUGIN, startPluginServer, loginAt } = require('./pluginTestServer');
const { PERSONAS } = require('../dev/mockGuild');

let server;
let safeServer;

before(async () => {
    [server, safeServer] = await Promise.all([
        startPluginServer(),
        startPluginServer({ PLUGINS_SAFE_MODE: 'true' })
    ]);
});

after(() => Promise.all([server.stop(), safeServer.stop()]));

const personaById = (id) => PERSONAS.find(persona => persona.id === id);

const loginAs = (personaId, baseUrl = server.baseUrl) => loginAt(baseUrl, personaId);

/**
 * GET with the path sent exactly as written: fetch would normalize `..`
 * and `%2e%2e` before the request leaves the client.
 */
function rawGet(baseUrl, rawPath) {
    const { hostname, port } = new URL(baseUrl);
    return new Promise((resolve, reject) => {
        const req = http.request({ hostname, port, path: rawPath, method: 'GET' }, res => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', chunk => { body += chunk; });
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
        });
        req.on('error', reject);
        req.end();
    });
}

test('a plugin that is not switched on answers 404', async () => {
    const client = await loginAs('member');
    const res = await client.request(`/api/plugins/${IDLE_PLUGIN}/me`);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'Plugin nicht gefunden.' });
});

test('an unknown plugin answers 404', async () => {
    const client = await loginAs('member');
    const res = await client.request('/api/plugins/no-such-plugin/me');
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'Plugin nicht gefunden.' });
});

test('a switched-on plugin answers a member with the logged-in user', async () => {
    const client = await loginAs('member');
    const res = await client.request(`/api/plugins/${PLUGIN}/me`);
    assert.equal(res.status, 200);
    const { user } = await res.json();
    const persona = personaById('member');
    assert.equal(user.id, persona.userId);
    assert.equal(user.name, persona.displayName);
    assert.equal(user.isAdmin, false);
    assert.ok(Array.isArray(user.roles));
    assert.deepEqual(Object.keys(user).sort(), ['avatar', 'id', 'isAdmin', 'name', 'roles']);
});

test('a plugin route without a session answers 401', async () => {
    const res = await createClient(server.baseUrl).request(`/api/plugins/${PLUGIN}/me`);
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: 'Nicht eingeloggt. Bitte melde dich über Discord an.' });
});

test('an admin route of a plugin refuses a member and serves an admin', async () => {
    const member = await loginAs('member');
    const refused = await member.request(`/api/plugins/${PLUGIN}/log`);
    assert.equal(refused.status, 403);
    assert.deepEqual(await refused.json(), { error: 'Keine Administrator-Berechtigung.' });

    const admin = await loginAs('admin');
    const res = await admin.request(`/api/plugins/${PLUGIN}/log`);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(await res.json()));
});

test('an unknown route of a switched-on plugin answers 404', async () => {
    const client = await loginAs('member');
    const res = await client.request(`/api/plugins/${PLUGIN}/nothing-here`);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'Nicht gefunden.' });
});

test('a plugin handler that throws answers 500 with a German sentence', async () => {
    const client = await loginAs('member');
    const res = await client.send('POST', `/api/plugins/${PLUGIN}/boom`, {});
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: 'Im Plugin ist ein Fehler aufgetreten.' });
    await server.waitForOutput('kaputt');
});

test('ctx.httpError answers with its status and message', async () => {
    const client = await loginAs('member');
    const res = await client.send('POST', `/api/plugins/${PLUGIN}/teapot`, {});
    assert.equal(res.status, 418);
    assert.deepEqual(await res.json(), { error: 'Ich bin eine Teekanne.' });
});

test('a mutating plugin request needs the CSRF token', async () => {
    const client = await loginAs('member');
    const refused = await client.request(`/api/plugins/${PLUGIN}/me`, { method: 'POST' });
    assert.equal(refused.status, 403);
    assert.deepEqual(await refused.json(), { error: 'Ungültiges CSRF-Token. Bitte Seite neu laden.' });

    const res = await client.send('POST', `/api/plugins/${PLUGIN}/me`, {});
    assert.equal(res.status, 200);
});

test('GET /api/plugins lists the client of every switched-on plugin', async () => {
    assert.equal((await createClient(server.baseUrl).request('/api/plugins')).status, 401);

    const client = await loginAs('member');
    const res = await client.request('/api/plugins');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), [{
        id: PLUGIN,
        name: 'Hook-Rekorder',
        version: '1.0.0',
        official: false,
        permissions: ['events:read', 'events:draft'],
        client: `/plugins/${PLUGIN}/client.js?v=1.0.0`,
        css: ''
    }]);
});

test('the client file of a switched-on plugin is served as JavaScript', async () => {
    const res = await createClient(server.baseUrl).request(`/plugins/${PLUGIN}/client.js?v=1.0.0`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('cache-control'), 'no-cache');
    assert.equal(res.headers.get('set-cookie'), null);
    assert.match(await res.text(), /export function register/);
});

test('the client file of a plugin that is off is not served', async () => {
    const res = await createClient(server.baseUrl).request(`/plugins/${IDLE_PLUGIN}/client.js`);
    assert.equal(res.status, 404);
});

for (const rawPath of [
    `/plugins/${PLUGIN}/../../.env`,
    `/plugins/${PLUGIN}/../../package.json`,
    `/plugins/${PLUGIN}/%2e%2e/%2e%2e/package.json`,
    `/plugins/${PLUGIN}/assets/../server.js`,
    `/plugins/${PLUGIN}/assets%2f..%2fserver.js`,
    `/plugins/${PLUGIN}/assets/..%5cserver.js`,
    `/plugins/${PLUGIN}/client.js%00.png`,
    `/plugins/${PLUGIN}/server.js`,
    `/plugins/${PLUGIN}/plugin.json`,
    `/plugins/${PLUGIN}/client.css`,
    `/plugins/${PLUGIN}/assets/x.html`,
    `/plugins/${PLUGIN}/assets/missing.js`,
    `/plugins/${PLUGIN}/`,
    `/plugins/${PLUGIN}`,
    '/plugins/',
    '/plugins/..%2f..%2fpackage.json'
]) {
    test(`a path trick on plugin files answers 404: ${rawPath}`, async () => {
        const res = await rawGet(server.baseUrl, rawPath);
        assert.equal(res.status, 404);
        assert.doesNotMatch(res.body, /"name"|SESSION|register\(ctx\)|<html/i);
    });
}

test('safe mode starts no plugin code', async () => {
    await safeServer.waitForOutput('DEMS Server running');
    const client = await loginAs('member', safeServer.baseUrl);
    const list = await client.request('/api/plugins');
    assert.equal(list.status, 200);
    assert.deepEqual(await list.json(), []);

    const route = await client.request(`/api/plugins/${PLUGIN}/me`);
    assert.equal(route.status, 404);
    assert.deepEqual(await route.json(), { error: 'Plugin nicht gefunden.' });

    assert.equal((await client.request(`/plugins/${PLUGIN}/client.js`)).status, 404);
});
