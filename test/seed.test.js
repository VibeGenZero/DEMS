const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir, repoPath, runNode } = require('./helpers');

// Mock mode with an own database; the empty cwd keeps a local .env out
const tmpDir = createTempDir('seed');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'seed.sqlite');

const { seedIfEmpty, resetAndSeed } = require('../dev/seed');
const { EVENT_ID, SERIES_EVENT_IDS, CHECKIN_CODE } = require('../dev/seedData');
const { PERSONAS } = require('../dev/mockGuild');
const { db, collection, doc, getDoc, getDocs, setDoc } = require('../firebaseAdmin');

const EXPECTED_COUNTS = {
    events: 12,
    users: 12,
    registrations: 32,
    comments: 6,
    auditLogs: 10,
    botMessages: 1,
    botSettings: 1,
    maintenanceSettings: 1
};

async function countDocs(name) {
    return (await getDocs(collection(db, name))).size;
}

async function getEvent(id) {
    return (await getDoc(doc(db, 'events', id))).data();
}

async function registrationsOf(eventId) {
    const snapshot = await getDocs(collection(db, 'registrations'));
    return snapshot.docs.map(d => d.data()).filter(registration => registration.eventId === eventId);
}

test('seedIfEmpty fills an empty database', async () => {
    assert.deepEqual(await seedIfEmpty(), EXPECTED_COUNTS);
    for (const [name, expected] of Object.entries(EXPECTED_COUNTS)) {
        assert.equal(await countDocs(name), expected, name);
    }
});

test('seedIfEmpty does not seed twice', async () => {
    assert.equal(await seedIfEmpty(), null);
    assert.equal(await countDocs('events'), EXPECTED_COUNTS.events);
    assert.equal(await countDocs('registrations'), EXPECTED_COUNTS.registrations);
});

test('the seed covers the scenarios of the spec', async () => {
    const now = new Date();

    assert.equal((await getEvent(EVENT_ID.FORM)).formFields.length, 5);
    assert.equal((await getEvent(EVENT_ID.FORM)).approvalMode, 'manual');
    assert.equal((await getEvent(EVENT_ID.BIG_FORM)).formFields.length, 7);
    assert.equal((await getEvent(EVENT_ID.ROLE)).accessMode, 'role-required');
    assert.equal((await getEvent(EVENT_ID.ARCHIVED)).status, 'archived');
    assert.equal((await getEvent(EVENT_ID.DRAFT)).status, 'draft');

    const running = await getEvent(EVENT_ID.RUNNING);
    assert.equal(running.checkinEnabled, true);
    assert.equal(running.checkinCode, CHECKIN_CODE);
    assert.ok(new Date(running.startDate) < now && new Date(running.endDate) > now);

    assert.ok(new Date((await getEvent(EVENT_ID.PAST)).endDate) < now);
    assert.ok(new Date((await getEvent(EVENT_ID.OPEN)).startDate) > now);

    const series = await Promise.all(SERIES_EVENT_IDS.map(getEvent));
    assert.ok(series[0].seriesId && series.every(event => event.seriesId === series[0].seriesId));

    const registrations = (await getDocs(collection(db, 'registrations'))).docs.map(d => d.data());
    for (const status of ['accepted', 'pending', 'waitlisted', 'rejected']) {
        assert.ok(registrations.some(registration => registration.status === status), status);
    }
    assert.ok(registrations.some(registration => registration.source === 'discord'));
    assert.ok(registrations.some(registration => registration.guests.length > 0));
    assert.ok(registrations.some(registration => registration.pendingGuests.length > 0));
    assert.ok(registrations.some(registration => registration.checkedIn));
});

test('the full event is exactly full', async () => {
    const full = await getEvent(EVENT_ID.FULL);
    const registrations = await registrationsOf(EVENT_ID.FULL);
    const occupied = registrations.filter(registration => ['accepted', 'pending'].includes(registration.status)).length;
    assert.equal(occupied, full.maxParticipants);
    assert.ok(registrations.some(registration => registration.status === 'waitlisted'));
});

test('the newcomer persona has no profile yet', async () => {
    const newcomer = PERSONAS.find(persona => persona.isNewcomer);
    assert.equal((await getDoc(doc(db, 'users', newcomer.userId))).exists(), false);
    for (const persona of PERSONAS.filter(p => !p.isNewcomer)) {
        assert.equal((await getDoc(doc(db, 'users', persona.userId))).exists(), true, persona.id);
    }
});

test('resetAndSeed removes own changes and restores the seed', async () => {
    await setDoc(doc(db, 'events', 'my-own-event'), { title: 'Eigenes Event', status: 'active' });
    await setDoc(doc(db, 'events', EVENT_ID.OPEN), { title: 'Überschrieben' });

    assert.deepEqual(await resetAndSeed(), EXPECTED_COUNTS);

    assert.equal((await getDoc(doc(db, 'events', 'my-own-event'))).exists(), false);
    assert.equal((await getEvent(EVENT_ID.OPEN)).title, 'Community-Spieleabend');
    assert.equal(await countDocs('events'), EXPECTED_COUNTS.events);
    assert.equal((await getDoc(doc(db, 'devMeta', 'seed'))).exists(), true);
});

test('the seed refuses to run outside the dev mock mode', () => {
    const result = runNode(`require(${repoPath('dev/seed')})`, { SQLITE_PATH: path.join(tmpDir, 'real.sqlite') });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /nur im Dev-Mock-Modus/);
});
