const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { promisify } = require('util');
const { createTempDir } = require('./helpers');

// Own SQLite file; the empty cwd keeps a local .env out, no PostgreSQL variables -> SQLite backend
const tmpDir = createTempDir('session-store');
process.chdir(tmpDir);
process.env.SQLITE_PATH = path.join(tmpDir, 'sessions.sqlite');
for (const key of Object.keys(process.env)) {
    if (key === 'DATABASE_URL' || key.startsWith('PG')) delete process.env[key];
}

const { db, collection, doc, getDocs, deleteDoc } = require('../firebaseAdmin');
const { PersistentSessionStore, SESSION_COLLECTION } = require('../utils/sessionStore');

const HOUR = 60 * 60 * 1000;

/**
 * A store with promise versions of the express-session store methods.
 *
 * @returns {Object} -> `{ store, get, set, destroy }`.
 */
function openStore() {
    const store = new PersistentSessionStore({ pruneIntervalMs: 0 });
    return {
        store,
        get: promisify(store.get.bind(store)),
        set: promisify(store.set.bind(store)),
        destroy: promisify(store.destroy.bind(store))
    };
}

/**
 * Session data in the shape express-session hands to a store.
 *
 * @param {number} expiresInMs -> Cookie lifetime from now (negative = expired).
 * @returns {Object} -> Session data.
 */
function sessionData(expiresInMs = 24 * HOUR) {
    return {
        cookie: { originalMaxAge: 24 * HOUR, expires: new Date(Date.now() + expiresInMs), httpOnly: true, path: '/' },
        user: { id: '200000000000000003', username: 'tom' },
        csrfToken: 'csrf-token-of-tom'
    };
}

const storedDocs = async () => (await getDocs(collection(db, SESSION_COLLECTION))).docs;

test('a stored session comes back after a restart', async () => {
    await openStore().set('sid-restart', sessionData());

    const afterRestart = openStore();
    const session = await afterRestart.get('sid-restart');
    assert.equal(session.user.username, 'tom');
    assert.equal(session.csrfToken, 'csrf-token-of-tom');
    assert.equal(new Date(session.cookie.expires).getTime() > Date.now(), true);
});

test('the session id itself never reaches the database', async () => {
    await openStore().set('sid-secret-value', sessionData());

    for (const snap of await storedDocs()) {
        assert.notEqual(snap.id, 'sid-secret-value');
        assert.doesNotMatch(JSON.stringify(snap.data()), /sid-secret-value/);
    }
});

test('an unknown session id gives no session', async () => {
    assert.equal(await openStore().get('sid-unknown'), null);
});

test('an expired session is gone, also from the database', async () => {
    await openStore().set('sid-expired', sessionData(-HOUR));
    const before = (await storedDocs()).length;

    assert.equal(await openStore().get('sid-expired'), null);
    assert.equal((await storedDocs()).length, before - 1);
});

test('destroy ends the session for good', async () => {
    const { set, destroy } = openStore();
    await set('sid-logout', sessionData());
    await destroy('sid-logout');

    assert.equal(await openStore().get('sid-logout'), null);
});

test('pruning deletes expired sessions only', async () => {
    const { store, set } = openStore();
    for (const snap of await storedDocs()) await deleteDoc(doc(db, SESSION_COLLECTION, snap.id));
    await set('sid-valid', sessionData());
    await set('sid-old', sessionData(-HOUR));

    assert.equal(await store.pruneExpired(), 1);
    assert.equal((await storedDocs()).length, 1);
    assert.equal((await openStore().get('sid-valid')).user.username, 'tom');
});

test('known sessions are served from memory without reading the database', async () => {
    const { set, get } = openStore();
    await set('sid-cached', sessionData());
    for (const snap of await storedDocs()) await deleteDoc(doc(db, SESSION_COLLECTION, snap.id));

    assert.equal((await get('sid-cached')).user.username, 'tom');
});

// ── Hardening from the pentest (vuln-0007) ──────────────────────────────

const crypto = require('crypto');
const { setDoc } = require('../firebaseAdmin');
const sessionDocId = (sid) => crypto.createHash('sha256').update(sid).digest('hex');

test('a record whose cookie has expired gives no session, whatever its expiresAt says', async () => {
    // expiresAt in the future, the session's own cookie long expired
    await setDoc(doc(db, SESSION_COLLECTION, sessionDocId('sid-backdated')), {
        data: JSON.stringify(sessionData(-365 * 24 * HOUR)),
        expiresAt: new Date(Date.now() + HOUR).toISOString(),
        updatedAt: new Date().toISOString()
    });

    const { get } = openStore();
    assert.equal(await get('sid-backdated'), null);
    assert.equal((await storedDocs()).some(snap => snap.id === sessionDocId('sid-backdated')), false);
});

test('a broken record gives no session instead of an error', async () => {
    await setDoc(doc(db, SESSION_COLLECTION, sessionDocId('sid-broken')), {
        data: '{kein json',
        expiresAt: new Date(Date.now() + HOUR).toISOString()
    });

    const { get } = openStore();
    assert.equal(await get('sid-broken'), null);
    assert.equal((await storedDocs()).some(snap => snap.id === sessionDocId('sid-broken')), false);
});
