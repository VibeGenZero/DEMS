// Server side of the official plugin „Event-Feedback“ (plugins/event-feedback) through the real
// server: dev mock mode switches the plugin on; this process writes events and registrations
// straight into the server's SQLite file.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir } = require('./helpers');
const { startPluginServer, loginAt } = require('./pluginTestServer');
const { PERSONAS, MEMBERS } = require('../dev/mockGuild');

const API = '/api/plugins/event-feedback';
const DAY = 86_400_000;
const NOT_ELIGIBLE = { error: 'Für dieses Event kannst du kein Feedback geben.' };

const dbPath = path.join(createTempDir('feedback-server'), 'dev.sqlite');
let server;
let admin;

before(async () => {
    server = await startPluginServer({ DEV_SQLITE_PATH: dbPath }, { seed: false });
    admin = await loginAt(server.baseUrl, 'admin');
});

after(() => server.stop());

const persona = (id) => PERSONAS.find(entry => entry.id === id);
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const kira = MEMBERS.find(member => member.username === 'kira');

/** The server's database, opened in this process. */
function store() {
    process.env.SQLITE_PATH = dbPath;
    return require('../firebaseAdmin');
}

async function json(res, status = 200) {
    assert.equal(res.status, status, await res.clone().text());
    return res.json();
}

/** An archived event that ended `daysAgo` days ago, straight into the database. */
async function endedEvent(key, daysAgo, fields = {}) {
    const { db, doc, setDoc } = store();
    const end = Date.now() - daysAgo * DAY;
    await setDoc(doc(db, 'events', key), {
        title: `Abend ${key}`, status: 'archived', category: 'Feedback-T2',
        startDate: new Date(end - 3 * 3600_000).toISOString(), endDate: new Date(end).toISOString(),
        createdAt: new Date(end - 10 * DAY).toISOString(), ...fields
    });
    return key;
}

/** A registration of a persona (or a raw user id) for an event, straight into the database. */
async function reg(eventId, who, fields = {}) {
    const { db, doc, setDoc } = store();
    const userId = persona(who) ? persona(who).userId : who;
    await setDoc(doc(db, 'registrations', `${eventId}-${userId}`), {
        eventId, userId, userName: who, status: 'accepted', createdAt: new Date().toISOString(), ...fields
    });
}

const client = (personaId) => loginAt(server.baseUrl, personaId);
// The mock logs „DM an <Mitglied>“ and the payload on separate lines: count the request texts
const dmLines = (title) => server.output().split(`Wie war **${title}**?`).length - 1;
const dmHeaders = (name) => server.output().split(`DM an ${name}`).length - 1;

async function eventually(read, check, label) {
    let value = await read();
    for (let i = 0; i < 60 && !check(value); i++) {
        await sleep(50);
        value = await read();
    }
    assert.ok(check(value), `${label}: ${JSON.stringify(value)}`);
    return value;
}

// ── Members ─────────────────────────────────────────────────────────────

test('a member who took part rates within the window, changes the answer, and sees it in /mine', async () => {
    const eventId = await endedEvent('fb-rate', 1);
    await reg(eventId, 'member');
    const tom = await client('member');
    const first = await json(await tom.request(`${API}/events/${eventId}/mine`));
    assert.deepEqual(first, {
        event: { id: eventId, title: `Abend ${eventId}`, startDate: first.event.startDate, category: 'Feedback-T2' },
        editable: true,
        answer: null
    });
    assert.deepEqual(await json(await tom.send('PUT', `${API}/events/${eventId}/mine`, { rating: 4, comment: ' Gut ' })), { rating: 4, comment: 'Gut' });
    assert.deepEqual(await json(await tom.send('PUT', `${API}/events/${eventId}/mine`, { rating: 5 })), { rating: 5, comment: '' });
    const mine = await json(await tom.request(`${API}/mine`));
    assert.equal(mine.open.some(entry => entry.id === eventId), false);
    const done = mine.done.find(entry => entry.event.id === eventId);
    assert.deepEqual({ rating: done.rating, comment: done.comment, editable: done.editable }, { rating: 5, comment: '', editable: true });
});

test('not eligible: rejected, waitlisted, not checked in although check-in was used, no registration → 403', async () => {
    const eventId = await endedEvent('fb-noteligible', 1, { checkinEnabled: true });
    // Check-in was really used: Kira checked in, Tom did not
    await reg(eventId, kira.userId, { checkedIn: true });
    await reg(eventId, 'member', { checkedIn: false });
    await reg(eventId, 'raider', { status: 'rejected' });
    await reg(eventId, 'admin', { status: 'waitlisted' });
    for (const personaId of ['member', 'raider', 'admin', 'newbie']) {
        const member = await client(personaId);
        assert.deepEqual(await json(await member.request(`${API}/events/${eventId}/mine`), 403), NOT_ELIGIBLE, personaId);
        assert.deepEqual(await json(await member.send('PUT', `${API}/events/${eventId}/mine`, { rating: 5 }), 403), NOT_ELIGIBLE, personaId);
    }
    assert.equal((await json(await admin.request(`${API}/events/${eventId}/summary`))).count, 0);
    assert.deepEqual(await json(await (await client('member')).request(`${API}/events/nope/mine`), 404), { error: 'Event nicht gefunden.' });
});

test('a checked-in member of a check-in event may answer; guests never', async () => {
    const eventId = await endedEvent('fb-checkin', 1, { checkinEnabled: true });
    await reg(eventId, 'member', { checkedIn: true, guests: [persona('raider').userId] });
    assert.equal((await json(await (await client('member')).request(`${API}/events/${eventId}/mine`))).editable, true);
    assert.deepEqual(await json(await (await client('raider')).request(`${API}/events/${eventId}/mine`), 403), NOT_ELIGIBLE);
});

test('after 7 days the answer is read-only and a change is refused with 409', async () => {
    const eventId = await endedEvent('fb-closed', 8);
    await reg(eventId, 'member');
    const { db, doc, setDoc } = store();
    const tomId = persona('member').userId;
    await setDoc(doc(db, 'plugin:event-feedback:answers', `${eventId}_${tomId}`), {
        eventId, userId: tomId, rating: 3, comment: 'Alt', createdAt: new Date(Date.now() - 7.5 * DAY).toISOString(), updatedAt: new Date(Date.now() - 7.5 * DAY).toISOString()
    });
    const tom = await client('member');
    const view = await json(await tom.request(`${API}/events/${eventId}/mine`));
    assert.deepEqual({ editable: view.editable, answer: view.answer }, { editable: false, answer: { rating: 3, comment: 'Alt' } });
    assert.deepEqual(await json(await tom.send('PUT', `${API}/events/${eventId}/mine`, { rating: 5 }), 409),
        { error: 'Die Feedback-Zeit für dieses Event ist vorbei.' });
    assert.equal((await json(await tom.request(`${API}/events/${eventId}/mine`))).answer.rating, 3);
});

test('invalid answers are refused in German', async () => {
    const eventId = await endedEvent('fb-invalid', 1);
    await reg(eventId, 'member');
    const tom = await client('member');
    assert.deepEqual(await json(await tom.send('PUT', `${API}/events/${eventId}/mine`, { rating: 0 }), 400), { error: 'Bitte vergib 1 bis 5 Sterne.' });
    assert.deepEqual(await json(await tom.send('PUT', `${API}/events/${eventId}/mine`, { rating: 3, comment: 'x'.repeat(1001) }), 400),
        { error: 'Der Kommentar darf höchstens 1000 Zeichen lang sein.' });
});

test('the open list holds only events in the window the member may still rate', async () => {
    const recent = await endedEvent('fb-open-recent', 1);
    const old = await endedEvent('fb-open-old', 10);
    const cancelled = await endedEvent('fb-open-cancelled', 1, { status: 'cancelled' });
    for (const eventId of [recent, old, cancelled]) await reg(eventId, 'member');
    const ids = (await json(await (await client('member')).request(`${API}/mine`))).open.map(entry => entry.id);
    assert.ok(ids.includes(recent));
    assert.equal(ids.includes(old), false);
    assert.equal(ids.includes(cancelled), false);
});

// ── Requests per DM ─────────────────────────────────────────────────────

async function activeEventWith(title, personaIds, fields = {}) {
    const event = await json(await admin.send('POST', '/api/admin/events', {
        title, status: 'active', approvalMode: 'instant', category: 'Feedback-DM',
        startDate: new Date(Date.now() - 3 * 3600_000).toISOString(), ...fields
    }));
    for (const personaId of personaIds) await reg(event.id, personaId);
    return event;
}

test('ending an event DMs every eligible member once, also when it is archived again', async () => {
    const event = await activeEventWith('Spieleabend DM', ['member', 'raider']);
    await reg(event.id, 'admin', { status: 'waitlisted' });
    const before = dmLines('Spieleabend DM');
    const moriBefore = dmHeaders('Mori');
    await json(await admin.send('POST', `/api/admin/events/${event.id}/end`, {}));
    await eventually(() => dmLines('Spieleabend DM'), count => count === before + 2, 'two DMs');
    assert.ok(server.output().includes('Wie war **Spieleabend DM**?'));
    assert.ok(server.output().includes('Feedback geben'));
    assert.ok(server.output().includes(`/#p/event-feedback/${event.id}`));
    assert.equal(dmHeaders('Mori'), moriBefore, 'not the waitlisted admin');

    await json(await admin.send('PUT', `/api/admin/events/${event.id}/status`, { status: 'active' }));
    await json(await admin.send('POST', `/api/admin/events/${event.id}/end`, {}));
    await sleep(300);
    assert.equal(dmLines('Spieleabend DM'), before + 2, 'nobody asked twice');
});

test('with DMs switched off the request is recorded and nothing is sent later', async () => {
    const settings = (values) => admin.send('PUT', '/api/admin/plugins/event-feedback/settings', { values });
    await json(await settings({ noDm: true }));
    try {
        const quiet = await activeEventWith('Leiser Abend', ['member']);
        await json(await admin.send('POST', `/api/admin/events/${quiet.id}/end`, {}));
        await sleep(300);
        assert.equal(dmLines('Leiser Abend'), 0);
        await json(await settings({ noDm: false }));
        const loud = await activeEventWith('Lauter Abend', ['member']);
        await json(await admin.send('POST', `/api/admin/events/${loud.id}/end`, {}));
        await json(await admin.send('PUT', `/api/admin/events/${quiet.id}/status`, { status: 'active' }));
        await json(await admin.send('POST', `/api/admin/events/${quiet.id}/end`, {}));
        await eventually(() => dmLines('Lauter Abend'), count => count === 1, 'the new event asks');
        await sleep(300);
        assert.equal(dmLines('Leiser Abend'), 0, 'the old event never asks');
    } finally {
        await json(await settings({ noDm: false }));
    }
});

// ── Admins ──────────────────────────────────────────────────────────────

test('the admin summary shows averages, rates and comments without ids, names or times', async () => {
    const eventId = await endedEvent('fb-summary', 1, { category: 'Auswertung-T2', title: 'Turnierabend' });
    for (const personaId of ['member', 'raider', 'admin']) await reg(eventId, personaId);
    await reg(eventId, kira.userId);
    const answers = { member: { rating: 5, comment: 'Top' }, raider: { rating: 4 }, admin: { rating: 2, comment: 'Zu spät' } };
    for (const [personaId, body] of Object.entries(answers)) {
        await json(await (await client(personaId)).send('PUT', `${API}/events/${eventId}/mine`, body));
    }
    const summary = await json(await admin.request(`${API}/summary`));
    const entry = summary.events.find(item => item.event.id === eventId);
    assert.deepEqual({ count: entry.count, eligible: entry.eligible, average: entry.average }, { count: 3, eligible: 4, average: 3.7 });
    assert.deepEqual(summary.categories.find(item => item.category === 'Auswertung-T2'), { category: 'Auswertung-T2', count: 3, average: 3.7 });
    const detail = await json(await admin.request(`${API}/events/${eventId}/summary`));
    assert.deepEqual(detail.distribution, [0, 1, 0, 1, 1]);
    assert.deepEqual(detail.comments, [{ rating: 2, comment: 'Zu spät' }, { rating: 5, comment: 'Top' }]);
    for (const body of [JSON.stringify(summary), JSON.stringify(detail)]) {
        for (const person of [...PERSONAS, kira]) {
            assert.equal(body.includes(person.userId), false, person.userId);
            assert.equal(body.includes(`"${person.displayName}"`), false, person.displayName);
        }
        assert.doesNotMatch(body, /At"/, 'no times');
    }
});

test('members get 403 on the admin routes; deleting an event deletes its answers', async () => {
    const tom = await client('member');
    assert.equal((await tom.request(`${API}/summary`)).status, 403);
    assert.equal((await tom.request(`${API}/events/x/summary`)).status, 403);

    const event = await activeEventWith('Wegwerf-Abend', ['member']);
    await json(await admin.send('POST', `/api/admin/events/${event.id}/end`, {}));
    await json(await tom.send('PUT', `${API}/events/${event.id}/mine`, { rating: 3 }));
    await json(await admin.send('DELETE', `/api/admin/events/${event.id}`));
    const { db, collection, getDocs } = store();
    await eventually(async () => (await getDocs(collection(db, 'plugin:event-feedback:answers'))).docs.filter(item => item.data().eventId === event.id).length,
        count => count === 0, 'answers deleted');
    assert.deepEqual(await json(await admin.request(`${API}/events/${event.id}/summary`), 404), { error: 'Event nicht gefunden.' });
});

test('the seed has two answers for the archived summer party', async () => {
    const detail = await json(await admin.request(`${API}/events/dev-event-archived/summary`));
    assert.deepEqual({ count: detail.count, average: detail.average }, { count: 2, average: 4.5 });
    assert.deepEqual(detail.comments, [{ rating: 5, comment: 'Super Orga!' }]);
});

// ── Review fixes ────────────────────────────────────────────────────────

test('archiving an event before it started asks nobody and keeps it closed; a real end later asks', async () => {
    const event = await activeEventWith('Zukunftsabend', ['member'], { startDate: new Date(Date.now() + 3 * DAY).toISOString() });
    await json(await admin.send('PUT', `/api/admin/events/${event.id}/status`, { status: 'archived' }));
    await sleep(300);
    assert.equal(dmLines('Zukunftsabend'), 0, 'no DM for an event that never happened');
    const tom = await client('member');
    assert.equal((await json(await tom.request(`${API}/events/${event.id}/mine`))).editable, false);
    assert.equal((await json(await tom.request(`${API}/mine`))).open.some(entry => entry.id === event.id), false);
    assert.equal((await tom.send('PUT', `${API}/events/${event.id}/mine`, { rating: 5 })).status, 409);

    // It happens after all: reactivated, started three hours ago, ended
    await json(await admin.send('PUT', `/api/admin/events/${event.id}/status`, { status: 'active' }));
    const { db, doc, updateDoc } = store();
    await updateDoc(doc(db, 'events', event.id), { startDate: new Date(Date.now() - 3 * 3600_000).toISOString(), endDate: '' });
    await json(await admin.send('POST', `/api/admin/events/${event.id}/end`, {}));
    await eventually(() => dmLines('Zukunftsabend'), count => count === 1, 'asked after the real end');
});

test('archiving an event whose window already closed sends no DM', async () => {
    const eventId = await endedEvent('fb-late-archive', 9, { status: 'active', title: 'Spaetabend' });
    await reg(eventId, 'member');
    await json(await admin.send('PUT', `/api/admin/events/${eventId}/status`, { status: 'archived' }));
    await sleep(300);
    assert.equal(dmLines('Spaetabend'), 0);
});

test('a check-in event where nobody checked in (e.g. a duplicate without code) lets every accepted member answer', async () => {
    const eventId = await endedEvent('fb-dup-checkin', 1, { checkinEnabled: true });
    await reg(eventId, 'member', { checkedIn: false });
    await reg(eventId, 'raider', { checkedIn: false });
    assert.equal((await json(await (await client('member')).request(`${API}/events/${eventId}/mine`))).editable, true);
    assert.equal((await json(await admin.request(`${API}/events/${eventId}/summary`))).eligible, 2);
});

test('the summary lists only events the plugin asked about or that have answers', async () => {
    const unasked = await endedEvent('fb-unasked', 2, { title: 'Nie gefragt' });
    await reg(unasked, 'member');
    const summary = await json(await admin.request(`${API}/summary`));
    assert.equal(summary.events.some(entry => entry.event.id === unasked), false);
    const asked = await activeEventWith('Gefragter Abend', ['member']);
    await json(await admin.send('POST', `/api/admin/events/${asked.id}/end`, {}));
    await eventually(async () => (await json(await admin.request(`${API}/summary`))).events.some(entry => entry.event.id === asked.id),
        found => found, 'listed after the request');
});

test('guests cannot store an answer either', async () => {
    const eventId = await endedEvent('fb-guest-put', 1);
    await reg(eventId, 'member', { guests: [persona('raider').userId] });
    assert.deepEqual(await json(await (await client('raider')).send('PUT', `${API}/events/${eventId}/mine`, { rating: 5 }), 403), NOT_ELIGIBLE);
});
