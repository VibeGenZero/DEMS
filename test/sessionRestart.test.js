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
