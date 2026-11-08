const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');
const { promisify } = require('util');
const { createTempDir, startServer } = require('./helpers');

// The server and this test share one SQLite file: the test plants a session, the server reads it
const tmpDir = createTempDir('role-refresh-server');
const dbPath = path.join(tmpDir, 'dev.sqlite');
process.chdir(tmpDir);
process.env.SQLITE_PATH = dbPath;
for (const key of Object.keys(process.env)) {
    if (key === 'DATABASE_URL' || key.startsWith('PG')) delete process.env[key];
}

const { PersistentSessionStore } = require('../utils/sessionStore');
const { PERSONAS, ROLE_ID } = require('../dev/mockGuild');

const MOCK_SESSION_SECRET = 'dems-dev-mock-secret'; // dev/mockMode.js default
const member = PERSONAS.find(persona => persona.id === 'member');

let server;
after(() => server?.stop());

/**
 * Cookie value express-session accepts for a session id (signed like cookie-signature).
 *
 * @param {string} sid -> Session id.
 * @returns {string} -> `connect.sid=...`.
 */
function sessionCookie(sid) {
    const signature = crypto.createHmac('sha256', MOCK_SESSION_SECRET).update(sid).digest('base64').replace(/=+$/, '');
    return `connect.sid=${encodeURIComponent(`s:${sid}.${signature}`)}`;
}

test('a stale admin right in a session is withdrawn once the roles are checked again', async () => {
    // A member whose session still says admin, last checked long ago (audit H-03)
    const sid = 'stale-admin-session-id';
    const store = new PersistentSessionStore({ pruneIntervalMs: 0 });
    await promisify(store.set.bind(store))(sid, {
        cookie: { originalMaxAge: 86400000, expires: new Date(Date.now() + 86400000), httpOnly: true, path: '/' },
        user: { id: member.userId, username: member.username, displayName: member.displayName, roles: [ROLE_ID.ADMIN], isAdmin: true, rolesCheckedAt: 0 },
        csrfToken: 'csrf'
    });

    server = await startServer('dev/start.js', { DEV_SQLITE_PATH: dbPath });
    const headers = { cookie: sessionCookie(sid) };

    const adminArea = await fetch(`${server.baseUrl}/api/admin/stats`, { headers });
    assert.equal(adminArea.status, 403);

    const me = await (await fetch(`${server.baseUrl}/auth/me`, { headers })).json();
    assert.equal(me.isAdmin, false);
    assert.deepEqual(me.roles, member.roles);
    assert.ok(Date.now() - me.rolesCheckedAt < 60 * 1000);
});
