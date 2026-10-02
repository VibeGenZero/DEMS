const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir } = require('./helpers');

// Mock mode with an own database; the empty cwd keeps a local .env out
const tmpDir = createTempDir('event-update');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'update.sqlite');

const bot = require('../bot');
const { db, doc, getDoc, setDoc } = require('../firebaseAdmin');
const { saveEventWithSlots } = require('../utils/eventUtils');
const { withEventLock } = require('../utils/eventLock');

after(async () => {
    await bot.client.destroy();
});

const TANK = { id: 'tank', name: 'Tank', emoji: '🛡️', capacity: 1 };
const HEAL = { id: 'heal', name: 'Heiler', emoji: '💚', capacity: 1 };

test('removing a slot waits for a registration in progress and then refuses', async () => {
    await setDoc(doc(db, 'events', 'upd-1'), { title: 'Umbau', status: 'active', slots: [TANK, HEAL], maxParticipants: 2 });

    // A registration holds the lock and takes the tank slot while the admin saves
    let release;
    const registering = withEventLock('upd-1', async () => {
        await new Promise(resolve => { release = resolve; });
        await setDoc(doc(db, 'registrations', 'upd-reg'), {
            eventId: 'upd-1', userId: 'upd-user', userName: 'Ana', status: 'accepted',
            slotId: 'tank', preferredSlotId: 'tank', altSlotIds: [], createdAt: '1'
        });
    });
    const saving = saveEventWithSlots('upd-1', [HEAL], (slots) => ({ slots }));
    await new Promise(resolve => setTimeout(resolve, 20));
    release();
    await registering;

    const result = await saving;
    assert.equal(result.ok, false);
    assert.equal(result.error, 'Slot „Tank“ hat noch 1 Anmeldung – bitte zuerst verschieben.');
    assert.equal((await getDoc(doc(db, 'events', 'upd-1'))).data().slots.length, 2);
});

test('a valid slot change is written and returns the old event', async () => {
    await setDoc(doc(db, 'events', 'upd-2'), { title: 'Umbau 2', status: 'active', slots: [TANK], maxParticipants: 1 });

    const result = await saveEventWithSlots('upd-2', [{ ...TANK, capacity: 3 }], (slots, oldEvent) => ({
        slots, maxParticipants: 3, title: `${oldEvent.title}!`
    }));

    assert.equal(result.ok, true);
    assert.equal(result.oldEvent.title, 'Umbau 2');
    const stored = (await getDoc(doc(db, 'events', 'upd-2'))).data();
    assert.equal(stored.slots[0].capacity, 3);
    assert.equal(stored.title, 'Umbau 2!');
});

test('invalid slots are reported without writing', async () => {
    await setDoc(doc(db, 'events', 'upd-3'), { title: 'Umbau 3', status: 'active', slots: [TANK], maxParticipants: 1 });
    const result = await saveEventWithSlots('upd-3', [{ name: 'Tank', emoji: 'abc', capacity: 1 }], (slots) => ({ slots }));
    assert.deepEqual(result, { ok: false, error: 'Das Emoji von Slot „Tank“ muss ein einzelnes Emoji sein.' });
});
