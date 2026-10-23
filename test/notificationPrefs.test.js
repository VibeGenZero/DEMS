const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir } = require('./helpers');

// Mock mode with an own, empty database; the empty cwd keeps a local .env out
const tmpDir = createTempDir('notification-prefs');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'prefs.sqlite');

const bot = require('../bot');
const firebase = require('../firebaseAdmin');
const { db, doc, setDoc } = firebase;
const {
    NOTIFICATION_KINDS, normalizeNotificationPrefs, filterByPreference, wantsDm
} = require('../utils/notificationPrefs');

after(async () => {
    await bot.client.destroy();
});

const ALL_ON = { reminders: true, changes: true, waitlist: true };

test('the three kinds are reminders, changes and waitlist', () => {
    assert.deepEqual(NOTIFICATION_KINDS, ['reminders', 'changes', 'waitlist']);
});

test('only an explicit false switches a kind off', () => {
    for (const raw of [undefined, null, {}, 'false', 0, [], { reminders: 'false', changes: 0, waitlist: null }]) {
        assert.deepEqual(normalizeNotificationPrefs(raw), ALL_ON, JSON.stringify(raw));
    }
    assert.deepEqual(normalizeNotificationPrefs({ changes: false }), { reminders: true, changes: false, waitlist: true });
    assert.deepEqual(normalizeNotificationPrefs({ reminders: false, changes: false, waitlist: false, other: false }),
        { reminders: false, changes: false, waitlist: false });
});

test('filterByPreference keeps the order, drops opted-out users and keeps users without a document', async () => {
    await setDoc(doc(db, 'users', 'p-off'), { id: 'p-off', notifications: { changes: false } });
    await setDoc(doc(db, 'users', 'p-on'), { id: 'p-on', notifications: { changes: true, reminders: false } });
    await setDoc(doc(db, 'users', 'p-old'), { id: 'p-old', acceptInvitations: false });

    const changes = await filterByPreference(['p-old', 'p-off', 'p-unknown', 'p-on'], 'changes');
    assert.deepEqual(changes, { userIds: ['p-old', 'p-unknown', 'p-on'], optedOut: 1 });

    const reminders = await filterByPreference(['p-on', 'p-off'], 'reminders');
    assert.deepEqual(reminders, { userIds: ['p-off'], optedOut: 1 });

    assert.deepEqual(await filterByPreference([], 'waitlist'), { userIds: [], optedOut: 0 });
});

test('filterByPreference reads each user once, also when listed twice', async () => {
    const original = firebase.getDoc;
    const reads = [];
    firebase.getDoc = (ref) => { reads.push(ref); return original(ref); };
    try {
        const result = await filterByPreference(['p-off', 'p-on', 'p-off', 'p-on'], 'changes');
        assert.deepEqual(result, { userIds: ['p-on'], optedOut: 1 });
        assert.equal(reads.length, 2);
    } finally {
        firebase.getDoc = original;
    }
});

test('wantsDm follows the stored choice and defaults to on', async () => {
    assert.equal(await wantsDm('p-off', 'changes'), false);
    assert.equal(await wantsDm('p-off', 'waitlist'), true);
    assert.equal(await wantsDm('p-unknown', 'reminders'), true);
});

test('a read error counts as on, so the DM still goes out', async () => {
    const original = firebase.getDoc;
    firebase.getDoc = async () => { throw new Error('database down'); };
    const errors = [];
    const log = console.error;
    console.error = (...args) => errors.push(args.join(' '));
    try {
        assert.equal(await wantsDm('p-off', 'changes'), true);
        assert.deepEqual(await filterByPreference(['p-off'], 'changes'), { userIds: ['p-off'], optedOut: 0 });
        assert.ok(errors.length > 0);
    } finally {
        firebase.getDoc = original;
        console.error = log;
    }
});
