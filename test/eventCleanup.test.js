const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir } = require('./helpers');

// Mock mode with an own database; the empty cwd keeps a local .env out
const tmpDir = createTempDir('event-cleanup');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'cleanup.sqlite');

const bot = require('../bot');

after(async () => {
    await bot.client.destroy();
});

// ── removeRoleFromMembers (real, with a stubbed client) ─────────────────

const realGuild = require('../bot/guild');
const { state: botState } = require('../bot/client');

/** Run fn with a ready bot whose guild knows the given members (id -> roles removed). */
async function withMembers(memberIds, fn) {
    const removed = [];
    let guildFetches = 0;
    const guild = {
        members: {
            async fetch(id) {
                if (!memberIds.includes(id)) throw Object.assign(new Error('Unknown Member'), { code: 10007 });
                return { user: { tag: id }, roles: { async remove(roleId) { removed.push([id, roleId]); } } };
            }
        }
    };
    const originalFetch = bot.client.guilds.fetch;
    const wasReady = botState.isReady;
    bot.client.guilds.fetch = async () => { guildFetches++; return guild; };
    botState.isReady = true;
    try {
        return await fn(removed, () => guildFetches);
    } finally {
        bot.client.guilds.fetch = originalFetch;
        botState.isReady = wasReady;
    }
}

test('removeRoleFromMembers takes the role from each member with one guild fetch', async () => {
    await withMembers(['u1', 'u2'], async (removed, guildFetches) => {
        assert.deepEqual(await realGuild.removeRoleFromMembers('r1', ['u1', 'u2']), { removed: 2, failed: 0 });
        assert.deepEqual(removed, [['u1', 'r1'], ['u2', 'r1']]);
        assert.equal(guildFetches(), 1);
    });
});

test('removeRoleFromMembers counts a member who left the server as failed and goes on', async () => {
    await withMembers(['u1', 'u3'], async (removed) => {
        assert.deepEqual(await realGuild.removeRoleFromMembers('r1', ['u1', 'gone', 'u3']), { removed: 2, failed: 1 });
        assert.deepEqual(removed.map(([id]) => id), ['u1', 'u3']);
    });
});

test('removeRoleFromMembers answers false while the bot is not ready', async () => {
    const wasReady = botState.isReady;
    botState.isReady = false;
    try {
        assert.equal(await realGuild.removeRoleFromMembers('r1', ['u1']), false);
    } finally {
        botState.isReady = wasReady;
    }
});

test('the mock twin logs the removal and reports every member as removed', async () => {
    assert.deepEqual(await bot.removeRoleFromMembers('r1', ['u1', 'u2']), { removed: 2, failed: 0 });
});

// ── cleanupEvent (injected bot stub) ────────────────────────────────────

const { db, collection, doc, getDoc, getDocs, setDoc, updateDoc } = require('../firebaseAdmin');
const { cleanupEvent, retryPendingCleanups, restoreEventRole } = require('../utils/eventCleanup');

const ROLE = 'role-event';

/** A bot stub that records role and channel calls; offline answers false like the real helpers. */
function stubBot({ online = true } = {}) {
    const calls = { removed: [], assigned: [], channels: [] };
    return {
        calls,
        async removeRoleFromMembers(roleId, userIds) {
            if (!online) return false;
            calls.removed.push([roleId, [...userIds].sort()]);
            return { removed: userIds.length, failed: 0 };
        },
        async assignRole(userId, roleId) {
            if (!online) return false;
            calls.assigned.push([userId, roleId]);
            return true;
        },
        async deleteEventChannels(eventId) {
            if (!online) return false;
            calls.channels.push(eventId);
            await updateDoc(doc(db, 'events', eventId), { discordChannelId: null, discordTextChannelId: null });
            return true;
        }
    };
}

let counter = 0;
async function createEvent(fields) {
    const id = `cleanup-event-${++counter}`;
    await setDoc(doc(db, 'events', id), { title: `Event ${counter}`, status: 'archived', assignRoleId: ROLE, ...fields });
    return id;
}
async function register(eventId, userId, status = 'accepted') {
    await setDoc(doc(db, 'registrations', `${eventId}-${userId}`), { eventId, userId, status });
}
const eventOf = async (id) => (await getDoc(doc(db, 'events', id))).data();
async function cleanupLogs(eventId) {
    const snap = await getDocs(collection(db, 'auditLogs'));
    return snap.docs.map(entry => entry.data()).filter(entry => entry.action === 'DISCORD_CLEANUP' && entry.targetId === eventId);
}

test('the clean-up takes the role only from accepted members and deletes the channels', async () => {
    const id = await createEvent({ discordChannelId: 'v1', discordTextChannelId: 't1' });
    await register(id, 'anna');
    await register(id, 'ben');
    await register(id, 'carl', 'pending');
    await register(id, 'dora', 'waitlisted');
    const stub = stubBot();

    assert.equal(await cleanupEvent(id, { bot: stub }), 'done');
    assert.deepEqual(stub.calls.removed, [[ROLE, ['anna', 'ben']]]);
    assert.deepEqual(stub.calls.channels, [id]);
    assert.equal((await eventOf(id)).discordCleanup, 'done');
    const logs = await cleanupLogs(id);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].adminId, 'system');
    assert.match(logs[0].details, /2 member/);
    assert.match(logs[0].details, /channels/);
});

test('a member accepted for another open event with the same role keeps it', async () => {
    const first = await createEvent({ seriesId: 'series-x' });
    const next = await createEvent({ seriesId: 'series-x', status: 'active' });
    const drafted = await createEvent({ status: 'draft' });
    const over = await createEvent({ status: 'cancelled' });
    const otherRole = await createEvent({ status: 'active', assignRoleId: 'role-other' });
    for (const user of ['eva', 'finn', 'gus', 'hans', 'ida']) await register(first, user);
    await register(next, 'eva');
    await register(drafted, 'finn');
    await register(over, 'gus');
    await register(otherRole, 'hans');
    await register(next, 'ida', 'waitlisted');
    const stub = stubBot();

    assert.equal(await cleanupEvent(first, { bot: stub }), 'done');
    assert.deepEqual(stub.calls.removed, [[ROLE, ['gus', 'hans', 'ida']]]);
});

test('an event without role and channels needs no clean-up', async () => {
    const id = await createEvent({ assignRoleId: '' });
    await register(id, 'jana');
    const stub = stubBot();

    assert.equal(await cleanupEvent(id, { bot: stub }), 'nothing');
    assert.deepEqual(stub.calls, { removed: [], assigned: [], channels: [] });
    assert.equal((await eventOf(id)).discordCleanup, undefined);
    assert.deepEqual(await cleanupLogs(id), []);
});

test('channels alone are cleaned up when nobody holds the role', async () => {
    const id = await createEvent({ discordChannelId: 'v2' });
    const stub = stubBot();
    assert.equal(await cleanupEvent(id, { bot: stub }), 'done');
    assert.deepEqual(stub.calls.removed, []);
    assert.deepEqual(stub.calls.channels, [id]);
});

test('an offline bot leaves the clean-up pending without an audit entry', async () => {
    const id = await createEvent({ discordChannelId: 'v3' });
    await register(id, 'kai');

    assert.equal(await cleanupEvent(id, { bot: stubBot({ online: false }) }), 'pending');
    assert.equal((await eventOf(id)).discordCleanup, 'pending');
    assert.deepEqual(await cleanupLogs(id), []);

    // Back online: the next attempt finishes it
    const stub = stubBot();
    assert.equal(await cleanupEvent(id, { bot: stub }), 'done');
    assert.deepEqual(stub.calls.removed, [[ROLE, ['kai']]]);
    assert.equal((await cleanupLogs(id)).length, 1);
});

test('a member who could not lose the role still ends the clean-up', async () => {
    const id = await createEvent({});
    await register(id, 'lea');
    await register(id, 'max');
    const stub = stubBot();
    stub.removeRoleFromMembers = async (roleId, userIds) => ({ removed: userIds.length - 1, failed: 1 });

    assert.equal(await cleanupEvent(id, { bot: stub }), 'done');
    assert.match((await cleanupLogs(id))[0].details, /1 member.*1 failed/);
});

test('a missing event is nothing to clean up', async () => {
    assert.equal(await cleanupEvent('cleanup-missing', { bot: stubBot() }), 'nothing');
});

// ── retryPendingCleanups / restoreEventRole ─────────────────────────────

test('the retry runs pending clean-ups of archived and cancelled events only', async () => {
    const archived = await createEvent({ discordCleanup: 'pending' });
    const cancelled = await createEvent({ status: 'cancelled', discordCleanup: 'pending' });
    const reactivated = await createEvent({ status: 'active', discordCleanup: 'pending' });
    const done = await createEvent({ discordCleanup: 'done' });
    const unmarked = await createEvent({});
    for (const id of [archived, cancelled, reactivated, done, unmarked]) await register(id, `user-${id}`);
    const stub = stubBot();

    assert.equal(await retryPendingCleanups({ bot: stub }), 2);
    assert.deepEqual(stub.calls.removed.map(([, users]) => users[0]).sort(), [`user-${archived}`, `user-${cancelled}`].sort());
    assert.equal((await eventOf(archived)).discordCleanup, 'done');
    assert.equal((await eventOf(reactivated)).discordCleanup, 'pending');

    assert.equal(await retryPendingCleanups({ bot: stub }), 0);
});

test('reactivating hands the role back after a finished clean-up and clears the marker', async () => {
    const id = await createEvent({ status: 'active', discordCleanup: 'done' });
    await register(id, 'nora');
    await register(id, 'olaf');
    await register(id, 'pia', 'pending');
    const stub = stubBot();

    await restoreEventRole(id, await eventOf(id), { bot: stub });
    assert.deepEqual(stub.calls.assigned.sort(), [['nora', ROLE], ['olaf', ROLE]]);
    assert.equal((await eventOf(id)).discordCleanup, null);
});

test('reactivating before a pending clean-up ran assigns nothing and stops the retry', async () => {
    const id = await createEvent({ status: 'active', discordCleanup: 'pending' });
    await register(id, 'quin');
    const stub = stubBot();

    await restoreEventRole(id, await eventOf(id), { bot: stub });
    assert.deepEqual(stub.calls.assigned, []);
    assert.equal((await eventOf(id)).discordCleanup, null);
});

test('an event that was never cleaned up is left alone on reactivation', async () => {
    const id = await createEvent({ status: 'active' });
    await register(id, 'rita');
    const stub = stubBot();

    await restoreEventRole(id, await eventOf(id), { bot: stub });
    assert.deepEqual(stub.calls.assigned, []);
    assert.equal((await eventOf(id)).discordCleanup, undefined);
});
