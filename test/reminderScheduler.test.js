const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir } = require('./helpers');

// Mock mode with an own, empty database; the empty cwd keeps a local .env out
const tmpDir = createTempDir('reminder-scheduler');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'reminders.sqlite');

const bot = require('../bot');
const { db, doc, getDoc, setDoc, deleteDoc } = require('../firebaseAdmin');

after(async () => {
    await bot.client.destroy();
});

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-10-20T16:00:00.000Z');
const inHours = (hours) => new Date(NOW.getTime() + hours * HOUR).toISOString();
const PARTICIPANT = '200000000000000003';

/**
 * Store one active event with one accepted participant.
 *
 * @param {string} id -> Event id.
 * @param {Object} fields -> Event fields (startDate, reminderHours, ...).
 * @returns {Promise<void>}
 */
async function storeEvent(id, fields) {
    await setDoc(doc(db, 'events', id), { title: `Event ${id}`, status: 'active', eventStartNotificationSent: false, ...fields });
    await setDoc(doc(db, 'registrations', `reg-${id}`), { eventId: id, userId: PARTICIPANT, status: 'accepted' });
}

const storedEvent = async (id) => (await getDoc(doc(db, 'events', id))).data();

/**
 * Run one scheduler pass with a recording DM function; only one event exists at a time.
 *
 * @param {Function} [onSend] -> Called for every DM before it is recorded.
 * @returns {Promise<Array<{ userId: string, message: string }>>} -> DMs sent in this pass.
 */
async function runPass(onSend = async () => {}) {
    const sent = [];
    await bot.checkReminders({ now: NOW, send: async (userId, message) => { await onSend(userId, message); sent.push({ userId, message }); } });
    return sent;
}

async function removeEvent(id) {
    await deleteDoc(doc(db, 'events', id));
    await deleteDoc(doc(db, 'registrations', `reg-${id}`));
}

test('a reminder stored as sent is not sent again after a restart', async () => {
    await storeEvent('restart', { startDate: inHours(2), reminderHours: [{ hours: 24, sent: true }] });
    try {
        assert.deepEqual(await runPass(), []);
    } finally {
        await removeEvent('restart');
    }
});

test('a due reminder goes out once and is stored as sent before the DMs', async () => {
    await storeEvent('due', { startDate: inHours(2), reminderHours: [{ hours: 24, sent: false }, { hours: 1, sent: false }] });
    try {
        const first = await runPass(async () => {
            assert.equal((await storedEvent('due')).reminderHours[0].sent, true, 'marked before the DM');
        });
        assert.equal(first.length, 1);
        assert.equal(first[0].userId, PARTICIPANT);
        assert.match(first[0].message, /Erinnerung/);
        assert.deepEqual((await storedEvent('due')).reminderHours, [{ hours: 24, sent: true }, { hours: 1, sent: false }]);

        assert.deepEqual(await runPass(), []);
    } finally {
        await removeEvent('due');
    }
});

test('reminders that are due together go out as one DM', async () => {
    // e.g. after a downtime: 24 h and 1 h are both reached
    await storeEvent('together', { startDate: inHours(0.5), reminderHours: [{ hours: 24, sent: false }, { hours: 1, sent: false }] });
    try {
        assert.equal((await runPass()).length, 1);
        assert.deepEqual((await storedEvent('together')).reminderHours, [{ hours: 24, sent: true }, { hours: 1, sent: true }]);
    } finally {
        await removeEvent('together');
    }
});

test('a legacy number reminder is stored as a list marked as sent', async () => {
    await storeEvent('legacy', { startDate: inHours(2), reminderHours: 24 });
    try {
        assert.equal((await runPass()).length, 1);
        assert.deepEqual((await storedEvent('legacy')).reminderHours, [{ hours: 24, sent: true }]);
    } finally {
        await removeEvent('legacy');
    }
});

test('the start notification goes out once and is marked before the DMs', async () => {
    await storeEvent('started', { startDate: inHours(-0.02), reminderHours: [] });
    try {
        const first = await runPass(async () => {
            assert.equal((await storedEvent('started')).eventStartNotificationSent, true, 'marked before the DM');
        });
        assert.equal(first.length, 1);
        assert.match(first[0].message, /hat gerade begonnen/);
        assert.deepEqual(await runPass(), []);
    } finally {
        await removeEvent('started');
    }
});
