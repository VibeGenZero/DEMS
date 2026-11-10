const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir, startServer, createClient } = require('./helpers');

// server.js with the real OAuth2 routes against a fake Discord API (user "oauth-tester")
const FIXTURE = 'test/fixtures/fakeDiscordServer.js';
const serverEnv = (name, env = {}) => ({
    SESSION_SECRET: 'login-test-secret',
    SQLITE_PATH: path.join(createTempDir(name), 'db.sqlite'),
    DISCORD_CLIENT_ID: '123',
    DISCORD_CLIENT_SECRET: 'login-test-client-secret',
    DISCORD_GUILD_ID: '999',
    BASE_URL: 'http://127.0.0.1',
    ...env
});

let server;

before(async () => {
    server = await startServer(FIXTURE, serverEnv('login'));
});

after(() => server.stop());

/**
 * Start the Discord login like the login button does.
 *
 * @param {Object} client -> createClient() result.
 * @returns {Promise<string|null>} -> The `state` the server put into the Discord URL.
 */
async function startLogin(client) {
    const res = await client.request('/auth/discord');
    assert.equal(res.status, 302);
    return new URL(res.headers.get('location')).searchParams.get('state');
}

/**
 * A client logged in through the full OAuth2 round trip.
 *
 * @returns {Promise<Object>} -> createClient() result.
 */
async function loggedInClient() {
    const client = createClient(server.baseUrl);
    const state = await startLogin(client);
    const res = await client.request(`/auth/discord/callback?code=abc&state=${state}`);
    assert.equal(res.headers.get('location'), '/#events');
    return client;
}

const currentUser = async (client) => (await client.request('/auth/me')).json();

const sessionCookieOf = (res) => res.headers.getSetCookie().find(cookie => cookie.startsWith('connect.sid='));

test('every Discord login attempt carries its own state', async () => {
    const first = await startLogin(createClient(server.baseUrl));
    const second = await startLogin(createClient(server.baseUrl));
    assert.match(first ?? '', /^[0-9a-f]{32,}$/);
    assert.notEqual(first, second);
});

test('a callback without the state of this browser is refused', async () => {
    const client = createClient(server.baseUrl);
    await startLogin(client);

    for (const query of ['code=abc&state=forged', 'code=abc']) {
        const res = await client.request(`/auth/discord/callback?${query}`);
        assert.equal(res.headers.get('location'), '/?error=invalid_state', query);
    }
    assert.equal(await currentUser(client), null);
});

test('a successful login starts a new session and uses the state up', async () => {
    const client = createClient(server.baseUrl);
    const state = await startLogin(client);
    const sessionBeforeLogin = client.cookie('connect.sid');
    assert.ok(sessionBeforeLogin);

    const res = await client.request(`/auth/discord/callback?code=abc&state=${state}`);
    assert.equal(res.headers.get('location'), '/#events');
    assert.notEqual(client.cookie('connect.sid'), sessionBeforeLogin);
    assert.equal((await currentUser(client)).username, 'oauth-tester');

    const replay = await client.request(`/auth/discord/callback?code=abc&state=${state}`);
    assert.equal(replay.headers.get('location'), '/?error=invalid_state');
});

test('a member without the admin role and without Discord Administrator is no admin', async () => {
    assert.equal((await currentUser(await loggedInClient())).isAdmin, false);
});

// Setup wizard: "Keine (nur Discord-Administratoren)" -> no DISCORD_ADMIN_ROLE_ID at all
test('a Discord Administrator is admin even without an admin role', async () => {
    const adminServer = await startServer(FIXTURE, serverEnv('login-administrator', { FAKE_DISCORD_PERMISSIONS: '8' }));
    try {
        const client = createClient(adminServer.baseUrl);
        const state = await startLogin(client);
        const res = await client.request(`/auth/discord/callback?code=abc&state=${state}`);
        assert.equal(res.headers.get('location'), '/#events');
        assert.equal((await currentUser(client)).isAdmin, true);
    } finally {
        await adminServer.stop();
    }
});

test('logging out needs a POST with the CSRF token', async () => {
    const client = await loggedInClient();

    await client.request('/auth/logout');
    assert.notEqual(await currentUser(client), null, 'GET must not log out');

    const withoutToken = await client.request('/auth/logout', { method: 'POST' });
    assert.equal(withoutToken.status, 403);
    assert.notEqual(await currentUser(client), null, 'POST without CSRF token must not log out');

    const res = await client.send('POST', '/auth/logout');
    assert.equal(res.status, 200);
    assert.equal(await currentUser(client), null);
});

// Production needs PostgreSQL (firebaseAdmin.js refuses SQLite there) -> runs where TEST_DATABASE_URL is set, e.g. in CI
test('session and CSRF cookies are Secure in production only', { skip: !process.env.TEST_DATABASE_URL && 'TEST_DATABASE_URL nicht gesetzt' }, async () => {
    // GET /api/csrf-token creates the session and the CSRF token -> both cookies
    const development = await fetch(`${server.baseUrl}/api/csrf-token`);
    assert.doesNotMatch(sessionCookieOf(development), /;\s*Secure/i);

    const production = await startServer(FIXTURE, serverEnv('login-production', { NODE_ENV: 'production', DATABASE_URL: process.env.TEST_DATABASE_URL }));
    try {
        // Production runs behind a TLS proxy (trust proxy 1) that sets X-Forwarded-Proto
        const res = await fetch(`${production.baseUrl}/api/csrf-token`, { headers: { 'X-Forwarded-Proto': 'https' } });
        assert.match(sessionCookieOf(res) ?? '', /;\s*Secure/i);
        assert.match(res.headers.getSetCookie().find(cookie => cookie.startsWith('XSRF-TOKEN=')) ?? '', /;\s*Secure/i);
    } finally {
        await production.stop();
    }
});
