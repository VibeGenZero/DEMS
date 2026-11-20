// Server side of the official plugin „Event einreichen“ (plugins/event-submissions/server.js)
// through the real server: dev mock mode switches the plugin on and seeds its submissions.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { OFFICIAL_PLUGIN, startPluginServer, loginAt } = require('./pluginTestServer');
const { PERSONAS, CHANNEL_ID } = require('../dev/mockGuild');

const API = `/api/plugins/${OFFICIAL_PLUGIN}`;
const LIMIT_SENTENCE = 'Du hast schon 3 offene Vorschläge. Warte, bis das Team sie bearbeitet hat.';
const WITHDRAW_SENTENCE = 'Nur offene Vorschläge lassen sich zurückziehen.';
const DONE_SENTENCE = 'Dieser Vorschlag wurde schon bearbeitet.';
const NOT_FOUND = { error: 'Vorschlag nicht gefunden.' };
const DAY = 86_400_000;

// Seeded submissions (dev/seedData.js)
const SEEDED = { tom: 'dev-submission-tom', neo: 'dev-submission-neo', lena: 'dev-submission-lena' };

let server;
let admin;

before(async () => {
    server = await startPluginServer();
    admin = await loginAt(server.baseUrl, 'admin');
});

after(() => server.stop());

const persona = (id) => PERSONAS.find(entry => entry.id === id);
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const futureIso = (days) => new Date(Date.now() + days * DAY).toISOString();
const dmLines = () => server.output().split('DM an ').length - 1;

async function json(res, status = 200) {
    assert.equal(res.status, status, await res.clone().text());
    return res.json();
}

async function submit(client, body) {
    return client.send('POST', `${API}/`, { title: 'Quiz-Nacht', ...body });
}

async function mine(client) {
    return json(await client.request(`${API}/mine`));
}

async function allSubmissions(filter = '') {
    return json(await admin.request(`${API}/${filter ? `?status=${filter}` : ''}`));
}

async function submissionById(id) {
    return (await allSubmissions()).find(item => item.id === id) || null;
}

/** Poll the admin list until the submission matches `check` (hooks run asynchronously). */
async function waitForSubmission(id, check) {
    let item = await submissionById(id);
    for (let i = 0; i < 60 && !(item && check(item)); i++) {
        await sleep(50);
        item = await submissionById(id);
    }
    assert.ok(item && check(item), `submission ${id} did not reach the expected state: ${JSON.stringify(item)}`);
    return item;
}

async function createEvent(body) {
    return json(await admin.send('POST', '/api/admin/events', { startDate: futureIso(7), ...body }));
}

const origin = (ref) => ({ plugin: OFFICIAL_PLUGIN, ref });

async function auditEntries(action) {
    const body = await json(await admin.request('/api/admin/audit-log?limit=500'));
    return body.data.filter(entry => entry.action === action);
}

// ── Seed and admin list ─────────────────────────────────────────────────

test('admins list the seeded submissions by status; members get 403', async () => {
    const open = await allSubmissions('open');
    const openIds = open.map(item => item.id);
    assert.ok(openIds.includes(SEEDED.tom) && openIds.includes(SEEDED.neo), JSON.stringify(openIds));
    assert.ok(open.every(item => item.status === 'open'));

    const done = await allSubmissions('done');
    const lena = done.find(item => item.id === SEEDED.lena);
    assert.equal(lena.status, 'rejected');
    assert.ok(lena.reason.length > 0);
    assert.equal(lena.userId, persona('raider').userId);

    const counts = await json(await admin.request(`${API}/counts`));
    assert.deepEqual(counts, { open: open.length });

    const member = await loginAt(server.baseUrl, 'member');
    assert.equal((await member.request(`${API}/`)).status, 403);
    assert.equal((await member.request(`${API}/counts`)).status, 403);
    assert.equal((await member.send('POST', `${API}/${SEEDED.tom}/reject`, {})).status, 403);
});

test('deleting an account removes the member\'s submissions, seeded ones included', async () => {
    const newbie = await loginAt(server.baseUrl, 'newbie');
    assert.ok((await mine(newbie)).some(item => item.id === SEEDED.neo));
    assert.equal((await newbie.send('DELETE', '/api/user/account')).status, 200);
    const left = await allSubmissions();
    assert.equal(left.some(item => item.userId === persona('newbie').userId), false);
});

// ── Member routes ───────────────────────────────────────────────────────

test('a member submits an idea and sees it as open in /mine', async () => {
    const member = await loginAt(server.baseUrl, 'member');
    const created = await json(await submit(member, {
        title: '  Retro-Turnier  ', description: 'Mit **Preisen**', wishedDate: futureIso(10).slice(0, 10), category: 'Tournament'
    }));
    const tom = persona('member');
    assert.equal(created.title, 'Retro-Turnier');
    assert.equal(created.status, 'open');
    assert.equal(created.userId, tom.userId);
    assert.equal(created.userName, tom.displayName);
    assert.equal(typeof created.userAvatar, 'string');
    assert.equal(created.eventId, '');
    assert.equal(created.reason, '');
    assert.ok(!Number.isNaN(Date.parse(created.createdAt)));
    assert.equal(created.updatedAt, created.createdAt);

    const list = await mine(member);
    assert.equal(list[0].id, created.id, 'newest first');
    assert.equal(list[0].status, 'open');
    assert.ok(list.every(item => item.userId === tom.userId));
});

test('a fourth open submission answers 409 with the limit sentence', async () => {
    const member = await loginAt(server.baseUrl, 'member');
    const openCount = (await mine(member)).filter(item => item.status === 'open' || item.status === 'planning').length;
    for (let i = openCount; i < 3; i++) await json(await submit(member, { title: `Idee ${i}` }));
    const res = await submit(member, { title: 'Eine zu viel' });
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: LIMIT_SENTENCE });
    assert.equal((await mine(member)).filter(item => item.status === 'open').length, 3);
});

test('five parallel submits of a fresh member let exactly three through', async () => {
    // Lena has only a rejected submission, which does not count
    const raider = await loginAt(server.baseUrl, 'raider');
    const results = await Promise.all([1, 2, 3, 4, 5].map(n => submit(raider, { title: `Doppelklick ${n}` })));
    const statuses = results.map(res => res.status).sort();
    assert.deepEqual(statuses, [200, 200, 200, 409, 409]);
    for (const res of results.filter(entry => entry.status === 409)) assert.deepEqual(await res.json(), { error: LIMIT_SENTENCE });
    assert.equal((await mine(raider)).filter(item => item.status === 'open').length, 3);
});

test('invalid input answers 400 in German', async () => {
    const member = await loginAt(server.baseUrl, 'member');
    const category = await submit(member, { category: 'Raid' });
    assert.equal(category.status, 400);
    assert.deepEqual(await category.json(), { error: 'Unbekannte Kategorie.' });

    const array = await member.send('POST', `${API}/`, [{ title: 'Quiz-Nacht' }]);
    assert.equal(array.status, 400);
    assert.deepEqual(await array.json(), { error: 'Ungültige Eingabe.' });

    const short = await submit(member, { title: 'ab' });
    assert.equal(short.status, 400);
    assert.deepEqual(await short.json(), { error: 'Der Titel braucht 3 bis 100 Zeichen.' });
});

test('a member withdraws an own open submission, never a foreign one', async () => {
    const member = await loginAt(server.baseUrl, 'member');
    const own = (await mine(member)).find(item => item.status === 'open');
    assert.deepEqual(await json(await member.send('DELETE', `${API}/${own.id}`)), { success: true });
    assert.equal((await mine(member)).some(item => item.id === own.id), false);

    const raider = await loginAt(server.baseUrl, 'raider');
    const foreign = (await mine(raider)).find(item => item.status === 'open');
    const refused = await member.send('DELETE', `${API}/${foreign.id}`);
    assert.equal(refused.status, 409);
    assert.deepEqual(await refused.json(), { error: WITHDRAW_SENTENCE });
    assert.ok(await submissionById(foreign.id), 'the foreign submission stays');

    // Not open any more: Lena's seeded rejection
    const rejected = await raider.send('DELETE', `${API}/${SEEDED.lena}`);
    assert.equal(rejected.status, 409);
    assert.deepEqual(await rejected.json(), { error: WITHDRAW_SENTENCE });

    const unknown = await member.send('DELETE', `${API}/no-such-submission`);
    assert.equal(unknown.status, 404);
    assert.deepEqual(await unknown.json(), NOT_FOUND);
});

// ── Admin reject ────────────────────────────────────────────────────────

test('rejecting with a reason stores it, audits and DMs the member', async () => {
    const raider = await loginAt(server.baseUrl, 'raider');
    const target = (await mine(raider)).find(item => item.status === 'open');
    const rejected = await json(await admin.send('POST', `${API}/${target.id}/reject`, { reason: 'Passt nicht in den Kalender.' }));
    assert.equal(rejected.id, target.id);
    assert.equal(rejected.status, 'rejected');
    assert.equal(rejected.reason, 'Passt nicht in den Kalender.');
    assert.equal(rejected.decidedBy, persona('admin').userId);
    assert.ok(!Number.isNaN(Date.parse(rejected.decidedAt)));

    await server.waitForOutput('Begründung: Passt nicht in den Kalender.');
    const dm = server.output().split(`DM an ${persona('raider').displayName}`).at(-1);
    assert.match(dm, new RegExp(`„${target.title}“ wurde abgelehnt\\.`));
    assert.match(dm, /Begründung: Passt nicht in den Kalender\./);

    const [entry] = await auditEntries(`plugin:${OFFICIAL_PLUGIN}:reject`);
    assert.equal(entry.details, `Vorschlag „${target.title}“ abgelehnt`);
    assert.equal(entry.targetId, target.id);

    const again = await admin.send('POST', `${API}/${target.id}/reject`, {});
    assert.equal(again.status, 409);
    assert.deepEqual(await again.json(), { error: DONE_SENTENCE });

    const unknown = await admin.send('POST', `${API}/no-such-submission/reject`, {});
    assert.equal(unknown.status, 404);
    assert.deepEqual(await unknown.json(), NOT_FOUND);

    const tooLong = await admin.send('POST', `${API}/${SEEDED.tom}/reject`, { reason: 'x'.repeat(501) });
    assert.equal(tooLong.status, 400);
    assert.equal((await submissionById(SEEDED.tom)).status, 'open');
});

// ── Hooks ───────────────────────────────────────────────────────────────

test('a draft from a submission plans it; publishing accepts it and DMs the event link', async () => {
    const member = await loginAt(server.baseUrl, 'member');
    const target = (await mine(member)).find(item => item.status === 'open');
    const event = await createEvent({ title: target.title, status: 'draft', pluginOrigin: origin(target.id) });
    const planning = await waitForSubmission(target.id, item => item.status === 'planning');
    assert.equal(planning.eventId, event.id);

    assert.equal((await admin.send('PUT', `/api/admin/events/${event.id}/status`, { status: 'active' })).status, 200);
    const accepted = await waitForSubmission(target.id, item => item.status === 'accepted');
    assert.equal(accepted.eventId, event.id);

    await server.waitForOutput(`#event/${event.id}`);
    const dm = server.output().split(`DM an ${persona('member').displayName}`).at(-1);
    assert.match(dm, new RegExp(`Dein Event „${target.title}“ wurde eingetragen\\.`));
    assert.match(dm, /Zum Event/);
    assert.match(dm, new RegExp(`#event/${event.id}`));
});

test('deleting the draft of a planned submission opens it again', async () => {
    const member = await loginAt(server.baseUrl, 'member');
    const target = (await mine(member)).find(item => item.status === 'open');
    const event = await createEvent({ title: target.title, status: 'draft', pluginOrigin: origin(target.id) });
    await waitForSubmission(target.id, item => item.status === 'planning' && item.eventId === event.id);

    assert.equal((await admin.send('DELETE', `/api/admin/events/${event.id}`)).status, 200);
    const reopened = await waitForSubmission(target.id, item => item.status === 'open');
    assert.equal(reopened.eventId, '');
});

test('an event with a stale origin (unknown, withdrawn, rejected) changes nothing and sends no DM', async () => {
    const raider = await loginAt(server.baseUrl, 'raider');
    const withdrawn = await json(await submit(raider, { title: 'Gleich zurückgezogen' }));
    await json(await raider.send('DELETE', `${API}/${withdrawn.id}`));
    const rejectedBefore = await submissionById(SEEDED.lena);
    const dmsBefore = dmLines();

    for (const ref of ['no-such-submission', withdrawn.id, SEEDED.lena]) {
        // Active: created and published, so both hooks see the stale ref
        const event = await createEvent({ title: `Veraltet ${ref}`, status: 'active', pluginOrigin: origin(ref) });
        assert.equal((await admin.send('DELETE', `/api/admin/events/${event.id}`)).status, 200);
    }

    // Hooks of one plugin run in order: once this draft plans its submission, the stale ones are done
    const sentinel = (await mine(raider)).find(item => item.status === 'open');
    await createEvent({ title: 'Wächter', status: 'draft', pluginOrigin: origin(sentinel.id) });
    await waitForSubmission(sentinel.id, item => item.status === 'planning');

    assert.equal(dmLines(), dmsBefore);
    assert.equal(await submissionById(withdrawn.id), null);
    assert.equal(await submissionById('no-such-submission'), null);
    assert.deepEqual(await submissionById(SEEDED.lena), rejectedBefore);
});

// ── Channel post ────────────────────────────────────────────────────────

test('with notifyChannel set a new submission posts the escaped title to the team', async () => {
    const saved = await admin.send('PUT', `/api/admin/plugins/${OFFICIAL_PLUGIN}/settings`, { values: { notifyChannel: CHANNEL_ID.EVENTS } });
    assert.equal(saved.status, 200, await saved.clone().text());

    await json(await submit(admin, { title: '**Fett** @everyone' }));
    await server.waitForOutput('Plugin-Nachricht in #events');
    const post = server.output().split('Plugin-Nachricht in #events').at(-1);
    assert.match(post, /Neuer Event-Vorschlag von \*\*Mori \(Admin\)\*\*/);
    assert.ok(post.includes('„\\*\\*Fett\\*\\* @​everyone“'), post);
});
