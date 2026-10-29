const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createTempDir, repoPath, runNode } = require('./helpers');

// Mock mode with an own database; the empty cwd keeps a local .env out
const tmpDir = createTempDir('seed');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'seed.sqlite');

const { seedIfEmpty, resetAndSeed } = require('../dev/seed');
const { EVENT_ID, SERIES_EVENT_IDS, CHECKIN_CODE, POLL_ID } = require('../dev/seedData');
const { PERSONAS } = require('../dev/mockGuild');
const { db, collection, doc, getDoc, getDocs, setDoc } = require('../firebaseAdmin');

const EXPECTED_COUNTS = {
    events: 14,
    users: 12,
    registrations: 38,
    comments: 6,
    auditLogs: 10,
    polls: 2,
    pollVotes: 5,
    botMessages: 1,
    botSettings: 1,
    maintenanceSettings: 1,
    eventTemplates: 1
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
    // Between its end and the automatic archive (W-01): over, but still active
    const ended = await getEvent(EVENT_ID.ENDED);
    assert.equal(ended.status, 'active');
    assert.ok(new Date(ended.endDate) < now && new Date(ended.endDate) > new Date(now.getTime() - 24 * 60 * 60 * 1000));
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

    // The member persona waits for a place and for an approval (overview markers)
    const member = PERSONAS.find(persona => persona.id === 'member');
    const ofMember = (eventId) => registrations.find(registration => registration.eventId === eventId && registration.userId === member.userId);
    assert.equal(ofMember(EVENT_ID.FULL).status, 'waitlisted');
    assert.equal(ofMember(EVENT_ID.FORM).status, 'pending');
});

test('every seeded event has a banner of dev/banners, the workshop a missing one', async () => {
    const events = (await getDocs(collection(db, 'events'))).docs.map(d => ({ id: d.id, ...d.data() }));
    assert.equal(events.length, EXPECTED_COUNTS.events);
    for (const event of events) {
        const match = event.bannerUrl.match(/^http:\/\/localhost:\d+\/dev-banners\/([a-z-]+\.svg)$/);
        assert.ok(match, `${event.id}: ${event.bannerUrl}`);
        const exists = fs.existsSync(path.join(__dirname, '..', 'dev', 'banners', match[1]));
        // The workshop's banner is missing on purpose: the overview shows its colour fallback
        assert.equal(exists, event.id !== EVENT_ID.BIG_FORM, event.id);
    }
});

test('the seed has an open poll for the raiders and a decided one', async () => {
    const open = (await getDoc(doc(db, 'polls', POLL_ID.OPEN))).data();
    assert.equal(open.status, 'open');
    assert.equal(open.options.length, 3);
    assert.ok(new Date(open.deadline) > new Date());
    const raider = PERSONAS.find(persona => persona.id === 'raider');
    assert.equal((await getDoc(doc(db, 'pollVotes', `${POLL_ID.OPEN}_${raider.userId}`))).exists(), false);

    const decided = (await getDoc(doc(db, 'polls', POLL_ID.DECIDED))).data();
    assert.deepEqual([decided.status, decided.eventId], ['decided', EVENT_ID.ARCHIVED]);
    assert.equal((await getEvent(EVENT_ID.ARCHIVED)).sourcePollId, POLL_ID.DECIDED);
});

test('the full event is exactly full', async () => {
    const full = await getEvent(EVENT_ID.FULL);
    const registrations = await registrationsOf(EVENT_ID.FULL);
    const occupied = registrations.filter(registration => ['accepted', 'pending'].includes(registration.status)).length;
    assert.equal(occupied, full.maxParticipants);
    assert.ok(registrations.some(registration => registration.status === 'waitlisted'));
});

test('the raid event has a line-up with a fallback role and a waitlist', async () => {
    const raid = await getEvent(EVENT_ID.ROLE);
    assert.deepEqual(raid.slots.map(slot => slot.id), ['tank', 'heal', 'dps']);
    assert.equal(raid.maxParticipants, 6);
    assert.equal(raid.allowGuests, false);

    const registrations = await registrationsOf(EVENT_ID.ROLE);
    assert.ok(registrations.some(r => r.status === 'accepted' && r.slotId !== r.preferredSlotId));
    assert.ok(registrations.some(r => r.status === 'waitlisted' && r.slotId === null && r.preferredSlotId === 'tank'));
});

test('the raid event is announced with a ping line and has a discussion thread (B-05, B-14)', async () => {
    const { GUILD, ROLE_ID, CHANNEL_ID } = require('../dev/mockGuild');
    const raid = await getEvent(EVENT_ID.ROLE);
    assert.equal(raid.announcements.length, 1);
    assert.equal(raid.announcements[0].channelId, CHANNEL_ID.ANNOUNCEMENTS);
    assert.ok(raid.announcements[0].intro.startsWith(`<@&${ROLE_ID.RAID_TEAM}>`));
    assert.equal(raid.discordThread.guildId, GUILD.id);
    assert.match(raid.discordThread.threadId, /^\d{17,20}$/);
    // Every other event starts without a thread
    const open = await getEvent(EVENT_ID.OPEN);
    assert.ok(!open.discordThread);
});

test('the seed shows the profile a slot, a rejection and a cancelled event', async () => {
    const userIdOf = (personaId) => PERSONAS.find(persona => persona.id === personaId).userId;
    const registrations = (await getDocs(collection(db, 'registrations'))).docs.map(d => d.data());
    const find = (personaId, eventId) => registrations.find(r => r.eventId === eventId && r.userId === userIdOf(personaId));

    assert.deepEqual([find('admin', EVENT_ID.ROLE).status, find('admin', EVENT_ID.ROLE).slotId], ['accepted', 'dps']);
    assert.equal(find('member', EVENT_ID.BIG_FORM).status, 'rejected');

    const cancelled = await getEvent(EVENT_ID.CANCELLED);
    assert.equal(cancelled.status, 'cancelled');
    assert.ok(new Date(cancelled.endDate) < new Date());
    for (const personaId of ['raider', 'member']) assert.equal(find(personaId, EVENT_ID.CANCELLED).status, 'accepted', personaId);

    // Lena stays free to pick a raid role herself (browser tour)
    assert.equal(find('raider', EVENT_ID.ROLE), undefined);
});

test('the seed covers the /meine-events overview of the personas (B-04)', async () => {
    const { loadUpcomingRegistrations } = require('../bot/myEvents');
    const { getSlots, countSlotOccupancy, hasFreePlace } = require('../utils/slotService');
    const userIdOf = (personaId) => PERSONAS.find(persona => persona.id === personaId).userId;

    const admin = await loadUpcomingRegistrations(userIdOf('admin'));
    const raid = admin.find(item => item.registration.eventId === EVENT_ID.ROLE);
    assert.equal(raid.registration.slotId, 'dps');
    // "Slot wechseln" offers Heiler, Tank is full
    const raidRegistrations = (await getDocs(collection(db, 'registrations'))).docs.map(d => d.data())
        .filter(registration => registration.eventId === EVENT_ID.ROLE);
    const slots = getSlots(raid.event);
    const occupancy = countSlotOccupancy(slots, raidRegistrations);
    const free = slots.filter(slot => slot.id !== 'dps' && hasFreePlace(slot, occupancy)).map(slot => slot.name);
    assert.deepEqual(free, ['Heiler']);

    const member = await loadUpcomingRegistrations(userIdOf('member'));
    const statuses = member.map(item => item.entry.status);
    for (const status of ['pending', 'waitlisted', 'rejected']) assert.ok(statuses.includes(status), status);
    assert.ok(member.find(item => item.entry.status === 'waitlisted').entry.waitlistPosition);
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

test('the seed refuses to touch Firebase', () => {
    const firebaseEnv = {
        FIREBASE_API_KEY: 'test', FIREBASE_AUTH_DOMAIN: 'test', FIREBASE_PROJECT_ID: 'test',
        FIREBASE_STORAGE_BUCKET: 'test', FIREBASE_MESSAGING_SENDER_ID: 'test', FIREBASE_APP_ID: 'test'
    };
    // firebaseAdmin.js is loaded before the mock mode -> it picks Firestore
    const result = runNode(`
        require(${repoPath('firebaseAdmin')});
        process.env.DEV_MOCK = 'true';
        require(${repoPath('dev/seed')});
    `, firebaseEnv);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /nicht Firebase/);
});
