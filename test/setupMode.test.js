const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir, startServer, createClient } = require('./helpers');

// #138: a fresh installation without Discord values starts in setup mode.
// server.js with an own SQLite file, no .env, a fixed PIN.
const PIN = '12345678';
const freshEnv = (extra = {}) => ({
    SQLITE_PATH: path.join(createTempDir('setup-mode'), 'dems.sqlite'),
    SETUP_PIN: PIN,
    ...extra
});

let server;
before(async () => { server = await startServer('server.js', freshEnv()); });
after(async () => { await server.stop(); });

const unlock = async (client, pin = PIN) => client.send('POST', '/api/setup/unlock', { pin });

test('a fresh installation reports setup mode, locked', async () => {
    const res = await createClient(server.baseUrl).request('/api/setup/status');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.required, true);
    assert.equal(body.unlocked, false);
    assert.deepEqual(body.locked, []);
});

test('the API answers 503 in setup mode, health check and public endpoints stay up', async () => {
    const client = createClient(server.baseUrl);
    const events = await client.request('/api/events');
    assert.equal(events.status, 503);
    assert.deepEqual(await events.json(), { error: 'DEMS ist noch nicht eingerichtet.', setupRequired: true });
    assert.equal((await client.request('/auth/me')).status, 503);
    assert.equal((await client.request('/auth/discord')).status, 503);

    assert.equal((await client.request('/healthz')).status, 200);
    assert.equal((await client.request('/api/server-info')).status, 200);
    assert.equal((await client.request('/api/maintenance/status')).status, 200);
    assert.equal((await client.request('/api/csrf-token')).status, 200);
    assert.equal((await client.request('/')).status, 200);
});

test('the log names the setup PIN', async () => {
    await server.waitForOutput(`Setup-PIN: ${PIN}`);
});

test('a wrong PIN is refused, the right one unlocks only this browser', async () => {
    const first = createClient(server.baseUrl);
    const wrong = await unlock(first, '00000000');
    assert.equal(wrong.status, 401);
    assert.deepEqual(await wrong.json(), { error: 'Falsche Setup-PIN.' });

    const right = await unlock(first);
    assert.equal(right.status, 200);
    assert.equal((await (await first.request('/api/setup/status')).json()).unlocked, true);

    const second = createClient(server.baseUrl);
    assert.equal((await (await second.request('/api/setup/status')).json()).unlocked, false);
    const blocked = await second.send('POST', '/api/setup/discord', {});
    assert.equal(blocked.status, 403);
    assert.equal((await second.request('/api/setup/invite-url?clientId=123456789012345678')).status, 403);
});

test('the invite URL carries the scopes and permissions of DEMS', async () => {
    const client = createClient(server.baseUrl);
    await unlock(client);
    const res = await client.request('/api/setup/invite-url?clientId=123456789012345678');
    assert.equal(res.status, 200);
    const { url } = await res.json();
    assert.match(url, /^https:\/\/discord\.com\/oauth2\/authorize\?client_id=123456789012345678&permissions=\d+&scope=bot%20applications\.commands$/);

    const invalid = await client.request('/api/setup/invite-url?clientId=abc');
    assert.equal(invalid.status, 400);
    assert.match((await invalid.json()).error, /Client ID/);
});

test('completing before the Discord step is refused and setup mode continues', async () => {
    const client = createClient(server.baseUrl);
    await unlock(client);
    const res = await client.send('POST', '/api/setup/complete', {
        baseUrl: 'https://dems.example.org', timezone: 'Europe/Berlin', adminResetPassword: 'a-long-password'
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /Discord/);
    assert.equal((await (await client.request('/api/setup/status')).json()).required, true);
});

test('more than five PIN attempts within 15 minutes are refused', async () => {
    const own = await startServer('server.js', freshEnv());
    try {
        const client = createClient(own.baseUrl);
        for (let attempt = 1; attempt <= 5; attempt++) {
            assert.equal((await unlock(client, '99999999')).status, 401);
        }
        const sixth = await unlock(client);
        assert.equal(sixth.status, 429);
        assert.match((await sixth.json()).error, /Versuche/);
    } finally {
        await own.stop();
    }
});

test('without SETUP_PIN a random 8-digit PIN is logged', async () => {
    const own = await startServer('server.js', freshEnv({ SETUP_PIN: '' }));
    try {
        await own.waitForOutput('Setup-PIN: ');
        assert.match(own.output(), /Setup-PIN: \d{8}\b/);
    } finally {
        await own.stop();
    }
});

test('with the three Discord values in the environment there is no setup mode', async () => {
    const own = await startServer('server.js', freshEnv({
        DISCORD_CLIENT_ID: '100000000000000001', DISCORD_CLIENT_SECRET: 'secret', DISCORD_GUILD_ID: '100000000000000002'
    }));
    try {
        const client = createClient(own.baseUrl);
        assert.equal((await (await client.request('/api/setup/status')).json()).required, false);
        assert.equal((await client.request('/api/events')).status, 401);
        assert.equal(own.output().includes('Setup-PIN'), false);
    } finally {
        await own.stop();
    }
});

test('dev mock mode never starts in setup mode', async () => {
    const own = await startServer('dev/start.js', { DEV_SQLITE_PATH: path.join(createTempDir('setup-mock'), 'dev.sqlite') });
    try {
        assert.equal((await (await createClient(own.baseUrl).request('/api/setup/status')).json()).required, false);
    } finally {
        await own.stop();
    }
});

test('a completed setup survives a restart: no setup mode, the stored values in effect', async () => {
    const env = freshEnv();
    let own = await startServer('test/fixtures/fakeSetupServer.js', env);
    try {
        const client = createClient(own.baseUrl);
        assert.equal((await unlock(client)).status, 200);
        const discord = await client.send('POST', '/api/setup/discord', {
            clientId: '123456789012345678', clientSecret: 'client-secret', botToken: 'bot-token', guildId: '234567890123456789'
        });
        assert.equal(discord.status, 200);
        const done = await client.send('POST', '/api/setup/complete', {
            baseUrl: 'https://dems.example.org', serverName: 'Neustart-Gilde', timezone: 'Europe/Berlin', adminResetPassword: 'ein-langes-passwort'
        });
        assert.equal(done.status, 200);
    } finally {
        await own.stop();
    }

    own = await startServer('test/fixtures/fakeSetupServer.js', env);
    try {
        const client = createClient(own.baseUrl);
        assert.equal((await (await client.request('/api/setup/status')).json()).required, false);
        assert.equal((await client.request('/api/events')).status, 401);
        assert.equal((await (await client.request('/api/server-info')).json()).serverName, 'Neustart-Gilde');
        const login = await client.request('/auth/discord');
        assert.equal(login.status, 302);
        assert.match(login.headers.get('location'), /client_id=123456789012345678&redirect_uri=https%3A%2F%2Fdems\.example\.org%2Fauth%2Fdiscord%2Fcallback/);
        assert.equal(own.output().includes('Setup-PIN'), false);
        assert.match(own.output(), /Konfiguration: \d+ Werte aus der Datenbank/);
    } finally {
        await own.stop();
    }
});
