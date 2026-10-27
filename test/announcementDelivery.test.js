const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir } = require('./helpers');

// Posting and refreshing V2 announcements with the real helpers of
// bot/messages.js against a fake Discord (B-05). bot.js is loaded first so the
// mock environment (own SQLite database) is in place.
const tmpDir = createTempDir('announcement-delivery');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'delivery.sqlite');

const bot = require('../bot');
const { client, state } = require('../bot/client');
const messages = require('../bot/messages');
const { db, doc, setDoc, getDoc } = require('../firebaseAdmin');

const IS_COMPONENTS_V2 = 1 << 15;
const originalFetch = client.channels.fetch;

after(async () => {
    client.channels.fetch = originalFetch;
    state.isReady = false;
    await bot.client.destroy();
});

/**
 * Fake Discord: channels with stored messages; records every send and edit.
 * A message id listed in `gone` answers "Unknown Message", one in `broken` a
 * different error.
 */
function fakeDiscord({ messageContent = {}, gone = [], broken = [] } = {}) {
    const calls = { sent: [], edited: [] };
    const channel = {
        id: 'chan1',
        guildId: 'guild1',
        send: async (payload) => {
            calls.sent.push(payload);
            return { id: `m${calls.sent.length}` };
        },
        messages: {
            fetch: async (messageId) => {
                if (gone.includes(messageId)) throw Object.assign(new Error('Unknown Message'), { code: 10008 });
                return {
                    id: messageId,
                    content: messageContent[messageId] || '',
                    edit: async (payload) => {
                        if (broken.includes(messageId)) throw Object.assign(new Error('Invalid Form Body'), { code: 50035 });
                        calls.edited.push({ messageId, payload });
                    }
                };
            }
        }
    };
    client.channels.fetch = async (id) => (id === 'chan1' ? channel : null);
    state.isReady = true;
    return calls;
}

beforeEach(() => {
    client.channels.fetch = originalFetch;
    state.isReady = false;
});

const textsOf = (payload) => payload.components.map(c => (c.toJSON ? c.toJSON() : c)).filter(c => c.type === 10).map(c => c.content);

test('sendChannelMessage posts the V2 payload with the chosen mentions and returns ids with the server', async () => {
    const calls = fakeDiscord();
    const payload = bot.buildEventAnnouncement({ title: 'Raid', status: 'active' }, 'ev1', undefined, '<@&r1>\n@everyone');
    const sent = await messages.sendChannelMessage('chan1', payload, { roleIds: ['r1'], pingEveryone: true });

    assert.deepEqual(sent, { channelId: 'chan1', messageId: 'm1', guildId: 'guild1' });
    const [posted] = calls.sent;
    assert.equal(posted.flags, IS_COMPONENTS_V2);
    assert.equal(posted.content, undefined);
    assert.equal(posted.embeds, undefined);
    assert.deepEqual(posted.allowedMentions, { parse: ['everyone', 'roles'], roles: ['r1'] });
    assert.deepEqual(textsOf(posted)[0], '<@&r1>\n@everyone');
});

test('without @everyone only the chosen roles may be pinged', async () => {
    const calls = fakeDiscord();
    await messages.sendChannelMessage('chan1', bot.buildEventAnnouncement({ title: 'Raid' }, 'ev1'), {});
    assert.deepEqual(calls.sent[0].allowedMentions, { parse: ['roles'], roles: [] });
});

test('sendChannelMessage answers false for an unknown channel', async () => {
    fakeDiscord();
    assert.equal(await messages.sendChannelMessage('nope', bot.buildEventAnnouncement({ title: 'Raid' }, 'ev1')), false);
});

test('editStoredMessages builds one payload per record and replaces content and embeds', async () => {
    const calls = fakeDiscord();
    const records = [{ channelId: 'chan1', messageId: 'a', intro: 'A' }, { channelId: 'chan1', messageId: 'b', intro: '' }];
    const kept = await messages.editStoredMessages(records, (record) => ({ flags: IS_COMPONENTS_V2, components: [{ type: 10, content: record.intro || '-' }] }));

    assert.deepEqual(kept, records);
    assert.deepEqual(calls.edited.map(edit => edit.payload.components[0].content), ['A', '-']);
    for (const { payload } of calls.edited) {
        assert.equal(payload.content, null);
        assert.deepEqual(payload.embeds, []);
        assert.deepEqual(payload.allowedMentions, { parse: [] });
        assert.equal(payload.flags, IS_COMPONENTS_V2);
    }
});

test('an old record without intro takes the message text as intro', async () => {
    const calls = fakeDiscord({ messageContent: { old: '<@&r9>\nHallo' } });
    const seen = [];
    const kept = await messages.editStoredMessages([{ channelId: 'chan1', messageId: 'old' }], (record) => {
        seen.push(record.intro);
        return { components: [] };
    });
    assert.deepEqual(seen, ['<@&r9>\nHallo']);
    assert.deepEqual(kept, [{ channelId: 'chan1', messageId: 'old', intro: '<@&r9>\nHallo' }]);
    assert.equal(calls.edited.length, 1);
});

test('a deleted message is dropped; any other error keeps the record unchanged', async () => {
    fakeDiscord({ gone: ['gone'], broken: ['broken'], messageContent: { broken: 'alt' } });
    const records = [
        { channelId: 'chan1', messageId: 'gone', intro: '' },
        { channelId: 'chan1', messageId: 'broken' },
        { channelId: 'chan1', messageId: 'fine', intro: '' }
    ];
    const kept = await messages.editStoredMessages(records, () => ({ components: [] }));
    assert.deepEqual(kept, [{ channelId: 'chan1', messageId: 'broken' }, { channelId: 'chan1', messageId: 'fine', intro: '' }]);
});

test('refreshEventAnnouncements re-renders every record with its intro and stores converted records', async () => {
    await setDoc(doc(db, 'events', 'refresh1'), {
        title: 'Refresh-Abend',
        status: 'active',
        maxParticipants: 5,
        announcements: [
            { channelId: 'chan1', messageId: 'new', intro: '<@&r1>' },
            { channelId: 'chan1', messageId: 'old' },
            { channelId: 'chan1', messageId: 'gone', intro: '' }
        ]
    });
    const calls = fakeDiscord({ gone: ['gone'], messageContent: { old: '@everyone\nAlt' } });

    assert.equal(await messages.refreshEventAnnouncements('refresh1'), true);

    const byId = Object.fromEntries(calls.edited.map(edit => [edit.messageId, edit.payload]));
    assert.deepEqual(Object.keys(byId).sort(), ['new', 'old']);
    assert.equal(textsOf(byId.new)[0], '<@&r1>');
    assert.equal(textsOf(byId.old)[0], '@everyone\nAlt');
    assert.ok(JSON.stringify(byId.new.components.map(c => c.toJSON())).includes('Refresh-Abend'));

    const stored = (await getDoc(doc(db, 'events', 'refresh1'))).data().announcements;
    assert.deepEqual(stored, [
        { channelId: 'chan1', messageId: 'new', intro: '<@&r1>' },
        { channelId: 'chan1', messageId: 'old', intro: '@everyone\nAlt' }
    ]);
});

test('posted polls are re-rendered with their intro, and a deleted poll drops it', async () => {
    const polls = require('../bot/polls');
    await setDoc(doc(db, 'polls', 'poll1'), {
        title: 'Termin-Suche', description: '', status: 'open', deadline: '', accessMode: 'open', requiredRoles: [],
        options: [{ id: 'aaaaaaaa', startDate: '2099-10-11T18:00:00.000Z', endDate: '' }], winnerOptionId: '', eventId: '',
        announcements: [{ channelId: 'chan1', messageId: 'p-new', intro: '<@&r2>' }, { channelId: 'chan1', messageId: 'p-old' }]
    });
    const calls = fakeDiscord({ messageContent: { 'p-old': 'Abstimmen!' } });

    assert.equal(await polls.refreshPollMessages('poll1'), true);
    const byId = Object.fromEntries(calls.edited.map(edit => [edit.messageId, edit.payload]));
    assert.equal(textsOf(byId['p-new'])[0], '<@&r2>');
    assert.equal(textsOf(byId['p-old'])[0], 'Abstimmen!');
    const stored = (await getDoc(doc(db, 'polls', 'poll1'))).data().announcements;
    assert.deepEqual(stored.map(record => record.intro), ['<@&r2>', 'Abstimmen!']);

    calls.edited.length = 0;
    assert.equal(await polls.markPollMessagesDeleted({ title: 'Termin-Suche', announcements: stored }), true);
    assert.equal(calls.edited.length, 2);
    for (const { payload } of calls.edited) {
        assert.deepEqual(textsOf(payload), []);
        assert.ok(JSON.stringify(payload.components.map(c => c.toJSON())).includes('Abstimmung gelöscht'));
    }
});
