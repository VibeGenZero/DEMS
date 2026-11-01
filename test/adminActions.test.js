const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir } = require('./helpers');

// Mock mode with an own database; the empty cwd keeps a local .env out
const tmpDir = createTempDir('admin-actions');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'actions.sqlite');

const bot = require('../bot');
const { db, collection, doc, getDoc, getDocs, setDoc } = require('../firebaseAdmin');
const { forgetBotSettings } = require('../utils/botSettings');
const {
    buildNewEvent, publishDraft, announceEvent, createPoll, announcePoll
} = require('../utils/adminActions');

after(async () => {
    await bot.client.destroy();
});

const ADMIN = 'admin-1';
const future = (days, hour = 18) => {
    const date = new Date(Date.now() + days * 86_400_000);
    date.setUTCHours(hour, 0, 0, 0);
    return date.toISOString();
};
const eventOf = async (id) => (await getDoc(doc(db, 'events', id))).data();
async function auditOf(action, targetId) {
    const snap = await getDocs(collection(db, 'auditLogs'));
    return snap.docs.map(entry => entry.data()).filter(entry => entry.action === action && entry.targetId === targetId);
}
/** Run fn without any announcement channel (bot center and env). */
async function withoutAnnounceChannel(fn) {
    const saved = process.env.DISCORD_ANNOUNCE_CHANNEL_ID;
    delete process.env.DISCORD_ANNOUNCE_CHANNEL_ID;
    forgetBotSettings();
    try {
        return await fn();
    } finally {
        process.env.DISCORD_ANNOUNCE_CHANNEL_ID = saved;
        forgetBotSettings();
    }
}

let counter = 0;
async function storeEvent(fields) {
    const id = `action-event-${++counter}`;
    await setDoc(doc(db, 'events', id), buildNewEvent({ title: `Event ${counter}`, startDate: future(3), ...fields }, ADMIN));
    return id;
}

// ── buildNewEvent ───────────────────────────────────────────────────────

test('a new event gets the defaults of the wizard', () => {
    const event = buildNewEvent({ title: 'Spieleabend', startDate: future(2) }, ADMIN);
    assert.equal(event.status, 'active');
    assert.equal(event.accessMode, 'open');
    assert.equal(event.approvalMode, 'manual');
    assert.equal(event.allowGuests, true);
    assert.equal(event.maxParticipants, 0);
    assert.equal(event.createdBy, ADMIN);
    assert.deepEqual(event.slots, []);
    assert.equal(event.eventStartNotificationSent, false);
    assert.ok(Array.isArray(event.reminderHours));
});

test('slots give the places and switch guests off', () => {
    const event = buildNewEvent({
        title: 'Raid', startDate: future(2), maxParticipants: 99, status: 'draft',
        slots: [{ id: 'tank', name: 'Tank', capacity: 2 }, { id: 'dps', name: 'DPS', capacity: 6 }]
    }, ADMIN);
    assert.equal(event.maxParticipants, 8);
    assert.equal(event.allowGuests, false);
    assert.equal(event.status, 'draft');
});

// ── publishDraft ────────────────────────────────────────────────────────

test('publishing a draft makes it active and logs it as done in Discord', async () => {
    const id = await storeEvent({ status: 'draft' });
    const result = await publishDraft(id, ADMIN, { via: 'discord' });
    assert.equal(result.ok, true);
    assert.equal((await eventOf(id)).status, 'active');
    const [entry] = await auditOf('UPDATE_EVENT_STATUS', id);
    assert.equal(entry.adminId, ADMIN);
    assert.match(entry.details, /active in Discord/);
});

test('only drafts with a start are published', async () => {
    const active = await storeEvent({});
    assert.deepEqual(await publishDraft(active, ADMIN), { ok: false, code: 'not_draft' });
    assert.deepEqual(await publishDraft('action-missing', ADMIN), { ok: false, code: 'missing' });
    const dateless = await storeEvent({ status: 'draft', startDate: '' });
    assert.deepEqual(await publishDraft(dateless, ADMIN), { ok: false, code: 'no_start' });
    assert.equal((await eventOf(dateless)).status, 'draft');
});

// ── announceEvent ───────────────────────────────────────────────────────

test('announcing stores the message and logs it', async () => {
    const id = await storeEvent({});
    const result = await announceEvent(id, ADMIN, { via: 'discord' });
    assert.equal(result.ok, true);
    assert.ok(result.sent.messageId);
    const stored = await eventOf(id);
    assert.equal(stored.announcements.length, 1);
    assert.equal(stored.announcements[0].messageId, result.sent.messageId);
    assert.match((await auditOf('ANNOUNCE_EVENT', id))[0].details, /in Discord/);
});

test('announcing without a channel or event answers the German reason', async () => {
    const id = await storeEvent({});
    const result = await withoutAnnounceChannel(() => announceEvent(id, ADMIN));
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.match(result.error, /Kein Ankündigungskanal/);
    assert.deepEqual(await announceEvent('action-missing', ADMIN), { ok: false, status: 404, error: 'Event nicht gefunden' });
});

// ── createPoll / announcePoll ───────────────────────────────────────────

test('a poll needs two dates and is logged when created', async () => {
    const refused = await createPoll({ title: 'Wann?', options: [{ startDate: future(5) }] }, ADMIN);
    assert.deepEqual(refused, { ok: false, error: 'Eine Abstimmung braucht 2–10 Termine.' });

    const result = await createPoll({ title: 'Wann?', options: [{ startDate: future(5) }, { startDate: future(6) }] }, ADMIN, { via: 'discord' });
    assert.equal(result.ok, true);
    assert.equal(result.poll.status, 'open');
    assert.equal(result.poll.createdBy, ADMIN);
    assert.match((await auditOf('CREATE_POLL', result.poll.id))[0].details, /"Wann\?" in Discord/);
});

test('announcing a poll stores the message', async () => {
    const { poll } = await createPoll({ title: 'Termin', options: [{ startDate: future(5) }, { startDate: future(7) }] }, ADMIN);
    const result = await announcePoll(poll.id, ADMIN, { via: 'discord' });
    assert.equal(result.ok, true);
    const stored = (await getDoc(doc(db, 'polls', poll.id))).data();
    assert.equal(stored.announcements[0].messageId, result.sent.messageId);
    assert.equal((await auditOf('ANNOUNCE_POLL', poll.id)).length, 1);

    const offline = await withoutAnnounceChannel(() => announcePoll(poll.id, ADMIN));
    assert.equal(offline.ok, false);
    assert.equal(offline.status, 400);
    assert.deepEqual(await announcePoll('poll-missing', ADMIN), { ok: false, status: 404, error: 'Abstimmung nicht gefunden' });
});
