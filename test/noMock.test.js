const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir, startServer, createClient } = require('./helpers');

let server;

before(async () => {
    server = await startServer('server.js', {
        SESSION_SECRET: 'no-mock-test-secret',
        SQLITE_PATH: path.join(createTempDir('no-mock'), 'db.sqlite'),
        DISCORD_CLIENT_ID: '123',
        DISCORD_CLIENT_SECRET: 'no-mock-client-secret',
        DISCORD_GUILD_ID: '999'
    });
});

after(() => server.stop());

test('without DEV_MOCK the login button still goes to Discord', async () => {
    const res = await createClient(server.baseUrl).request('/auth/discord');
    assert.equal(res.status, 302);
    assert.match(res.headers.get('location'), /^https:\/\/discord\.com\/api\/oauth2\/authorize\?client_id=123/);
});

test('without DEV_MOCK the persona login does not exist', async () => {
    const client = createClient(server.baseUrl);
    await client.request('/auth/dev-login/admin');
    assert.equal(await (await client.request('/auth/me')).json(), null);
});

test('without DEV_MOCK the stylesheet of the persona page does not exist', async () => {
    const res = await createClient(server.baseUrl).request('/auth/dev-login.css');
    assert.doesNotMatch(res.headers.get('content-type') || '', /css/);
});

test('without a bot token the archive scheduler still starts', async () => {
    // The first run waits for the bot; a missing token must not keep it waiting
    await server.waitForOutput('Archive scheduler started');
});

test('without DEV_MOCK the dummy banners do not exist', async () => {
    // The SPA fallback answers with index.html, never with the image
    const res = await createClient(server.baseUrl).request('/dev-banners/raid.svg');
    assert.doesNotMatch(res.headers.get('content-type') || '', /svg/);
});
