const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir } = require('./helpers');

// Mock mode with an own database; the empty cwd keeps a local .env out
const tmpDir = createTempDir('poll-components');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'poll-components.sqlite');

const bot = require('../bot');
const { db, doc, setDoc } = require('../firebaseAdmin');
const { tallyPoll } = require('../utils/pollService');
const { buildPollUrl } = require('../utils/eventUrl');
const { CHANNEL_ID } = require('../dev/mockGuild');

after(async () => {
    await bot.client.destroy();
});

const A = { id: 'aaaaaaaa', startDate: '2026-10-11T18:00:00.000Z', endDate: '' };
const B = { id: 'bbbbbbbb', startDate: '2026-10-12T16:00:00.000Z', endDate: '' };
const poll = (fields = {}) => ({
    id: 'p1', title: 'Raid-Termin', description: 'Wann passt es?', status: 'open', deadline: '',
    accessMode: 'open', requiredRoles: [], options: [A, B], winnerOptionId: '', eventId: '', ...fields
});
const votes = ['Ana', 'Ben', 'Cem', 'Dan', 'Eva', '*Fee*'].map((name, i) => ({
    userId: `u${i}`, userName: name, yes: [A.id], maybe: i === 0 ? [B.id] : [], updatedAt: String(i)
}));
const fieldsOf = (embed) => embed.toJSON().fields;

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

test('poll links open the poll page', () => {
    assert.ok(buildPollUrl('p1').endsWith('/#poll/p1'));
});

test('the open poll embed shows counts, names and the favorite', () => {
    const embed = bot.buildPollEmbed(poll({ deadline: '2026-10-09T16:00:00.000Z' }), tallyPoll(poll(), votes)).toJSON();
    assert.equal(embed.title, '📅 Raid-Termin');
    assert.equal(embed.description, 'Wann passt es?');
    assert.deepEqual(fieldsOf(bot.buildPollEmbed(poll(), tallyPoll(poll(), votes))).map(f => f.name), [
        '🏆 So, 11.10. · 20:00',
        'Mo, 12.10. · 18:00'
    ]);
    const [first, second] = embed.fields;
    assert.equal(first.value, '✅ 6 · 🤔 0\nAna, Ben, Cem, Dan, Eva, +1');
    assert.equal(second.value, '✅ 0 · 🤔 1\n🤔 nur „wenn nötig“');
    assert.equal(embed.footer.text, '⏰ Abstimmung bis Fr, 09.10. · 18:00 · 6 Stimmen');
});

test('names are escaped and empty dates say so', () => {
    const escaped = bot.buildPollEmbed(poll(), tallyPoll(poll(), [votes[5]])).toJSON();
    assert.equal(escaped.fields[0].value, '✅ 1 · 🤔 0\n\\*Fee\\*');
    const empty = bot.buildPollEmbed(poll(), tallyPoll(poll(), [])).toJSON();
    assert.equal(empty.fields[1].value, '✅ 0 · 🤔 0\n— noch keine Stimmen —');
    assert.equal(empty.footer.text, 'Abstimmung offen · 0 Stimmen');
});

test('closed and decided polls change title and buttons', () => {
    const closed = bot.buildPollEmbed(poll({ status: 'closed' }), tallyPoll(poll(), votes)).toJSON();
    assert.equal(closed.title, '🔒 Abstimmung beendet: Raid-Termin');
    assert.equal(closed.footer.text, 'Abstimmung beendet · 6 Stimmen');

    const decided = bot.buildPollEmbed(poll({ status: 'decided', winnerOptionId: B.id, eventId: 'e1' }), tallyPoll(poll(), votes)).toJSON();
    assert.equal(decided.title, '✅ Termin steht: Raid-Termin');
    assert.equal(decided.description, '**Mo, 12.10. · 18:00**');
    assert.equal(decided.fields[1].name, '✅ Mo, 12.10. · 18:00');
});

test('the buttons follow the poll status', () => {
    const buttons = (fields) => bot.buildPollComponents(poll(fields)).flatMap(row => row.toJSON().components);
    const open = buttons({});
    assert.deepEqual(open.map(b => b.label), ['Abstimmen', 'Im Web ansehen']);
    assert.equal(open[0].custom_id, 'poll_vote:p1');
    assert.ok(open[1].url.endsWith('/#poll/p1'));

    assert.deepEqual(buttons({ status: 'closed' }).map(b => b.label), ['Im Web ansehen']);
    assert.deepEqual(buttons({ deadline: '2020-01-01T00:00:00.000Z' }).map(b => b.label), ['Im Web ansehen']);

    const decided = buttons({ status: 'decided', eventId: 'e1' });
    assert.deepEqual(decided.map(b => b.label), ['Zum Event']);
    assert.ok(decided[0].url.endsWith('/#event/e1'));
});

test('the vote answer holds two prefilled selects', () => {
    const reply = bot.buildPollVoteReply(poll(), { yes: [A.id], maybe: [B.id] }, '💾 Gespeichert.');
    assert.equal(reply.flags, undefined);
    assert.ok(reply.content.includes('**Raid-Termin**'));
    assert.ok(reply.content.endsWith('💾 Gespeichert.'));
    const [yes, maybe] = reply.components.map(row => row.toJSON().components[0]);
    assert.equal(yes.custom_id, 'poll_yes:p1');
    assert.equal(maybe.custom_id, 'poll_maybe:p1');
    assert.equal(yes.min_values, 0);
    assert.equal(yes.max_values, 2);
    assert.deepEqual(yes.options.map(o => [o.value, o.default]), [[A.id, true], [B.id, false]]);
    assert.deepEqual(maybe.options.map(o => [o.value, o.default]), [[A.id, false], [B.id, true]]);
    assert.equal(yes.options[0].label, 'So, 11.10. · 20:00');
});

test('posted poll messages are refreshed through the mock', async () => {
    const { id: _id, ...stored } = poll();
    await setDoc(doc(db, 'polls', 'p-refresh'), { ...stored, announcements: [] });
    assert.equal(await bot.refreshPollMessages('p-refresh'), false);

    await setDoc(doc(db, 'polls', 'p-refresh'), {
        ...stored, announcements: [{ channelId: CHANNEL_ID.ANNOUNCEMENTS, messageId: '1' }]
    });
    let refreshed;
    const output = await captureLogs(async () => { refreshed = await bot.refreshPollMessages('p-refresh'); });
    assert.equal(refreshed, true);
    assert.ok(output.includes('Abstimmung "Raid-Termin" aktualisiert'));

    let marked;
    const deletedOutput = await captureLogs(async () => {
        marked = await bot.markPollMessagesDeleted({ title: 'Raid-Termin', announcements: [{ channelId: CHANNEL_ID.ANNOUNCEMENTS, messageId: '1' }] });
    });
    assert.equal(marked, true);
    assert.ok(deletedOutput.includes('Abstimmung "Raid-Termin" als gelöscht markiert'));
});
