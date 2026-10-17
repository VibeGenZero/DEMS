const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir } = require('./helpers');

// Mock mode with an own database; the empty cwd keeps a local .env out
const tmpDir = createTempDir('event-archive');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'archive.sqlite');

const bot = require('../bot');
const { db, collection, doc, getDoc, getDocs, setDoc } = require('../firebaseAdmin');
const { isDueForArchive, archiveEndedEvents, startArchiveScheduler, stopArchiveScheduler } = require('../utils/eventArchive');

after(async () => {
    await bot.client.destroy();
});

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const NOW = new Date('2026-10-17T12:00:00.000Z');
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();
const ahead = (ms) => new Date(NOW.getTime() + ms).toISOString();
const active = (fields) => ({ title: 'Test', status: 'active', ...fields });

let counter = 0;
async function createEvent(fields) {
    const id = `archive-event-${++counter}`;
    await setDoc(doc(db, 'events', id), active(fields));
    return id;
}
const statusOf = async (id) => (await getDoc(doc(db, 'events', id))).data().status;
async function autoArchiveLogs() {
    const snap = await getDocs(collection(db, 'auditLogs'));
    return snap.docs.map(entry => entry.data()).filter(entry => entry.action === 'AUTO_ARCHIVE_EVENT');
}

test('an active event is due 24 hours after its end', () => {
    assert.equal(isDueForArchive(active({ startDate: ago(27 * HOUR), endDate: ago(24 * HOUR) }), NOW), true);
    assert.equal(isDueForArchive(active({ startDate: ago(27 * HOUR), endDate: ago(24 * HOUR - MINUTE) }), NOW), false);
    // Without an end date the event ends two hours after its start
    assert.equal(isDueForArchive(active({ startDate: ago(26 * HOUR) }), NOW), true);
    assert.equal(isDueForArchive(active({ startDate: ago(26 * HOUR - MINUTE) }), NOW), false);
});

test('only active events with a start can be due', () => {
    for (const status of ['draft', 'cancelled', 'archived']) {
        assert.equal(isDueForArchive({ status, startDate: ago(10 * 24 * HOUR), endDate: ago(9 * 24 * HOUR) }, NOW), false, status);
    }
    assert.equal(isDueForArchive(active({ endDate: ago(9 * 24 * HOUR) }), NOW), false);
    assert.equal(isDueForArchive(active({ startDate: 'kaputt' }), NOW), false);
});

test('the scheduler archives the due events once and logs each one', async () => {
    const due = await createEvent({ startDate: ago(50 * HOUR), endDate: ago(48 * HOUR) });
    const justEnded = await createEvent({ startDate: ago(3 * HOUR), endDate: ago(HOUR) });
    const firstDate = await createEvent({ seriesId: 'series-a', startDate: ago(30 * HOUR), endDate: ago(27 * HOUR) });
    const nextDate = await createEvent({ seriesId: 'series-a', startDate: ahead(7 * 24 * HOUR), endDate: ahead(7 * 24 * HOUR + 3 * HOUR) });

    assert.equal(await archiveEndedEvents({ now: NOW }), 2);
    assert.deepEqual(
        [await statusOf(due), await statusOf(justEnded), await statusOf(firstDate), await statusOf(nextDate)],
        ['archived', 'active', 'archived', 'active']
    );
    const logs = await autoArchiveLogs();
    assert.deepEqual(logs.map(entry => entry.targetId).sort(), [due, firstDate].sort());
    assert.ok(logs.every(entry => entry.adminId === 'system'));

    assert.equal(await archiveEndedEvents({ now: NOW }), 0);
    assert.equal((await autoArchiveLogs()).length, 2);
});

test('the scheduler runs on events without a date', async () => {
    const dateless = await createEvent({});
    assert.equal(await archiveEndedEvents({ now: NOW }), 0);
    assert.equal(await statusOf(dateless), 'active');
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const longAgo = () => ({ startDate: new Date(Date.now() - 50 * HOUR).toISOString(), endDate: new Date(Date.now() - 48 * HOUR).toISOString() });
async function waitForStatus(id, status) {
    for (let attempt = 0; attempt < 50; attempt++) {
        if (await statusOf(id) === status) return true;
        await sleep(20);
    }
    return false;
}

test('the scheduler waits for the bot before its first run', async () => {
    // Announcements can only be refreshed once the bot is ready
    const due = await createEvent(longAgo());
    let botReady;
    startArchiveScheduler({ waitFor: new Promise(resolve => { botReady = resolve; }) });
    await sleep(100);
    assert.equal(await statusOf(due), 'active');

    botReady(true);
    assert.equal(await waitForStatus(due, 'archived'), true);
    stopArchiveScheduler();
});

test('a scheduler stopped before the bot is ready never runs', async () => {
    const due = await createEvent(longAgo());
    let botReady;
    startArchiveScheduler({ waitFor: new Promise(resolve => { botReady = resolve; }) });
    stopArchiveScheduler();
    botReady(true);
    await sleep(100);
    assert.equal(await statusOf(due), 'active');
});
