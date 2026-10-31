const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { GuildScheduledEventEntityType } = require('discord.js');
const { createTempDir } = require('./helpers');

// Mock mode with an own database; the empty cwd keeps a local .env out
const tmpDir = createTempDir('scheduled-event-sync');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'scheduled.sqlite');

const bot = require('../bot');
const { buildScheduledEventFields } = require('../bot/scheduledEvents');

after(async () => {
    await bot.client.destroy();
});

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-11-01T12:00:00.000Z');
const at = (hours) => new Date(NOW.getTime() + hours * HOUR).toISOString();

// ── Field builder ───────────────────────────────────────────────────────

test('name and description are cut to Discord\'s limits, the end lies after the start', () => {
    const fields = buildScheduledEventFields({ title: 'T'.repeat(150), description: 'D'.repeat(1500), startDate: at(24), endDate: at(27) }, NOW);
    assert.equal(fields.name.length, 100);
    assert.equal(fields.description.length, 1000);
    assert.equal(fields.scheduledStartTime.toISOString(), at(24));
    assert.equal(fields.scheduledEndTime.toISOString(), at(27));

    const noEnd = buildScheduledEventFields({ title: 'x', startDate: at(24) }, NOW);
    assert.equal(noEnd.scheduledEndTime.toISOString(), at(26), 'start + 2 h');
    const earlierEnd = buildScheduledEventFields({ title: 'x', startDate: at(24), endDate: at(23) }, NOW);
    assert.equal(earlierEnd.scheduledEndTime.toISOString(), at(26));
    assert.equal(buildScheduledEventFields({ title: 'x', startDate: at(1) }, NOW).description, '');
});

test('a voice channel makes a voice event', () => {
    const own = buildScheduledEventFields({ title: 'x', startDate: at(24), discordChannelId: 'voice-own' }, NOW);
    assert.deepEqual([own.entityType, own.channel, own.entityMetadata], [GuildScheduledEventEntityType.Voice, 'voice-own', undefined]);

    const chosen = buildScheduledEventFields({ title: 'x', startDate: at(24), location: { text: 'Event-Voice', channelId: 'voice-loc', channelType: 'voice' } }, NOW);
    assert.deepEqual([chosen.entityType, chosen.channel], [GuildScheduledEventEntityType.Voice, 'voice-loc']);
});

test('otherwise it is external at the location text, or „Discord“, never "TBD"', () => {
    const place = buildScheduledEventFields({ title: 'x', startDate: at(24), location: { text: 'Gemeindehaus', channelId: null, channelType: null } }, NOW);
    assert.deepEqual([place.entityType, place.channel, place.entityMetadata], [GuildScheduledEventEntityType.External, null, { location: 'Gemeindehaus' }]);

    const textChannel = buildScheduledEventFields({ title: 'x', startDate: at(24), location: { text: '#events', channelId: 'text-1', channelType: 'text' } }, NOW);
    assert.equal(textChannel.entityType, GuildScheduledEventEntityType.External);
    assert.deepEqual(textChannel.entityMetadata, { location: '#events' });

    const none = buildScheduledEventFields({ title: 'x', startDate: at(24) }, NOW);
    assert.deepEqual(none.entityMetadata, { location: 'Discord' });

    const long = buildScheduledEventFields({ title: 'x', startDate: at(24), location: { text: 'L'.repeat(150) } }, NOW);
    assert.equal(long.entityMetadata.location.length, 100);
});

// ── Discord helpers (real, with a stubbed client) ───────────────────────

const { GuildScheduledEventStatus } = require('discord.js');
const realSync = require('../bot/scheduledEvents');
const { state: botState } = require('../bot/client');

const goneError = () => Object.assign(new Error('Unknown Guild Scheduled Event'), { code: 10070 });

/** A scheduled event stub that records its calls. */
function stubScheduledEvent(status = GuildScheduledEventStatus.Scheduled) {
    const calls = [];
    return {
        calls, status,
        async edit(options) { calls.push(['edit', options]); return this; },
        async setImage(image) { calls.push(['setImage', image]); return this; },
        async setStatus(next) { calls.push(['setStatus', next]); this.status = next; return this; }
    };
}

/** Run fn with a ready bot whose guild knows the given scheduled events (id -> stub, 'gone' or an Error). */
async function withGuild(events, fn) {
    const deleted = [];
    const lookup = (id) => {
        const entry = events[id];
        if (!entry || entry === 'gone') throw goneError();
        if (entry instanceof Error) throw entry;
        return entry;
    };
    const guild = {
        scheduledEvents: {
            async fetch(id) { return lookup(id); },
            async delete(id) { lookup(id); deleted.push(id); }
        }
    };
    const originalFetch = bot.client.guilds.fetch;
    const wasReady = botState.isReady;
    bot.client.guilds.fetch = async () => guild;
    botState.isReady = true;
    try {
        return await fn(deleted);
    } finally {
        bot.client.guilds.fetch = originalFetch;
        botState.isReady = wasReady;
    }
}

const synced = (fields = {}) => ({ title: 'Raid-Nacht', startDate: at(24), endDate: at(27), discordScheduledEventId: 'se-1', ...fields });

test('updateScheduledEvent edits the fields and sets the image only for a new banner', async () => {
    const scheduled = stubScheduledEvent();
    await withGuild({ 'se-1': scheduled }, async () => {
        assert.equal(await realSync.updateScheduledEvent(synced({ title: 'Neu' }), { now: NOW }), 'updated');
        assert.equal(await realSync.updateScheduledEvent(synced({ bannerUrl: 'https://img.example/b.png' }), { bannerChanged: true, now: NOW }), 'updated');
    });
    const [first, second, image] = scheduled.calls;
    assert.equal(first[0], 'edit');
    assert.equal(first[1].name, 'Neu');
    assert.equal(first[1].scheduledStartTime.toISOString(), at(24));
    assert.equal(second[0], 'edit');
    assert.deepEqual(image, ['setImage', 'https://img.example/b.png']);
    assert.equal(scheduled.calls.length, 3, 'no image without a new banner');
});

test('a running Discord event or a past start keeps its start time', async () => {
    const running = stubScheduledEvent(GuildScheduledEventStatus.Active);
    const scheduled = stubScheduledEvent();
    await withGuild({ 'se-run': running, 'se-past': scheduled }, async () => {
        await realSync.updateScheduledEvent(synced({ discordScheduledEventId: 'se-run' }), { now: NOW });
        await realSync.updateScheduledEvent(synced({ discordScheduledEventId: 'se-past', startDate: at(-1), endDate: at(2) }), { now: NOW });
    });
    assert.equal('scheduledStartTime' in running.calls[0][1], false);
    assert.equal('scheduledStartTime' in scheduled.calls[0][1], false);
    assert.equal(scheduled.calls[0][1].scheduledEndTime.toISOString(), at(2));
});

test('updateScheduledEvent: gone, finished and refused events', async () => {
    const done = stubScheduledEvent(GuildScheduledEventStatus.Completed);
    const errors = [];
    const originalError = console.error;
    console.error = (...args) => errors.push(args.join(' '));
    try {
        await withGuild({ 'se-gone': 'gone', 'se-done': done, 'se-err': new Error('Missing Permissions') }, async () => {
            assert.equal(await realSync.updateScheduledEvent(synced({ discordScheduledEventId: 'se-gone' }), { now: NOW }), 'gone');
            assert.equal(await realSync.updateScheduledEvent(synced({ discordScheduledEventId: 'se-done' }), { now: NOW }), false);
            assert.equal(await realSync.updateScheduledEvent(synced({ discordScheduledEventId: 'se-err' }), { now: NOW }), false);
            assert.equal(await realSync.updateScheduledEvent(synced({ discordScheduledEventId: '' }), { now: NOW }), false);
        });
    } finally {
        console.error = originalError;
    }
    assert.deepEqual(done.calls, []);
    assert.ok(errors.some(line => line.includes('Missing Permissions')));
});

test('removeScheduledEvent deletes it and counts an already deleted one as removed', async () => {
    await withGuild({ 'se-1': stubScheduledEvent(), 'se-gone': 'gone' }, async (deleted) => {
        assert.equal(await realSync.removeScheduledEvent(synced()), true);
        assert.equal(await realSync.removeScheduledEvent(synced({ discordScheduledEventId: 'se-gone' })), true);
        assert.deepEqual(deleted, ['se-1']);
    });
});

test('setScheduledEventStatus follows the order of Discord states', async () => {
    const S = GuildScheduledEventStatus;
    const toActive = stubScheduledEvent();
    const toCompleted = stubScheduledEvent();
    const alreadyActive = stubScheduledEvent(S.Active);
    const alreadyDone = stubScheduledEvent(S.Completed);
    await withGuild({ a: toActive, c: toCompleted, r: alreadyActive, d: alreadyDone, g: 'gone' }, async () => {
        assert.equal(await realSync.setScheduledEventStatus(synced({ discordScheduledEventId: 'a' }), 'active'), 'active');
        assert.equal(await realSync.setScheduledEventStatus(synced({ discordScheduledEventId: 'c' }), 'completed'), 'completed');
        assert.equal(await realSync.setScheduledEventStatus(synced({ discordScheduledEventId: 'r' }), 'active'), 'active');
        assert.equal(await realSync.setScheduledEventStatus(synced({ discordScheduledEventId: 'd' }), 'completed'), 'completed');
        assert.equal(await realSync.setScheduledEventStatus(synced({ discordScheduledEventId: 'g' }), 'active'), 'gone');
    });
    assert.deepEqual(toActive.calls, [['setStatus', S.Active]]);
    assert.deepEqual(toCompleted.calls, [['setStatus', S.Active], ['setStatus', S.Completed]]);
    assert.deepEqual(alreadyActive.calls, []);
    assert.deepEqual(alreadyDone.calls, []);
});
