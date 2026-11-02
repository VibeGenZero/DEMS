const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir } = require('./helpers');

// Mock mode with an own database; the empty cwd keeps a local .env out
const tmpDir = createTempDir('tentative-registration');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'tentative.sqlite');

const bot = require('../bot');
const { db, doc, getDoc, setDoc } = require('../firebaseAdmin');
const { confirmTentativeRegistration } = require('../utils/tentativeRegistration');
const { loadEventRegistrations } = require('../utils/eventUtils');
const { waitlistPositions } = require('../utils/capacity');
const { flushAnnouncementRefreshes } = require('../utils/announcementRefresh');

after(async () => {
    await bot.client.destroy();
});

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const at = (ms) => new Date(Date.now() + ms).toISOString();
const SLOTS = [
    { id: 'tank', name: 'Tank', emoji: '🛡️', capacity: 1 },
    { id: 'heal', name: 'Heiler', emoji: '💚', capacity: 1 },
    { id: 'dps', name: 'Schaden', emoji: '⚔️', capacity: 2 }
];

let counter = 0;
async function createEvent(fields = {}) {
    const id = `bench-event-${++counter}`;
    await setDoc(doc(db, 'events', id), {
        title: `Bank ${counter}`, status: 'active', accessMode: 'open', approvalMode: 'instant', allowTentative: true,
        maxParticipants: 0, formFields: [], startDate: at(3 * DAY), ...fields
    });
    return id;
}
async function addRegistration(eventId, status, minutesAgo, fields = {}) {
    const id = `bench-reg-${++counter}`;
    const createdAt = new Date(Date.now() - minutesAgo * MINUTE).toISOString();
    await setDoc(doc(db, 'registrations', id), {
        eventId, userId: `bench-user-${counter}`, userName: `User ${counter}`, status, guests: [], pendingGuests: [],
        formAnswers: {}, source: 'web', createdAt, ...(status === 'tentative' ? { tentativeAt: createdAt } : {}), ...fields
    });
    return id;
}
const registrationOf = async (id) => (await getDoc(doc(db, 'registrations', id))).data();
const confirm = async (registrationId) => confirmTentativeRegistration({
    eventId: (await registrationOf(registrationId)).eventId,
    userId: (await registrationOf(registrationId)).userId
});
const failureOf = (result) => ({ ok: result.ok, code: result.code, httpStatus: result.httpStatus, error: result.error });

/** Console lines written while fn runs (the mock bot logs there). */
async function captureLog(fn) {
    const lines = [];
    const original = console.log;
    console.log = (...args) => { lines.push(args.map(String).join(' ')); };
    try {
        await fn();
        await flushAnnouncementRefreshes();
        await new Promise(resolve => setTimeout(resolve, 50));
    } finally {
        console.log = original;
    }
    return lines.join('\n');
}

test('confirming with a free place and instant approval accepts with DM, role and channels', async () => {
    const eventId = await createEvent({ maxParticipants: 2, assignRoleId: 'role-bench', discordChannelId: 'voice-bench' });
    await addRegistration(eventId, 'accepted', 60);
    const reg = await addRegistration(eventId, 'tentative', 2 * 24 * 60);
    const before = await registrationOf(reg);

    let result;
    const log = await captureLog(async () => { result = await confirm(reg); });
    assert.equal(result.ok, true);
    assert.equal(result.status, 'accepted');
    assert.equal(result.message, 'Erfolgreich angemeldet!');
    const stored = await registrationOf(reg);
    assert.equal(stored.status, 'accepted');
    // Counts as registered now; the „Vielleicht“ time stays
    assert.ok(stored.createdAt > before.createdAt);
    assert.equal(stored.tentativeAt, before.tentativeAt);
    assert.match(log, /DM an/);
    assert.match(log, /Rolle role-bench an .* vergeben/);
    assert.match(log, /zu den Channels/);
});

test('confirming with manual approval makes a request and posts it for approval', async () => {
    const eventId = await createEvent({ approvalMode: 'manual' });
    const reg = await addRegistration(eventId, 'tentative', 30);
    const requests = [];
    const original = bot.sendApprovalRequest;
    bot.sendApprovalRequest = async (registrationId) => { requests.push(registrationId); return null; };
    let result;
    try {
        await captureLog(async () => { result = await confirm(reg); });
    } finally {
        bot.sendApprovalRequest = original;
    }
    assert.equal(result.status, 'pending');
    assert.equal((await registrationOf(reg)).status, 'pending');
    assert.deepEqual(requests, [reg]);
});

test('confirming on a full event goes to the end of the waitlist', async () => {
    const eventId = await createEvent({ maxParticipants: 1 });
    await addRegistration(eventId, 'accepted', 60);
    const waiting = await addRegistration(eventId, 'waitlisted', 10);
    // Answered „Vielleicht“ long before the waitlisted member registered
    const reg = await addRegistration(eventId, 'tentative', 3 * 24 * 60);

    const result = await confirm(reg);
    assert.equal(result.status, 'waitlisted');
    const positions = waitlistPositions(await loadEventRegistrations(eventId));
    assert.deepEqual(positions.get(waiting), { position: 1, total: 2 });
    assert.deepEqual(positions.get(reg), { position: 2, total: 2 });
});

test('confirming on a slot event takes the wanted role, else a free fallback', async () => {
    const eventId = await createEvent({ slots: SLOTS, maxParticipants: 4 });
    await addRegistration(eventId, 'accepted', 60, { slotId: 'heal', preferredSlotId: 'heal', altSlotIds: [] });
    const reg = await addRegistration(eventId, 'tentative', 30, { slotId: null, preferredSlotId: 'heal', altSlotIds: ['dps'] });

    const result = await confirm(reg);
    assert.equal(result.status, 'accepted');
    assert.equal(result.slotId, 'dps');
    assert.equal(result.message, 'Erfolgreich angemeldet! Dein Slot: ⚔️ Schaden (💚 Heiler war voll).');
    assert.equal((await registrationOf(reg)).slotId, 'dps');
});

test('confirming is refused after the end, after the deadline and on inactive events; the bench stays', async () => {
    const cases = [
        [{ startDate: at(-3 * 60 * MINUTE), endDate: at(-MINUTE) }, { ok: false, code: 'event_ended', httpStatus: 400, error: 'Das Event ist schon vorbei.' }],
        [{ registrationDeadline: at(-MINUTE) }, { ok: false, code: 'registration_closed', httpStatus: 400, error: 'Die Anmeldung für dieses Event ist geschlossen.' }],
        [{ status: 'cancelled' }, { ok: false, code: 'event_inactive', httpStatus: 400, error: 'Dieses Event akzeptiert keine Anmeldungen.' }]
    ];
    for (const [fields, expected] of cases) {
        const eventId = await createEvent(fields);
        const reg = await addRegistration(eventId, 'tentative', 30);
        assert.deepEqual(failureOf(await confirm(reg)), expected, expected.code);
        assert.equal((await registrationOf(reg)).status, 'tentative', expected.code);
    }
});

test('only a tentative registration of the member can be confirmed', async () => {
    const NOT_TENTATIVE = { ok: false, code: 'not_tentative', httpStatus: 400, error: 'Du stehst nicht auf der Ersatzbank.' };
    const eventId = await createEvent();
    const accepted = await addRegistration(eventId, 'accepted', 30);
    assert.deepEqual(failureOf(await confirm(accepted)), NOT_TENTATIVE);
    assert.deepEqual(failureOf(await confirmTentativeRegistration({ eventId, userId: 'bench-nobody' })), NOT_TENTATIVE);
    assert.equal((await confirmTentativeRegistration({ eventId: 'bench-missing', userId: 'bench-nobody' })).code, 'event_not_found');
});

test('two confirmations at once for the last place get one place', async () => {
    const eventId = await createEvent({ maxParticipants: 1 });
    const first = await addRegistration(eventId, 'tentative', 30);
    const second = await addRegistration(eventId, 'tentative', 20);
    const results = await Promise.all([confirm(first), confirm(second)]);
    assert.deepEqual(results.map(result => result.status).sort(), ['accepted', 'waitlisted']);
});
