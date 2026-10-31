const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir, createFakeInteraction, dispatchInteraction } = require('./helpers');

// Without mock mode: the real Discord helpers of bot.js, never logged in.
// The mock-mode tests replace most of them by dev/mockBot.js, so this file
// pins what they do while the bot is not ready (B-01 split safety net).
const tmpDir = createTempDir('bot-real-exports');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
delete process.env.DEV_MOCK;
for (const key of Object.keys(process.env)) {
    if (key.startsWith('FIREBASE_') || key.startsWith('DISCORD_')) delete process.env[key];
}
process.env.SQLITE_PATH = path.join(tmpDir, 'real-exports.sqlite');

const bot = require('../bot');

after(async () => {
    bot.stopBot();
    await bot.client.destroy();
});

const STATUS_KEYS = [
    'online', 'username', 'avatarUrl', 'uptime', 'startedAt', 'ping', 'guildName', 'guildMemberCount',
    'guildId', 'dmsSent', 'commandsProcessed', 'reminderSchedulerActive', 'presenceAutoUpdate'
];

test('the real exports are in place without mock mode', () => {
    assert.equal(require('../dev/mockMode').IS_MOCK_MODE, false);
    assert.equal(bot.getBotStatus().username, null, 'not the mock status');
});

test('every Discord helper answers with its neutral value while the bot is not ready', async () => {
    const event = { id: 'ev', title: 'Abend', discordChannelId: 'c1', discordTextChannelId: 't1' };
    const neutral = {
        sendDM: [['u1', 'Hallo'], false],
        sendChannelMessage: [['c1', { components: [] }, { roleIds: ['r1'] }], false],
        refreshEventAnnouncements: [['ev'], false],
        refreshPollMessages: [['poll'], false],
        markPollMessagesDeleted: [[{ id: 'poll', messages: [] }], false],
        assignRole: [['u1', 'r1', 'g1'], false],
        removeRole: [['u1', 'r1', 'g1'], false],
        getUserRoles: [['u1', 'g1'], []],
        fetchMemberRoleIds: [['u1'], null],
        searchGuildMembers: [['ab'], []],
        fetchGuildMember: [['u1'], null],
        isGuildMember: [['u1', 'g1'], false],
        getGuildName: [['g1'], ''],
        getGuildIconUrl: [['g1'], null],
        getGuildRoles: [['g1'], []],
        getGuildChannels: [['g1'], []],
        getPublicGuildChannels: [['g1'], []],
        getGuildScheduledEvents: [['g1'], []],
        createScheduledEvent: [[event], null],
        createEventChannels: [[event], null],
        addParticipantToEventChannels: [[event, 'u1'], false],
        removeParticipantFromEventChannels: [[event, 'u1'], false],
        deleteEventChannels: [['ev'], false],
        sendGuestInvitation: [['g2', { id: 'u1', displayName: 'Host' }, event, 'reg1'], false],
        ensureAnnouncementThread: [[{ channelId: 'c1', messageId: 'm1' }, 'Abend', null], null],
        sendApprovalRequest: [['reg1'], null],
        closeApprovalRequest: [[{ id: 'reg1', eventId: 'ev', approvalMessage: { channelId: 'c1', messageId: 'm1' } }, { status: 'accepted', actorName: 'Mori' }], false],
        sendCheckinInvitations: [['ev'], 0],
        mirrorCommentToThread: [['c1'], null],
        deleteMirroredMessage: [[{ id: 'c1', discordMessageId: 'm1' }, { discordThread: { guildId: 'g1', threadId: 't1' } }], false]
    };
    for (const [name, [args, expected]] of Object.entries(neutral)) {
        assert.deepEqual(await bot[name](...args), expected, name);
    }
});

test('the bot status has the same keys and reflects scheduler, counters and stop', async () => {
    const before = bot.getBotStatus();
    assert.deepEqual(Object.keys(before), STATUS_KEYS);
    assert.equal(before.online, false);
    assert.equal(before.uptime, 0);
    assert.equal(before.startedAt, null);
    assert.equal(before.dmsSent, 0);
    assert.equal(before.reminderSchedulerActive, false);
    assert.equal(before.presenceAutoUpdate, false);

    bot.startReminderScheduler();
    assert.equal(bot.getBotStatus().reminderSchedulerActive, true);

    const interaction = createFakeInteraction({ kind: 'command', commandName: 'register', eventOption: 'missing', userId: 'u1' });
    await dispatchInteraction(bot.client, interaction);
    assert.equal(bot.getBotStatus().commandsProcessed, before.commandsProcessed + 1);

    bot.stopBot();
    assert.equal(bot.getBotStatus().reminderSchedulerActive, false);
});

test('without a token the bot does not start and settles with false', async () => {
    assert.equal(await bot.startBot(''), false);
    assert.equal(await bot.whenBotSettled(1000), false);
});

test('closing a request whose message was deleted in Discord answers false without throwing', async () => {
    const { state } = require('../bot/client');
    const originalFetch = bot.client.channels.fetch;
    const errors = [];
    const originalError = console.error;
    state.isReady = true;
    bot.client.channels.fetch = async () => { throw Object.assign(new Error('Unknown Message'), { code: 10008 }); };
    console.error = (...args) => errors.push(args.join(' '));
    try {
        const registration = { id: 'reg1', eventId: 'ev', userId: 'u1', approvalMessage: { channelId: 'c1', messageId: 'm1' } };
        assert.equal(await bot.closeApprovalRequest(registration, { status: 'accepted', actorName: 'Mori' }, { title: 'Abend' }), false);
        assert.deepEqual(errors, [], 'a gone message is not logged as an error');
    } finally {
        state.isReady = false;
        bot.client.channels.fetch = originalFetch;
        console.error = originalError;
    }
});
