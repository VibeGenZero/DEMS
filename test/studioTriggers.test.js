'use strict';
// Hook buttons of the studio (scripts/studio/triggers.js) against a real DEMS mock server
// with the hook-recorder fixture plugin switched on.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTriggers } = require('../scripts/studio/triggers');
const { PLUGIN, startPluginServer, loginAt } = require('./pluginTestServer');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let server;
let admin;

before(async () => {
  server = await startPluginServer();
  admin = await loginAt(server.baseUrl, 'admin');
});

after(() => server && server.stop());

/** Hook names hook-recorder logged for one event; polls until `count` are there (max ~3 s). */
async function hooksOf(eventId, count) {
  const read = async () => {
    const res = await admin.request(`/api/plugins/${PLUGIN}/log`);
    assert.equal(res.status, 200);
    const entries = await res.json();
    return entries.filter((e) => (e.payload.event ? e.payload.event.id : e.payload.eventId) === eventId).map((e) => e.hook);
  };
  let names = await read();
  for (let i = 0; i < 60 && names.length < count; i++) {
    await sleep(50);
    names = await read();
  }
  return names;
}

test('create, publish and end fire event.created, event.published and event.ended', async () => {
  const triggers = createTriggers({ baseUrl: server.baseUrl });
  const created = await triggers.run('create');
  assert.equal(created.ok, true);
  assert.equal(typeof created.eventId, 'string');
  assert.equal(created.message, 'Test-Event „Studio-Test“ als Entwurf erstellt.');

  const event = await (await admin.request(`/api/events/${created.eventId}`)).json();
  assert.equal(event.title, 'Studio-Test');
  assert.equal(event.status, 'draft');
  // The category of the oldest seeded event that has one
  const seeded = (await (await admin.request('/api/admin/all-events')).json())
    .filter((e) => e.category && e.id !== created.eventId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  assert.ok(seeded.length > 0);
  assert.equal(event.category, seeded[0].category);
  const start = new Date(event.startDate).getTime();
  assert.ok(Math.abs(start - (Date.now() + 3600_000)) < 60_000, event.startDate);
  assert.equal(new Date(event.endDate).getTime() - start, 2 * 3600_000);

  assert.deepEqual(await triggers.run('publish'), { ok: true, eventId: created.eventId, message: 'Test-Event veröffentlicht.' });
  assert.deepEqual(await triggers.run('end'), { ok: true, eventId: created.eventId, message: 'Test-Event beendet.' });
  assert.deepEqual(await hooksOf(created.eventId, 3), ['event.created', 'event.published', 'event.ended']);
});

test('checkin registers the member, accepts and checks it in', async () => {
  const triggers = createTriggers({ baseUrl: server.baseUrl });
  const { eventId } = await triggers.run('create');
  await triggers.run('publish');
  const result = await triggers.run('checkin');
  assert.deepEqual(result, { ok: true, eventId, message: 'Tom ist angemeldet und eingecheckt.' });
  const names = await hooksOf(eventId, 3);
  assert.ok(names.includes('registration.checkedIn'), names.join());
  // A second click works on the existing registration
  assert.equal((await triggers.run('checkin')).ok, true);
});

test('cancel and delete fire their hooks; after delete the event is gone', async () => {
  const triggers = createTriggers({ baseUrl: server.baseUrl });
  const { eventId } = await triggers.run('create');
  await triggers.run('publish');
  assert.equal((await triggers.run('cancel')).message, 'Test-Event abgesagt.');
  assert.deepEqual(await triggers.run('delete'), { ok: true, eventId, message: 'Test-Event gelöscht.' });
  assert.deepEqual(await hooksOf(eventId, 4), ['event.created', 'event.published', 'event.cancelled', 'event.deleted']);
  await assert.rejects(triggers.run('end'), { status: 409, message: 'Erstelle zuerst ein Test-Event.' });
});

test('end without a created event answers 409', async () => {
  const triggers = createTriggers({ baseUrl: server.baseUrl });
  await assert.rejects(triggers.run('end'), { status: 409, message: 'Erstelle zuerst ein Test-Event.' });
});

test('a failing DEMS answer becomes 502 with the DEMS error text', async () => {
  const triggers = createTriggers({ baseUrl: server.baseUrl });
  const { eventId } = await triggers.run('create');
  assert.equal((await admin.send('DELETE', `/api/admin/events/${eventId}`)).status, 200);
  await assert.rejects(triggers.run('end'), { status: 502, message: 'Event nicht gefunden' });
});

test('an unknown action answers 400, a stopped DEMS 503', async () => {
  await assert.rejects(createTriggers({ baseUrl: server.baseUrl }).run('explode'), { status: 400, message: 'Unbekannte Aktion.' });
  await assert.rejects(createTriggers({ childPort: () => null }).run('create'), { status: 503, message: 'DEMS läuft gerade nicht. Warte, bis die Vorschau gestartet ist.' });
});
