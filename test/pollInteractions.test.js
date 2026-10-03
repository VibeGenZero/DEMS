const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir, createFakeInteraction, dispatchInteraction } = require('./helpers');

// Mock mode with an own database; the empty cwd keeps a local .env out
const tmpDir = createTempDir('poll-interactions');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'poll-interactions.sqlite');

const bot = require('../bot');
const { db, doc, setDoc } = require('../firebaseAdmin');
const { loadUserVote } = require('../utils/pollStore');

after(async () => {
    await bot.client.destroy();
});

const A = { id: 'aaaaaaaa', startDate: '2026-12-11T18:00:00.000Z', endDate: '' };
const B = { id: 'bbbbbbbb', startDate: '2026-12-12T18:00:00.000Z', endDate: '' };
const EPHEMERAL = 64;

async function seedPoll(id, fields = {}) {
    await setDoc(doc(db, 'polls', id), {
        title: 'Discord-Abstimmung', description: '', status: 'open', deadline: '', accessMode: 'open',
        requiredRoles: [], options: [A, B], winnerOptionId: '', eventId: '', announcements: [], createdBy: 'x', ...fields
    });
}

async function seedVote(pollId, userId, yes, maybe = []) {
    await setDoc(doc(db, 'pollVotes', `${pollId}_${userId}`), { pollId, userId, userName: userId, yes, maybe, updatedAt: '1' });
}

test('the vote button answers with two prefilled selects', async () => {
    await seedPoll('ip-1');
    await seedVote('ip-1', 'ip-user-1', [A.id]);

    const interaction = createFakeInteraction({ kind: 'button', customId: 'poll_vote:ip-1', userId: 'ip-user-1' });
    await dispatchInteraction(bot.client, interaction);

    assert.deepEqual(interaction.calls.map(([name]) => name), ['deferReply', 'editReply']);
    assert.equal(interaction.calls[0][1].flags, EPHEMERAL);
    const [yes, maybe] = interaction.calls[1][1].components.map(row => row.toJSON().components[0]);
    assert.equal(yes.custom_id, 'poll_yes:ip-1');
    assert.equal(maybe.custom_id, 'poll_maybe:ip-1');
    assert.deepEqual(yes.options.map(o => o.default), [true, false]);
});

test('moving a date to "wenn nötig" removes it from "passt"', async () => {
    await seedPoll('ip-2');
    await seedVote('ip-2', 'ip-user-2', [A.id, B.id]);

    const interaction = createFakeInteraction({ kind: 'select', customId: 'poll_maybe:ip-2', userId: 'ip-user-2', values: [A.id] });
    await dispatchInteraction(bot.client, interaction);

    assert.deepEqual(interaction.calls.map(([name]) => name), ['deferUpdate', 'editReply']);
    assert.ok(interaction.calls[1][1].content.includes('Gespeichert: 1× passt, 1× wenn nötig.'));
    assert.deepEqual(await loadUserVote('ip-2', 'ip-user-2'), { yes: [B.id], maybe: [A.id] });
});

test('closed polls answer with a notice', async () => {
    await seedPoll('ip-3', { status: 'closed' });
    const button = createFakeInteraction({ kind: 'button', customId: 'poll_vote:ip-3', userId: 'ip-user-3' });
    await dispatchInteraction(bot.client, button);
    assert.equal(button.calls[1][1].content, '🔒 Die Abstimmung ist beendet.');

    const select = createFakeInteraction({ kind: 'select', customId: 'poll_yes:ip-3', userId: 'ip-user-3', values: [A.id] });
    await dispatchInteraction(bot.client, select);
    assert.deepEqual(select.calls[1][1], { content: '❌ Die Abstimmung ist beendet.', components: [] });
});

test('the vote button refuses members without the role', async () => {
    await seedPoll('ip-4', { accessMode: 'role-required', requiredRoles: ['raid'] });
    const interaction = createFakeInteraction({ kind: 'button', customId: 'poll_vote:ip-4', userId: 'ip-user-4', roles: ['other'] });
    await dispatchInteraction(bot.client, interaction);
    assert.equal(interaction.calls[1][1].content, '❌ Du hast nicht die erforderliche Rolle für diese Abstimmung.');
});

test('the saved line uses the own answers of the poll', async () => {
    await seedPoll('ip-labels', { labels: { yes: 'Bin dabei', maybe: 'Vielleicht', no: 'Kann nicht' } });

    const interaction = createFakeInteraction({ kind: 'select', customId: 'poll_yes:ip-labels', userId: 'ip-user-labels', values: [A.id] });
    await dispatchInteraction(bot.client, interaction);

    assert.ok(interaction.calls[1][1].content.includes('Gespeichert: 1× Bin dabei, 0× Vielleicht.'));
});
