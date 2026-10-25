/**
 * Regression: panic mode must end every non-admin session (known issue 14).
 *
 * Panic mode is the emergency lockdown. If already logged-in non-admins keep
 * their session, the lockout only exists in the frontend overlay while the
 * API keeps answering them. Admin sessions survive on purpose: admins have to
 * reach the reset-password dialog to end the panic mode again.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir, startServer, createClient } = require('./helpers');
const { EVENT_ID } = require('../dev/seedData');

let server;
let uploadDir;
let devDbPath;

before(async () => {
    const tmpDir = createTempDir('panic-sessions');
    uploadDir = path.join(tmpDir, 'uploads');
    devDbPath = path.join(tmpDir, 'dev.sqlite');
    server = await startServer('dev/start.js', {
        DEV_SQLITE_PATH: devDbPath,
        DEV_UPLOAD_DIR: uploadDir
    });
});

after(() => server.stop());

const currentUser = async (client) => (await client.request('/auth/me')).json();

test('panic mode invalidates every non-admin session, admins keep theirs', async () => {
    const admin = createClient(server.baseUrl);
    const member = createClient(server.baseUrl);
    await admin.request('/auth/dev-login/admin');
    await member.request('/auth/dev-login/member');

    // Sanity before the lockdown: the member can read the event
    assert.equal((await member.request(`/api/events/${EVENT_ID.RUNNING}`)).status, 200);

    const { token: adminToken } = await (await admin.request('/api/csrf-token')).json();
    const activated = await admin.request('/api/admin/maintenance/panic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': adminToken }
    });
    assert.equal(activated.status, 200);

    // The admin keeps the session, otherwise nobody could deactivate the mode
    assert.equal((await admin.request('/api/admin/stats')).status, 200);

    // The member session is gone
    assert.equal(await (await member.request('/auth/me')).json(), null);
    assert.equal((await member.request(`/api/events/${EVENT_ID.RUNNING}`)).status, 401);

    // Even a valid CSRF header cannot resurrect the destroyed session
    const { token: anonymousToken } = await (await member.request('/api/csrf-token')).json();
    const forced = await member.request(`/api/events/${EVENT_ID.RUNNING}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': anonymousToken },
        body: JSON.stringify({ text: 'panic bypass probe' })
    });
    assert.equal(forced.status, 401);

    // Restore: deactivate panic mode and log the member in again
    const deactivated = await admin.request('/api/admin/maintenance/panic/deactivate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': adminToken },
        body: JSON.stringify({ password: 'dev' })
    });
    assert.equal(deactivated.status, 200);
    assert.equal((await member.request('/auth/dev-login/member')).status, 302);
    assert.equal((await currentUser(member)).username, 'tom');
});

test('a broken session record does not stop the lockdown', async () => {
    // Firestore-style access to the test server's database
    process.env.SQLITE_PATH = devDbPath;
    const { db, doc, setDoc, getDoc } = require('../firebaseAdmin');
    const { SESSION_COLLECTION } = require('../utils/sessionStore');
    await setDoc(doc(db, SESSION_COLLECTION, 'kaputt'), { data: '{kein json', expiresAt: '2099-01-01T00:00:00.000Z', updatedAt: new Date().toISOString() });

    const admin = createClient(server.baseUrl);
    const member = createClient(server.baseUrl);
    await admin.request('/auth/dev-login/admin');
    await member.request('/auth/dev-login/member');
    const { token: adminToken } = await (await admin.request('/api/csrf-token')).json();

    const activated = await admin.request('/api/admin/maintenance/panic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': adminToken }
    });
    assert.equal(activated.status, 200, await activated.clone().text());
    assert.equal(await (await member.request('/auth/me')).json(), null, 'the member is logged out');
    assert.equal((await admin.request('/api/admin/stats')).status, 200, 'the admin stays');
    // A record nobody can read belongs to nobody we must keep -> it is removed too
    assert.equal((await getDoc(doc(db, SESSION_COLLECTION, 'kaputt'))).exists(), false);

    const deactivated = await admin.request('/api/admin/maintenance/panic/deactivate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': adminToken },
        body: JSON.stringify({ password: 'dev' })
    });
    assert.equal(deactivated.status, 200);
});
