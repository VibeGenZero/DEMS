const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir } = require('./helpers');

// Mock mode with an own, empty database; the empty cwd keeps a local .env out
const tmpDir = createTempDir('bot-settings');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'bot-settings.sqlite');

const bot = require('../bot');
const { db, doc, setDoc, deleteDoc } = require('../firebaseAdmin');
const settings = require('../utils/botSettings');

after(async () => {
    await bot.client.destroy();
});

beforeEach(async () => {
    await deleteDoc(doc(db, 'botSettings', 'config'));
    settings.forgetBotSettings();
});

test('normalizeBotSettings gives every setting its default', () => {
    assert.deepEqual(settings.normalizeBotSettings({}), {
        statusType: 'online',
        activityType: 'WATCHING',
        activityText: '',
        dmNotifications: true,
        reminderEnabled: true,
        eventStartNotifications: true,
        autoChannelCreation: true,
        announcementThreads: true,
        autoUpdatePresence: false,
        autoStatusCalendarEvents: false,
        announceChannel: '',
        welcomeMessage: ''
    });
    assert.deepEqual(settings.normalizeBotSettings(null), settings.normalizeBotSettings({}));
});

test('stored values win, booleans are coerced like the settings route does', () => {
    const normalized = settings.normalizeBotSettings({
        dmNotifications: false, autoUpdatePresence: 1, announceChannel: '123', welcomeMessage: 'Hallo', updatedAt: 'x'
    });
    assert.equal(normalized.dmNotifications, false);
    assert.equal(normalized.autoUpdatePresence, true);
    assert.equal(normalized.reminderEnabled, true);
    assert.equal(normalized.announceChannel, '123');
    assert.equal(normalized.welcomeMessage, 'Hallo');
    assert.equal(normalized.updatedAt, 'x');
    assert.equal(settings.normalizeBotSettings({ announcementThreads: false }).announcementThreads, false);
});

test('settings saved before a key existed read that key as its default', async () => {
    await setDoc(doc(db, 'botSettings', 'config'), { statusType: 'idle', dmNotifications: false });
    const loaded = await settings.loadBotSettings();
    assert.equal(loaded.statusType, 'idle');
    assert.equal(loaded.dmNotifications, false);
    assert.equal(loaded.eventStartNotifications, true);
    assert.equal(loaded.autoChannelCreation, true);
    assert.equal(loaded.announcementThreads, true);
});

test('loadBotSettings reads once and keeps the value until a save remembers a new one', async () => {
    await setDoc(doc(db, 'botSettings', 'config'), { dmNotifications: false });
    assert.equal((await settings.loadBotSettings()).dmNotifications, false);
    // Changed behind the cache's back -> still the cached value
    await setDoc(doc(db, 'botSettings', 'config'), { dmNotifications: true });
    assert.equal((await settings.loadBotSettings()).dmNotifications, false);
    settings.rememberBotSettings({ dmNotifications: true });
    assert.equal((await settings.loadBotSettings()).dmNotifications, true);
});

test('a read error gives the defaults and is logged', async (t) => {
    const errors = [];
    t.mock.method(console, 'error', (...args) => errors.push(args.join(' ')));
    const loaded = await settings.loadBotSettings({ read: async () => { throw new Error('db weg'); } });
    assert.deepEqual(loaded, settings.normalizeBotSettings({}));
    assert.ok(errors.some(line => line.includes('db weg')), errors.join('\n'));
});

test('saveBotSettings in bot.js updates the cache at once', async () => {
    assert.equal((await settings.loadBotSettings()).dmNotifications, true);
    assert.equal(await bot.saveBotSettings(settings.normalizeBotSettings({ dmNotifications: false })), true);
    assert.equal((await settings.loadBotSettings()).dmNotifications, false);
    assert.equal((await bot.getBotSettings()).dmNotifications, false);
});

test('sendAutomaticDM sends only while DM notifications are on', async (t) => {
    const sent = [];
    t.mock.method(bot, 'sendDM', async (userId, message) => { sent.push([userId, message]); return true; });

    settings.rememberBotSettings({ dmNotifications: true });
    assert.equal(await settings.sendAutomaticDM('u1', 'Hallo'), true);
    settings.rememberBotSettings({ dmNotifications: false });
    assert.equal(await settings.sendAutomaticDM('u2', 'Hallo'), false);
    assert.deepEqual(sent, [['u1', 'Hallo']]);
});

test('announceChannelId prefers the bot center channel over the env variable', (t) => {
    const before = process.env.DISCORD_ANNOUNCE_CHANNEL_ID;
    t.after(() => { process.env.DISCORD_ANNOUNCE_CHANNEL_ID = before; });
    process.env.DISCORD_ANNOUNCE_CHANNEL_ID = 'env-channel';
    assert.equal(settings.announceChannelId({ announceChannel: 'bot-center' }), 'bot-center');
    assert.equal(settings.announceChannelId({ announceChannel: '' }), 'env-channel');
    process.env.DISCORD_ANNOUNCE_CHANNEL_ID = '';
    assert.equal(settings.announceChannelId({ announceChannel: '' }), '');
});

test('change notices use the DM gate by default', async (t) => {
    const { describeEventChanges, notifyEventChange } = require('../utils/eventChangeNotice');
    const base = { startDate: '2099-03-06T19:00:00.000Z', endDate: '', location: null };
    const changes = describeEventChanges(base, { ...base, startDate: '2099-03-07T19:00:00.000Z' });
    await setDoc(doc(db, 'registrations', 'gate-1'), { eventId: 'ev-gate', userId: 'u-gate', status: 'accepted', guests: [] });
    const sent = [];
    t.mock.method(bot, 'sendDM', async (userId) => { sent.push(userId); return true; });

    settings.rememberBotSettings({ dmNotifications: true });
    assert.equal((await notifyEventChange({ eventId: 'ev-gate', title: 'Raid', changes })).notified, 1);
    settings.rememberBotSettings({ dmNotifications: false });
    assert.equal((await notifyEventChange({ eventId: 'ev-gate', title: 'Raid', changes })).notified, 0);
    assert.deepEqual(sent, ['u-gate']);
    await deleteDoc(doc(db, 'registrations', 'gate-1'));
});

test('only admin-triggered messages call sendDM directly; every automatic DM goes through the gate', () => {
    const fs = require('fs');
    const repo = path.join(__dirname, '..');
    const files = ['server.js', ...['routes', 'utils', 'middleware'].flatMap(dir =>
        fs.readdirSync(path.join(repo, dir)).filter(name => name.endsWith('.js')).map(name => `${dir}/${name}`))]
        .filter(file => file !== 'utils/botSettings.js');
    const direct = [];
    for (const file of files) {
        const source = fs.readFileSync(path.join(repo, file), 'utf8');
        source.split(/\r?\n/).forEach((line, index) => {
            if (/\bsendDM\s*\(|send:\s*sendDM\b|=\s*sendDM\b/.test(line) && !/^\s*(\*|\/\/)/.test(line)) direct.push(`${file}:${index + 1}`);
        });
    }
    const allowed = direct.filter(entry => entry.startsWith('routes/admin.js:'));
    assert.equal(allowed.length, 2, `expected only the cancellation DM and the participant message: ${direct.join(', ')}`);
    assert.deepEqual(direct, allowed,
        'Automatic DMs must use sendAutomaticDM (utils/botSettings.js) so the bot center switch "DM-Benachrichtigungen" applies (B-02). Direct sendDM is only for messages an admin triggers on purpose.');
});

// ── Welcome message (B-02) ──────────────────────────────────────────────

const { getDoc } = require('../firebaseAdmin');
const WELCOME = 'Willkommen, {user.name}! Schön, dass du dabei bist. {user.mention}';

/** A member with a profile; `extra` adds fields such as welcomeSentAt. */
async function storeMember(id, name, extra = {}) {
    await setDoc(doc(db, 'users', id), { id, username: name.toLowerCase(), displayName: name, ...extra });
    return { id, username: name.toLowerCase(), displayName: name };
}

async function storeEventDoc(id, fields = {}) {
    const event = { title: `Event ${id}`, status: 'active', accessMode: 'open', approvalMode: 'instant', maxParticipants: 0,
        startDate: '2099-03-06T19:00:00.000Z', formFields: [], allowGuests: true, ...fields };
    await setDoc(doc(db, 'events', id), event);
    return event;
}

/** Record the DMs the bot would send while `fn` runs. */
async function recordDms(t, fn) {
    const sent = [];
    t.mock.method(bot, 'sendDM', async (userId, message) => { sent.push({ userId, message }); return true; });
    await fn();
    return sent;
}

const welcomes = (sent, userId) => sent.filter(dm => dm.userId === userId && /^Willkommen, /.test(dm.message));
const { registerUserForEvent, notifyStatusChange } = require('../utils/registrationService');
const { announcePromotions } = require('../utils/eventUtils');

test('the first acceptance sends the welcome message once and marks the member', async (t) => {
    settings.rememberBotSettings({ welcomeMessage: WELCOME });
    const user = await storeMember('w-first', 'Wilma');
    await storeEventDoc('w-ev-1');
    await storeEventDoc('w-ev-2');
    const sent = await recordDms(t, async () => {
        assert.equal((await registerUserForEvent({ eventId: 'w-ev-1', user })).status, 'accepted');
        assert.equal((await registerUserForEvent({ eventId: 'w-ev-2', user })).status, 'accepted');
    });
    const mine = welcomes(sent, 'w-first');
    assert.equal(mine.length, 1, JSON.stringify(sent));
    assert.equal(mine[0].message, 'Willkommen, Wilma! Schön, dass du dabei bist. <@w-first>');
    assert.match((await getDoc(doc(db, 'users', 'w-first'))).data().welcomeSentAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('a member accepted before the welcome message existed gets none', async (t) => {
    settings.rememberBotSettings({ welcomeMessage: WELCOME });
    const user = await storeMember('w-old', 'Olga');
    await setDoc(doc(db, 'registrations', 'w-old-reg'), { eventId: 'w-ev-old', userId: 'w-old', status: 'accepted' });
    await storeEventDoc('w-ev-3');
    const sent = await recordDms(t, async () => {
        assert.equal((await registerUserForEvent({ eventId: 'w-ev-3', user })).status, 'accepted');
    });
    assert.deepEqual(welcomes(sent, 'w-old'), []);
});

test('an empty welcome message or DMs off send nothing and mark nothing', async (t) => {
    const user = await storeMember('w-none', 'Nina');
    await storeEventDoc('w-ev-4');
    await storeEventDoc('w-ev-5');
    const sent = await recordDms(t, async () => {
        settings.rememberBotSettings({ welcomeMessage: '' });
        await registerUserForEvent({ eventId: 'w-ev-4', user });
    });
    assert.deepEqual(welcomes(sent, 'w-none'), []);
    assert.equal((await getDoc(doc(db, 'users', 'w-none'))).data().welcomeSentAt, undefined);

    const user2 = await storeMember('w-off', 'Otto');
    const sentOff = await recordDms(t, async () => {
        settings.rememberBotSettings({ welcomeMessage: WELCOME, dmNotifications: false });
        await registerUserForEvent({ eventId: 'w-ev-5', user: user2 });
    });
    assert.deepEqual(sentOff, []);
    assert.equal((await getDoc(doc(db, 'users', 'w-off'))).data().welcomeSentAt, undefined);
});

test('acceptance by an admin and moving up welcome a first-time member too', async (t) => {
    settings.rememberBotSettings({ welcomeMessage: WELCOME });
    await storeMember('w-admin', 'Anna');
    await storeMember('w-up', 'Udo');
    const event = await storeEventDoc('w-ev-6', { approvalMode: 'manual' });
    await setDoc(doc(db, 'registrations', 'w-admin-reg'), { eventId: 'w-ev-6', userId: 'w-admin', userName: 'Anna', status: 'accepted' });
    await setDoc(doc(db, 'registrations', 'w-up-reg'), { eventId: 'w-ev-6', userId: 'w-up', userName: 'Udo', status: 'accepted' });
    const sent = await recordDms(t, async () => {
        await notifyStatusChange({ registration: { id: 'w-admin-reg', userId: 'w-admin', userName: 'Anna' }, eventId: 'w-ev-6', event, status: 'accepted' });
        await announcePromotions('w-ev-6', event, [{ registrationId: 'w-up-reg', userId: 'w-up', status: 'accepted', slotId: null }]);
    });
    assert.equal(welcomes(sent, 'w-admin').length, 1, JSON.stringify(sent));
    assert.equal(welcomes(sent, 'w-up').length, 1, JSON.stringify(sent));
});

test('without a profile document no welcome is sent', async (t) => {
    settings.rememberBotSettings({ welcomeMessage: WELCOME });
    const sent = await recordDms(t, () => settings.sendWelcomeOnce({ id: 'w-ghost', displayName: 'Geist' }, 'x'));
    assert.deepEqual(sent, []);
});

test('announceTarget refuses when neither the bot center nor .env names a channel', (t) => {
    const before = process.env.DISCORD_ANNOUNCE_CHANNEL_ID;
    t.after(() => { process.env.DISCORD_ANNOUNCE_CHANNEL_ID = before; });
    process.env.DISCORD_ANNOUNCE_CHANNEL_ID = '';
    assert.deepEqual(settings.announceTarget({ announceChannel: '' }),
        { error: 'Kein Ankündigungskanal festgelegt – bitte in der Bot-Zentrale wählen.' });
    assert.deepEqual(settings.announceTarget({ announceChannel: 'c1' }), { channelId: 'c1' });
    process.env.DISCORD_ANNOUNCE_CHANNEL_ID = 'env';
    assert.deepEqual(settings.announceTarget({ announceChannel: '' }), { channelId: 'env' });
});
