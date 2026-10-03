const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir, createFakeInteraction, dispatchInteraction } = require('./helpers');

// Mock mode with an own database; the empty cwd keeps a local .env out
const tmpDir = createTempDir('slot-interactions');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'interactions.sqlite');

const bot = require('../bot');
const { db, doc, getDoc, setDoc } = require('../firebaseAdmin');

after(async () => {
    await bot.client.destroy();
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const SLOTS = [
    { id: 'tank', name: 'Tank', emoji: '🛡️', capacity: 1 },
    { id: 'heal', name: 'Heiler', emoji: '💚', capacity: 1 }
];

async function seedSlotEvent(id) {
    await setDoc(doc(db, 'events', id), { title: `Raid ${id}`, status: 'active', approvalMode: 'instant', slots: SLOTS, maxParticipants: 2 });
}

async function seedRegistration(id, eventId, userId, fields) {
    await setDoc(doc(db, 'registrations', id), {
        eventId, userId, userName: userId, guests: [], pendingGuests: [], formAnswers: {}, source: 'discord',
        createdAt: new Date().toISOString(), ...fields
    });
}

test('the leave button acknowledges the click before the slow clean-up', async () => {
    await seedSlotEvent('int-leave');
    await seedRegistration('int-leave-reg', 'int-leave', 'int-user-1', { status: 'accepted', slotId: 'tank', preferredSlotId: 'tank', altSlotIds: [] });

    const interaction = createFakeInteraction({ kind: 'button', customId: 'slot_leave:int-leave', userId: 'int-user-1' });
    await dispatchInteraction(bot.client, interaction);

    assert.deepEqual(interaction.calls.map(([name]) => name), ['deferUpdate', 'editReply']);
    assert.match(interaction.calls[1][1].content, /abgemeldet/);
    assert.equal((await getDoc(doc(db, 'registrations', 'int-leave-reg'))).exists(), false);
});

test('the switch button acknowledges the click before switching', async () => {
    await seedSlotEvent('int-switch');
    await seedRegistration('int-switch-reg', 'int-switch', 'int-user-2', { status: 'accepted', slotId: 'tank', preferredSlotId: 'tank', altSlotIds: [] });

    const interaction = createFakeInteraction({ kind: 'button', customId: 'slot_switch:int-switch:heal', userId: 'int-user-2' });
    await dispatchInteraction(bot.client, interaction);

    assert.deepEqual(interaction.calls.map(([name]) => name), ['deferUpdate', 'editReply']);
    assert.equal(interaction.calls[1][1].content, '✅ Du bist jetzt als 💚 Heiler eingeplant.');
});

test('/unregister acknowledges the command before the clean-up', async () => {
    await seedSlotEvent('int-slash');
    await seedRegistration('int-slash-reg', 'int-slash', 'int-user-3', { status: 'accepted', slotId: 'tank', preferredSlotId: 'tank', altSlotIds: [] });

    const interaction = createFakeInteraction({ kind: 'command', commandName: 'unregister', eventOption: 'int-slash', userId: 'int-user-3' });
    await dispatchInteraction(bot.client, interaction);

    assert.deepEqual(interaction.calls.map(([name]) => name), ['deferReply', 'editReply']);
    assert.equal(interaction.calls[1][1].embeds[0].toJSON().title, '✅ Abmeldung erfolgreich');
});

test('a declined guest invitation lets the waitlist move up', async () => {
    await setDoc(doc(db, 'events', 'int-guest'), { title: 'Abend', status: 'active', approvalMode: 'instant', maxParticipants: 2 });
    await seedRegistration('int-guest-host', 'int-guest', 'int-host', {
        status: 'accepted',
        pendingGuests: [{ userId: 'int-guest-user', displayName: 'Gast', avatar: '', status: 'pending' }],
        createdAt: '2026-10-01T08:00:00.000Z'
    });
    await seedRegistration('int-guest-waiting', 'int-guest', 'int-waiting', { status: 'waitlisted', createdAt: '2026-10-01T09:00:00.000Z' });

    const interaction = createFakeInteraction({ kind: 'button', customId: 'guest_decline:int-guest-host:int-guest-user', userId: 'int-guest-user' });
    await dispatchInteraction(bot.client, interaction);

    let status;
    for (let attempt = 0; attempt < 40; attempt++) {
        status = (await getDoc(doc(db, 'registrations', 'int-guest-waiting'))).data().status;
        if (status !== 'waitlisted') break;
        await sleep(25);
    }
    assert.equal(status, 'accepted');
});
