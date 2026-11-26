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
        manifest: { client: 'client.js', css: '' },
        isEnabled: id => id === 'demo' && fake.enabled,
        routesOf: id => (id === 'demo' ? fake.routes.map(route => ({ ...route })) : []),
        entryOf: id => (id === 'demo' ? { id, dir: pluginDir, manifest: { ...fake.manifest } } : null),
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
    // A folder link out of the plugin (a junction on Windows, a symlink elsewhere: both need no admin rights)
    const outsideDir = path.join(pluginDir, '..', '..', 'outside');
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(path.join(outsideDir, 'client.js'), 'export const secret = "OUTSIDE";');
    fs.writeFileSync(path.join(outsideDir, 'client.css'), '.secret { color: red; }');
    fs.symlinkSync(outsideDir, path.join(pluginDir, 'lib'), 'junction');
    host = createFakeHost(pluginDir);

    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        req.session = req.headers['x-user'] ? { user: JSON.parse(req.headers['x-user']) } : {};
        next();
    });
    app.use('/plugins', createPluginStatic(getHost));
    app.use('/api/plugins', createPluginRouter(getHost));
    app.use('/api/plugins-short', createPluginRouter(getHost, { handlerTimeoutMs: 50 }));
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

test('a handler that does not answer in time gets 504 and is reported, other routes keep working', async () => {
    host.errors.length = 0;
    host.routes = [
        route('GET', '/hang/:itemId', () => new Promise(() => {})),
        route('GET', '/quick', () => ({ ok: true }))
    ];
    const res = await call('/api/plugins-short/demo/hang/42');
    assert.equal(res.status, 504);
    assert.deepEqual(await res.json(), { error: 'Das Plugin hat nicht rechtzeitig geantwortet.' });
    assert.deepEqual(host.errors, [['demo', 'Route GET /hang/:itemId hat nicht innerhalb von 0,05 s geantwortet.']]);
    const quick = await call('/api/plugins-short/demo/quick');
    assert.equal(quick.status, 200);
    assert.deepEqual(await quick.json(), { ok: true });
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

test('password routes check ADMIN_RESET_PASSWORD, strip password from body, and leave normal routes unchanged', async () => {
    process.env.ADMIN_RESET_PASSWORD = 'dev';
    const adminUser = { ...MEMBER, isAdmin: true };
    const seenProtected = [];
    const seenPlain = [];
    host.routes = [
        { method: 'POST', path: '/secret', access: 'admin', password: true, handler: ({ body }) => { seenProtected.push(body); return { ok: true }; } },
        { method: 'POST', path: '/plain', access: 'admin', password: false, handler: ({ body }) => { seenPlain.push(body); return { ok: true }; } }
    ];

    const missing = await call('/api/plugins/demo/secret', { method: 'POST', user: adminUser, body: { a: 1 } });
    assert.equal(missing.status, 401);
    assert.deepEqual(await missing.json(), { error: 'Ungültiges Admin-Reset-Passwort.' });

    const wrong = await call('/api/plugins/demo/secret', { method: 'POST', user: adminUser, body: { a: 1, password: 'wrong' } });
    assert.equal(wrong.status, 401);
    assert.deepEqual(await wrong.json(), { error: 'Ungültiges Admin-Reset-Passwort.' });
    assert.deepEqual(seenProtected, []);

    const right = await call('/api/plugins/demo/secret', { method: 'POST', user: adminUser, body: { a: 1, password: 'dev' } });
    assert.equal(right.status, 200);
    assert.deepEqual(seenProtected, [{ a: 1 }]);

    const plain = await call('/api/plugins/demo/plain', { method: 'POST', user: adminUser, body: { a: 1, password: 'kept' } });
    assert.equal(plain.status, 200);
    assert.deepEqual(seenPlain, [{ a: 1, password: 'kept' }]);
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

test('static files: client.js and client.css reached through a link out of the plugin folder are refused', async () => {
    host.manifest = { client: 'lib/client.js', css: 'lib/client.css' };
    try {
        for (const name of ['client.js', 'client.css']) {
            const res = await call(`/plugins/demo/${name}`);
            assert.equal(res.status, 404, name);
            assert.doesNotMatch(await res.text(), /secret/i, name);
        }
    } finally {
        host.manifest = { client: 'client.js', css: '' };
    }
    assert.equal((await call('/plugins/demo/client.js')).status, 200);
});

// Studio events: only with an active sender
const studioEvents = require('../dev/studioEvents');

async function withStudio(fn) {
    const sent = [];
    const saved = { PLUGIN_STUDIO: process.env.PLUGIN_STUDIO, DEV_MOCK: process.env.DEV_MOCK, NODE_ENV: process.env.NODE_ENV };
    process.env.PLUGIN_STUDIO = '1';
    process.env.DEV_MOCK = 'true';
    delete process.env.NODE_ENV;
    studioEvents.setSender(message => sent.push(message));
    try {
        await fn(sent);
    } finally {
        studioEvents.setSender(null);
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
}

test('studio: a plugin request emits one request event with both bodies', async () => {
    host.routes = [route('POST', '/x', () => ({ ok: true }))];
    await withStudio(async (sent) => {
        const res = await call('/api/plugins/demo/x', { method: 'POST', body: { a: 1 } });
        assert.equal(res.status, 200);
        await res.json();
        const requests = sent.filter(message => message.type === 'request');
        assert.equal(requests.length, 1);
        assert.equal(requests[0].pluginId, 'demo');
        const { method, path: requestPath, status, ms, requestBody, responseBody } = requests[0].data;
        assert.equal(method, 'POST');
        assert.equal(requestPath, '/x');
        assert.equal(status, 200);
        assert.equal(typeof ms, 'number');
        assert.equal(requestBody, JSON.stringify({ a: 1 }));
        assert.equal(responseBody, JSON.stringify({ ok: true }));
    });
});

test('studio: a failing route emits a request with 500 and an error event with where route', async () => {
    host.errors.length = 0;
    host.routes = [route('GET', '/boom', () => { throw new Error('kaputt'); })];
    await withStudio(async (sent) => {
        const res = await call('/api/plugins/demo/boom');
        assert.equal(res.status, 500);
        await res.json();
        assert.equal(sent.find(message => message.type === 'request').data.status, 500);
        const error = sent.find(message => message.type === 'error');
        assert.equal(error.data.where, 'route');
        assert.equal(error.data.message, 'kaputt');
    });
});

test('studio: nothing is emitted without an active sender', async () => {
    host.routes = [route('GET', '/quiet', () => ({ ok: true }))];
    const sent = [];
    studioEvents.setSender(message => sent.push(message));
    try {
        await (await call('/api/plugins/demo/quiet')).json();
        assert.equal(sent.length, 0);
    } finally {
        studioEvents.setSender(null);
    }
});
