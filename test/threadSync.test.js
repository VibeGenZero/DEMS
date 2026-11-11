const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { PermissionsBitField, PermissionFlagsBits } = require('discord.js');
const { createTempDir } = require('./helpers');

// Mock mode with an own database; the empty cwd keeps a local .env out
const tmpDir = createTempDir('thread-sync');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'thread-sync.sqlite');

const bot = require('../bot');
const { db, doc, getDoc, setDoc } = require('../firebaseAdmin');
const {
    isThreadSyncEnabled, formatDiscordContent, webhookName, topLevelReplyTarget,
    findEventByThreadId, commentByDiscordMessageId, COMMENT_MAX_LENGTH
} = require('../utils/threadSync');

after(async () => {
    await bot.client.destroy();
});

const GUILD_ID = '100000000000000001';

async function seedEvent(id, threadId, fields = {}) {
    await setDoc(doc(db, 'events', id), {
        title: `Event ${id}`, status: 'active', startDate: new Date(Date.now() + 86400000).toISOString(),
        discordThread: threadId ? { guildId: GUILD_ID, threadId } : null, ...fields
    });
}

async function seedComment(id, fields) {
    await setDoc(doc(db, 'comments', id), {
        eventId: 'ev', userId: 'u1', userName: 'Lena', userAvatar: '', text: 'Hallo', isAdmin: false,
        replyTo: null, createdAt: new Date().toISOString(), ...fields
    });
}

const commentOf = async (id) => (await getDoc(doc(db, 'comments', id))).data();

// ── Switch and data side ────────────────────────────────────────────────

test('the sync follows DISCORD_THREAD_SYNC', () => {
    const saved = process.env.DISCORD_THREAD_SYNC;
    try {
        process.env.DISCORD_THREAD_SYNC = 'true';
        assert.equal(isThreadSyncEnabled(), true);
        process.env.DISCORD_THREAD_SYNC = 'false';
        assert.equal(isThreadSyncEnabled(), false);
        delete process.env.DISCORD_THREAD_SYNC;
        assert.equal(isThreadSyncEnabled(), false);
    } finally {
        process.env.DISCORD_THREAD_SYNC = saved;
    }
});

test('Discord markup becomes readable text', () => {
    const names = {
        users: { '200000000000000002': 'Lena' },
        roles: { '300000000000000001': 'Raider' },
        channels: { '400000000000000001': 'events' }
    };
    const text = formatDiscordContent({
        content: '<@200000000000000002> und <@!200000000000000002>, <@&300000000000000001> in <#400000000000000001> <:pog:123> <a:dance:456> <@999>',
        names,
        attachments: ['https://cdn.discordapp.com/attachments/1/2/bild.png']
    });
    assert.equal(text, '@Lena und @Lena, @Raider in #events :pog: :dance: @unbekannt\nhttps://cdn.discordapp.com/attachments/1/2/bild.png');
});

test('long Discord messages are cut to the comment limit, empty ones stay empty', () => {
    const long = formatDiscordContent({ content: 'a'.repeat(1800) });
    assert.equal(COMMENT_MAX_LENGTH, 1000);
    assert.equal(long.length, 1000);
    assert.ok(long.endsWith('…'));
    assert.equal(formatDiscordContent({ content: '   ' }), '');
    assert.equal(formatDiscordContent({}), '');
    assert.equal(formatDiscordContent({ content: '', attachments: ['https://x.example/a.png'] }), 'https://x.example/a.png');
});

test('webhook names carry "(Web)" and never the word discord', () => {
    assert.equal(webhookName('Lena'), 'Lena (Web)');
    assert.equal(webhookName('DiscordFan'), 'Fan (Web)');
    assert.equal(webhookName('  '), 'Mitglied (Web)');
    assert.equal(webhookName('discord'), 'Mitglied (Web)');
    assert.ok(webhookName('x'.repeat(200)).length <= 80);
    assert.ok(webhookName('x'.repeat(200)).endsWith(' (Web)'));
});

test('a reply attaches to the top comment of its conversation', () => {
    assert.equal(topLevelReplyTarget({ id: 'top', replyTo: null }), 'top');
    assert.equal(topLevelReplyTarget({ id: 'reply', replyTo: 'top' }), 'top');
});

test('the event of a discussion thread is found, other threads are not', async () => {
    await seedEvent('ev-thread', '130000000000000101');
    await seedEvent('ev-nothread', null);

    const found = await findEventByThreadId('130000000000000101');
    assert.equal(found.id, 'ev-thread');
    assert.equal(found.event.title, 'Event ev-thread');
    assert.equal(await findEventByThreadId('130000000000000999'), null);

    // A thread that changed is not served from the cache
    await seedEvent('ev-thread', '130000000000000102');
    assert.equal(await findEventByThreadId('130000000000000101'), null);
    assert.equal((await findEventByThreadId('130000000000000102')).id, 'ev-thread');
});

test('a comment is found by its Discord message', async () => {
    await seedComment('c-mirrored', { discordMessageId: '140000000000000001' });

    const found = await commentByDiscordMessageId('140000000000000001');
    assert.equal(found.id, 'c-mirrored');
    assert.equal(found.data.text, 'Hallo');
    assert.equal(await commentByDiscordMessageId('140000000000000999'), null);
    assert.equal((await commentOf('c-mirrored')).discordMessageId, '140000000000000001');
});

// ── Intent only with the switch ─────────────────────────────────────────

const { runNode, parseLastLine, repoPath } = require('./helpers');

/** Intents and partials of a freshly loaded client in a child process. */
function clientOptions(env, { mock = false } = {}) {
    const code = `
        ${mock ? `require(${repoPath('dev/mockMode.js')});` : ''}
        const { client } = require(${repoPath('bot/client.js')});
        const { GatewayIntentBits, Partials } = require(${JSON.stringify(require.resolve('discord.js'))});
        console.log(JSON.stringify({
            content: client.options.intents.has(GatewayIntentBits.MessageContent),
            partial: (client.options.partials || []).includes(Partials.Message),
            sync: process.env.DISCORD_THREAD_SYNC || ''
        }));
        client.destroy();`;
    const result = runNode(code, env);
    assert.equal(result.status, 0, result.stderr);
    return parseLastLine(result.stdout);
}

test('the Message Content intent is requested only with DISCORD_THREAD_SYNC=true', () => {
    assert.deepEqual(clientOptions({ DISCORD_THREAD_SYNC: 'true' }), { content: true, partial: true, sync: 'true' });
    assert.deepEqual(clientOptions({}), { content: false, partial: false, sync: '' });
    assert.deepEqual(clientOptions({ DISCORD_THREAD_SYNC: 'false' }), { content: false, partial: false, sync: 'false' });
});

test('dev mock mode switches the sync on unless it is set', () => {
    const tmp = createTempDir('thread-sync-mock');
    const mockEnv = { DEV_MOCK: 'true', DEV_SQLITE_PATH: path.join(tmp, 'm.sqlite') };
    assert.equal(clientOptions(mockEnv, { mock: true }).sync, 'true');
    assert.equal(clientOptions({ ...mockEnv, DISCORD_THREAD_SYNC: 'false' }, { mock: true }).sync, 'false');
});

// ── Website → thread: payload and webhook ───────────────────────────────

const { buildThreadPost, postWithWebhook, clearWebhookCache } = require('../bot/threadSync');

const THREAD = { guildId: GUILD_ID, threadId: '130000000000000201' };

test('a website comment is posted as „<Name> (Web)“ without pings', () => {
    const post = buildThreadPost(
        { text: 'Bin dabei! @everyone', userName: 'Lena', userAvatar: 'https://cdn.discordapp.com/avatars/2/a.png' },
        { discordThread: THREAD }
    );
    assert.equal(post.content, 'Bin dabei! @everyone');
    assert.equal(post.username, 'Lena (Web)');
    assert.equal(post.avatarURL, 'https://cdn.discordapp.com/avatars/2/a.png');
    assert.equal(post.threadId, THREAD.threadId);
    assert.deepEqual(post.allowedMentions, { parse: [] });

    const noAvatar = buildThreadPost({ text: 'x', userName: 'Tom', userAvatar: '/img/default.png' }, { discordThread: THREAD });
    assert.equal(noAvatar.avatarURL, undefined, 'only absolute https avatars');
});

test('a website reply names the answered comment and links its message', () => {
    const event = { discordThread: THREAD };
    const withLink = buildThreadPost({ text: 'Ich!', userName: 'Tom' }, event, { userName: 'Kira', discordMessageId: '140000000000000301' });
    assert.equal(withLink.content, `-# ↪ Antwort an **Kira** · https://discord.com/channels/${GUILD_ID}/${THREAD.threadId}/140000000000000301\nIch!`);

    const withoutLink = buildThreadPost({ text: 'Ich!', userName: 'Tom' }, event, { userName: 'Kira' });
    assert.equal(withoutLink.content, '-# ↪ Antwort an **Kira**\nIch!');
});

/** A channel stub with webhooks; `failFirstSend` makes the first webhook answer "Unknown Webhook". */
function stubChannel({ webhooks = [], failFirstSend = false } = {}) {
    const calls = [];
    let failed = !failFirstSend;
    const makeWebhook = (id, ownerId) => ({
        id, owner: { id: ownerId }, token: `token-${id}`,
        async send(payload) {
            calls.push(['send', id, payload]);
            if (!failed) { failed = true; const err = new Error('Unknown Webhook'); err.code = 10015; throw err; }
            return { id: `msg-${id}` };
        }
    });
    const existing = webhooks.map(([id, ownerId]) => makeWebhook(id, ownerId));
    let created = 0;
    return {
        id: `channel-${Math.random()}`, calls,
        async fetchWebhooks() { calls.push(['fetchWebhooks']); return new Map(existing.map(hook => [hook.id, hook])); },
        async createWebhook(options) { calls.push(['createWebhook', options.name]); const hook = makeWebhook(`new-${++created}`, 'bot'); existing.push(hook); return hook; }
    };
}

test('the bot uses its own webhook and creates one when there is none', async () => {
    clearWebhookCache();
    const own = stubChannel({ webhooks: [['other', 'someone'], ['mine', 'bot']] });
    assert.equal((await postWithWebhook(own, 'bot', { content: 'a' })).id, 'msg-mine');
    assert.equal((await postWithWebhook(own, 'bot', { content: 'b' })).id, 'msg-mine');
    assert.equal(own.calls.filter(([name]) => name === 'fetchWebhooks').length, 1, 'cached');

    const none = stubChannel({ webhooks: [['other', 'someone']] });
    assert.equal((await postWithWebhook(none, 'bot', { content: 'a' })).id, 'msg-new-1');
    assert.deepEqual(none.calls.find(([name]) => name === 'createWebhook'), ['createWebhook', 'DEMS Kommentare']);
});

test('a deleted webhook is replaced once', async () => {
    clearWebhookCache();
    const channel = stubChannel({ webhooks: [['mine', 'bot']], failFirstSend: true });
    const message = await postWithWebhook(channel, 'bot', { content: 'a' });
    assert.ok(message, 'second try worked');
    assert.equal(channel.calls.filter(([name]) => name === 'send').length, 2);
});

// ── Website → thread: mirroring (mock twin) ─────────────────────────────

/** Run fn and return the console lines it printed. */
async function captureLog(fn) {
    const lines = [];
    const original = console.log;
    console.log = (...args) => { lines.push(args.join(' ')); };
    try {
        await fn();
    } finally {
        console.log = original;
    }
    return lines;
}

test('the mock twin posts a website comment as „<Name> (Web)“ and remembers the message', async () => {
    await seedEvent('mirror-ev', '130000000000000301', { title: 'Raid-Abend' });
    await seedComment('mirror-c', { eventId: 'mirror-ev', text: 'Bin dabei!', source: 'web' });

    let messageId;
    const lines = await captureLog(async () => { messageId = await bot.mirrorCommentToThread('mirror-c'); });

    assert.match(messageId, /^\d+$/);
    assert.equal((await commentOf('mirror-c')).discordMessageId, messageId);
    assert.ok(lines.some(line => line.includes('Raid-Abend') && line.includes('Lena (Web)') && line.includes('Bin dabei!')), 'mock log');
    assert.equal(await bot.mirrorCommentToThread('mirror-c'), null, 'never twice');
});

test('the mock twin does nothing without thread, for Discord comments or with the sync off', async () => {
    await seedEvent('mirror-nothread', null);
    await seedComment('mirror-c2', { eventId: 'mirror-nothread' });
    await seedEvent('mirror-ev2', '130000000000000302');
    await seedComment('mirror-c3', { eventId: 'mirror-ev2', source: 'discord', discordMessageId: '140000000000000302' });
    await seedComment('mirror-c4', { eventId: 'mirror-ev2' });

    assert.equal(await bot.mirrorCommentToThread('mirror-c2'), null);
    assert.equal(await bot.mirrorCommentToThread('mirror-c3'), null);
    assert.equal(await bot.mirrorCommentToThread('mirror-missing'), null);
    const saved = process.env.DISCORD_THREAD_SYNC;
    process.env.DISCORD_THREAD_SYNC = 'false';
    try {
        assert.equal(await bot.mirrorCommentToThread('mirror-c4'), null);
    } finally {
        process.env.DISCORD_THREAD_SYNC = saved;
    }
    assert.equal((await commentOf('mirror-c4')).discordMessageId, undefined);
});

// ── Thread → website ────────────────────────────────────────────────────

const { handleThreadMessage } = require('../bot/threadSync');
const { collection, getDocs } = require('../firebaseAdmin');

const SYNC_THREAD = '130000000000000401';
const ADMIN_ROLE = process.env.DISCORD_ADMIN_ROLE_ID;
let messageCounter = 0;

/** A Discord message stub as discord.js delivers it. */
function fakeMessage(fields = {}) {
    const {
        id = `17000000000000${String(++messageCounter).padStart(4, '0')}`, content = 'Hallo Thread',
        authorId = '200000000000000005', displayName = 'Kira', roles = [], permissions = null, bot = false, webhookId = null,
        system = false, threadId = SYNC_THREAD, isThread = true, mentions = {}, attachments = [], replyTo = null
    } = fields;
    return {
        id, content, system, webhookId, createdAt: new Date('2026-10-31T18:00:00.000Z'),
        channelId: threadId,
        channel: { id: threadId, isThread: () => isThread },
        author: { id: authorId, bot, username: displayName.toLowerCase(), globalName: displayName, displayAvatarURL: () => `https://cdn.discordapp.com/avatars/${authorId}/a.png` },
        member: { displayName, roles: { cache: new Map(roles.map(role => [role, { id: role }])) }, permissions, displayAvatarURL: () => `https://cdn.discordapp.com/guilds/1/users/${authorId}/avatars/m.png` },
        mentions: {
            users: new Map(Object.entries(mentions.users || {}).map(([userId, name]) => [userId, { id: userId, username: name, globalName: name }])),
            members: new Map(),
            roles: new Map(Object.entries(mentions.roles || {}).map(([roleId, name]) => [roleId, { id: roleId, name }])),
            channels: new Map(Object.entries(mentions.channels || {}).map(([channelId, name]) => [channelId, { id: channelId, name }]))
        },
        attachments: new Map(attachments.map((url, index) => [String(index), { url }])),
        reference: replyTo ? { messageId: replyTo } : null
    };
}

async function commentsOfEvent(eventId) {
    return (await getDocs(collection(db, 'comments'))).docs.map(d => ({ id: d.id, ...d.data() })).filter(c => c.eventId === eventId);
}

test('a member message in the thread becomes a comment with the Discord mark', async () => {
    await seedEvent('sync-in', SYNC_THREAD);

    const commentId = await handleThreadMessage(fakeMessage({ id: '150000000000000001', content: 'Wer bringt Snacks?' }));

    const comment = await commentOf(commentId);
    assert.deepEqual(
        [comment.eventId, comment.userId, comment.userName, comment.text, comment.source, comment.discordMessageId, comment.isAdmin, comment.replyTo],
        ['sync-in', '200000000000000005', 'Kira', 'Wer bringt Snacks?', 'discord', '150000000000000001', false, null]
    );
    assert.equal(comment.userAvatar, 'https://cdn.discordapp.com/guilds/1/users/200000000000000005/avatars/m.png');
    assert.equal(comment.createdAt, '2026-10-31T18:00:00.000Z');
});

test('admins get the badge, mentions and attachments are converted', async () => {
    const adminComment = await commentOf(await handleThreadMessage(fakeMessage({ roles: [ADMIN_ROLE], displayName: 'Mori' })));
    assert.equal(adminComment.isAdmin, true);
    const administrator = new PermissionsBitField(PermissionFlagsBits.Administrator);
    const ownerComment = await commentOf(await handleThreadMessage(fakeMessage({ permissions: administrator, displayName: 'Owner' })));
    assert.equal(ownerComment.isAdmin, true, 'Discord Administrator without the admin role');

    const converted = await commentOf(await handleThreadMessage(fakeMessage({
        content: '<@200000000000000002> schau mal',
        mentions: { users: { '200000000000000002': 'Lena' } },
        attachments: ['https://cdn.discordapp.com/attachments/1/2/bild.png']
    })));
    assert.equal(converted.text, '@Lena schau mal\nhttps://cdn.discordapp.com/attachments/1/2/bild.png');
});

test('bots, webhooks, system messages, other threads and empty messages create nothing', async () => {
    await seedEvent('sync-other', '130000000000000402');
    const before = (await commentsOfEvent('sync-in')).length;
    const ignored = [
        fakeMessage({ bot: true }),
        fakeMessage({ webhookId: '160000000000000001' }),
        fakeMessage({ system: true }),
        fakeMessage({ threadId: '130000000000000499' }),
        fakeMessage({ isThread: false }),
        fakeMessage({ content: '   ' })
    ];
    for (const message of ignored) assert.equal(await handleThreadMessage(message), null);
    assert.equal((await commentsOfEvent('sync-in')).length, before);
});

test('the same message twice creates one comment', async () => {
    const message = fakeMessage({ id: '150000000000000099' });
    assert.ok(await handleThreadMessage(message));
    assert.equal(await handleThreadMessage(message), null);
    assert.equal((await commentsOfEvent('sync-in')).filter(c => c.discordMessageId === '150000000000000099').length, 1);
});

test('Discord replies attach to the top comment, unknown ones stay top comments', async () => {
    await seedComment('sync-top', { eventId: 'sync-in', source: 'web', discordMessageId: '150000000000000201' });
    await seedComment('sync-reply', { eventId: 'sync-in', source: 'web', replyTo: 'sync-top', discordMessageId: '150000000000000202' });

    const toTop = await commentOf(await handleThreadMessage(fakeMessage({ replyTo: '150000000000000201' })));
    const toReply = await commentOf(await handleThreadMessage(fakeMessage({ replyTo: '150000000000000202' })));
    const toUnknown = await commentOf(await handleThreadMessage(fakeMessage({ replyTo: '150000000000000299' })));

    assert.deepEqual([toTop.replyTo, toReply.replyTo, toUnknown.replyTo], ['sync-top', 'sync-top', null]);
});

test('the bot client turns thread messages into comments', async () => {
    await seedEvent('sync-wired', '130000000000000403');
    bot.client.emit('messageCreate', fakeMessage({ id: '150000000000000301', threadId: '130000000000000403', content: 'Über den Listener' }));
    const start = Date.now();
    let comments = [];
    while (comments.length === 0 && Date.now() - start < 3000) {
        comments = await commentsOfEvent('sync-wired');
        if (comments.length === 0) await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(comments[0]?.text, 'Über den Listener');
});

// ── Edits and deletions in Discord ──────────────────────────────────────

const { handleThreadMessageUpdate, handleThreadMessageDelete } = require('../bot/threadSync');

test('a Discord edit updates the comment and marks it edited', async () => {
    const commentId = await handleThreadMessage(fakeMessage({ id: '150000000000000501', content: 'Wer bringt Snacks?' }));

    // A partial old message is fine; the new one is fetched when partial
    const edited = { ...fakeMessage({ id: '150000000000000501', content: 'Wer bringt Getränke?' }), partial: true };
    edited.fetch = async () => ({ ...edited, partial: false });
    assert.equal(await handleThreadMessageUpdate({ id: '150000000000000501', partial: true }, edited), commentId);

    const comment = await commentOf(commentId);
    assert.equal(comment.text, 'Wer bringt Getränke?');
    assert.ok(comment.editedAt);
});

test('an edit to empty text, an unchanged text or an unknown message changes nothing', async () => {
    const commentId = await handleThreadMessage(fakeMessage({ id: '150000000000000502', content: 'Bleibt' }));

    assert.equal(await handleThreadMessageUpdate(null, fakeMessage({ id: '150000000000000502', content: '  ' })), null);
    assert.equal(await handleThreadMessageUpdate(null, fakeMessage({ id: '150000000000000502', content: 'Bleibt' })), null, 'e.g. a link preview');
    assert.equal(await handleThreadMessageUpdate(null, fakeMessage({ id: '150000000000000599', content: 'Neu' })), null);
    const comment = await commentOf(commentId);
    assert.deepEqual([comment.text, comment.editedAt], ['Bleibt', undefined]);
});

test('an edit of the bot\'s own webhook copy never changes the website comment', async () => {
    await seedComment('sync-web-copy', { eventId: 'sync-in', source: 'web', text: 'Original', discordMessageId: '150000000000000503' });
    assert.equal(await handleThreadMessageUpdate(null, fakeMessage({ id: '150000000000000503', content: 'Anders', webhookId: '160000000000000001' })), null);
    assert.equal((await commentOf('sync-web-copy')).text, 'Original');
});

test('deleting a mirrored message in Discord deletes its comment', async () => {
    const fromDiscord = await handleThreadMessage(fakeMessage({ id: '150000000000000601' }));
    await seedComment('sync-web-deleted', { eventId: 'sync-in', source: 'web', discordMessageId: '150000000000000602' });

    assert.equal(await handleThreadMessageDelete({ id: '150000000000000601', partial: true }), fromDiscord);
    assert.equal(await handleThreadMessageDelete({ id: '150000000000000602' }), 'sync-web-deleted');
    assert.equal(await handleThreadMessageDelete({ id: '150000000000000699' }), null);

    assert.equal((await getDoc(doc(db, 'comments', fromDiscord))).exists(), false);
    assert.equal((await getDoc(doc(db, 'comments', 'sync-web-deleted'))).exists(), false);
});

// ── Deletions from the website ──────────────────────────────────────────

const realSync = require('../bot/threadSync');
const { state: botState } = require('../bot/client');

test('the mock twin removes the thread copy of a mirrored comment only', async () => {
    const event = { title: 'Raid-Abend', discordThread: { guildId: GUILD_ID, threadId: '130000000000000701' } };
    let result;
    const lines = await captureLog(async () => { result = await bot.deleteMirroredMessage({ id: 'c', discordMessageId: '150000000000000701' }, event); });
    assert.equal(result, true);
    assert.ok(lines.some(line => line.includes('150000000000000701') && line.includes('gelöscht')));

    assert.equal(await bot.deleteMirroredMessage({ id: 'c' }, event), false, 'never mirrored');
    assert.equal(await bot.deleteMirroredMessage({ id: 'c', discordMessageId: '1' }, { discordThread: null }), false);
});

/** Run fn with a ready bot whose channel fetch returns the given stubs. */
async function withStubbedClient(channels, fn) {
    const originalFetch = bot.client.channels.fetch;
    const originalUser = bot.client.user;
    const wasReady = botState.isReady;
    bot.client.channels.fetch = async (id) => channels[id];
    bot.client.user = { id: 'bot' };
    botState.isReady = true;
    realSync.clearWebhookCache();
    try {
        return await fn();
    } finally {
        bot.client.channels.fetch = originalFetch;
        bot.client.user = originalUser;
        botState.isReady = wasReady;
        realSync.clearWebhookCache();
    }
}

test('the real deletion uses the webhook for website comments and the thread for Discord comments', async () => {
    const calls = [];
    const webhook = { id: 'hook', owner: { id: 'bot' }, token: 't', async deleteMessage(id, threadId) { calls.push(['webhook', id, threadId]); } };
    const parent = { id: 'parent', async fetchWebhooks() { return new Map([['hook', webhook]]); } };
    const thread = { id: 'thread-1', parent, parentId: 'parent', messages: { async delete(id) { calls.push(['thread', id]); } } };
    const event = { discordThread: { guildId: GUILD_ID, threadId: 'thread-1' } };

    await withStubbedClient({ 'thread-1': thread, parent }, async () => {
        assert.equal(await realSync.deleteMirroredMessage({ source: 'web', discordMessageId: 'm-web' }, event), true);
        assert.equal(await realSync.deleteMirroredMessage({ source: 'discord', discordMessageId: 'm-discord' }, event), true);
    });
    assert.deepEqual(calls, [['webhook', 'm-web', 'thread-1'], ['thread', 'm-discord']]);
});

test('a refused deletion is logged and answers false', async () => {
    const thread = { id: 'thread-2', messages: { async delete() { const err = new Error('Missing Permissions'); err.code = 50013; throw err; } } };
    const event = { discordThread: { guildId: GUILD_ID, threadId: 'thread-2' } };
    const errors = [];
    const originalError = console.error;
    console.error = (...args) => errors.push(args.join(' '));
    try {
        await withStubbedClient({ 'thread-2': thread }, async () => {
            assert.equal(await realSync.deleteMirroredMessage({ source: 'discord', discordMessageId: 'm' }, event), false);
        });
    } finally {
        console.error = originalError;
    }
    assert.ok(errors.some(line => line.includes('Missing Permissions')));
});

// ── Helpful log on missing permissions ──────────────────────────────────

/** Run fn and return the console.error lines it printed. */
async function captureErrors(fn) {
    const errors = [];
    const original = console.error;
    console.error = (...args) => errors.push(args.join(' '));
    try {
        await fn();
    } finally {
        console.error = original;
    }
    return errors;
}

const missingPermissions = () => Object.assign(new Error('Missing Permissions'), { code: 50013 });

test('a mirror without "Webhooks verwalten" names the right, the channel and the fix', async () => {
    await seedEvent('perm-ev', 'thread-perm-1');
    await seedComment('perm-c', { eventId: 'perm-ev', source: 'web' });
    const parent = { id: 'parent-perm', name: 'events', isThread: () => false, async fetchWebhooks() { throw missingPermissions(); } };
    const thread = { id: 'thread-perm-1', name: 'Raid', parent, parentId: 'parent-perm', isThread: () => true };

    let result;
    const errors = await captureErrors(() => withStubbedClient({ 'thread-perm-1': thread, 'parent-perm': parent }, async () => {
        result = await realSync.mirrorCommentToThread('perm-c');
    }));

    assert.equal(result, null);
    const line = errors.join('\n');
    assert.match(line, /„Webhooks verwalten“/);
    assert.match(line, /#events/);
    assert.match(line, /Invite-Link/);
    assert.match(line, /Missing Permissions/, 'keeps the Discord message');
});

test('deleting a member message without "Nachrichten verwalten" names that right', async () => {
    const thread = { id: 'thread-perm-2', name: 'Raid', isThread: () => true, messages: { async delete() { throw missingPermissions(); } } };
    const event = { discordThread: { guildId: GUILD_ID, threadId: 'thread-perm-2' } };

    const errors = await captureErrors(() => withStubbedClient({ 'thread-perm-2': thread }, async () => {
        assert.equal(await realSync.deleteMirroredMessage({ source: 'discord', discordMessageId: 'm' }, event), false);
    }));

    const line = errors.join('\n');
    assert.match(line, /„Nachrichten verwalten“/);
    assert.match(line, /Thread „Raid“/);
});

test('other Discord errors keep the short log line', async () => {
    const thread = { id: 'thread-perm-3', isThread: () => true, messages: { async delete() { throw Object.assign(new Error('Internal Server Error'), { code: 0 }); } } };
    const event = { discordThread: { guildId: GUILD_ID, threadId: 'thread-perm-3' } };

    const errors = await captureErrors(() => withStubbedClient({ 'thread-perm-3': thread }, async () => {
        await realSync.deleteMirroredMessage({ source: 'discord', discordMessageId: 'm' }, event);
    }));

    assert.equal(errors.length, 1);
    assert.match(errors[0], /Internal Server Error/);
    assert.doesNotMatch(errors[0], /verwalten/);
});
