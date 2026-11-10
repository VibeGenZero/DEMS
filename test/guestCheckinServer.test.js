const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir, startServer, createClient } = require('./helpers');

// Guests and check-in (#110). The server and this test share one SQLite file:
// the test plants an event with an accepted and a pending registration that
// carry guests, then the dev mock server seeds its own data next to them.
const tmpDir = createTempDir('guest-checkin-server');
const dbPath = path.join(tmpDir, 'dev.sqlite');
process.chdir(tmpDir);
process.env.SQLITE_PATH = dbPath;
for (const key of Object.keys(process.env)) {
    if (key === 'DATABASE_URL' || key.startsWith('PG')) delete process.env[key];
}

const { db, collection, doc, getDocs, setDoc } = require('../firebaseAdmin');
const { PERSONAS } = require('../dev/mockGuild');

const persona = (id) => PERSONAS.find(entry => entry.id === id);
const MEMBER = persona('member');
const NEWBIE = persona('newbie');
const RAIDER = persona('raider');
const ADMIN = persona('admin');
const EVENT = 'gc-running';
const CODE = '123456';
const HOUR = 60 * 60 * 1000;
const at = (offset) => new Date(Date.now() + offset).toISOString();

let server;

before(async () => {
    await setDoc(doc(db, 'events', EVENT), {
        title: 'Gast-Check-in-Abend', status: 'active', accessMode: 'open', approvalMode: 'manual', allowGuests: true,
        maxParticipants: 10, formFields: [], startDate: at(-HOUR), endDate: at(2 * HOUR),
        checkinEnabled: true, checkinCode: CODE, checkinMessage: 'Willkommen!', createdAt: at(-48 * HOUR)
    });
    await setDoc(doc(db, 'registrations', 'gc-member'), {
        eventId: EVENT, userId: MEMBER.userId, userName: MEMBER.displayName, status: 'accepted', source: 'web',
        createdAt: at(-24 * HOUR), formAnswers: { Geheim: 'nur für Admins' },
        guests: [NEWBIE.userId], pendingGuests: [{ userId: NEWBIE.userId, displayName: 'Neo', avatar: '', status: 'accepted' }]
    });
    await setDoc(doc(db, 'registrations', 'gc-raider'), {
        eventId: EVENT, userId: RAIDER.userId, userName: RAIDER.displayName, status: 'pending', source: 'web',
        createdAt: at(-23 * HOUR), formAnswers: {},
        guests: [ADMIN.userId], pendingGuests: [{ userId: ADMIN.userId, displayName: 'Mori', avatar: '', status: 'accepted' }]
    });
    server = await startServer('dev/start.js', { DEV_SQLITE_PATH: dbPath });
});

after(() => server?.stop());

async function loginAs(personaId) {
    const client = createClient(server.baseUrl);
    const res = await client.request(`/auth/dev-login/${personaId}`);
    assert.equal(res.status, 302);
    return client;
}

const myRegistration = async (client) => (await client.request(`/api/events/${EVENT}/my-registration`)).json();

test('a guest sees status and own check-in, nothing else', async () => {
    const body = await myRegistration(await loginAs('newbie'));
    assert.deepEqual(body, { registered: true, asGuest: true, id: 'gc-member', status: 'accepted', checkedIn: false, checkedInAt: null });
});

test('a guest of a pending registration is refused', async () => {
    const admin = await loginAs('admin');
    const res = await admin.send('POST', `/api/events/${EVENT}/checkin`, { code: CODE });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'Keine akzeptierte Anmeldung gefunden.' });
    assert.deepEqual(await myRegistration(admin), { registered: true, asGuest: true, id: 'gc-raider', status: 'pending', checkedIn: false, checkedInAt: null });
});

test('a guest of an accepted registration checks in with the code', async () => {
    const newbie = await loginAs('newbie');
    const res = await newbie.send('POST', `/api/events/${EVENT}/checkin`, { code: CODE });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { success: true, checkinMessage: 'Willkommen!' });

    const body = await myRegistration(newbie);
    assert.equal(body.checkedIn, true);
    assert.ok(body.checkedInAt);
});

test('the admin check-in box counts persons', async () => {
    const admin = await loginAs('admin');
    const stats = await (await admin.request(`/api/admin/events/${EVENT}/checkin-stats`)).json();
    // member + guest Neo; raider's request is not accepted
    assert.deepEqual([stats.total, stats.checkedIn, stats.code], [2, 1, CODE]);
});

test('an admin ticks a guest off and back', async () => {
    const admin = await loginAs('admin');
    const url = '/api/admin/registrations/gc-member/checkin';

    const undo = await admin.send('PUT', url, { checkedIn: false, guestId: NEWBIE.userId });
    assert.equal(undo.status, 200);
    assert.deepEqual(await undo.json(), { id: 'gc-member', guestId: NEWBIE.userId, checkedIn: false, checkedInAt: null });

    const redo = await admin.send('PUT', url, { checkedIn: true, guestId: NEWBIE.userId });
    const redone = await redo.json();
    assert.deepEqual([redo.status, redone.checkedIn, typeof redone.checkedInAt], [200, true, 'string']);

    const unknown = await admin.send('PUT', url, { checkedIn: true, guestId: 'not-a-guest' });
    assert.equal(unknown.status, 400);
    assert.deepEqual(await unknown.json(), { error: 'Dieser Gast gehört nicht zu der Anmeldung.' });

    const logs = (await getDocs(collection(db, 'auditLogs'))).docs.map(entry => entry.data()).filter(log => log.targetId === 'gc-member');
    assert.deepEqual(logs.map(log => log.action).sort(), ['CHECKIN_REGISTRATION', 'UNDO_CHECKIN_REGISTRATION']);
    assert.ok(logs.every(log => log.details.includes('Neo')), logs.map(log => log.details).join(' | '));

    const csv = await (await admin.request(`/api/admin/events/${EVENT}/registrations/export`)).text();
    const [header, ...rows] = csv.replace(/^﻿/, '').split('\n');
    const column = header.split(',').indexOf('"Gäste eingecheckt"');
    assert.ok(column > 0, header);
    const memberRow = rows.find(row => row.includes(MEMBER.userId)).split(',');
    assert.equal(memberRow[column], '"1"');
});

test('the guest\'s profile and member page count the guest check-in', async () => {
    // Runs after the check-in above: Neo is checked in as Mitglied's guest
    const profile = await (await (await loginAs('newbie')).request('/api/user/profile')).json();
    const entry = [...profile.upcoming, ...profile.history].find(item => item.event && item.event.id === EVENT);
    assert.ok(entry, 'the guest place is listed');
    assert.deepEqual([entry.asGuest, entry.checkedIn, entry.status], [true, true, 'accepted']);
    assert.ok(profile.stats.checkedIn >= 1);

    const member = await (await (await loginAs('admin')).request(`/api/admin/members/${NEWBIE.userId}`)).json();
    assert.ok(member.stats.checkedIn >= 1);
    assert.ok(member.history.some(item => item.event && item.event.id === EVENT && item.asGuest === true));
});
