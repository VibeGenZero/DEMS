const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir, startServer, createClient } = require('./helpers');

test('a login survives a server restart, a logout does too', async () => {
    const env = { DEV_SQLITE_PATH: path.join(createTempDir('session-restart'), 'dev.sqlite') };
    const meWith = async (baseUrl, sessionCookie) =>
        (await fetch(`${baseUrl}/auth/me`, { headers: { cookie: `connect.sid=${sessionCookie}` } })).json();

    let server = await startServer('dev/start.js', env);
    const client = createClient(server.baseUrl);
    await client.request('/auth/dev-login/member');
    const sessionCookie = client.cookie('connect.sid');
    await server.stop();

    server = await startServer('dev/start.js', env);
    try {
        assert.equal((await meWith(server.baseUrl, sessionCookie))?.username, 'tom');

        // The CSRF token of the session survives as well -> the logout works right away
        const csrfToken = (await (await fetch(`${server.baseUrl}/api/csrf-token`, { headers: { cookie: `connect.sid=${sessionCookie}` } })).json()).token;
        const logout = await fetch(`${server.baseUrl}/auth/logout`, {
            method: 'POST',
            headers: { cookie: `connect.sid=${sessionCookie}`, 'X-CSRF-TOKEN': csrfToken }
        });
        assert.equal(logout.status, 200);
    } finally {
        await server.stop();
    }

    server = await startServer('dev/start.js', env);
    try {
        assert.equal(await meWith(server.baseUrl, sessionCookie), null);
    } finally {
        await server.stop();
    }
});

// #138: without SESSION_SECRET in the environment DEMS generates one and keeps it in the database
test('without SESSION_SECRET a session still survives a restart', async () => {
    const env = {
        SQLITE_PATH: path.join(createTempDir('session-secret'), 'dems.sqlite'),
        DISCORD_CLIENT_ID: '100000000000000001',
        DISCORD_CLIENT_SECRET: 'client-secret',
        DISCORD_GUILD_ID: '100000000000000002'
    };
    const tokenWith = async (baseUrl, cookie) =>
        (await (await fetch(`${baseUrl}/api/csrf-token`, { headers: cookie ? { cookie: `connect.sid=${cookie}` } : {} })).json()).token;

    let server = await startServer('server.js', env);
    const client = createClient(server.baseUrl);
    const firstToken = (await (await client.request('/api/csrf-token')).json()).token;
    const sessionCookie = client.cookie('connect.sid');
    assert.ok(firstToken && sessionCookie);
    await server.stop();

    server = await startServer('server.js', env);
    try {
        assert.equal(await tokenWith(server.baseUrl, sessionCookie), firstToken);
    } finally {
        await server.stop();
    }
});

test('the placeholder SESSION_SECRET still stops the start', async () => {
    const env = {
        SQLITE_PATH: path.join(createTempDir('session-placeholder'), 'dems.sqlite'),
        SESSION_SECRET: 'your_random_session_secret_here'
    };
    await assert.rejects(startServer('server.js', env), (err) => {
        assert.match(err.message, /Code 1/);
        assert.match(err.message, /SESSION_SECRET/);
        return true;
    });
});
