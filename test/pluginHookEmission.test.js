// The core emits the plugin hooks on every event change and stores the plugin origin on create.
// Web paths run through the real server with hook-recorder switched on; the Discord
// paths and the auto-archive run in this process (mock mode) with a recording handler.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir, createFakeInteraction, dispatchInteraction } = require('./helpers');
const { PLUGIN, IDLE_PLUGIN, startPluginServer, loginAt } = require('./pluginTestServer');

// In-process mock mode with an own database; the empty cwd keeps a local .env out
const tmpDir = createTempDir('hook-emission');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'hooks.sqlite');

const bot = require('../bot');
const { db, collection, doc, getDoc, getDocs, setDoc } = require('../firebaseAdmin');
const { PERSONAS, ROLE_ID } = require('../dev/mockGuild');
const { HOOK_NAMES, onHook, whenHooksIdle } = require('../plugin-sdk/hooks');
const { validatePluginOrigin, changedFields, safeEmit, safeStatusChange } = require('../plugin-sdk/coreHooks');
const { archiveEndedEvents } = require('../utils/eventArchive');
const { checkInMember } = require('../utils/checkin');

const ADMIN = PERSONAS.find(persona => persona.id === 'admin');
const INVALID_ORIGIN = { error: 'Ungültige Plugin-Herkunft.' };
const DAY = 86_400_000;

let server;
let admin;
const seen = [];

before(async () => {
    process.env.DISCORD_ADMIN_ROLE_ID = ROLE_ID.ADMIN;
    for (const name of HOOK_NAMES) onHook('probe', name, payload => { seen.push({ hook: name, payload }); });
    server = await startPluginServer();
    admin = await loginAt(server.baseUrl, 'admin');
});

after(async () => {
    await bot.client.destroy();
    await server.stop();
});

const futureIso = (days) => new Date(Date.now() + days * DAY).toISOString();
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const eventIdOf = (entry) => (entry.payload.event ? entry.payload.event.id : entry.payload.eventId);

/**
 * Hook entries hook-recorder logged for the given events, in emission order.
 * Hooks run asynchronously: poll until `count` entries are there (max ~2 s),
 * then look once more so a late extra entry is caught too.
 */
async function hooksFor(eventIds, count) {
    const ids = new Set([].concat(eventIds));
    const read = async () => {
        const res = await admin.request(`/api/plugins/${PLUGIN}/log`);
        assert.equal(res.status, 200);
        return (await res.json()).filter(entry => ids.has(eventIdOf(entry)));
    };
    let entries = await read();
    for (let i = 0; i < 40 && entries.length < count; i++) {
        await sleep(50);
        entries = await read();
    }
    await sleep(150);
    return read();
}
const names = (entries) => entries.map(entry => entry.hook);

async function createEvent(body) {
    const res = await admin.send('POST', '/api/admin/events', { startDate: futureIso(7), ...body });
    assert.equal(res.status, 200, await res.clone().text());
    return res.json();
}
async function storedAsAdmin(eventId) {
    const res = await admin.request(`/api/events/${eventId}`);
    assert.equal(res.status, 200);
    return res.json();
}

// ── Origin check and emission helpers (unit) ────────────────────────────

/** Fake host: hook-recorder on with events:draft, reader on without it, idle-recorder off. */
const fakeHost = {
    isEnabled: (id) => id === 'hook-recorder' || id === 'reader',
    entryOf: (id) => ({
        'hook-recorder': { manifest: { permissions: ['events:read', 'events:draft'] } },
        reader: { manifest: { permissions: ['events:read'] } },
        'idle-recorder': { manifest: { permissions: ['events:read', 'events:draft'] } }
    })[id] || null
};

for (const [label, value, expected] of [
    ['a valid origin', { plugin: 'hook-recorder', ref: 'sub-1' }, { ok: true, origin: { plugin: 'hook-recorder', ref: 'sub-1' } }],
    ['a ref with spaces around it', { plugin: 'hook-recorder', ref: '  sub-2 ' }, { ok: true, origin: { plugin: 'hook-recorder', ref: 'sub-2' } }],
    ['a ref of 100 characters', { plugin: 'hook-recorder', ref: 'x'.repeat(100) }, { ok: true, origin: { plugin: 'hook-recorder', ref: 'x'.repeat(100) } }],
    ['a ref of 101 characters', { plugin: 'hook-recorder', ref: 'x'.repeat(101) }, { ok: false }],
    ['an empty ref', { plugin: 'hook-recorder', ref: '   ' }, { ok: false }],
    ['a ref that is a number', { plugin: 'hook-recorder', ref: 7 }, { ok: false }],
    ['a plugin that is off', { plugin: 'idle-recorder', ref: 'sub-1' }, { ok: false }],
    ['a plugin without events:draft', { plugin: 'reader', ref: 'sub-1' }, { ok: false }],
    ['an unknown plugin', { plugin: 'no-such-plugin', ref: 'sub-1' }, { ok: false }],
    ['a plugin id that is no string', { plugin: ['hook-recorder'], ref: 'sub-1' }, { ok: false }],
    ['an array', [{ plugin: 'hook-recorder', ref: 'sub-1' }], { ok: false }],
    ['a string', 'hook-recorder', { ok: false }],
    ['null', null, { ok: false }]
]) {
    test(`validatePluginOrigin: ${label}`, () => {
        assert.deepEqual(validatePluginOrigin(value, fakeHost), expected);
    });
}

test('validatePluginOrigin refuses everything while the host is not running', () => {
    const brokenHost = { isEnabled: () => { throw new Error('not ready'); }, entryOf: () => null };
    assert.deepEqual(validatePluginOrigin({ plugin: 'hook-recorder', ref: 'sub-1' }, brokenHost), { ok: false });
});

test('changedFields lists the keys whose value differs, without updatedAt', () => {
    const old = { title: 'Alt', slots: [{ id: 'a' }], location: null, updatedAt: '2026-01-01' };
    const updates = { title: 'Neu', slots: [{ id: 'a' }], location: null, allowTentative: false, updatedAt: '2026-02-02' };
    assert.deepEqual(changedFields(old, updates), ['title', 'allowTentative']);
});

test('an emission that throws never reaches the caller and is logged', (t) => {
    const logged = t.mock.method(console, 'error', () => {});
    assert.doesNotThrow(() => safeEmit('event.created', () => { throw new Error('kaputt'); }));
    // A payload that cannot be copied for a handler
    assert.doesNotThrow(() => safeEmit('event.created', { fn: () => {} }));
    assert.doesNotThrow(() => safeStatusChange({ eventId: 'x', before: null, after: { status: 'active', fn: () => {} } }));
    assert.equal(logged.mock.callCount(), 3);
});

// ── Web paths (dev server, hook-recorder on) ────────────────────────────

test('creating a draft emits event.created', async () => {
    const event = await createEvent({ title: 'Hook Entwurf', status: 'draft' });
    const entries = await hooksFor(event.id, 1);
    assert.deepEqual(names(entries), ['event.created']);
    assert.equal(entries[0].payload.event.title, 'Hook Entwurf');
    assert.equal(entries[0].payload.event.origin, null);
});

test('creating an active event emits event.created, then event.published', async () => {
    const event = await createEvent({ title: 'Hook Aktiv', status: 'active' });
    assert.deepEqual(names(await hooksFor(event.id, 2)), ['event.created', 'event.published']);
});

test('PUT …/status from draft to active emits event.published', async () => {
    const event = await createEvent({ title: 'Hook Status', status: 'draft' });
    await hooksFor(event.id, 1);
    const res = await admin.send('PUT', `/api/admin/events/${event.id}/status`, { status: 'active' });
    assert.equal(res.status, 200);
    assert.deepEqual(names(await hooksFor(event.id, 2)), ['event.created', 'event.published']);
});

test('PUT /events/:id with a new title emits event.updated naming the title', async () => {
    const event = await createEvent({ title: 'Hook Titel', status: 'active' });
    await hooksFor(event.id, 2);
    const res = await admin.send('PUT', `/api/admin/events/${event.id}`, { ...event, title: 'Hook Titel neu' });
    assert.equal(res.status, 200);
    const entries = await hooksFor(event.id, 3);
    assert.deepEqual(names(entries), ['event.created', 'event.published', 'event.updated']);
    const { payload } = entries[2];
    assert.ok(payload.changed.includes('title'), JSON.stringify(payload.changed));
    assert.ok(!payload.changed.includes('updatedAt'));
    assert.equal(payload.event.title, 'Hook Titel neu');
});

test('POST …/end emits event.ended', async () => {
    const event = await createEvent({ title: 'Hook Ende', status: 'active' });
    await hooksFor(event.id, 2);
    assert.equal((await admin.send('POST', `/api/admin/events/${event.id}/end`, {})).status, 200);
    assert.deepEqual(names(await hooksFor(event.id, 3)), ['event.created', 'event.published', 'event.ended']);
});

test('PUT …/cancel emits event.cancelled', async () => {
    const event = await createEvent({ title: 'Hook Absage', status: 'active' });
    await hooksFor(event.id, 2);
    assert.equal((await admin.send('PUT', `/api/admin/events/${event.id}/cancel`, {})).status, 200);
    assert.deepEqual(names(await hooksFor(event.id, 3)), ['event.created', 'event.published', 'event.cancelled']);
});

test('duplicating emits event.created for the copy, without the origin', async () => {
    const event = await createEvent({ title: 'Hook Original', status: 'draft', pluginOrigin: { plugin: PLUGIN, ref: 'dup-1' } });
    const res = await admin.send('POST', `/api/admin/events/${event.id}/duplicate`, {});
    assert.equal(res.status, 200);
    const copy = await res.json();
    assert.equal(copy.origin, undefined);
    const entries = await hooksFor(copy.id, 1);
    assert.deepEqual(names(entries), ['event.created']);
    assert.equal(entries[0].payload.event.origin, null);
    assert.equal((await storedAsAdmin(copy.id)).origin, undefined);
});

test('a series of 3 dates emits 3 × event.created; only the first date carries the origin', async () => {
    const start = futureIso(7);
    const until = new Date(Date.parse(start) + 14 * DAY).toISOString().slice(0, 10);
    const body = await createEvent({
        title: 'Hook Serie', status: 'draft', startDate: start,
        recurring: true, recurringInterval: 'weekly', recurringUntil: until,
        pluginOrigin: { plugin: PLUGIN, ref: 'series-1' }
    });
    assert.equal(body.count, 3);
    const ids = body.events.map(event => event.id);
    const entries = await hooksFor(ids, 3);
    assert.deepEqual(names(entries), ['event.created', 'event.created', 'event.created']);
    assert.deepEqual(entries.map(eventIdOf), ids);
    assert.deepEqual(entries.map(entry => entry.payload.event.origin), [{ plugin: PLUGIN, ref: 'series-1' }, null, null]);
    assert.deepEqual((await storedAsAdmin(ids[0])).origin, { plugin: PLUGIN, ref: 'series-1' });
    assert.equal((await storedAsAdmin(ids[1])).origin, undefined);

    // Deleting the series emits event.deleted once per date, with the stored origin
    const seriesId = body.events[0].seriesId;
    assert.equal((await admin.send('DELETE', `/api/admin/events/series/${seriesId}`)).status, 200);
    const deleted = (await hooksFor(ids, 6)).filter(entry => entry.hook === 'event.deleted');
    // The route deletes in storage order, not by date
    const byDate = deleted.map(entry => entry.payload).sort((a, b) => ids.indexOf(a.eventId) - ids.indexOf(b.eventId));
    assert.equal(deleted.length, 3);
    assert.deepEqual(byDate, [
        { eventId: ids[0], origin: { plugin: PLUGIN, ref: 'series-1' } },
        { eventId: ids[1], origin: null },
        { eventId: ids[2], origin: null }
    ]);
});

test('extending a series emits the hooks of the new date, without the origin', async () => {
    const start = futureIso(7);
    const body = await createEvent({
        title: 'Hook Verlängerung', status: 'active', startDate: start,
        recurring: true, recurringInterval: 'weekly', recurringUntil: start.slice(0, 10),
        pluginOrigin: { plugin: PLUGIN, ref: 'extend-1' }
    });
    assert.equal(body.count, 1);
    const [first] = body.events;
    const until = new Date(Date.parse(start) + 7 * DAY).toISOString().slice(0, 10);
    const res = await admin.send('PUT', `/api/admin/events/${first.id}`, { ...first, recurringUntil: until });
    assert.equal(res.status, 200, await res.clone().text());
    assert.equal((await res.json()).createdDates, 1);

    const all = await (await admin.request('/api/admin/all-events')).json();
    const added = all.find(event => event.seriesId === first.seriesId && event.id !== first.id);
    assert.equal(added.origin, undefined);
    // The new date copies the status: active, so it is published as well
    const entries = await hooksFor(added.id, 2);
    assert.deepEqual(names(entries), ['event.created', 'event.published']);
    assert.equal(entries[0].payload.event.origin, null);
});

test('POST …/start of a draft emits event.published', async () => {
    const event = await createEvent({ title: 'Hook Start', status: 'draft' });
    await hooksFor(event.id, 1);
    assert.equal((await admin.send('POST', `/api/admin/events/${event.id}/start`, {})).status, 200);
    assert.deepEqual(names(await hooksFor(event.id, 2)), ['event.created', 'event.published']);
});

test('DELETE /events/:id emits event.deleted with the origin', async () => {
    const event = await createEvent({ title: 'Hook Löschen', status: 'draft', pluginOrigin: { plugin: PLUGIN, ref: 'del-1' } });
    await hooksFor(event.id, 1);
    assert.equal((await admin.send('DELETE', `/api/admin/events/${event.id}`)).status, 200);
    const entries = await hooksFor(event.id, 2);
    assert.deepEqual(names(entries), ['event.created', 'event.deleted']);
    assert.deepEqual(entries[1].payload, { eventId: event.id, origin: { plugin: PLUGIN, ref: 'del-1' } });
});

test('an origin of a plugin that is off answers 400 and writes nothing', async () => {
    const before = (await (await admin.request('/api/admin/all-events')).json()).length;
    for (const pluginOrigin of [{ plugin: IDLE_PLUGIN, ref: 'x' }, { plugin: PLUGIN, ref: '' }, 'kaputt']) {
        const res = await admin.send('POST', '/api/admin/events', { title: 'Hook Fremd', startDate: futureIso(7), status: 'draft', pluginOrigin });
        assert.equal(res.status, 400);
        assert.deepEqual(await res.json(), INVALID_ORIGIN);
    }
    // Also with a poll decision: refused before the poll is touched
    const fromPoll = await admin.send('POST', '/api/admin/events', {
        title: 'Hook Fremd', startDate: futureIso(7), status: 'active',
        fromPoll: { pollId: 'no-such-poll', optionId: 'x' }, pluginOrigin: { plugin: IDLE_PLUGIN, ref: 'x' }
    });
    assert.equal(fromPoll.status, 400);
    assert.deepEqual(await fromPoll.json(), INVALID_ORIGIN);
    assert.equal((await (await admin.request('/api/admin/all-events')).json()).length, before);
});

test('PUT /events/:id ignores origin and pluginOrigin', async () => {
    const event = await createEvent({ title: 'Hook Herkunft', status: 'active', pluginOrigin: { plugin: PLUGIN, ref: 'keep-1' } });
    const res = await admin.send('PUT', `/api/admin/events/${event.id}`, {
        ...event, origin: { plugin: 'other', ref: 'x' }, pluginOrigin: { plugin: PLUGIN, ref: 'changed' }
    });
    assert.equal(res.status, 200);
    assert.deepEqual((await storedAsAdmin(event.id)).origin, { plugin: PLUGIN, ref: 'keep-1' });

    const plain = await createEvent({ title: 'Hook Ohne Herkunft', status: 'active' });
    await admin.send('PUT', `/api/admin/events/${plain.id}`, { ...plain, pluginOrigin: { plugin: PLUGIN, ref: 'late' } });
    assert.equal((await storedAsAdmin(plain.id)).origin, undefined);
});

test('members never see the origin, admins do', async () => {
    const event = await createEvent({ title: 'Hook Sichtbar', status: 'active', pluginOrigin: { plugin: PLUGIN, ref: 'seen-1' } });
    const member = await loginAt(server.baseUrl, 'member');
    const res = await member.request(`/api/events/${event.id}`);
    assert.equal(res.status, 200);
    assert.ok(!('origin' in (await res.json())));
    assert.deepEqual((await storedAsAdmin(event.id)).origin, { plugin: PLUGIN, ref: 'seen-1' });
});

test('hook payloads never carry the check-in code and keep hostile text as plain data', async () => {
    const hostile = '<img src=x onerror=alert(1)> @everyone <@&123>';
    const event = await createEvent({ title: hostile, status: 'active' });
    assert.equal((await admin.send('POST', `/api/admin/events/${event.id}/generate-checkin`, {})).status, 200);
    assert.equal((await admin.send('PUT', `/api/admin/events/${event.id}`, { ...event, description: 'Neu' })).status, 200);
    assert.equal((await admin.send('PUT', `/api/admin/events/${event.id}/cancel`, {})).status, 200);
    const entries = await hooksFor(event.id, 4);
    assert.deepEqual(names(entries), ['event.created', 'event.published', 'event.updated', 'event.cancelled']);
    for (const entry of entries) {
        assert.ok(!JSON.stringify(entry.payload).includes('checkinCode'), entry.hook);
        assert.equal(entry.payload.event.title, hostile);
    }
});

test('registration.checkedIn: code check-in and admin toggle, never for a repeat or an undo', async () => {
    const event = await createEvent({ title: 'Hook Check-in', status: 'active', approvalMode: 'instant', startDate: new Date(Date.now() - 3600_000).toISOString() });
    const member = await loginAt(server.baseUrl, 'member');
    const raider = await loginAt(server.baseUrl, 'raider');
    for (const client of [member, raider]) {
        const res = await client.send('POST', `/api/events/${event.id}/register`, {});
        assert.equal(res.status, 200, await res.clone().text());
    }
    const { code } = await (await admin.send('POST', `/api/admin/events/${event.id}/generate-checkin`, {})).json();
    for (let i = 0; i < 2; i++) {
        const res = await member.send('POST', `/api/events/${event.id}/checkin`, { code });
        assert.equal(res.status, 200, await res.clone().text());
    }
    const list = await (await admin.request(`/api/admin/events/${event.id}/registrations`)).json();
    const raiderReg = list.data.find(reg => reg.userId === PERSONAS.find(p => p.id === 'raider').userId);
    for (const checkedIn of [true, true, false]) {
        const res = await admin.send('PUT', `/api/admin/registrations/${raiderReg.id}/checkin`, { checkedIn });
        assert.equal(res.status, 200, await res.clone().text());
    }
    // 4 = event.created + event.published of the active event + the two first check-ins
    const entries = (await hooksFor(event.id, 4)).filter(entry => entry.hook === 'registration.checkedIn');
    assert.deepEqual(entries.map(entry => entry.payload.registration.userId),
        ['member', 'raider'].map(id => PERSONAS.find(p => p.id === id).userId));
    for (const entry of entries) {
        assert.deepEqual(Object.keys(entry.payload).sort(), ['eventId', 'registration']);
        assert.equal(entry.payload.eventId, event.id);
        assert.equal(entry.payload.registration.checkedIn, true);
        assert.equal(typeof entry.payload.registration.checkedInAt, 'string');
        assert.equal('formAnswers' in entry.payload.registration, false);
    }
});

// ── Discord paths and the auto-archive (this process, mock mode) ────────

async function seenFor(eventId) {
    await whenHooksIdle();
    return seen.filter(entry => eventIdOf(entry) === eventId);
}
async function eventTitled(title) {
    const snap = await getDocs(collection(db, 'events'));
    return snap.docs.map(entry => ({ id: entry.id, ...entry.data() })).find(event => event.title === title);
}
/** A future day as the admin types it: "TT.MM.JJJJ HH:MM" in the server time zone. */
function typedDate(days, time = '19:30') {
    const date = new Date(Date.now() + days * DAY);
    const parts = new Intl.DateTimeFormat('de-DE', { timeZone: process.env.TIMEZONE || 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
    return `${parts} ${time}`;
}
async function answeredInteraction({ kind, customId, fields = {} }) {
    const interaction = createFakeInteraction({ kind, customId, userId: ADMIN.userId, roles: ADMIN.roles });
    interaction.guildId = 'guild-1';
    interaction.fields = { getTextInputValue: (id) => (id in fields ? fields[id] : '') };
    await dispatchInteraction(bot.client, interaction);
    const last = () => interaction.calls[interaction.calls.length - 1][0];
    for (let i = 0; i < 100 && last() !== 'editReply'; i++) await sleep(10);
    return interaction;
}

test('Discord /event erstellen emits event.created; the publish button emits event.published', async () => {
    await answeredInteraction({ kind: 'modal', customId: 'admin_event_modal:-', fields: { title: 'Hook Discord', start: typedDate(10) } });
    const event = await eventTitled('Hook Discord');
    assert.ok(event, 'event stored');
    assert.equal(event.status, 'draft');
    assert.deepEqual(names(await seenFor(event.id)), ['event.created']);

    await answeredInteraction({ kind: 'button', customId: `admin_event_activate:${event.id}` });
    assert.equal((await getDoc(doc(db, 'events', event.id))).data().status, 'active');
    const entries = await seenFor(event.id);
    assert.deepEqual(names(entries), ['event.created', 'event.published']);
    assert.equal(entries[1].payload.event.status, 'active');
});

test('the auto-archive emits event.ended', async () => {
    const eventId = 'hook-auto-archive';
    const start = new Date(Date.now() - 3 * DAY).toISOString();
    await setDoc(doc(db, 'events', eventId), { title: 'Hook Archiv', status: 'active', startDate: start, endDate: '', createdAt: start });
    await archiveEndedEvents();
    const entries = await seenFor(eventId);
    assert.deepEqual(names(entries), ['event.ended']);
    assert.equal(entries[0].payload.event.status, 'archived');
});

test('checkInMember (also behind the Discord button) emits registration.checkedIn once, not for guests', async () => {
    const eventId = 'hook-checkin-discord';
    const start = new Date(Date.now() - 3600_000).toISOString();
    await setDoc(doc(db, 'events', eventId), { title: 'Hook Discord Check-in', status: 'active', startDate: start, createdAt: start,
        checkinEnabled: true, checkinCode: '123456' });
    const guest = PERSONAS.find(p => p.id === 'newbie').userId;
    await setDoc(doc(db, 'registrations', 'hook-checkin-reg'), { eventId, userId: ADMIN.userId, userName: 'Admin', status: 'accepted',
        createdAt: start, guests: [guest], pendingGuests: [] });
    for (const userId of [ADMIN.userId, ADMIN.userId, guest]) {
        const result = await checkInMember({ eventId, userId });
        assert.equal(result.ok, true);
    }
    const entries = (await seenFor(eventId)).filter(entry => entry.hook === 'registration.checkedIn');
    assert.equal(entries.length, 1);
    assert.equal(entries[0].payload.registration.id, 'hook-checkin-reg');
    assert.equal(entries[0].payload.registration.userId, ADMIN.userId);
});
