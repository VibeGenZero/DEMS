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

test('the announcement is refreshed once when the registration deadline passes (W-03)', async () => {
    const refreshed = [];
    const pass = () => bot.checkReminders({ now: NOW, send: async () => {}, refresh: (eventId) => refreshed.push(eventId) });
    await storeEvent('deadline-open', { startDate: inHours(48), registrationDeadline: inHours(1), registrationClosedRefreshed: false });
    try {
        await pass();
        assert.deepEqual(refreshed, [], 'not before the deadline');
    } finally {
        await removeEvent('deadline-open');
    }

    await storeEvent('deadline-passed', { startDate: inHours(48), registrationDeadline: inHours(-1), registrationClosedRefreshed: false });
    try {
        await pass();
        assert.deepEqual(refreshed, ['deadline-passed']);
        assert.equal((await storedEvent('deadline-passed')).registrationClosedRefreshed, true);
        await pass();
        assert.deepEqual(refreshed, ['deadline-passed'], 'only once');
    } finally {
        await removeEvent('deadline-passed');
    }
});

// ── DM choices (W-16) ───────────────────────────────────────────────────

const OPTED_OUT = '200000000000000011';

/** A second accepted participant who switched reminders off. */
async function storeOptedOut(eventId) {
    await setDoc(doc(db, 'users', OPTED_OUT), { id: OPTED_OUT, notifications: { reminders: false } });
    await setDoc(doc(db, 'registrations', `reg-${eventId}-off`), { eventId, userId: OPTED_OUT, status: 'accepted' });
}

test('a member with reminders off gets neither the reminder nor the start DM (W-16)', async () => {
    await storeEvent('w16-due', { startDate: inHours(2), reminderHours: [{ hours: 24, sent: false }] });
    await storeOptedOut('w16-due');
    try {
        const reminder = await runPass();
        assert.deepEqual(reminder.map(dm => dm.userId), [PARTICIPANT]);
        assert.deepEqual((await storedEvent('w16-due')).reminderHours, [{ hours: 24, sent: true }]);
    } finally {
        await removeEvent('w16-due');
        await deleteDoc(doc(db, 'registrations', 'reg-w16-due-off'));
    }

    await storeEvent('w16-start', { startDate: inHours(-0.02), reminderHours: [] });
    await storeOptedOut('w16-start');
    try {
        const start = await runPass();
        assert.deepEqual(start.map(dm => dm.userId), [PARTICIPANT]);
        assert.equal((await storedEvent('w16-start')).eventStartNotificationSent, true);
    } finally {
        await removeEvent('w16-start');
        await deleteDoc(doc(db, 'registrations', 'reg-w16-start-off'));
    }
});

test('a reminder counts as sent even when every participant switched reminders off (W-16)', async () => {
    await storeEvent('w16-all', { startDate: inHours(2), reminderHours: [{ hours: 24, sent: false }] });
    await setDoc(doc(db, 'users', PARTICIPANT), { id: PARTICIPANT, notifications: { reminders: false } });
    try {
        assert.deepEqual(await runPass(), []);
        assert.deepEqual((await storedEvent('w16-all')).reminderHours, [{ hours: 24, sent: true }]);
    } finally {
        await removeEvent('w16-all');
        await deleteDoc(doc(db, 'users', PARTICIPANT));
    }
});

// ── Bot center switches (B-02) ──────────────────────────────────────────

const { normalizeBotSettings } = require('../utils/botSettings');

/** One pass with the given bot center settings; returns the DMs. */
async function runPassWith(changes, refresh = () => {}) {
    const sent = [];
    await bot.checkReminders({
        now: NOW,
        settings: normalizeBotSettings(changes),
        send: async (userId, message) => { sent.push({ userId, message }); },
        refresh
    });
    return sent;
}

test('reminders off: a due reminder is dropped and not sent after switching on again', async () => {
    await storeEvent('rem-off', { startDate: inHours(2), reminderHours: [{ hours: 24, sent: false }] });
    try {
        assert.deepEqual(await runPassWith({ reminderEnabled: false }), []);
        assert.deepEqual((await storedEvent('rem-off')).reminderHours, [{ hours: 24, sent: true }]);
        assert.deepEqual(await runPassWith({ reminderEnabled: true }), [], 'no late reminder');
    } finally {
        await removeEvent('rem-off');
    }
});

test('start notifications off: no start DM, and none later', async () => {
    await storeEvent('start-off', { startDate: inHours(-0.02), reminderHours: [] });
    try {
        assert.deepEqual(await runPassWith({ eventStartNotifications: false }), []);
        assert.equal((await storedEvent('start-off')).eventStartNotificationSent, true);
        assert.deepEqual(await runPassWith({ eventStartNotifications: true }), []);
    } finally {
        await removeEvent('start-off');
    }
});

test('reminders off leave the start DM alone, start notifications off leave reminders alone', async () => {
    await storeEvent('mixed', { startDate: inHours(-0.02), reminderHours: [] });
    try {
        const sent = await runPassWith({ reminderEnabled: false });
        assert.equal(sent.length, 1);
        assert.match(sent[0].message, /hat gerade begonnen/);
    } finally {
        await removeEvent('mixed');
    }
    await storeEvent('mixed-2', { startDate: inHours(2), reminderHours: [{ hours: 24, sent: false }] });
    try {
        const sent = await runPassWith({ eventStartNotifications: false });
        assert.equal(sent.length, 1);
        assert.match(sent[0].message, /Erinnerung/);
    } finally {
        await removeEvent('mixed-2');
    }
});

test('the deadline refresh runs with reminders off', async () => {
    const refreshed = [];
    await storeEvent('deadline-rem-off', { startDate: inHours(48), registrationDeadline: inHours(-1), registrationClosedRefreshed: false });
    try {
        await runPassWith({ reminderEnabled: false, eventStartNotifications: false }, (eventId) => refreshed.push(eventId));
        assert.deepEqual(refreshed, ['deadline-rem-off']);
    } finally {
        await removeEvent('deadline-rem-off');
    }
});

test('the reminder switch no longer stops the scheduler (it also closes announcements at the deadline)', () => {
    const fs = require('fs');
    // The function lives in bot.js or, since the split (B-01), in one of the bot/ modules
    const repo = path.join(__dirname, '..');
    const botDir = path.join(repo, 'bot');
    const candidates = ['bot.js', ...(fs.existsSync(botDir) ? fs.readdirSync(botDir).map(name => `bot/${name}`) : [])];
    const source = candidates.map(file => fs.readFileSync(path.join(repo, file), 'utf8').replace(/\r\n/g, '\n'))
        .find(text => text.includes('async function applyBotSettings')) || '';
    const start = source.indexOf('async function applyBotSettings');
    const body = source.slice(start, source.indexOf('\n}\n', start));
    assert.ok(body.length > 100, 'applyBotSettings found');
    assert.equal(/clearInterval\(reminderInterval\)|startReminderScheduler\(|stopReminderScheduler\(/.test(body), false,
        'applyBotSettings must not start or stop the reminder scheduler; reminderEnabled is checked inside checkReminders (B-02)');
});

// ── Check-in invitations (B-07) ─────────────────────────────────────────

const CHECKIN = { checkinEnabled: true, checkinCode: '123456', reminderHours: [] };
const textOf = (message) => (typeof message === 'string' ? message : message.content);
const hasCheckinButton = (message) => typeof message !== 'string'
    && message.components.some(row => row.toJSON().components.some(button => button.custom_id && button.custom_id.startsWith('event_checkin:')));
const registrationOf = async (id) => (await getDoc(doc(db, 'registrations', id))).data();

/** One pass where the bot can send, with bot center changes; returns the DMs. */
async function runCheckinPass(changes = {}, { canInvite = () => true, onSend = async () => {}, now = NOW } = {}) {
    const sent = [];
    await bot.checkReminders({
        now,
        settings: normalizeBotSettings(changes),
        send: async (userId, message) => { await onSend(userId, message); sent.push({ userId, message }); },
        refresh: () => {},
        canInvite
    });
    return sent;
}

test('an event with check-in starts: one DM with start text and button, marked before it', async () => {
    await storeEvent('ci-start', { startDate: inHours(-0.02), endDate: inHours(2), ...CHECKIN });
    try {
        const sent = await runCheckinPass({}, {
            onSend: async () => assert.ok((await registrationOf('reg-ci-start')).checkinInvitedAt, 'marked before the DM')
        });
        assert.equal(sent.length, 1);
        assert.equal(sent[0].userId, PARTICIPANT);
        assert.ok(hasCheckinButton(sent[0].message));
        assert.match(textOf(sent[0].message), /hat gerade begonnen/);

        assert.deepEqual(await runCheckinPass(), [], 'no second invitation');
    } finally {
        await removeEvent('ci-start');
    }
});

test('start notifications off or reminders off: the invitation still goes out', async () => {
    await storeEvent('ci-switch', { startDate: inHours(-0.02), endDate: inHours(2), ...CHECKIN });
    try {
        const sent = await runCheckinPass({ eventStartNotifications: false });
        assert.equal(sent.length, 1);
        assert.ok(hasCheckinButton(sent[0].message));
        assert.match(textOf(sent[0].message), /läuft – checke jetzt ein/);
    } finally {
        await removeEvent('ci-switch');
    }

    await storeEvent('ci-optout', { startDate: inHours(-0.02), endDate: inHours(2), ...CHECKIN });
    await storeOptedOut('ci-optout');
    try {
        const sent = await runCheckinPass();
        assert.equal(sent.length, 2, 'one DM per member');
        const byUser = Object.fromEntries(sent.map(dm => [dm.userId, dm.message]));
        assert.match(textOf(byUser[PARTICIPANT]), /hat gerade begonnen/);
        assert.match(textOf(byUser[OPTED_OUT]), /läuft – checke jetzt ein/);
        assert.ok(hasCheckinButton(byUser[PARTICIPANT]) && hasCheckinButton(byUser[OPTED_OUT]));
    } finally {
        await removeEvent('ci-optout');
        await deleteDoc(doc(db, 'registrations', 'reg-ci-optout-off'));
    }
});

test('an event without check-in keeps the plain start DM', async () => {
    await storeEvent('ci-none', { startDate: inHours(-0.02), endDate: inHours(2), reminderHours: [] });
    try {
        const sent = await runCheckinPass();
        assert.equal(sent.length, 1);
        assert.equal(typeof sent[0].message, 'string');
        assert.equal((await registrationOf('reg-ci-none')).checkinInvitedAt, undefined);
    } finally {
        await removeEvent('ci-none');
    }
});

test('while the event runs, late accepts are invited; checked-in and invited members are not', async () => {
    await storeEvent('ci-late', { startDate: inHours(-1), endDate: inHours(1), eventStartNotificationSent: true, ...CHECKIN });
    await setDoc(doc(db, 'registrations', 'reg-ci-late-checked'), { eventId: 'ci-late', userId: 'u-checked', status: 'accepted', checkedIn: true });
    await setDoc(doc(db, 'registrations', 'reg-ci-late-invited'), { eventId: 'ci-late', userId: 'u-invited', status: 'accepted', checkinInvitedAt: inHours(-1) });
    await setDoc(doc(db, 'registrations', 'reg-ci-late-pending'), { eventId: 'ci-late', userId: 'u-pending', status: 'pending' });
    try {
        const sent = await runCheckinPass();
        assert.deepEqual(sent.map(dm => dm.userId), [PARTICIPANT]);
        assert.match(textOf(sent[0].message), /läuft – checke jetzt ein/, 'no start text after the start window');

        // The pending member is accepted later -> invited in the next pass
        await setDoc(doc(db, 'registrations', 'reg-ci-late-pending'), { eventId: 'ci-late', userId: 'u-pending', status: 'accepted' });
        assert.deepEqual((await runCheckinPass()).map(dm => dm.userId), ['u-pending']);
    } finally {
        await removeEvent('ci-late');
        for (const id of ['checked', 'invited', 'pending']) await deleteDoc(doc(db, 'registrations', `reg-ci-late-${id}`));
    }
});

test('no invitation before the start or after the end', async () => {
    await storeEvent('ci-future', { startDate: inHours(1), endDate: inHours(3), ...CHECKIN });
    try {
        assert.deepEqual(await runCheckinPass(), []);
    } finally {
        await removeEvent('ci-future');
    }
    await storeEvent('ci-over', { startDate: inHours(-4), endDate: inHours(-1), eventStartNotificationSent: true, ...CHECKIN });
    try {
        assert.deepEqual(await runCheckinPass(), []);
        assert.equal((await registrationOf('reg-ci-over')).checkinInvitedAt, undefined);
    } finally {
        await removeEvent('ci-over');
    }
});

test('bot offline: nothing is marked, the invitation follows once the bot is back', async () => {
    await storeEvent('ci-offline', { startDate: inHours(-0.02), endDate: inHours(2), ...CHECKIN });
    try {
        const offline = await runCheckinPass({}, { canInvite: () => false });
        assert.equal(offline.length, 1, 'plain start DM (it fails on its own while offline)');
        assert.equal(hasCheckinButton(offline[0].message), false);
        assert.equal((await registrationOf('reg-ci-offline')).checkinInvitedAt, undefined);

        const later = new Date(NOW.getTime() + 0.5 * HOUR);
        const online = await runCheckinPass({}, { now: later });
        assert.equal(online.length, 1);
        assert.ok(hasCheckinButton(online[0].message));
    } finally {
        await removeEvent('ci-offline');
    }
});
