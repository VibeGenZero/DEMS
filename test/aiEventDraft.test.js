const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createTempDir } = require('./helpers');

const tmpDir = createTempDir('ai-event-draft');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'ai-draft.sqlite');
process.env.TIMEZONE = 'Europe/Berlin';

const { db, collection, getDocs, doc, setDoc, deleteDoc } = require('../firebaseAdmin');
const limits = require('../ai/limits');
const { AiError, AI_ERROR_MESSAGES } = require('../ai/errors');
const { checkEventFields } = require('../middleware/validators');
const { TEMPLATE_FIELDS } = require('../utils/eventTemplates');
const { ROLE_ID, CHANNEL_ID } = require('../dev/mockGuild');
const {
    ALLOWED_DRAFT_FIELDS, DATE_FIELDS, describeDraftFields, sanitizePatch, blameFields
} = require('../ai/draftFields');
const { extractJson, draftEvent, rewriteText } = require('../ai/eventDraft');

const NOW = new Date('2026-11-13T13:00:00Z'); // Friday, 14:00 in Berlin
const ROLES = [{ id: ROLE_ID.RAID_TEAM, name: 'Raid-Team' }, { id: ROLE_ID.VIP, name: 'VIP' }];
const CHANNELS = [
    { id: CHANNEL_ID.EVENTS, name: 'events', type: 'text' },
    { id: CHANNEL_ID.EVENT_VOICE, name: 'Event-Voice', type: 'voice' }
];
const CTX = { roles: ROLES, channels: CHANNELS, timezone: 'Europe/Berlin' };

/** A form as collectEventDraft() sends it for a new, untouched event. */
const EMPTY_DRAFT = Object.freeze({
    title: '', description: '', aiNotes: '', bannerUrl: '', startDate: '', endDate: '',
    registrationDeadline: '', unregisterDeadline: '', maxParticipants: '0', category: '',
    accessMode: 'open', approvalMode: 'manual', status: 'active', reminderHours: '', assignRoleId: '',
    requiredRoles: [], formFields: [], recurring: false, recurringInterval: 'weekly', recurringUntil: '',
    storedRecurringUntil: '', checkinMessage: '', autoCreateChannels: false,
    channelConfig: { type: 'voice', voiceName: '', textName: '' }, announceChannelId: '',
    allowGuests: true, allowTentative: false, slots: [],
    customBotMessages: { registration: '', accepted: '', rejected: '' }, accentColor: '#8b5cf6', location: null
});

/** A provider stand-in: answers the scripted texts (objects as JSON) in order, an Error is thrown. */
function scriptedClient(...answers) {
    const calls = [];
    return {
        calls,
        async chat(args) {
            calls.push(args);
            const next = answers.shift();
            if (next instanceof Error) throw next;
            if (next === undefined) throw new Error('unexpected model call');
            return { text: typeof next === 'string' ? next : JSON.stringify(next), usage: { inputTokens: 100, outputTokens: 20 } };
        }
    };
}

const plain = (value) => JSON.parse(JSON.stringify(value));
const usageRows = async () => (await getDocs(collection(db, 'aiUsage'))).docs.map(d => d.data());
const refusal = (status, error) => (err) => err && err.status === status && (!error || err.error === error);
const draftCall = (params) => draftEvent({ message: 'Raid am Samstag um 20 Uhr', draft: { ...EMPTY_DRAFT }, adminId: 'admin-1', now: NOW, ...params });

beforeEach(async () => {
    limits.resetLimits();
    for (const name of ['aiUsage', 'events', 'eventTemplates', 'registrations', 'users']) {
        for (const d of (await getDocs(collection(db, name))).docs) await deleteDoc(doc(db, name, d.id));
    }
});

test('the allowed fields are the template fields without the banner plus the four dates', () => {
    for (const field of TEMPLATE_FIELDS.filter(name => name !== 'bannerUrl')) assert.ok(ALLOWED_DRAFT_FIELDS.includes(field), field);
    for (const field of ['startDate', 'endDate', 'registrationDeadline', 'unregisterDeadline', 'aiNotes']) assert.ok(ALLOWED_DRAFT_FIELDS.includes(field));
    for (const field of ['bannerUrl', 'status', 'checkinCode', 'recurring', 'recurringUntil', 'fromPoll']) assert.equal(ALLOWED_DRAFT_FIELDS.includes(field), false, field);
    assert.equal(new Set(ALLOWED_DRAFT_FIELDS).size, ALLOWED_DRAFT_FIELDS.length);
    assert.deepEqual(DATE_FIELDS, ['startDate', 'endDate', 'registrationDeadline', 'unregisterDeadline']);

    const description = describeDraftFields();
    for (const field of ALLOWED_DRAFT_FIELDS) assert.ok(description.includes(field), `${field} is described`);
    // Limits come from the validators' constants
    for (const fact of ['200', '5000', '4000', '"open"', '"role-required"', '"manual"', '"instant"', '10', '1–30', '1–100', '"dropdown"', '"mentionable"']) {
        assert.ok(description.includes(fact), fact);
    }
});

test('extractJson reads plain JSON, fenced JSON and JSON inside prose; garbage -> null', () => {
    assert.deepEqual(extractJson('{"patch":{"title":"A"},"reply":"ok"}'), { patch: { title: 'A' }, reply: 'ok' });
    assert.deepEqual(extractJson('```json\n{"a": 1}\n```'), { a: 1 });
    assert.deepEqual(extractJson('Hier ist der Entwurf: {"a":{"b":"} {"}} Viel Spaß!'), { a: { b: '} {' } });
    assert.deepEqual(extractJson('{"a":"x\\"}"} danach {"b":2}'), { a: 'x"}' });
    assert.deepEqual(extractJson('Text {kein json} dann {"ok":true}'), { ok: true });
    // An object inside a JSON array is not top-level; brackets in prose are no array
    assert.equal(extractJson('[{"patch":{"title":"A"}}]'), null);
    assert.deepEqual(extractJson('[Hinweis] Liste [1, {"x":2}] und {"ok":true}'), { ok: true });
    for (const garbage of ['kein JSON', '', '[1, 2]', '42', '"text"', '{"a":', 'null', undefined, null, 7]) {
        assert.equal(extractJson(garbage), null, String(garbage));
    }
});

test('sanitizePatch keeps only allowed own keys', () => {
    const raw = JSON.parse('{"title":"A","status":"active","checkinCode":"1","bannerUrl":"x","__proto__":{"description":"geerbt","isAdmin":true},"constructor":{"x":1},"foo":1,"recurring":true}');
    const { patch, dropped } = sanitizePatch(raw, CTX);
    assert.deepEqual(plain(patch), { title: 'A' });
    assert.deepEqual(Object.keys(patch), ['title']);
    assert.equal(({}).isAdmin, undefined);
    assert.ok(['status', 'checkinCode', 'bannerUrl', '__proto__', 'constructor', 'foo', 'recurring']
        .every(field => dropped.some(entry => entry.field === field && entry.reason === 'not_allowed')));

    // An inherited key (here set through Object.assign's __proto__ setter) is not own and stays out
    const inherited = Object.assign({ title: 'B' }, JSON.parse('{"__proto__":{"description":"geerbt"}}'));
    assert.equal(inherited.description, 'geerbt');
    assert.deepEqual(plain(sanitizePatch(inherited, CTX).patch), { title: 'B' });

    for (const notObject of [null, undefined, 'x', 3, ['title'], new Date()]) {
        assert.deepEqual(plain(sanitizePatch(notObject, CTX)), { patch: {}, dropped: [] });
    }
});

test('sanitizePatch brings values into the shape of the editor form', () => {
    const { patch, dropped } = sanitizePatch({
        maxParticipants: 20, reminderHours: [24, '1', 24], allowGuests: 'ja', slots: [{ name: 'Tank', emoji: '🛡️', capacity: '2', id: 'x', extra: 1 }],
        formFields: [{ label: 'Klasse', type: 'dropdown', required: true, options: ['Krieger', 3, 'Magier'] }, { label: 'Notiz', type: 'weird', required: 'ja' }],
        channelConfig: { type: 'text', textName: 'raid', other: 1 }, location: 'Gildenhalle', title: 7
    }, CTX);
    assert.equal(patch.maxParticipants, '20');
    assert.equal(patch.reminderHours, '24, 1');
    // A slot id is kept for draftEvent, which only lets the ids of the form through
    assert.deepEqual(plain(patch.slots), [{ id: 'x', name: 'Tank', emoji: '🛡️', capacity: 2 }]);
    assert.deepEqual(plain(patch.formFields), [
        { label: 'Klasse', type: 'dropdown', required: true, options: ['Krieger', 'Magier'] },
        { label: 'Notiz', type: 'text', required: false }
    ]);
    // Only the given keys: draftEvent completes them from the form
    assert.deepEqual(plain(patch.channelConfig), { type: 'text', textName: 'raid' });
    assert.deepEqual(plain(patch.location), { text: 'Gildenhalle', channelId: '', channelType: '' });
    assert.equal('allowGuests' in patch, false);
    assert.equal('title' in patch, false);
    assert.deepEqual(dropped.map(entry => `${entry.field}:${entry.reason}`).sort(), ['allowGuests:invalid', 'title:invalid']);
    assert.equal(sanitizePatch({ reminderHours: '24, bald' }, CTX).patch.reminderHours, undefined);
    assert.equal(sanitizePatch({ reminderHours: '' }, CTX).patch.reminderHours, '');
    assert.equal(sanitizePatch({ location: null }, CTX).patch.location, null);
});

test('local date-times become ISO in the configured time zone; nonsense dates are dropped', () => {
    const { patch, dropped } = sanitizePatch({
        startDate: '2026-11-21T20:00', endDate: '2026-07-04T22:30:00',
        registrationDeadline: '2026-02-31T10:00', unregisterDeadline: 'nächsten Samstag'
    }, CTX);
    assert.equal(patch.startDate, '2026-11-21T19:00:00.000Z');
    assert.equal(patch.endDate, '2026-07-04T20:30:00.000Z');
    assert.equal('registrationDeadline' in patch, false);
    assert.equal('unregisterDeadline' in patch, false);
    assert.deepEqual(dropped.map(entry => `${entry.field}:${entry.reason}`).sort(), ['registrationDeadline:invalid_date', 'unregisterDeadline:invalid_date']);

    assert.equal(sanitizePatch({ startDate: '2026-11-21T20:00' }, { ...CTX, timezone: 'America/New_York' }).patch.startDate, '2026-11-22T01:00:00.000Z');
    // A time in the daylight saving gap does not exist; a full ISO string is not the asked format
    for (const value of ['2026-03-29T02:30', '2026-11-21T20:00:00.000Z', '2026-11-21', 20]) {
        assert.equal(sanitizePatch({ startDate: value }, CTX).patch.startDate, undefined, String(value));
    }
    assert.equal(sanitizePatch({ endDate: '' }, CTX).patch.endDate, '');
});

test('unknown role and channel ids are dropped and reported', () => {
    const { patch, dropped } = sanitizePatch({
        requiredRoles: [ROLE_ID.RAID_TEAM, '999999999999999999'], assignRoleId: '999999999999999998',
        announceChannelId: '888888888888888888', location: { text: 'Voice', channelId: '777777777777777777' }
    }, CTX);
    assert.deepEqual(plain(patch.requiredRoles), [ROLE_ID.RAID_TEAM]);
    assert.equal('assignRoleId' in patch, false);
    assert.equal('announceChannelId' in patch, false);
    assert.deepEqual(plain(patch.location), { text: 'Voice', channelId: '', channelType: '' });
    assert.deepEqual(dropped.map(entry => `${entry.field}:${entry.reason}`).sort(),
        ['announceChannelId:unknown_channel', 'assignRoleId:unknown_role', 'location:unknown_channel', 'requiredRoles:unknown_role']);

    const known = sanitizePatch({
        assignRoleId: ROLE_ID.VIP, announceChannelId: CHANNEL_ID.EVENTS, location: { text: 'Voice', channelId: CHANNEL_ID.EVENT_VOICE }
    }, CTX);
    assert.equal(known.patch.assignRoleId, ROLE_ID.VIP);
    assert.equal(known.patch.announceChannelId, CHANNEL_ID.EVENTS);
    assert.deepEqual(plain(known.patch.location), { text: 'Voice', channelId: CHANNEL_ID.EVENT_VOICE, channelType: 'voice' });
    assert.deepEqual(known.dropped, []);
    // Only unknown ids: the field is not touched at all
    assert.equal('requiredRoles' in sanitizePatch({ requiredRoles: ['1'] }, CTX).patch, false);
});

test('every sentence checkEventFields can return names the fields it is about', async () => {
    const bad = [
        { title: 5 }, { title: '' }, { title: 'x'.repeat(201) }, { maxParticipants: '-3' }, { accessMode: 'secret' },
        { approvalMode: 'auto' }, { announceChannelId: 'abc' }, { aiNotes: 'x'.repeat(4001) }, { status: 'gone' },
        { status: 'active' }, { startDate: '2026-11-21T19:00:00Z', endDate: '2026-11-21T18:00:00Z' },
        { startDate: '2026-11-21T19:00:00Z', registrationDeadline: 'nie', unregisterDeadline: 'nie' },
        { startDate: '2026-11-21T19:00:00Z', registrationDeadline: '2026-11-25T19:00:00Z', unregisterDeadline: '2026-11-25T19:00:00Z' },
        { description: 'x'.repeat(5001) }, { bannerUrl: 'javascript:alert(1)' }, { accentColor: 'red' }
    ];
    const sentences = new Set();
    for (const body of bad) for (const sentence of await checkEventFields({ title: 'T', ...body })) sentences.add(sentence);
    // Tripwire: a new rule in checkEventFields needs an entry in the table of ai/draftFields.js and a body above
    const source = fs.readFileSync(path.join(__dirname, '..', 'middleware', 'validators.js'), 'utf8');
    assert.equal(source.split('errors.push(').length - 1, 16);
    assert.equal(sentences.size, 17);
    for (const sentence of sentences) {
        const fields = blameFields(sentence);
        assert.ok(Array.isArray(fields) && fields.length > 0, sentence);
    }
    assert.deepEqual(blameFields('Das Ende liegt vor dem Start.'), ['endDate', 'startDate']);
    assert.equal(blameFields('Irgendein anderer Satz.'), null);
});

test('a valid patch is returned with the reply and no second model call', async () => {
    const client = scriptedClient({
        patch: { title: 'Raid-Abend', startDate: '2026-11-21T20:00', maxParticipants: 20, reminderHours: [24, 1] },
        reply: 'Entwurf ist im Formular.', questions: []
    });
    const result = await draftCall({ client, history: [{ role: 'user', text: 'Hallo' }, { role: 'assistant', text: 'Hi' }] });
    assert.deepEqual(plain(result), {
        patch: { title: 'Raid-Abend', startDate: '2026-11-21T19:00:00.000Z', maxParticipants: '20', reminderHours: '24, 1' },
        reply: 'Entwurf ist im Formular.', questions: []
    });
    assert.equal(client.calls.length, 1);
    const call = client.calls[0];
    assert.equal(call.json, true);
    assert.equal(call.maxTokens, 2000);
    assert.equal(call.timeoutMs, 120000);
    assert.deepEqual(call.messages, [{ role: 'user', text: 'Hallo' }, { role: 'assistant', text: 'Hi' }, { role: 'user', text: 'Raid am Samstag um 20 Uhr' }]);
    const rows = await usageRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].adminRequests, 1);
    assert.equal(rows[0].inputTokens, 100);
});

test('prose instead of JSON triggers exactly one repair call', async () => {
    const client = scriptedClient('Gern, ich trage den Raid ein!', '```json\n{"patch":{"title":"Raid"},"reply":"Erledigt.","questions":[]}\n```');
    const result = await draftCall({ client });
    assert.deepEqual(plain(result.patch), { title: 'Raid' });
    assert.equal(result.reply, 'Erledigt.');
    assert.equal(client.calls.length, 2);
    const repair = client.calls[1].messages;
    assert.deepEqual(repair.at(-1), { role: 'user', text: 'Antworte nur mit einem JSON-Objekt.' });
    assert.deepEqual(repair.at(-2), { role: 'assistant', text: 'Gern, ich trage den Raid ein!' });
    assert.equal(client.calls[1].json, true);
    // Both calls are one request in the counters
    const rows = await usageRows();
    assert.equal(rows[0].adminRequests, 1);
    assert.equal(rows[0].inputTokens, 200);
    assert.equal(rows[0].outputTokens, 40);

    // Prose twice: still only one repair, and an explanation instead of a patch
    const stubborn = scriptedClient('Nein.', 'Immer noch nein. {"patch": [1]}');
    const empty = await draftCall({ client: stubborn });
    assert.equal(stubborn.calls.length, 2);
    assert.deepEqual(plain(empty), { patch: {}, reply: 'Ich konnte daraus keine Änderungen ableiten. Beschreib es bitte etwas genauer.', questions: [] });
});

test('a patch that fails validation is repaired once; what still fails is removed and named', async () => {
    const slots = Array.from({ length: 21 }, (_, i) => ({ name: `Slot ${i + 1}`, capacity: 1 }));
    const bad = { title: 'Raid', startDate: '2026-11-21T20:00', endDate: '2026-11-21T18:00', slots, maxParticipants: -3 };
    const halfFixed = { ...bad, slots: [{ name: 'Tank', emoji: '🛡️', capacity: 2 }] };
    const client = scriptedClient(
        { patch: bad, reply: 'Entwurf ist im Formular.', questions: [] },
        { patch: halfFixed, reply: 'Korrigiert.', questions: [] }
    );
    const result = await draftCall({ client });
    assert.equal(client.calls.length, 2);
    const repairText = client.calls[1].messages.at(-1).text;
    for (const sentence of ['Das Ende liegt vor dem Start.', 'Maximale Teilnehmerzahl muss eine Zahl >= 0 sein.', 'Es sind höchstens 10 Slots erlaubt.']) {
        assert.ok(repairText.includes(sentence), sentence);
    }
    assert.deepEqual(plain(result.patch), {
        title: 'Raid', startDate: '2026-11-21T19:00:00.000Z', slots: [{ name: 'Tank', emoji: '🛡️', capacity: 2 }]
    });
    assert.equal(result.reply, 'Korrigiert. Nicht übernommen: Max. Teilnehmer, Ende.');
    // What is returned passes the same check as a manual save
    assert.deepEqual(await checkEventFields({ ...EMPTY_DRAFT, ...plain(result.patch) }), []);
});

test('errors the admin has not caused yet do not count against the patch', async () => {
    // No title and no start in the form: a patch that only sets the category is fine
    const client = scriptedClient({ patch: { category: 'Raid' }, reply: 'Kategorie gesetzt.', questions: [] });
    const result = await draftCall({ client });
    assert.equal(client.calls.length, 1);
    assert.deepEqual(plain(result.patch), { category: 'Raid' });
    assert.equal(result.reply, 'Kategorie gesetzt.');

    // A start moved behind a deadline of the form breaks the relation: the start is the field that goes
    const draft = { ...EMPTY_DRAFT, title: 'Raid', startDate: '2026-11-21T19:00:00.000Z', registrationDeadline: '2026-11-21T18:00:00.000Z' };
    const moved = scriptedClient(
        { patch: { startDate: '2026-11-20T10:00' }, reply: 'Verschoben.', questions: [] },
        { patch: { startDate: '2026-11-20T10:00' }, reply: 'Verschoben.', questions: [] }
    );
    const kept = await draftCall({ client: moved, draft });
    assert.equal(moved.calls.length, 2);
    assert.ok(moved.calls[1].messages.at(-1).text.includes('Der Anmeldeschluss liegt nach dem Ende des Events.'));
    assert.deepEqual(plain(kept.patch), {});
    assert.equal(kept.reply, 'Ich konnte daraus keine Änderungen ableiten. Beschreib es bitte etwas genauer. Nicht übernommen: Beginn.');
});

test('slots keep the ids of the form by name; nested settings keep untouched keys', async () => {
    const draft = { ...EMPTY_DRAFT, slots: [{ id: 'slot-aaa', name: 'Tank', emoji: '', capacity: 2 }, { id: 'slot-bbb', name: 'Schild', emoji: '', capacity: 1 }], customBotMessages: { registration: 'Hallo', accepted: 'Super', rejected: '' } };
    const client = scriptedClient({
        patch: { slots: [{ name: 'tank', capacity: 3 }, { name: 'Heiler', capacity: 2, id: 'fremd' }, { id: 'slot-bbb', name: 'Verteidiger', capacity: 1 }], customBotMessages: { rejected: 'Leider nein.' } },
        reply: 'Slots angepasst.', questions: []
    });
    const result = await draftCall({ client, draft });
    // Same name (any case) or a renamed slot sent with its id keeps the id; a foreign id is dropped
    assert.deepEqual(plain(result.patch.slots), [
        { id: 'slot-aaa', name: 'tank', emoji: '', capacity: 3 }, { name: 'Heiler', emoji: '', capacity: 2 },
        { id: 'slot-bbb', name: 'Verteidiger', emoji: '', capacity: 1 }
    ]);
    assert.deepEqual(plain(result.patch.customBotMessages), { registration: 'Hallo', accepted: 'Super', rejected: 'Leider nein.' });
});

test('an empty result explains itself in German', async () => {
    const client = scriptedClient({ patch: { status: 'active' }, reply: 'Okay.', questions: [] });
    const result = await draftCall({ client });
    assert.equal(client.calls.length, 1);
    assert.deepEqual(plain(result), { patch: {}, reply: 'Ich konnte daraus keine Änderungen ableiten. Beschreib es bitte etwas genauer.', questions: [] });
});

test('questions are passed through, at most three', async () => {
    const client = scriptedClient({
        patch: { title: 'Raid' }, reply: 'r'.repeat(700),
        questions: ['An welchem Tag?', 7, 'q'.repeat(400), 'Wie viele Plätze?', 'Welche Rollen?']
    });
    const result = await draftCall({ client });
    assert.deepEqual(result.questions, ['An welchem Tag?', 'q'.repeat(300), 'Wie viele Plätze?']);
    assert.equal(result.reply, 'r'.repeat(600));

    // Questions without a patch: the model's reply stays
    const asking = scriptedClient({ patch: {}, reply: 'Mir fehlt das Datum.', questions: ['Wann soll der Raid sein?'] });
    const asked = await draftCall({ client: asking });
    assert.deepEqual(plain(asked), { patch: {}, reply: 'Mir fehlt das Datum.', questions: ['Wann soll der Raid sein?'] });
});

test('the model sees roles, channels, templates and recent events but no registrations or members', async () => {
    await setDoc(doc(db, 'eventTemplates', 'tpl-1'), { name: 'Raid-Vorlage', settings: { title: 'Raid', maxParticipants: 15, bannerUrl: 'https://cdn.example/tpl-banner.png', slots: [] } });
    for (let i = 1; i <= 11; i++) {
        await setDoc(doc(db, 'events', `ev-${i}`), {
            title: `Event Nummer ${i}`, category: 'Raid', status: 'active', startDate: '2026-11-07T19:00:00.000Z',
            createdAt: new Date(Date.UTC(2026, 9, i)).toISOString(), maxParticipants: 20, checkinCode: `98765${i}`,
            requiredRoles: [ROLE_ID.RAID_TEAM], slots: [{ id: 's1', name: 'Tank', emoji: '', capacity: 2 }],
            formFields: [{ label: 'Charaktername', type: 'text' }], description: 'Geheime Beschreibung alter Events'
        });
    }
    await setDoc(doc(db, 'registrations', 'reg-1'), { eventId: 'ev-11', userId: '200000000000000011', username: 'kira-geheim', formAnswers: { Charaktername: 'Schattenklinge' } });
    await setDoc(doc(db, 'users', '200000000000000011'), { username: 'kira-geheim', displayName: 'Kira Geheim' });
    const draft = { ...EMPTY_DRAFT, title: 'Mein Entwurf', status: 'draft', bannerUrl: 'https://cdn.example/draft-banner.png', checkinCode: 'draft-code-1', description: 'd'.repeat(6000), startDate: '2026-11-21T19:00:00.000Z' };

    const client = scriptedClient({ patch: { title: 'Neu' }, reply: 'Ok.', questions: [] });
    await draftCall({ client, draft });
    const { system } = client.calls[0];
    for (const fact of [
        'Raid-Team (110000000000000004)', 'events (120000000000000003', 'Event-Voice (120000000000000005', 'Raid-Vorlage',
        'Event Nummer 11', 'Event Nummer 2', 'Charaktername', 'Tank', 'Freitag, 13.11.2026, 14:00', 'Europe/Berlin',
        'Mein Entwurf', '2026-11-21T20:00', 'YYYY-MM-DDTHH:mm', 'nur Daten', '"patch"', '"questions"'
    ]) assert.ok(system.includes(fact), fact);
    for (const secret of [
        'Event Nummer 1 ', 'Event Nummer 1\n', '987651', '9876511', 'kira-geheim', 'Kira Geheim', 'Schattenklinge',
        'draft-code-1', 'draft-banner.png', 'tpl-banner.png', 'Geheime Beschreibung', 'd'.repeat(5001), 'admin-1'
    ]) assert.equal(system.includes(secret), false, secret);
    assert.ok(system.includes('d'.repeat(5000)));
});

test('what goes into the prompt is capped', async () => {
    for (let i = 0; i < 25; i++) {
        await setDoc(doc(db, 'eventTemplates', `tpl-${i}`), { name: `Vorlage ${String(i).padStart(2, '0')}`, settings: { description: `${i}-` + 'x'.repeat(3000) } });
    }
    const client = scriptedClient({ patch: { title: 'Neu' }, reply: 'Ok.', questions: [] });
    await draftCall({ client, message: 'm'.repeat(2000), history: [{ role: 'user', text: 'h'.repeat(1500) }] });
    const { system, messages } = client.calls[0];
    assert.equal((system.match(/Vorlage \d\d/g) || []).length, 20);
    assert.equal(system.includes('x'.repeat(1600)), false);
    assert.equal(messages[0].text.length, 1000);
    assert.equal(messages.at(-1).text.length, 2000);
});

test('an empty or too long message is refused without calling the model', async () => {
    const client = scriptedClient();
    for (const message of ['', '   ', 'x'.repeat(2001), undefined, 5]) {
        await assert.rejects(draftCall({ client, message }), refusal(400, 'Bitte beschreibe kurz, was du brauchst (höchstens 2000 Zeichen).'));
    }
    assert.equal(client.calls.length, 0);
    assert.deepEqual(await usageRows(), []);
});

test('a provider error is refused with its admin text and counted as failed', async () => {
    const client = scriptedClient(new AiError('timeout'));
    await assert.rejects(draftCall({ client }), refusal(503, AI_ERROR_MESSAGES.timeout));
    const rows = await usageRows();
    assert.equal(rows[0].adminRequests, 1);
    assert.equal(rows[0].errors, 1);
});

test('the 61st request within an hour is refused', async () => {
    for (let i = 0; i < 60; i++) assert.equal(limits.allowAdminRequest('admin-1', NOW), true);
    const client = scriptedClient({ patch: { title: 'x' }, reply: 'Ok.', questions: [] });
    await assert.rejects(draftCall({ client }), refusal(429, 'Du hast das KI-Limit für diese Stunde erreicht.'));
    await assert.rejects(rewriteText({ kind: 'improve-description', draft: { description: 'Text' }, adminId: 'admin-1', client, now: NOW }),
        refusal(429, 'Du hast das KI-Limit für diese Stunde erreicht.'));
    assert.equal(client.calls.length, 0);
    // Another admin has an own window
    assert.deepEqual(plain((await draftCall({ client, adminId: 'admin-2' })).patch), { title: 'x' });
});

test('rewriteText improves the description and suggests aiNotes as plain text', async () => {
    const draft = { ...EMPTY_DRAFT, title: 'Raid-Abend', description: 'wir raiden samstag, bringt flasks mit', aiNotes: 'Treffpunkt Gildenhalle' };
    const client = scriptedClient('```markdown\n## Raid-Abend\n\nBringt Flasks mit.\n```', 'x'.repeat(4500));
    const improved = await rewriteText({ kind: 'improve-description', draft, adminId: 'admin-1', client, now: NOW });
    assert.deepEqual(improved, { text: '## Raid-Abend\n\nBringt Flasks mit.' });
    const first = client.calls[0];
    assert.notEqual(first.json, true);
    assert.equal(first.timeoutMs, 120000);
    assert.ok(first.system.includes('wir raiden samstag, bringt flasks mit'));
    assert.ok(first.system.includes('Markdown'));
    assert.equal(first.messages.at(-1).role, 'user');

    const notes = await rewriteText({ kind: 'suggest-ai-notes', draft, adminId: 'admin-1', client, now: NOW });
    assert.equal(notes.text.length, 4000);
    assert.ok(client.calls[1].system.includes('Treffpunkt Gildenhalle'));
    assert.ok(client.calls[1].system.includes('Antwort:'));
    assert.equal((await usageRows())[0].adminRequests, 2);
});

test('rewriteText refuses an unknown kind and an empty description', async () => {
    const client = scriptedClient();
    await assert.rejects(rewriteText({ kind: 'translate', draft: {}, adminId: 'admin-1', client, now: NOW }), refusal(400, 'Unbekannte KI-Aktion.'));
    await assert.rejects(rewriteText({ kind: 'improve-description', draft: { description: '  ' }, adminId: 'admin-1', client, now: NOW }),
        refusal(400, 'Es gibt noch keine Beschreibung zum Verbessern.'));
    assert.equal(client.calls.length, 0);
    const failing = scriptedClient(new AiError('rate_limited'));
    await assert.rejects(rewriteText({ kind: 'suggest-ai-notes', draft: {}, adminId: 'admin-1', client: failing, now: NOW }),
        refusal(503, AI_ERROR_MESSAGES.rate_limited));
});
