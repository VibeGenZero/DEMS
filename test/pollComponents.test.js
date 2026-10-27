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
// Real poll builders (pure); the deleted notice is not exported through bot.js
const polls = require('../bot/polls');
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

test('own answers show up in Discord', () => {
    const labels = { yes: 'Bin dabei', maybe: 'Vielleicht', no: 'Kann nicht' };
    const reply = bot.buildPollVoteReply(poll({ labels }), { yes: [], maybe: [] });
    assert.deepEqual(reply.components.map(row => row.toJSON().components[0].placeholder), ['✅ Bin dabei …', '🤔 Vielleicht …']);
    const [, second] = optionBlocks(message({ labels }));
    assert.equal(second, '**Mo, 12.10. · 18:00**\n✅ 0 · 🤔 1\n🤔 nur „Vielleicht“');
});

const IS_COMPONENTS_V2 = 1 << 15;
const GREY = 0x6b7280;
const GREEN = 0x22c55e;
const ACCENT = 0x8b5cf6;
const message = (fields, tallyVotes = votes, intro) => bot.buildPollMessage(poll(fields), tallyPoll(poll(), tallyVotes), intro);
const partsOf = (payload) => payload.components.map(component => component.toJSON());
const containerOf = (payload) => partsOf(payload).find(component => component.type === 17);
const textsOf = (payload) => containerOf(payload).components.filter(component => component.type === 10).map(component => component.content);
const optionBlocks = (payload) => textsOf(payload)[1].split('\n\n');
const buttonsOf = (payload) => {
    const row = containerOf(payload).components.find(component => component.type === 1);
    return row ? row.components : [];
};

test('the open poll message shows counts, names and the favorite in an accent container', () => {
    // Deadline far in the future: a past one closes the poll. 2099-10-09 is a Friday, 18:00 in Berlin.
    const payload = message({ deadline: '2099-10-09T16:00:00.000Z' });
    assert.equal(payload.flags, IS_COMPONENTS_V2);
    assert.equal(containerOf(payload).accent_color, ACCENT);
    const [head, , footer] = textsOf(payload);
    assert.equal(head, '## 📅 Raid-Termin\nWann passt es?');
    assert.deepEqual(optionBlocks(payload), [
        '**🏆 So, 11.10. · 20:00**\n✅ 6 · 🤔 0\nAna, Ben, Cem, Dan, Eva, +1',
        '**Mo, 12.10. · 18:00**\n✅ 0 · 🤔 1\n🤔 nur „wenn nötig“'
    ]);
    assert.equal(footer, '⏰ Abstimmung bis Fr, 09.10. · 18:00 · 6 Stimmen');
});

test('the ping line stands above the poll container', () => {
    const payload = message({}, votes, '<@&r1>\nAbstimmen!');
    assert.deepEqual(partsOf(payload).map(component => component.type), [10, 17]);
    assert.equal(partsOf(payload)[0].content, '<@&r1>\nAbstimmen!');
    assert.deepEqual(partsOf(message({})).map(component => component.type), [17]);
});

test('names are escaped and empty dates say so', () => {
    assert.equal(optionBlocks(message({}, [votes[5]]))[0], '**🏆 So, 11.10. · 20:00**\n✅ 1 · 🤔 0\n\\*Fee\\*');
    const empty = message({}, []);
    assert.equal(optionBlocks(empty)[1], '**Mo, 12.10. · 18:00**\n✅ 0 · 🤔 0\n— noch keine Stimmen —');
    assert.equal(textsOf(empty)[2], 'Abstimmung offen · 0 Stimmen');
    assert.equal(textsOf(message({ title: '*Raid*', description: '' }))[0], '## 📅 \\*Raid\\*');
});

test('closed and decided polls change colour, title and footer', () => {
    const closed = message({ status: 'closed' });
    assert.equal(containerOf(closed).accent_color, GREY);
    assert.equal(textsOf(closed)[0], '## 🔒 Abstimmung beendet: Raid-Termin\nWann passt es?');
    assert.equal(textsOf(closed)[2], 'Abstimmung beendet · 6 Stimmen');

    const decided = message({ status: 'decided', winnerOptionId: B.id, eventId: 'e1' });
    assert.equal(containerOf(decided).accent_color, GREEN);
    assert.equal(textsOf(decided)[0], '## ✅ Termin steht: Raid-Termin\n**Mo, 12.10. · 18:00**');
    assert.ok(optionBlocks(decided)[1].startsWith('**✅ Mo, 12.10. · 18:00**'));
});

test('a long description is cut to the text budget', () => {
    const payload = message({ description: 'x'.repeat(5000) });
    const [head] = textsOf(payload);
    assert.ok(head.endsWith('…'));
    assert.ok(head.length <= '## 📅 Raid-Termin\n'.length + 1000, String(head.length));
});

test('the buttons follow the poll status', () => {
    const open = buttonsOf(message({}));
    assert.deepEqual(open.map(b => b.label), ['Abstimmen', 'Im Web ansehen']);
    assert.equal(open[0].custom_id, 'poll_vote:p1');
    assert.ok(open[1].url.endsWith('/#poll/p1'));

    assert.deepEqual(buttonsOf(message({ status: 'closed' })).map(b => b.label), ['Im Web ansehen']);
    assert.deepEqual(buttonsOf(message({ deadline: '2020-01-01T00:00:00.000Z' })).map(b => b.label), ['Im Web ansehen']);

    const decided = buttonsOf(message({ status: 'decided', eventId: 'e1' }));
    assert.deepEqual(decided.map(b => b.label), ['Zum Event']);
    assert.ok(decided[0].url.endsWith('/#event/e1'));
});

test('a deleted poll becomes a grey notice without buttons', () => {
    const payload = polls.buildPollDeletedMessage(poll({ title: 'Raid_Termin' }));
    assert.equal(payload.flags, IS_COMPONENTS_V2);
    assert.equal(containerOf(payload).accent_color, GREY);
    assert.deepEqual(textsOf(payload), ['## 🗑️ Abstimmung gelöscht: Raid\\_Termin\nDiese Abstimmung wurde von einem Admin gelöscht.']);
    assert.deepEqual(buttonsOf(payload), []);
});
