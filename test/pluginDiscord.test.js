const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir } = require('./helpers');

// The default "known user" check reads users/<id>: own, empty SQLite
// database; the empty cwd keeps a local .env out
const tmpDir = createTempDir('plugin-discord');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
delete process.env.DEV_MOCK;
process.env.SQLITE_PATH = path.join(tmpDir, 'plugin-discord.sqlite');
process.env.BASE_URL = 'https://dems.example.org';
process.env.TIMEZONE = 'Europe/Berlin';

const { ButtonStyle } = require('discord.js');
const { db, doc, setDoc } = require('../firebaseAdmin');
const { PluginPermissionError, PluginHttpError, PluginDataError } = require('../plugin-sdk/errors');
const { createMessageLimiter, createDiscordApi, isDemsUrl } = require('../plugin-sdk/discord');

const USER = '123456789012345678';
const STRANGER = '876543210987654321';
const CHANNEL = '111111111111111111';
const DEMS_LINK = { label: 'Zur Einreichung', url: 'https://dems.example.org/#plugin/event-submissions' };
// 2026-11-19 18:00 UTC = 19:00 in Berlin
const START = Date.UTC(2026, 10, 19, 18, 0, 0);
const SCHEMA = [
    { key: 'notifyChannel', type: 'channel', label: 'Kanal', help: '', required: false },
    { key: 'greeting', type: 'text', label: 'Gruß', help: '', required: false }
];

let clock;
let logs;
let sentDms;
let sentPosts;

beforeEach(() => {
    clock = START;
    logs = { info: [], warn: [], error: [] };
    sentDms = [];
    sentPosts = [];
});

const now = () => clock;
const log = {
    info: (...args) => logs.info.push(args.join(' ')),
    warn: (...args) => logs.warn.push(args.join(' ')),
    error: (...args) => logs.error.push(args.join(' '))
};

/** ctx.discord with fakes for every Discord-facing call. */
function api({ permissions = ['discord:dm', 'discord:channel'], settings = {}, limiter, known = [USER] } = {}) {
    return createDiscordApi({
        pluginId: 'alpha',
        permissions,
        readSettings: async () => settings,
        settingsSchema: SCHEMA,
        limiter: limiter || createMessageLimiter({ now }),
        log,
        now,
        sendDm: async (userId, payload) => { sentDms.push({ userId, payload }); return true; },
        sendChannel: async (channelId, payload) => { sentPosts.push({ channelId, payload }); return true; },
        userExists: async userId => known.includes(userId)
    });
}

test('the error classes carry their names, and PluginHttpError a numeric status', () => {
    const http = new PluginHttpError(409, 'Schon eingereicht.');
    assert.equal(http.name, 'PluginHttpError');
    assert.equal(http.status, 409);
    assert.equal(http.message, 'Schon eingereicht.');
    assert.ok(http instanceof Error);
    const permission = new PluginPermissionError('discord:dm');
    assert.equal(permission.name, 'PluginPermissionError');
    assert.equal(permission.permission, 'discord:dm');
    assert.match(permission.message, /discord:dm/);
    assert.equal(new PluginDataError('x').name, 'PluginDataError');
});

test('the limiter allows 200 DMs, refuses the 201st and frees it after the window', () => {
    const limiter = createMessageLimiter({ now });
    assert.equal(limiter.take('alpha', 'dm'), true, 'DM 1');
    clock += 1000;
    for (let i = 1; i < 200; i++) assert.equal(limiter.take('alpha', 'dm'), true, `DM ${i + 1}`);
    assert.equal(limiter.take('alpha', 'dm'), false);
    clock = START + 599999;
    assert.equal(limiter.take('alpha', 'dm'), false, 'still inside the window');
    clock += 1;
    assert.equal(limiter.take('alpha', 'dm'), true, 'the oldest left the window');
    assert.equal(limiter.take('alpha', 'dm'), false);
});

test('the limiter counts channel posts (30) apart from DMs and per plugin', () => {
    const limiter = createMessageLimiter({ now });
    for (let i = 0; i < 200; i++) limiter.take('alpha', 'dm');
    for (let i = 0; i < 30; i++) assert.equal(limiter.take('alpha', 'post'), true, `post ${i + 1}`);
    assert.equal(limiter.take('alpha', 'post'), false);
    assert.equal(limiter.take('beta', 'dm'), true, 'another plugin has its own budget');
    assert.equal(limiter.take('beta', 'post'), true);
});

test('warning names the time the longest blocked kind frees up, in the DEMS time zone', () => {
    const limiter = createMessageLimiter({ dms: 2, posts: 1, now });
    assert.equal(limiter.warning('alpha'), null);
    limiter.take('alpha', 'dm');
    clock += 60000;
    limiter.take('alpha', 'dm');
    assert.equal(limiter.warning('alpha'), 'Nachrichtengrenze erreicht (bis 19:10)');
    clock += 60000;
    limiter.take('alpha', 'post');
    assert.equal(limiter.warning('alpha'), 'Nachrichtengrenze erreicht (bis 19:12)', 'the post is blocked longer');
    clock = START + 600000;
    assert.equal(limiter.warning('alpha'), 'Nachrichtengrenze erreicht (bis 19:12)', 'one DM left, the post still blocks');
    clock = START + 720000;
    assert.equal(limiter.warning('alpha'), null);
    assert.equal(limiter.warning('beta'), null);
});

test('isDemsUrl accepts only links into this DEMS', () => {
    assert.equal(isDemsUrl('https://dems.example.org/#event/abc'), true);
    assert.equal(isDemsUrl('https://dems.example.org.evil.example/#event/abc'), false);
    assert.equal(isDemsUrl('https://evil.example/'), false);
    assert.equal(isDemsUrl(42), false);
});

test('sendDM sends text and link button without any mentions', async () => {
    const hostile = '@everyone <@&123> hi';
    assert.equal(await api().sendDM(USER, { text: hostile, link: DEMS_LINK }), true);
    assert.equal(sentDms.length, 1);
    const { userId, payload } = sentDms[0];
    assert.equal(userId, USER);
    assert.equal(payload.content, hostile);
    assert.deepEqual(payload.allowedMentions, { parse: [] });
    assert.equal(payload.components.length, 1);
    const [button] = payload.components[0].toJSON().components;
    assert.equal(button.style, ButtonStyle.Link);
    assert.equal(button.url, DEMS_LINK.url);
    assert.equal(button.label, DEMS_LINK.label);
});

test('sendDM without a link sends no components', async () => {
    assert.equal(await api().sendDM(USER, { text: 'Hallo' }), true);
    assert.deepEqual(sentDms[0].payload, { content: 'Hallo', components: [], allowedMentions: { parse: [] } });
});

test('sendDM to a user DEMS does not know answers false without sending or using budget', async () => {
    const limiter = createMessageLimiter({ dms: 1, now });
    const discord = api({ limiter });
    assert.equal(await discord.sendDM(STRANGER, { text: 'Hallo' }), false);
    assert.equal(sentDms.length, 0);
    assert.equal(logs.warn.length, 1);
    assert.equal(await discord.sendDM(USER, { text: 'Hallo' }), true, 'the budget is still there');
});

test('sendDM refuses invalid ids, texts and foreign links with one warning each', async () => {
    const discord = api();
    assert.equal(await discord.sendDM('1234', { text: 'Hallo' }), false);
    assert.equal(await discord.sendDM(Number(USER), { text: 'Hallo' }), false);
    assert.equal(await discord.sendDM(USER, { text: '' }), false);
    assert.equal(await discord.sendDM(USER, { text: '   ' }), false);
    assert.equal(await discord.sendDM(USER, { text: 'x'.repeat(2001) }), false);
    assert.equal(await discord.sendDM(USER, {}), false);
    assert.equal(await discord.sendDM(USER, { text: 'Hallo', link: { label: 'Los', url: 'https://evil.example/' } }), false);
    assert.equal(await discord.sendDM(USER, { text: 'Hallo', link: { label: 'x'.repeat(81), url: DEMS_LINK.url } }), false);
    assert.equal(await discord.sendDM(USER, { text: 'Hallo', link: { label: '', url: DEMS_LINK.url } }), false);
    assert.equal(sentDms.length, 0);
    assert.equal(logs.warn.length, 9);
    assert.equal(await discord.sendDM(USER, { text: 'x'.repeat(2000), link: { label: 'x'.repeat(80), url: DEMS_LINK.url } }), true);
});

test('refused messages do not use up the budget', async () => {
    const limiter = createMessageLimiter({ dms: 1, now });
    const discord = api({ limiter });
    assert.equal(await discord.sendDM(USER, { text: '' }), false);
    assert.equal(await discord.sendDM(USER, { text: 'Hallo', link: { label: 'Los', url: 'https://evil.example/' } }), false);
    assert.equal(await discord.sendDM(USER, { text: 'Hallo' }), true);
});

test('beyond the DM limit sendDM answers false and warns once per window', async () => {
    const limiter = createMessageLimiter({ dms: 1, now });
    const discord = api({ limiter });
    assert.equal(await discord.sendDM(USER, { text: 'eins' }), true);
    assert.equal(await discord.sendDM(USER, { text: 'zwei' }), false);
    assert.equal(await discord.sendDM(USER, { text: 'drei' }), false);
    assert.equal(sentDms.length, 1);
    assert.equal(logs.warn.length, 1, 'one warning for the window');
    assert.match(logs.warn[0], /Nachrichtengrenze erreicht/);
    clock += 600000;
    assert.equal(await discord.sendDM(USER, { text: 'vier' }), true);
    assert.equal(await discord.sendDM(USER, { text: 'fünf' }), false);
    assert.equal(logs.warn.length, 2, 'a new window warns again');
});

test('a DM that the bot could not send answers false', async () => {
    const discord = createDiscordApi({
        pluginId: 'alpha', permissions: ['discord:dm'], readSettings: async () => ({}), settingsSchema: [],
        limiter: createMessageLimiter({ now }), log, now,
        sendDm: async () => false, userExists: async () => true
    });
    assert.equal(await discord.sendDM(USER, { text: 'Hallo' }), false);
});

test('errors of the senders are logged and answer false instead of throwing', async () => {
    const discord = createDiscordApi({
        pluginId: 'alpha', permissions: ['discord:dm', 'discord:channel'],
        readSettings: async () => { throw new Error('db down'); }, settingsSchema: SCHEMA,
        limiter: createMessageLimiter({ now }), log, now,
        sendDm: async () => { throw new Error('boom'); }, userExists: async () => true
    });
    assert.equal(await discord.sendDM(USER, { text: 'Hallo' }), false);
    assert.equal(await discord.sendChannelMessage('notifyChannel', { text: 'Hallo' }), false);
    assert.equal(logs.error.length, 2);
});

test('by default a DM goes only to a user with a users document', async () => {
    await setDoc(doc(db, 'users', USER), { displayName: 'Lena' });
    const sent = [];
    const discord = createDiscordApi({
        pluginId: 'alpha', permissions: ['discord:dm'], readSettings: async () => ({}), settingsSchema: [],
        limiter: createMessageLimiter({ now }), log, now,
        sendDm: async (userId) => { sent.push(userId); return true; }
    });
    assert.equal(await discord.sendDM(USER, { text: 'Hallo' }), true);
    assert.equal(await discord.sendDM(STRANGER, { text: 'Hallo' }), false);
    assert.deepEqual(sent, [USER]);
});

test('sendChannelMessage posts to the channel of the named channel setting', async () => {
    const discord = api({ settings: { notifyChannel: CHANNEL } });
    assert.equal(await discord.sendChannelMessage('notifyChannel', { text: '@everyone neu', link: DEMS_LINK }), true);
    assert.equal(sentPosts.length, 1);
    assert.equal(sentPosts[0].channelId, CHANNEL);
    assert.equal(sentPosts[0].payload.content, '@everyone neu');
    assert.deepEqual(sentPosts[0].payload.allowedMentions, { parse: [] });
    assert.equal(sentPosts[0].payload.components.length, 1);
});

test('sendChannelMessage refuses an empty setting, raw ids, other setting types and broken values', async () => {
    assert.equal(await api({ settings: {} }).sendChannelMessage('notifyChannel', { text: 'Hallo' }), false);
    assert.equal(await api({ settings: { notifyChannel: '' } }).sendChannelMessage('notifyChannel', { text: 'Hallo' }), false);
    assert.equal(await api({ settings: { notifyChannel: CHANNEL } }).sendChannelMessage('1234', { text: 'Hallo' }), false);
    assert.equal(await api({ settings: { notifyChannel: CHANNEL } }).sendChannelMessage(CHANNEL, { text: 'Hallo' }), false);
    assert.equal(await api({ settings: { greeting: CHANNEL } }).sendChannelMessage('greeting', { text: 'Hallo' }), false);
    assert.equal(await api({ settings: { notifyChannel: 'general' } }).sendChannelMessage('notifyChannel', { text: 'Hallo' }), false);
    assert.equal(await api({ settings: { notifyChannel: CHANNEL } }).sendChannelMessage('notifyChannel', { text: 'Hi', link: { label: 'Los', url: 'https://evil.example/' } }), false);
    assert.equal(sentPosts.length, 0);
    assert.equal(logs.warn.length, 7);
});

test('beyond the post limit sendChannelMessage answers false; refused posts keep the budget', async () => {
    const limiter = createMessageLimiter({ posts: 1, now });
    const discord = api({ limiter, settings: { notifyChannel: CHANNEL } });
    assert.equal(await discord.sendChannelMessage('notifyChannel', { text: '' }), false);
    assert.equal(await discord.sendChannelMessage('notifyChannel', { text: 'eins' }), true);
    assert.equal(await discord.sendChannelMessage('notifyChannel', { text: 'zwei' }), false);
    assert.equal(sentPosts.length, 1);
    assert.equal(await discord.sendDM(USER, { text: 'DMs zählen extra' }), true);
});

test('a missing permission throws PluginPermissionError', async () => {
    const noDm = api({ permissions: ['discord:channel'], settings: { notifyChannel: CHANNEL } });
    await assert.rejects(noDm.sendDM(USER, { text: 'Hallo' }), PluginPermissionError);
    const noChannel = api({ permissions: ['discord:dm'], settings: { notifyChannel: CHANNEL } });
    await assert.rejects(noChannel.sendChannelMessage('notifyChannel', { text: 'Hallo' }), PluginPermissionError);
    assert.equal(sentDms.length + sentPosts.length, 0);
});
