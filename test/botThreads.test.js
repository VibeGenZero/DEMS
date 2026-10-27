const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir } = require('./helpers');

// Discussion thread of an event announcement (B-14) with the real helper of
// bot/threads.js against a fake Discord.
const tmpDir = createTempDir('bot-threads');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'threads.sqlite');

const bot = require('../bot');
const { client, state } = require('../bot/client');
const { ensureAnnouncementThread } = require('../bot/threads');

const ONE_WEEK_MINUTES = 10080;
const originalFetch = client.channels.fetch;
const sent = { channelId: 'chan1', messageId: 'msg1', guildId: 'guild1' };

after(async () => {
    client.channels.fetch = originalFetch;
    state.isReady = false;
    await bot.client.destroy();
});

/**
 * Fake Discord with one announcement channel. `threads` maps thread ids to
 * true (exists), 'gone' (Unknown Channel) or 'error' (another failure).
 */
function fakeDiscord({ threads = {}, startThreadFails = false } = {}) {
    const started = [];
    const message = {
        id: 'msg1',
        startThread: async (options) => {
            if (startThreadFails) throw Object.assign(new Error('Missing Permissions'), { code: 50013 });
            started.push(options);
            return { id: 'thread-new', guildId: 'guild1' };
        }
    };
    client.channels.fetch = async (id) => {
        if (id === 'chan1') return { id, guildId: 'guild1', messages: { fetch: async () => message } };
        if (threads[id] === true) return { id, guildId: 'guild1' };
        if (threads[id] === 'gone') throw Object.assign(new Error('Unknown Channel'), { code: 10003 });
        if (threads[id] === 'error') throw Object.assign(new Error('Service Unavailable'), { code: 0 });
        return null;
    };
    state.isReady = true;
    return started;
}

beforeEach(() => {
    client.channels.fetch = originalFetch;
    state.isReady = false;
});

test('a bot that is not ready opens no thread', async () => {
    assert.equal(await ensureAnnouncementThread(sent, 'Raid', null), null);
});

test('the first announcement opens a thread named after the event for one week', async () => {
    const started = fakeDiscord();
    const thread = await ensureAnnouncementThread(sent, 'Raid Night', null);
    assert.deepEqual(thread, { guildId: 'guild1', threadId: 'thread-new' });
    assert.deepEqual(started, [{ name: 'Raid Night', autoArchiveDuration: ONE_WEEK_MINUTES }]);
});

test('a long title is cut to Discord\'s 100 characters', async () => {
    const started = fakeDiscord();
    await ensureAnnouncementThread(sent, 'x'.repeat(150), null);
    assert.equal(started[0].name.length, 100);
});

test('an existing thread is kept and no second one is opened', async () => {
    const started = fakeDiscord({ threads: { 'thread-old': true } });
    const existing = { guildId: 'guild1', threadId: 'thread-old' };
    assert.equal(await ensureAnnouncementThread(sent, 'Raid', existing), existing);
    assert.deepEqual(started, []);
});

test('a deleted thread is replaced by a new one on the new message', async () => {
    for (const threads of [{ 'thread-old': 'gone' }, {}]) {
        const started = fakeDiscord({ threads });
        const thread = await ensureAnnouncementThread(sent, 'Raid', { guildId: 'guild1', threadId: 'thread-old' });
        assert.deepEqual(thread, { guildId: 'guild1', threadId: 'thread-new' });
        assert.equal(started.length, 1);
    }
});

test('another error while checking the thread keeps it, without a second thread', async () => {
    const started = fakeDiscord({ threads: { 'thread-old': 'error' } });
    const existing = { guildId: 'guild1', threadId: 'thread-old' };
    assert.equal(await ensureAnnouncementThread(sent, 'Raid', existing), existing);
    assert.deepEqual(started, []);
});

test('a refused thread is logged and gives no thread', async () => {
    fakeDiscord({ startThreadFails: true });
    const errors = [];
    const original = console.error;
    console.error = (...args) => errors.push(args.join(' '));
    try {
        assert.equal(await ensureAnnouncementThread(sent, 'Raid', null), null);
    } finally {
        console.error = original;
    }
    assert.ok(errors.some(line => line.includes('Missing Permissions')), errors.join('\n'));
});
