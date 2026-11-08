const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir, startServer, createClient } = require('./helpers');

// Own server: the test uses up a member's search budget
let server;

before(async () => {
    const tmpDir = createTempDir('user-search-limit');
    server = await startServer('dev/start.js', {
        DEV_SQLITE_PATH: path.join(tmpDir, 'dev.sqlite'),
        DEV_UPLOAD_DIR: path.join(tmpDir, 'uploads')
    });
});

after(() => server.stop());

async function loginAs(personaId) {
    const client = createClient(server.baseUrl);
    assert.equal((await client.request(`/auth/dev-login/${personaId}`)).status, 302);
    return client;
}

test('the user search allows 60 requests per minute and member', async () => {
    const member = await loginAs('member');
    for (let i = 0; i < 60; i++) {
        assert.equal((await member.request('/api/user/search?q=ma')).status, 200, `request ${i + 1}`);
    }

    const blocked = await member.request('/api/user/search?q=ma');
    assert.equal(blocked.status, 429);
    assert.deepEqual(await blocked.json(), { error: 'Zu viele Suchanfragen. Bitte warte einen Moment.' });

    // The budget belongs to the member, not to everybody
    const raider = await loginAs('raider');
    assert.equal((await raider.request('/api/user/search?q=ma')).status, 200);
});
