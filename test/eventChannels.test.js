const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { PermissionsBitField } = require('discord.js');
const { createTempDir } = require('./helpers');

// Mock mode with an own database; the real channel helpers run against a stubbed guild
const tmpDir = createTempDir('event-channels');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'channels.sqlite');

const bot = require('../bot');
const { db, doc, getDoc, setDoc } = require('../firebaseAdmin');
const realChannels = require('../bot/channels');
const { state: botState } = require('../bot/client');

after(async () => {
    await bot.client.destroy();
});

const BOT_ID = '300000000000000001';
const GUILD_ID = '300000000000000099';
const { Flags } = PermissionsBitField;
const missingAccess = () => Object.assign(new Error('Missing Access'), { code: 50001, status: 403 });

/**
 * Run fn with a ready bot whose guild records created channels; `deleteFails`
 * maps channel ids to the error their delete throws.
 */
async function withGuild(fn, { deleteFails = {} } = {}) {
    const created = [];
    const deleted = [];
    const sent = [];
    let next = 0;
    const channelStub = (id, options = {}) => ({
        id, ...options,
        permissionOverwrites: { async create() {} },
        async send(message) { sent.push([id, message]); },
        async delete() {
            if (deleteFails[id]) throw deleteFails[id];
            deleted.push(id);
        }
    });
    const guild = {
        id: GUILD_ID,
        channels: {
            async create(options) {
                const channel = channelStub(`chan-${++next}`, options);
                created.push(options);
                return channel;
            },
            async fetch(id) { return channelStub(id); }
        }
    };
    const originalFetch = bot.client.guilds.fetch;
    const originalUser = bot.client.user;
    const wasReady = botState.isReady;
    bot.client.guilds.fetch = async () => guild;
    bot.client.user = { id: BOT_ID };
    botState.isReady = true;
    try {
        return await fn({ created, deleted, sent });
    } finally {
        bot.client.guilds.fetch = originalFetch;
        bot.client.user = originalUser;
        botState.isReady = wasReady;
    }
}

/** Allowed permission bits of the overwrite for an id. */
function allowedFor(options, id) {
    const overwrite = (options.permissionOverwrites || []).find(entry => entry.id === id);
    return overwrite ? new PermissionsBitField(overwrite.allow || []) : null;
}

let counter = 0;
async function createEvent(fields) {
    const id = `channels-event-${++counter}`;
    const event = { title: `Event ${counter}`, status: 'active', startDate: new Date(Date.now() + 86_400_000).toISOString(), ...fields };
    await setDoc(doc(db, 'events', id), event);
    return { id, ...event };
}

test('the bot keeps access to the private channels it creates', async () => {
    const event = await createEvent({ channelConfig: { type: 'both' } });
    await withGuild(async ({ created, sent }) => {
        const result = await realChannels.createEventChannels(event);
        assert.ok(result.voiceId && result.textId);
        assert.equal(created.length, 2);
        for (const options of created) {
            const everyone = options.permissionOverwrites.find(entry => entry.id === GUILD_ID);
            assert.ok(new PermissionsBitField(everyone.deny).has(Flags.ViewChannel), 'hidden for @everyone');
            const own = allowedFor(options, BOT_ID);
            assert.ok(own, 'overwrite for the bot');
            for (const flag of [Flags.ViewChannel, Flags.SendMessages, Flags.Connect, Flags.ReadMessageHistory, Flags.EmbedLinks]) {
                assert.ok(own.has(flag), `bot may ${flag}`);
            }
        }
        assert.equal(sent.length, 1, 'the welcome embed is posted');
    });
});

test('the bot only grants itself rights it asks for in the invite', async () => {
    const { BOT_PERMISSIONS } = require('../utils/botPermissions');
    const invited = new PermissionsBitField(BOT_PERMISSIONS.map(entry => entry.flag));
    const event = await createEvent({ channelConfig: { type: 'voice' } });
    await withGuild(async ({ created }) => {
        await realChannels.createEventChannels(event);
        assert.ok(invited.has(allowedFor(created[0], BOT_ID)), 'Discord refuses overwrites with rights the bot does not have');
    });
});

/** Console lines of one level written while fn runs. */
async function capture(level, fn) {
    const lines = [];
    const original = console[level];
    console[level] = (...args) => { lines.push(args.map(String).join(' ')); };
    try {
        await fn();
    } finally {
        console[level] = original;
    }
    return lines.join('\n');
}

test('a channel the bot cannot reach is reported for manual deletion and forgotten', async () => {
    const event = await createEvent({ discordChannelId: 'old-voice', discordTextChannelId: 'old-text' });
    await withGuild(async ({ deleted }) => {
        let result;
        const warnings = await capture('warn', async () => { result = await realChannels.deleteEventChannels(event.id); });
        assert.equal(result, true);
        assert.deepEqual(deleted, ['old-text'], 'the reachable channel is still deleted');
        assert.match(warnings, /old-voice/);
        assert.match(warnings, /von Hand/);
    }, { deleteFails: { 'old-voice': missingAccess() } });
    const stored = (await getDoc(doc(db, 'events', event.id))).data();
    assert.deepEqual([stored.discordChannelId, stored.discordTextChannelId], [null, null]);
});

test('other delete errors keep the ids for a later try', async () => {
    const event = await createEvent({ discordChannelId: 'busy-voice' });
    await withGuild(async () => {
        const result = await capture('error', async () => {
            assert.equal(await realChannels.deleteEventChannels(event.id), false);
        });
        assert.match(result, /Failed to delete event channels/);
    }, { deleteFails: { 'busy-voice': Object.assign(new Error('Service unavailable'), { status: 503 }) } });
    assert.equal((await getDoc(doc(db, 'events', event.id))).data().discordChannelId, 'busy-voice');
});
