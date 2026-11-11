const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir, startServer, createClient } = require('./helpers');

// Own server: the reset wipes every user, which would break the shared devServer tests
let server;

before(async () => {
    const tmpDir = createTempDir('admin-reset');
    server = await startServer('dev/start.js', {
        DEV_SQLITE_PATH: path.join(tmpDir, 'dev.sqlite'),
        DEV_UPLOAD_DIR: path.join(tmpDir, 'uploads')
    });
});

after(() => server.stop());

async function loginAs(personaId) {
    const client = createClient(server.baseUrl);
    const res = await client.request(`/auth/dev-login/${personaId}`);
    assert.equal(res.status, 302);
    return client;
}

const currentUser = async (client) => (await client.request('/auth/me')).json();

test('wiping the users ends their sessions, admins stay logged in', async () => {
    const admin = await loginAs('admin');
    const member = await loginAs('member');
    assert.ok((await currentUser(member))?.id, 'member is logged in before the reset');

    const res = await admin.send('DELETE', '/api/admin/reset', { password: 'dev', targets: ['users'] });
    assert.equal(res.status, 200);

    assert.equal(await currentUser(member), null);
    const settings = await member.send('PUT', '/api/user/settings', { acceptInvitations: false });
    assert.equal(settings.status, 401);
    assert.ok((await currentUser(admin))?.isAdmin, 'the admin who ran the reset keeps the session');
});
