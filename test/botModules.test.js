const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createTempDir } = require('./helpers');

// Shape of the bot after the split (B-01): bot.js is a thin facade over the
// area modules in bot/, and its export list stays exactly what callers use.
const tmpDir = createTempDir('bot-modules');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'bot-modules.sqlite');

const REPO_ROOT = path.join(__dirname, '..');
const BOT_DIR = path.join(REPO_ROOT, 'bot');
const FACADE_MAX_LINES = 150;
const MODULE_MAX_LINES = 500;

const bot = require('../bot');

after(async () => {
    await bot.client.destroy();
});

const EXPORTS = [
    'client', 'startBot', 'whenBotSettled', 'stopBot', 'sendDM', 'sendChannelMessage',
    'refreshEventAnnouncements', 'isGoneDiscordError', 'buildPollMessage',
    'buildPollVoteReply', 'refreshPollMessages', 'markPollMessagesDeleted', 'buildSlotModal',
    'buildRegisteredSlotReply', 'buildEventAnnouncement', 'assignRole', 'removeRole', 'getUserRoles',
    'fetchMemberRoleIds', 'isGuildMember', 'searchGuildMembers', 'fetchGuildMember', 'getGuildName',
    'getGuildIconUrl', 'getGuildRoles', 'getGuildChannels', 'getPublicGuildChannels',
    'getGuildScheduledEvents', 'parseTemplate', 'startReminderScheduler', 'checkReminders',
    'createEventChannels', 'addParticipantToEventChannels', 'removeParticipantFromEventChannels',
    'deleteEventChannels', 'createScheduledEvent', 'getBotStatus', 'getBotSettings', 'saveBotSettings',
    'getRunningEvents', 'sendGuestInvitation', 'canRegisterViaDiscord', 'buildAnnouncementIntro',
    'ensureAnnouncementThread', 'sendApprovalRequest', 'closeApprovalRequest', 'sendCheckinInvitations'
];

const lineCount = (file) => fs.readFileSync(file, 'utf8').split(/\r?\n/).length;
const botModules = () => (fs.existsSync(BOT_DIR)
    ? fs.readdirSync(BOT_DIR).filter(name => name.endsWith('.js')).map(name => path.join(BOT_DIR, name))
    : []);
const jsFilesIn = (dir) => fs.readdirSync(path.join(REPO_ROOT, dir))
    .filter(name => name.endsWith('.js')).map(name => path.join(REPO_ROOT, dir, name));

test('bot.js exports exactly the names its callers use, in the same order', () => {
    assert.deepEqual(Object.keys(bot), EXPORTS);
});

test('bot.js is a thin facade over the modules in bot/', () => {
    assert.ok(botModules().length > 0, 'bot/ holds the area modules');
    const lines = lineCount(path.join(REPO_ROOT, 'bot.js'));
    assert.ok(lines <= FACADE_MAX_LINES, `bot.js has ${lines} lines, at most ${FACADE_MAX_LINES}`);
});

test('every module in bot/ stays readable as a whole', () => {
    for (const file of botModules()) {
        const lines = lineCount(file);
        assert.ok(lines <= MODULE_MAX_LINES, `${path.relative(REPO_ROOT, file)} has ${lines} lines, at most ${MODULE_MAX_LINES}; split it along its sections`);
    }
});

test('only bot/client.js creates the discord.js client', () => {
    const creators = [path.join(REPO_ROOT, 'bot.js'), ...botModules()]
        .filter(file => /new Client\(/.test(fs.readFileSync(file, 'utf8')))
        .map(file => path.relative(REPO_ROOT, file).replace(/\\/g, '/'));
    assert.deepEqual(creators, ['bot/client.js']);
});

test('no module in bot/ requires the facade (keeps load order and mock mode as they are)', () => {
    for (const file of botModules()) {
        assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /require\(['"]\.\.\/bot['"]\)/, path.relative(REPO_ROOT, file));
    }
});

test('code outside the bot reaches it only through bot.js', () => {
    const files = [path.join(REPO_ROOT, 'server.js'), ...['routes', 'utils', 'middleware', 'dev'].flatMap(jsFilesIn)];
    for (const file of files) {
        assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /require\(['"](\.\.?\/)+bot\/[^'"]+['"]\)/, path.relative(REPO_ROOT, file));
    }
});
