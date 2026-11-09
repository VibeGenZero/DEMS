const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir } = require('./helpers');

// Mock mode with an own database; the empty cwd keeps a local .env out
const tmpDir = createTempDir('mock-bot');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'bot.sqlite');

const bot = require('../bot');
const { GUILD, ROLE_ID, CHANNEL_ID, CATEGORY_ID, PERSONAS } = require('../dev/mockGuild');
const { db, doc, getDoc, setDoc } = require('../firebaseAdmin');

const raider = PERSONAS.find(persona => persona.id === 'raider');

after(async () => {
    await bot.client.destroy();
});

test('bot.js answers with the mock server when DEV_MOCK=true', async () => {
    assert.equal(await bot.getGuildName(GUILD.id), 'DEMS Dev Server');
    const roles = await bot.getGuildRoles(GUILD.id);
    assert.ok(roles.some(role => role.id === ROLE_ID.RAID_TEAM && role.name === 'Raid-Team'));
    assert.ok(roles.some(role => role.managed));
});

test('the mock server has no icon, so the login card shows its initials', async () => {
    assert.equal(await bot.getGuildIconUrl(GUILD.id), null);
});

test('only public channels are offered to members', async () => {
    const all = await bot.getGuildChannels(GUILD.id);
    const publicChannels = await bot.getPublicGuildChannels(GUILD.id);

    assert.ok(all.some(channel => channel.id === CHANNEL_ID.MOD_INTERNAL));
    assert.ok(!publicChannels.some(channel => channel.id === CHANNEL_ID.MOD_INTERNAL));
    assert.ok(all.every(channel => ['text', 'voice'].includes(channel.type)));

    const names = publicChannels.map(channel => channel.name);
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
});

test('the mock server offers one category for event channels (#138)', async () => {
    assert.deepEqual(await bot.getGuildCategories(GUILD.id), [{ id: CATEGORY_ID.EVENTS, name: 'Events' }]);
});

test('scheduled events for the import lie in the future', async () => {
    const events = await bot.getGuildScheduledEvents(GUILD.id);
    assert.equal(events.length, 2);
    assert.ok(events.every(event => event.name && event.scheduledStartTimestamp > Date.now()));
});

test('member roles come from the persona', async () => {
    const roles = await bot.getUserRoles(raider.userId, GUILD.id);
    assert.deepEqual(roles.map(role => role.id).sort(), [...raider.roles].sort());
    assert.ok(roles.every(role => /^#[0-9a-f]{6}$/.test(role.color)));
    assert.equal(await bot.isGuildMember(raider.userId, GUILD.id), true);
    assert.equal(await bot.isGuildMember('1', GUILD.id), false);
});

test('the periodic rights check reads the persona roles', async () => {
    assert.deepEqual(await bot.fetchMemberRoleIds(raider.userId), { isMember: true, roleIds: [...raider.roles] });
    assert.deepEqual(await bot.fetchMemberRoleIds('1'), { isMember: false, roleIds: [] });
});

test('messages are logged and reported as sent', async () => {
    const event = { title: 'Mock-Test', status: 'active', startDate: new Date().toISOString() };

    assert.equal(await bot.startBot(''), true);
    assert.equal(await bot.sendDM(raider.userId, 'Hallo Lena'), true);
    const intro = bot.buildAnnouncementIntro({ text: 'Neues Event!', roleIds: [ROLE_ID.RAID_TEAM] });
    const sent = await bot.sendChannelMessage(CHANNEL_ID.ANNOUNCEMENTS, bot.buildEventAnnouncement(event, 'evt-mock', undefined, intro), {
        roleIds: [ROLE_ID.RAID_TEAM]
    });
    assert.equal(sent.channelId, CHANNEL_ID.ANNOUNCEMENTS);
    assert.match(sent.messageId, /^\d+$/);
    assert.equal(sent.guildId, GUILD.id);
    assert.equal(await bot.sendGuestInvitation(raider.userId, { id: '1', displayName: 'Tom' }, { id: 'evt-mock', title: 'Mock-Test' }, 'reg-1'), true);
    assert.equal(await bot.assignRole(raider.userId, ROLE_ID.VIP, GUILD.id), true);
    assert.equal(await bot.removeRole(raider.userId, ROLE_ID.VIP, GUILD.id), true);
    assert.match(await bot.createScheduledEvent(event), /^\d{18}$/);

    const status = bot.getBotStatus();
    assert.equal(status.online, true);
    assert.equal(status.guildName, GUILD.name);
    assert.equal(status.dmsSent, 2);
});

test('event channels are simulated and stored on the event', async () => {
    const eventRef = doc(db, 'events', 'evt-channels');
    await setDoc(eventRef, { title: 'Channel-Test', channelConfig: { type: 'both' } });

    const created = await bot.createEventChannels({ id: 'evt-channels', title: 'Channel-Test', channelConfig: { type: 'both' } });
    assert.match(created.voiceId, /^\d{18}$/);
    assert.match(created.textId, /^\d{18}$/);
    assert.equal((await getDoc(eventRef)).data().discordTextChannelId, created.textId);

    const stored = { id: 'evt-channels', ...(await getDoc(eventRef)).data() };
    assert.equal(await bot.addParticipantToEventChannels(stored, raider.userId), true);
    assert.equal(await bot.removeParticipantFromEventChannels(stored, raider.userId), true);

    assert.equal(await bot.deleteEventChannels('evt-channels'), true);
    assert.equal((await getDoc(eventRef)).data().discordChannelId, null);
    assert.equal(await bot.deleteEventChannels('evt-channels'), false);
});

test('the "Zum Event" button of an announcement opens the event page', () => {
    const payload = bot.buildEventAnnouncement({ title: 'Link-Test', status: 'active' }, 'evt-link');
    const container = payload.components.map(component => component.toJSON()).find(component => component.type === 17);
    const row = container.components.find(component => component.type === 1);
    const linkButton = row.components.find(component => component.url);
    assert.equal(linkButton.label, 'Zum Event');
    assert.match(linkButton.url, /\/#event\/evt-link$/);
});

test('the mock opens a discussion thread once and keeps it (B-14)', async () => {
    const sent = { channelId: CHANNEL_ID.ANNOUNCEMENTS, messageId: '1', guildId: GUILD.id };
    const thread = await bot.ensureAnnouncementThread(sent, 'Thread-Test', null);
    assert.equal(thread.guildId, GUILD.id);
    assert.match(thread.threadId, /^\d{18}$/);
    assert.equal(await bot.ensureAnnouncementThread(sent, 'Thread-Test', thread), thread);
});

/** Collect everything printed with console.log while `fn` runs. */
async function captureLogs(fn) {
    const lines = [];
    const original = console.log;
    console.log = (...args) => lines.push(args.map(String).join(' '));
    try {
        await fn();
    } finally {
        console.log = original;
    }
    return lines.join('\n');
}

test('announcements are refreshed only when the event has stored messages', async () => {
    await setDoc(doc(db, 'events', 'evt-refresh'), { title: 'Live-Test', status: 'active', maxParticipants: 5 });
    assert.equal(await bot.refreshEventAnnouncements('evt-refresh'), false);

    await setDoc(doc(db, 'events', 'evt-refresh'), {
        title: 'Live-Test', status: 'active', maxParticipants: 5,
        announcements: [{ channelId: CHANNEL_ID.ANNOUNCEMENTS, messageId: '123' }]
    });
    let result;
    const output = await captureLogs(async () => { result = await bot.refreshEventAnnouncements('evt-refresh'); });
    assert.equal(result, true);
    assert.ok(output.includes('Ankündigung von "Live-Test" aktualisiert'));
    assert.equal(await bot.refreshEventAnnouncements('does-not-exist'), false);
});

test('deleted Discord messages count as gone', () => {
    assert.equal(bot.isGoneDiscordError({ code: 10008 }), true);
    assert.equal(bot.isGoneDiscordError({ code: 10003 }), true);
    assert.equal(bot.isGoneDiscordError({ code: 50013 }), false);
    assert.equal(bot.isGoneDiscordError(null), false);
});

test('the member search finds personas and members by the start or a part of their name (W-06)', async () => {
    const greta = await bot.searchGuildMembers('gre');
    assert.deepEqual(greta, [{ id: '200000000000000019', username: 'greta', displayName: 'Greta', avatar: '' }]);
    // The mock also matches inside the name; Discord itself only matches the start
    assert.ok((await bot.searchGuildMembers('ena')).some(member => member.id === raider.userId));
    assert.ok((await bot.searchGuildMembers('e')).length <= 10);
    assert.deepEqual(await bot.searchGuildMembers('zzz'), []);
});

test('a member lookup returns the member or false', async () => {
    assert.deepEqual(await bot.fetchGuildMember(raider.userId), { id: raider.userId, username: 'lena', displayName: 'Lena', avatar: '' });
    assert.equal(await bot.fetchGuildMember('1'), false);
});

test('the simulated bot logs in again at once (#138)', async () => {
    assert.deepEqual(await bot.restartBot('any-token'), { ok: true, guildName: GUILD.name });
});
