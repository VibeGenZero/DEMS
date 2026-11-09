const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir, createClient } = require('./helpers');

// #138: the setup wizard API in-process, with the Discord calls replaced by
// doubles (setup mode never runs in mock mode, so the mock bot cannot help).
const tmpDir = createTempDir('setup-routes');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
delete process.env.DEV_MOCK;
for (const key of Object.keys(process.env)) {
    if (key === 'DATABASE_URL' || key.startsWith('PG') || key.startsWith('DISCORD_')) delete process.env[key];
}
for (const key of ['BASE_URL', 'TIMEZONE', 'SERVER_NAME', 'ADMIN_RESET_PASSWORD', 'SESSION_SECRET']) delete process.env[key];
process.env.SQLITE_PATH = path.join(tmpDir, 'setup-routes.sqlite');
process.env.SETUP_PIN = '12345678';

// The routes log every step. In this process stdout also carries the test
// runner's own messages; under load the log lines tore them apart
// ("Unable to deserialize cloned data"), so the logs stay silent here.
console.log = () => {};

const express = require('express');
const session = require('express-session');
const { db, doc, getDoc, deleteDoc } = require('../firebaseAdmin');
const systemConfig = require('../utils/systemConfig');
const setupState = require('../utils/setupState');
const privacy = require('../utils/privacyPolicy');
const { createSetupRouter } = require('../routes/setup');

const CLIENT_ID = '123456789012345678';
const GUILD_ID = '234567890123456789';
const MANAGED = Object.keys(systemConfig.MANAGED_KEYS);

// Discord doubles: every test sets the answers it needs
const discord = {};
function resetDiscord() {
    Object.assign(discord, {
        credentials: { ok: true },
        restart: { ok: true, guildName: 'Gilde' },
        guildName: 'Gilde',
        envAtRestart: null,
        restartCalls: 0
    });
}

const deps = {
    checkClientCredentials: async () => discord.credentials,
    restartBot: async (token) => {
        discord.restartCalls++;
        discord.envAtRestart = { token, guildId: process.env.DISCORD_GUILD_ID, tokenEnv: process.env.DISCORD_BOT_TOKEN };
        return discord.restart;
    },
    getGuildName: async () => discord.guildName,
    getGuildRoles: async () => [{ id: '345678901234567890', name: 'Admin', color: 0, managed: false }],
    getGuildChannels: async () => [{ id: '456789012345678901', name: 'ankündigungen', type: 'text' }],
    getGuildCategories: async () => [{ id: '567890123456789012', name: 'Events' }]
};

let server;
let baseUrl;
before(async () => {
    const app = express();
    app.use(express.json());
    app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
    app.get('/api/csrf-token', (req, res) => { req.session.touched = true; res.json({ token: 't' }); });
    app.use('/api/setup', createSetupRouter({ ...deps, unlockLimit: 1000 }));
    await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise(resolve => server.close(resolve)));

async function freshSetup(env = {}) {
    await deleteDoc(doc(db, 'systemSettings', 'config'));
    await deleteDoc(doc(db, 'privacyPolicy', 'current'));
    systemConfig.forgetSystemConfig();
    privacy.forgetPrivacyPolicy();
    for (const key of MANAGED) delete process.env[key];
    Object.assign(process.env, env);
    await systemConfig.loadSystemConfig();
    await setupState.initSetupState({ log: () => {} });
}

beforeEach(async () => {
    resetDiscord();
    await freshSetup();
});

const stored = async () => {
    const snap = await getDoc(doc(db, 'systemSettings', 'config'));
    return snap.exists() ? snap.data() : null;
};

async function unlockedClient() {
    const client = createClient(baseUrl);
    assert.equal((await client.send('POST', '/api/setup/unlock', { pin: '12345678' })).status, 200);
    return client;
}

const DISCORD_BODY = { clientId: CLIENT_ID, clientSecret: 'client-secret', botToken: 'bot-token', guildId: GUILD_ID };
const COMPLETE_BODY = {
    baseUrl: 'https://dems.example.org/', serverName: 'Gilde', timezone: 'Europe/Vienna',
    adminRoleId: '345678901234567890', announceChannelId: '456789012345678901', eventCategoryId: '',
    threadSync: false, adminResetPassword: 'ein-langes-passwort'
};

test('the Discord step stores the values, logs the bot in and lists roles and channels', async () => {
    const client = await unlockedClient();
    const res = await client.send('POST', '/api/setup/discord', DISCORD_BODY);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.guildName, 'Gilde');
    assert.equal(body.roles[0].name, 'Admin');
    assert.equal(body.channels[0].name, 'ankündigungen');
    assert.equal(body.categories[0].name, 'Events');

    // The bot logged in with the new values already in the environment (slash commands need them)
    assert.deepEqual(discord.envAtRestart, { token: 'bot-token', guildId: GUILD_ID, tokenEnv: 'bot-token' });
    assert.equal(process.env.DISCORD_CLIENT_ID, CLIENT_ID);
    const values = (await stored()).values;
    assert.equal(values.DISCORD_BOT_TOKEN, 'bot-token');
    assert.equal(values.DISCORD_GUILD_ID, GUILD_ID);
    assert.equal((await (await client.request('/api/setup/status')).json()).discordDone, true);
});

for (const [name, setup, pattern, status] of [
    ['a rejected client secret', () => { discord.credentials = { ok: false, error: 'invalid_client' }; }, /Client Secret.*Schritt 2/s, 400],
    ['a rejected bot token', () => { discord.restart = { ok: false, error: 'invalid_token' }; }, /Bot-Token.*Schritt 3/s, 400],
    ['the Server Members Intent switched off', () => { discord.restart = { ok: false, error: 'disallowed_intents' }; }, /Server Members Intent.*Schritt 3/s, 400],
    ['a bot that does not answer', () => { discord.restart = { ok: false, error: 'timeout' }; }, /Bot/, 502]
]) {
    test(`${name} is refused with a hint and nothing is stored`, async () => {
        setup();
        const client = await unlockedClient();
        const res = await client.send('POST', '/api/setup/discord', DISCORD_BODY);
        assert.equal(res.status, status);
        assert.match((await res.json()).error, pattern);
        assert.equal(process.env.DISCORD_CLIENT_ID, undefined);
        assert.equal(process.env.DISCORD_BOT_TOKEN, undefined);
        assert.equal(process.env.DISCORD_GUILD_ID, undefined);
        assert.equal((await stored())?.values?.DISCORD_BOT_TOKEN, undefined);
    });
}

test('a bot that is not on the guild gets the invite link', async () => {
    discord.guildName = '';
    const client = await unlockedClient();
    const res = await client.send('POST', '/api/setup/discord', DISCORD_BODY);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /Schritt 4/);
    assert.match(body.inviteUrl, new RegExp(`client_id=${CLIENT_ID}`));
    assert.equal(process.env.DISCORD_GUILD_ID, undefined);
});

test('invalid ids and missing secrets are refused before Discord is asked', async () => {
    const client = await unlockedClient();
    for (const body of [
        { ...DISCORD_BODY, clientId: '12' },
        { ...DISCORD_BODY, guildId: 'abc' },
        { ...DISCORD_BODY, clientSecret: '' },
        { ...DISCORD_BODY, botToken: '  ' }
    ]) {
        assert.equal((await client.send('POST', '/api/setup/discord', body)).status, 400);
    }
    assert.equal(discord.restartCalls, 0);
});

test('completing stores the values, ends setup mode and the setup session', async () => {
    const client = await unlockedClient();
    await client.send('POST', '/api/setup/discord', DISCORD_BODY);
    const res = await client.send('POST', '/api/setup/complete', { ...COMPLETE_BODY, privacyMarkdown: '# Datenschutz\n\nText' });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { success: true, restartRequired: false });

    assert.equal(setupState.isSetupRequired(), false);
    assert.equal(process.env.BASE_URL, 'https://dems.example.org');
    assert.equal(process.env.TIMEZONE, 'Europe/Vienna');
    assert.equal(process.env.DISCORD_ADMIN_ROLE_ID, '345678901234567890');
    assert.equal(process.env.ADMIN_RESET_PASSWORD, 'ein-langes-passwort');
    const saved = await stored();
    assert.equal(saved.setupSource, 'wizard');
    assert.equal((await privacy.getPrivacyPolicy()).version, 1);

    const status = await (await client.request('/api/setup/status')).json();
    assert.equal(status.required, false);
    assert.equal(status.unlocked, false);
    assert.equal((await client.send('POST', '/api/setup/unlock', { pin: '12345678' })).status, 409);
    assert.equal((await client.send('POST', '/api/setup/complete', COMPLETE_BODY)).status, 409);
});

test('thread sync in the wizard reports that a restart is needed', async () => {
    const client = await unlockedClient();
    await client.send('POST', '/api/setup/discord', DISCORD_BODY);
    const res = await client.send('POST', '/api/setup/complete', { ...COMPLETE_BODY, threadSync: true });
    assert.deepEqual(await res.json(), { success: true, restartRequired: true });
    assert.equal(process.env.DISCORD_THREAD_SYNC, 'true');
});

test('invalid server values are refused and setup mode continues', async () => {
    const client = await unlockedClient();
    await client.send('POST', '/api/setup/discord', DISCORD_BODY);
    for (const [change, pattern] of [
        [{ baseUrl: 'dems.example.org' }, /BASE_URL/],
        [{ baseUrl: 'ftp://dems.example.org' }, /BASE_URL/],
        [{ timezone: 'Mars/Olympus' }, /Zeitzone/],
        [{ adminResetPassword: 'kurz' }, /12 Zeichen/],
        [{ adminRoleId: 'admin' }, /Admin-Rolle/],
        [{ privacyMarkdown: 'x'.repeat(50001) }, /Datenschutz/]
    ]) {
        const res = await client.send('POST', '/api/setup/complete', { ...COMPLETE_BODY, ...change });
        assert.equal(res.status, 400, JSON.stringify(change));
        assert.match((await res.json()).error, pattern);
    }
    assert.equal(setupState.isSetupRequired(), true);
});

test('values from .env are reported locked and kept by the wizard', async () => {
    await freshSetup({ BASE_URL: 'https://from.env', DISCORD_CLIENT_ID: CLIENT_ID });
    const client = await unlockedClient();
    const status = await (await client.request('/api/setup/status')).json();
    assert.deepEqual(status.locked.sort(), ['BASE_URL', 'DISCORD_CLIENT_ID']);
    assert.equal(status.values.BASE_URL, 'https://from.env');
    assert.equal(status.values.DISCORD_CLIENT_ID, CLIENT_ID);

    await client.send('POST', '/api/setup/discord', { ...DISCORD_BODY, clientId: '999999999999999999' });
    assert.equal(process.env.DISCORD_CLIENT_ID, CLIENT_ID);
    await client.send('POST', '/api/setup/complete', { ...COMPLETE_BODY, baseUrl: 'https://other.example.org' });
    assert.equal(process.env.BASE_URL, 'https://from.env');
    assert.equal((await stored())?.values?.BASE_URL, undefined);
});

test('the status suggests BASE_URL from the request and the default time zone', async () => {
    const status = await (await createClient(baseUrl).request('/api/setup/status')).json();
    assert.equal(status.defaults.BASE_URL, baseUrl);
    assert.equal(status.defaults.TIMEZONE, 'Europe/Berlin');
    assert.equal(status.values, undefined);
});

test('going back to the Discord step keeps the stored secrets when their fields stay empty', async () => {
    const client = await unlockedClient();
    assert.equal((await client.send('POST', '/api/setup/discord', DISCORD_BODY)).status, 200);
    const again = await client.send('POST', '/api/setup/discord', { ...DISCORD_BODY, clientSecret: '', botToken: '' });
    assert.equal(again.status, 200);
    assert.equal(discord.envAtRestart.token, 'bot-token');
    assert.equal((await stored()).values.DISCORD_CLIENT_SECRET, 'client-secret');
});

test('in production over plain HTTP the status says that the setup needs HTTPS', async () => {
    const express = require('express');
    const session = require('express-session');
    const app = express();
    app.set('trust proxy', 1);
    app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
    app.use('/api/setup', createSetupRouter({ ...deps, isProduction: true }));
    const own = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    try {
        const url = `http://127.0.0.1:${own.address().port}/api/setup/status`;
        assert.equal((await (await fetch(url)).json()).httpsRequired, true);
        assert.equal((await (await fetch(url, { headers: { 'X-Forwarded-Proto': 'https' } })).json()).httpsRequired, false);
    } finally {
        await new Promise(resolve => own.close(resolve));
    }
    // Outside production (dev, tests) plain HTTP works
    assert.equal((await (await createClient(baseUrl).request('/api/setup/status')).json()).httpsRequired, false);
});
