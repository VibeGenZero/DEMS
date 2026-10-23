const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir } = require('./helpers');

// Mock mode with an own, empty database; the empty cwd keeps a local .env out
const tmpDir = createTempDir('event-change');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'change.sqlite');
process.env.TIMEZONE = 'Europe/Berlin';

const bot = require('../bot');
const { db, doc, setDoc } = require('../firebaseAdmin');
const { buildEventUrl } = require('../utils/eventUrl');
const {
    describeEventChanges, buildEventChangeMessage, changeRecipients, notifyEventChange
} = require('../utils/eventChangeNotice');

after(async () => {
    await bot.client.destroy();
});

// Saturday 24.10.2026, 19:00 (summer time) and Sunday 25.10.2026, 19:00 (winter time) in Berlin
const SATURDAY = '2026-10-24T17:00:00.000Z';
const SUNDAY = '2026-10-25T18:00:00.000Z';
const LOBBY = { text: 'Lobby', channelId: '300000000000000001', channelType: 'voice' };
const BASE = { title: 'Spieleabend', startDate: SATURDAY, endDate: '', location: LOBBY };

test('a moved start is reported with both dates', () => {
    const changes = describeEventChanges(BASE, { ...BASE, startDate: SUNDAY });
    assert.deepEqual(changes, [{ field: 'startDate', label: 'Beginn', before: 'Sa., 24.10.2026, 19:00', after: 'So., 25.10.2026, 19:00' }]);
});

test('the same instant in another ISO notation is no change', () => {
    assert.deepEqual(describeEventChanges(BASE, { ...BASE, startDate: '2026-10-24T19:00:00+02:00' }), []);
    assert.deepEqual(describeEventChanges({ ...BASE, endDate: '' }, { ...BASE, endDate: 'kein Datum' }), []);
});

test('an added end reads "nicht festgelegt" before', () => {
    const changes = describeEventChanges(BASE, { ...BASE, endDate: '2026-10-24T20:00:00.000Z' });
    assert.deepEqual(changes, [{ field: 'endDate', label: 'Ende', before: 'nicht festgelegt', after: 'Sa., 24.10.2026, 22:00' }]);
});

test('a removed or added location counts, also a new channel with the same text', () => {
    assert.deepEqual(describeEventChanges(BASE, { ...BASE, location: null }),
        [{ field: 'location', label: 'Ort', before: 'Lobby', after: 'nicht festgelegt' }]);
    assert.deepEqual(describeEventChanges({ ...BASE, location: null }, { ...BASE, location: { text: '  ', channelId: '' } }), []);
    assert.deepEqual(describeEventChanges({ ...BASE, location: null }, BASE),
        [{ field: 'location', label: 'Ort', before: 'nicht festgelegt', after: 'Lobby' }]);
    assert.deepEqual(describeEventChanges(BASE, { ...BASE, location: { ...LOBBY, channelId: '300000000000000002' } }),
        [{ field: 'location', label: 'Ort', before: 'Lobby', after: 'Lobby' }]);
    assert.deepEqual(describeEventChanges(BASE, { ...BASE, location: { ...LOBBY, text: ' Lobby ', channelType: 'text' } }), []);
});

test('other fields never count and the order is Beginn, Ende, Ort', () => {
    const others = {
        ...BASE, title: 'Neu', description: 'Anders', maxParticipants: 99,
        registrationDeadline: SATURDAY, unregisterDeadline: SATURDAY, status: 'draft'
    };
    assert.deepEqual(describeEventChanges(BASE, others), []);
    const all = describeEventChanges(BASE, { ...BASE, location: null, endDate: SUNDAY, startDate: SUNDAY });
    assert.deepEqual(all.map(change => change.label), ['Beginn', 'Ende', 'Ort']);
});

test('the DM names the event, lists only the changed fields and links to the event', () => {
    const changes = describeEventChanges(BASE, { ...BASE, startDate: SUNDAY, location: { text: 'Event-Voice', channelId: '' } });
    const message = buildEventChangeMessage('Spieleabend', changes, 'https://dems.example.org/#event/ev-1');
    assert.match(message, /\*\*Spieleabend\*\*/);
    assert.match(message, /\*\*Beginn:\*\* ~~Sa\., 24\.10\.2026, 19:00~~ → \*\*So\., 25\.10\.2026, 19:00\*\*/);
    assert.match(message, /\*\*Ort:\*\* ~~Lobby~~ → \*\*Event-Voice\*\*/);
    assert.doesNotMatch(message, /Ende/);
    assert.ok(message.trimEnd().endsWith('https://dems.example.org/#event/ev-1'));
});

test('"nicht festgelegt" is not struck through', () => {
    const changes = describeEventChanges(BASE, { ...BASE, endDate: SUNDAY });
    const message = buildEventChangeMessage('Spieleabend', changes, 'https://dems.example.org/#event/ev-1');
    assert.match(message, /\*\*Ende:\*\* nicht festgelegt → \*\*So\., 25\.10\.2026, 19:00\*\*/);
});

test('recipients are accepted registrants and their accepted guests, each once', () => {
    const registrations = [
        { userId: 'a', status: 'accepted', guests: ['g1'], pendingGuests: [{ userId: 'invited', status: 'pending' }] },
        { userId: 'b', status: 'accepted', guests: ['g1', 'a'] },
        { userId: 'c', status: 'accepted' },
        { userId: 'p', status: 'pending', guests: ['pg'] },
        { userId: 'w', status: 'waitlisted' },
        { userId: 'r', status: 'rejected' }
    ];
    assert.deepEqual(changeRecipients(registrations), ['a', 'g1', 'b', 'c']);
    assert.deepEqual(changeRecipients([]), []);
});

test('notifyEventChange sends one DM per recipient and counts only delivered ones', async () => {
    await setDoc(doc(db, 'registrations', 'n-1'), { eventId: 'ev-n', userId: 'u1', status: 'accepted', guests: ['u2'] });
    await setDoc(doc(db, 'registrations', 'n-2'), { eventId: 'ev-n', userId: 'u3', status: 'accepted', guests: [] });
    await setDoc(doc(db, 'registrations', 'n-3'), { eventId: 'ev-n', userId: 'u4', status: 'pending', guests: [] });
    await setDoc(doc(db, 'registrations', 'other'), { eventId: 'ev-other', userId: 'u5', status: 'accepted', guests: [] });

    const sent = [];
    const send = async (userId, message) => {
        sent.push({ userId, message });
        return userId !== 'u2';
    };
    const changes = describeEventChanges(BASE, { ...BASE, startDate: SUNDAY });
    const result = await notifyEventChange({ eventId: 'ev-n', title: 'Spieleabend', changes, send });

    assert.deepEqual(result, { recipients: 3, notified: 2 });
    assert.deepEqual(sent.map(entry => entry.userId).sort(), ['u1', 'u2', 'u3']);
    assert.ok(sent.every(entry => entry.message.endsWith(buildEventUrl('ev-n'))));
});

test('notifyEventChange sends nothing without changes', async () => {
    const sent = [];
    const result = await notifyEventChange({ eventId: 'ev-n', title: 'Spieleabend', changes: [], send: async (id) => sent.push(id) });
    assert.deepEqual(result, { recipients: 0, notified: 0 });
    assert.deepEqual(sent, []);
});
