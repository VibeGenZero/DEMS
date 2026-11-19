// Edge cases of the plugin dispatcher and the static allow-list, in-process with a fake host.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { createTempDir } = require('./helpers');
const { createPluginRouter } = require('../routes/plugins');
const { createPluginStatic } = require('../routes/pluginStatic');
const { PluginHttpError } = require('../plugin-sdk/errors');

const MEMBER = { id: '1', username: 'tom', displayName: 'Tom', avatar: 'a.png', isAdmin: false, roles: ['r1'], isNewUser: false };

/** Fake host: `routes` and `enabled` can be swapped between requests. */
function createFakeHost(pluginDir) {
    const fake = {
        enabled: true,
        routes: [],
        errors: [],
        isEnabled: id => id === 'demo' && fake.enabled,
        routesOf: id => (id === 'demo' ? fake.routes.map(route => ({ ...route })) : []),
        entryOf: id => (id === 'demo' ? { id, dir: pluginDir, manifest: { client: 'client.js', css: '' } } : null),
        clients: () => [],
        reportError: (id, message) => fake.errors.push([id, message])
    };
    return fake;
}

let baseUrl;
let listener;
let host;
let ready = true;
const getHost = () => {
    if (!ready) throw new Error('Plugin host not initialized: call initPlugins() first.');
    return host;
};

before(async () => {
    // A dot-named parent folder (git worktree, ~/.local) must not hide the plugin files
    const pluginDir = path.join(createTempDir('plugin-router'), '.worktrees', 'plugins', 'demo');
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(path.join(pluginDir, 'client.js'), 'export function register() {}');
    fs.mkdirSync(path.join(pluginDir, 'assets'));
    fs.writeFileSync(path.join(pluginDir, 'assets', 'logo.png'), 'png');
    host = createFakeHost(pluginDir);

    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        req.session = req.headers['x-user'] ? { user: JSON.parse(req.headers['x-user']) } : {};
        next();
    });
    app.use('/plugins', createPluginStatic(getHost));
    app.use('/api/plugins', createPluginRouter(getHost));
    await new Promise(resolve => {
        listener = app.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${listener.address().port}`;
});

after(() => new Promise(resolve => listener.close(resolve)));

function call(pathname, { method = 'GET', user = MEMBER, body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (user) headers['x-user'] = JSON.stringify(user);
    return fetch(baseUrl + pathname, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

const route = (method, routePath, handler, access = 'member') => ({ method, path: routePath, access, handler });

test('the handler gets plain copies of params, query and body, never req or res', async () => {
    let seen = null;
    host.routes = [route('POST', '/items/:itemId', input => { seen = input; })];
    const res = await call('/api/plugins/demo/items/42?tag=a', { method: 'POST', body: { title: 'x', nested: { n: 1 } } });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { success: true });
    assert.deepEqual(Object.keys(seen).sort(), ['body', 'params', 'query', 'user']);
    assert.deepEqual(seen.params, { itemId: '42' });
    assert.deepEqual({ ...seen.query }, { tag: 'a' });
    assert.deepEqual(seen.body, { title: 'x', nested: { n: 1 } });
    assert.deepEqual(seen.user, { id: '1', name: 'Tom', avatar: 'a.png', isAdmin: false, roles: ['r1'] });
});

test('the user name falls back to the username', async () => {
    host.routes = [route('GET', '/me', ({ user }) => user)];
    const res = await call('/api/plugins/demo/me', { user: { ...MEMBER, displayName: '' } });
    assert.equal((await res.json()).name, 'tom');
});

test('the dispatcher checks the on/off switch on every request', async () => {
    host.routes = [route('GET', '/ping', () => ({ pong: true }))];
    assert.equal((await call('/api/plugins/demo/ping')).status, 200);
    host.enabled = false;
    try {
        const res = await call('/api/plugins/demo/ping');
        assert.equal(res.status, 404);
        assert.deepEqual(await res.json(), { error: 'Plugin nicht gefunden.' });
    } finally {
        host.enabled = true;
    }
});

test('a host that is not ready yet answers like an unknown plugin', async () => {
    ready = false;
    try {
        const res = await call('/api/plugins/demo/ping');
        assert.equal(res.status, 404);
        assert.deepEqual(await res.json(), { error: 'Plugin nicht gefunden.' });
        const list = await call('/api/plugins');
        assert.equal(list.status, 200);
        assert.deepEqual(await list.json(), []);
        assert.equal((await call('/plugins/demo/client.js')).status, 404);
    } finally {
        ready = true;
    }
});

test('a new routes array (register retry) replaces the cached router', async () => {
    host.routes = [route('GET', '/version', () => ({ v: 1 }))];
    assert.deepEqual(await (await call('/api/plugins/demo/version')).json(), { v: 1 });
    host.routes = [route('GET', '/version', () => ({ v: 2 }))];
    assert.deepEqual(await (await call('/api/plugins/demo/version')).json(), { v: 2 });
});

test('a route path Express refuses is skipped and reported once, the other routes keep working', async () => {
    host.errors.length = 0;
    host.routes = [route('GET', '/bad(x)', () => ({})), route('GET', '/good', () => ({ ok: true }))];
    assert.deepEqual(await (await call('/api/plugins/demo/good')).json(), { ok: true });
    assert.deepEqual(await (await call('/api/plugins/demo/good')).json(), { ok: true });
    assert.deepEqual(host.errors, [['demo', 'Route GET /bad(x) ist ungültig.']]);
});

test('a plain throw answers 500 and is reported, an httpError is not', async () => {
    host.errors.length = 0;
    host.routes = [
        route('POST', '/boom', () => { throw new Error('kaputt'); }),
        route('POST', '/async-boom', async () => { throw new Error('später kaputt'); }),
        route('POST', '/conflict', () => { throw new PluginHttpError(409, 'Schon vorhanden.'); })
    ];
    const boom = await call('/api/plugins/demo/boom', { method: 'POST' });
    assert.equal(boom.status, 500);
    assert.deepEqual(await boom.json(), { error: 'Im Plugin ist ein Fehler aufgetreten.' });
    assert.equal((await call('/api/plugins/demo/async-boom', { method: 'POST' })).status, 500);
    const conflict = await call('/api/plugins/demo/conflict', { method: 'POST' });
    assert.equal(conflict.status, 409);
    assert.deepEqual(await conflict.json(), { error: 'Schon vorhanden.' });
    assert.deepEqual(host.errors, [['demo', 'kaputt'], ['demo', 'später kaputt']]);
});

test('an httpError with a status outside 400-599 counts as a plain throw', async () => {
    host.errors.length = 0;
    host.routes = [
        route('GET', '/ok', () => { throw new PluginHttpError(200, 'Alles gut.'); }),
        route('GET', '/redirect', () => { throw new PluginHttpError(302, 'Weiter.'); }),
        route('GET', '/huge', () => { throw new PluginHttpError(600, 'Zu groß.'); })
    ];
    for (const name of ['ok', 'redirect', 'huge']) {
        const res = await call(`/api/plugins/demo/${name}`);
        assert.equal(res.status, 500, name);
        assert.deepEqual(await res.json(), { error: 'Im Plugin ist ein Fehler aufgetreten.' });
    }
    assert.equal(host.errors.length, 3);
});

test('a result that is not JSON answers 500', async () => {
    host.errors.length = 0;
    host.routes = [
        route('GET', '/fn', () => () => 1),
        route('GET', '/bigint', () => ({ n: 1n })),
        route('GET', '/nested-fn', () => ({ run() {} }))
    ];
    for (const name of ['fn', 'bigint', 'nested-fn']) {
        const res = await call(`/api/plugins/demo/${name}`);
        assert.equal(res.status, 500, name);
        assert.deepEqual(await res.json(), { error: 'Im Plugin ist ein Fehler aufgetreten.' });
    }
    assert.equal(host.errors.length, 3);
});

test('admin routes need an admin session', async () => {
    host.routes = [route('DELETE', '/all', () => ({ gone: true }), 'admin')];
    const anonymous = await call('/api/plugins/demo/all', { method: 'DELETE', user: null });
    assert.equal(anonymous.status, 401);
    assert.deepEqual(await anonymous.json(), { error: 'Nicht eingeloggt. Bitte melde dich über Discord an.' });
    assert.equal((await call('/api/plugins/demo/all', { method: 'DELETE' })).status, 403);
    const admin = await call('/api/plugins/demo/all', { method: 'DELETE', user: { ...MEMBER, isAdmin: true } });
    assert.deepEqual(await admin.json(), { gone: true });
});

test('a method the plugin did not register answers 404', async () => {
    host.routes = [route('GET', '/only-get', () => ({}))];
    const res = await call('/api/plugins/demo/only-get', { method: 'PUT' });
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'Nicht gefunden.' });
});

test('static files: allowed assets are served with their type, other methods and names are not', async () => {
    const png = await call('/plugins/demo/assets/logo.png');
    assert.equal(png.status, 200);
    assert.equal(png.headers.get('content-type'), 'image/png');
    const head = await fetch(`${baseUrl}/plugins/demo/client.js`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal((await fetch(`${baseUrl}/plugins/demo/client.js`, { method: 'POST' })).status, 404);
    assert.equal((await call('/plugins/demo/assets/.hidden.png')).status, 404);
    assert.equal((await call('/plugins/demo/assets/sub/logo.png')).status, 404);
    assert.equal((await call('/plugins/Demo/client.js')).status, 404);
});
