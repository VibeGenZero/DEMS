const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir } = require('./helpers');

// Mock mode with an own database; the empty cwd keeps a local .env out
const tmpDir = createTempDir('promotion');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'promotion.sqlite');

const bot = require('../bot');
const { db, doc, getDoc, setDoc } = require('../firebaseAdmin');
const { promoteFromWaitlist } = require('../utils/eventUtils');

after(async () => {
    await bot.client.destroy();
});

let counter = 0;

async function createEvent(fields) {
    const id = `promo-event-${++counter}`;
    const event = { title: `Event ${counter}`, status: 'active', approvalMode: 'instant', maxParticipants: 0, ...fields };
    await setDoc(doc(db, 'events', id), event);
    return { id, event };
}

async function addRegistration(eventId, status, createdAt, fields = {}) {
    const id = `promo-reg-${++counter}`;
    await setDoc(doc(db, 'registrations', id), {
        eventId, userId: `promo-user-${counter}`, userName: `User ${counter}`,
        status, guests: [], pendingGuests: [], createdAt, ...fields
    });
    return id;
}

async function registration(id) {
    return (await getDoc(doc(db, 'registrations', id))).data();
}

test('a waitlisted registration with guests does not overbook a normal event', async () => {
    const { id, event } = await createEvent({ maxParticipants: 2 });
    await addRegistration(id, 'accepted', '2026-10-01T08:00:00.000Z');
    const withGuest = await addRegistration(id, 'waitlisted', '2026-10-01T09:00:00.000Z', { guests: ['promo-guest'] });
    const single = await addRegistration(id, 'waitlisted', '2026-10-01T10:00:00.000Z');

    const promotions = await promoteFromWaitlist(id, event);

    assert.deepEqual(promotions.map(promotion => promotion.registrationId), [single]);
    assert.equal((await registration(withGuest)).status, 'waitlisted');
    assert.equal((await registration(single)).status, 'accepted');
});

test('several registrations move up when places are free', async () => {
    const { id, event } = await createEvent({ maxParticipants: 3 });
    await addRegistration(id, 'accepted', '2026-10-01T08:00:00.000Z');
    const first = await addRegistration(id, 'waitlisted', '2026-10-01T09:00:00.000Z');
    const second = await addRegistration(id, 'waitlisted', '2026-10-01T10:00:00.000Z');
    const third = await addRegistration(id, 'waitlisted', '2026-10-01T11:00:00.000Z');

    await promoteFromWaitlist(id, event);

    assert.equal((await registration(first)).status, 'accepted');
    assert.equal((await registration(second)).status, 'accepted');
    assert.equal((await registration(third)).status, 'waitlisted');
});

test('a freed slot goes to the oldest matching waitlist entry', async () => {
    const slots = [
        { id: 'tank', name: 'Tank', emoji: '🛡️', capacity: 1 },
        { id: 'heal', name: 'Heiler', emoji: '💚', capacity: 1 }
    ];
    const { id, event } = await createEvent({ slots, maxParticipants: 2 });
    await addRegistration(id, 'accepted', '1', { slotId: 'tank', preferredSlotId: 'tank', altSlotIds: [] });
    const waitsForTank = await addRegistration(id, 'waitlisted', '2', { slotId: null, preferredSlotId: 'tank', altSlotIds: [] });
    const waitsForHeal = await addRegistration(id, 'waitlisted', '3', { slotId: null, preferredSlotId: 'tank', altSlotIds: ['heal'] });

    const promotions = await promoteFromWaitlist(id, event);

    assert.deepEqual(promotions.map(({ registrationId, slotId, status }) => ({ registrationId, slotId, status })), [
        { registrationId: waitsForHeal, slotId: 'heal', status: 'accepted' }
    ]);
    assert.equal((await registration(waitsForTank)).status, 'waitlisted');
    assert.equal((await registration(waitsForHeal)).slotId, 'heal');
});

test('manual approval moves people up as pending requests', async () => {
    const slots = [{ id: 'dps', name: 'Schaden', emoji: '', capacity: 2 }];
    const { id, event } = await createEvent({ slots, maxParticipants: 2, approvalMode: 'manual' });
    const waiting = await addRegistration(id, 'waitlisted', '1', { slotId: null, preferredSlotId: 'dps', altSlotIds: [] });

    await promoteFromWaitlist(id, event);

    assert.equal((await registration(waiting)).status, 'pending');
    assert.equal((await registration(waiting)).slotId, 'dps');
});

test('nothing moves while every place is taken', async () => {
    const { id, event } = await createEvent({ maxParticipants: 1 });
    await addRegistration(id, 'accepted', '1');
    const waiting = await addRegistration(id, 'waitlisted', '2');

    assert.deepEqual(await promoteFromWaitlist(id, event), []);
    assert.equal((await registration(waiting)).status, 'waitlisted');
});

test('places still move up after the registration deadline (W-03)', async () => {
    const { id, event } = await createEvent({
        maxParticipants: 1,
        startDate: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        registrationDeadline: new Date(Date.now() - 60 * 1000).toISOString()
    });
    const waiting = await addRegistration(id, 'waitlisted', '2026-10-01T10:00:00.000Z');
    const promotions = await promoteFromWaitlist(id, event);
    assert.equal(promotions.length, 1);
    // Two days before the start the place is offered for confirmation (B-15)
    assert.equal((await registration(waiting)).status, 'offered');
});
