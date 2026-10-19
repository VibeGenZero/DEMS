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

test('/events tells the places of an event with the sentence of the website', async () => {
    await setDoc(doc(db, 'events', 'int-list'), { title: 'Listen-Abend', status: 'active', approvalMode: 'manual', maxParticipants: 10, startDate: '2026-10-20T18:00:00.000Z' });
    await seedRegistration('int-list-a', 'int-list', 'int-list-1', { status: 'accepted', guests: ['int-list-guest'] });
    await seedRegistration('int-list-b', 'int-list', 'int-list-2', { status: 'pending' });

    const interaction = createFakeInteraction({ kind: 'command', commandName: 'events', userId: 'int-list-1' });
    await dispatchInteraction(bot.client, interaction);

    const [, payload] = interaction.calls.find(([name]) => name === 'reply');
    const embed = payload.embeds.map(entry => entry.toJSON()).find(entry => entry.title === 'Listen-Abend');
    assert.equal(embed.fields.find(field => field.name === '👥 Plätze').value, '3 von 10 Plätzen belegt (inkl. 1 Gast, 1 Anfrage offen)');
});

test('a slot button of an ended event answers that it is over', async () => {
    const HOUR = 60 * 60 * 1000;
    await setDoc(doc(db, 'events', 'int-ended'), {
        title: 'Raid int-ended', status: 'active', approvalMode: 'instant', slots: SLOTS, maxParticipants: 2,
        startDate: new Date(Date.now() - 3 * HOUR).toISOString(), endDate: new Date(Date.now() - HOUR).toISOString()
    });
    const interaction = createFakeInteraction({ kind: 'button', customId: 'event_slot:int-ended:tank', userId: 'int-user-9' });
    await dispatchInteraction(bot.client, interaction);
    const answers = interaction.calls.filter(([name]) => name === 'reply' || name === 'editReply').map(([, payload]) => payload.content);
    assert.ok(answers.some(content => content.includes('Das Event ist schon vorbei.')), JSON.stringify(interaction.calls));
});

// ── Deadlines (W-03) ────────────────────────────────────────────────────

const MINUTE = 60 * 1000;
const inTwoDays = () => new Date(Date.now() + 48 * 60 * MINUTE).toISOString();
const passed = () => new Date(Date.now() - MINUTE).toISOString();
const answersOf = (interaction) => interaction.calls
    .filter(([name]) => ['reply', 'editReply', 'update'].includes(name))
    .map(([, payload]) => payload.content || '');

test('after the registration deadline the announcement keeps only the link', async () => {
    const closed = { title: 'Zu', status: 'active', approvalMode: 'instant', startDate: inTwoDays(), registrationDeadline: passed() };
    const labels = (event) => bot.buildEventComponents(event, 'int-x').flatMap(row => row.toJSON().components.map(button => button.label));
    assert.deepEqual(labels(closed), ['Zum Event']);
    assert.deepEqual(labels({ ...closed, slots: SLOTS, maxParticipants: 2 }), ['Zum Event']);
    assert.deepEqual(labels({ ...closed, registrationDeadline: inTwoDays() }), ['Anmelden', 'Zum Event']);
});

test('the register button and modals answer that registration is closed', async () => {
    await setDoc(doc(db, 'events', 'int-closed'), { title: 'Abend zu', status: 'active', approvalMode: 'instant', startDate: inTwoDays(), registrationDeadline: passed() });
    await setDoc(doc(db, 'events', 'int-closed-slots'), {
        title: 'Raid zu', status: 'active', approvalMode: 'instant', slots: SLOTS, maxParticipants: 2, startDate: inTwoDays(), registrationDeadline: passed()
    });
    const cases = [
        { kind: 'button', customId: 'event_register:int-closed' },
        { kind: 'button', customId: 'event_slot:int-closed-slots:tank' },
        { kind: 'modal', customId: 'event_register_modal:int-closed' },
        { kind: 'modal', customId: 'event_slot_modal:int-closed-slots:tank' }
    ];
    for (const fields of cases) {
        const interaction = createFakeInteraction({ ...fields, userId: 'int-late' });
        await dispatchInteraction(bot.client, interaction);
        assert.ok(answersOf(interaction).some(content => content.includes('Die Anmeldung für dieses Event ist geschlossen.')), `${fields.customId}: ${JSON.stringify(interaction.calls)}`);
    }
    assert.equal((await getDoc(doc(db, 'registrations', 'int-late'))).exists(), false);
});

test('the status answer offers no switch after the registration deadline and no leave after the unregister deadline', async () => {
    const registration = { status: 'accepted', slotId: 'tank' };
    const buttons = (event) => {
        const reply = bot.buildRegisteredSlotReply({ title: 'Raid', slots: SLOTS, startDate: inTwoDays(), ...event }, 'int-r', registration, SLOTS[1], [registration]);
        return { content: reply.content, ids: reply.components.flatMap(row => row.toJSON().components.map(button => button.custom_id)) };
    };
    assert.deepEqual(buttons({}).ids, ['slot_switch:int-r:heal', 'slot_leave:int-r']);
    assert.deepEqual(buttons({ registrationDeadline: passed() }).ids, ['slot_leave:int-r']);
    const fixed = buttons({ unregisterDeadline: passed() });
    assert.deepEqual(fixed.ids, ['slot_switch:int-r:heal']);
    assert.match(fixed.content, /Abmelden ist nicht mehr möglich\. Wende dich an einen Admin\./);
    assert.deepEqual(buttons({ registrationDeadline: passed(), unregisterDeadline: passed() }).ids, []);
});

test('an old leave button after the unregister deadline keeps the registration', async () => {
    await setDoc(doc(db, 'events', 'int-fixed'), {
        title: 'Raid fest', status: 'active', approvalMode: 'instant', slots: SLOTS, maxParticipants: 2, startDate: inTwoDays(), unregisterDeadline: passed()
    });
    await seedRegistration('int-fixed-reg', 'int-fixed', 'int-user-fixed', { status: 'accepted', slotId: 'tank', preferredSlotId: 'tank', altSlotIds: [] });
    const interaction = createFakeInteraction({ kind: 'button', customId: 'slot_leave:int-fixed', userId: 'int-user-fixed' });
    await dispatchInteraction(bot.client, interaction);
    assert.ok(answersOf(interaction).some(content => content.includes('Abmelden ist nicht mehr möglich.')));
    assert.equal((await getDoc(doc(db, 'registrations', 'int-fixed-reg'))).exists(), true);
});

test('the announcement tells both deadlines', async () => {
    const event = { title: 'Raid', status: 'active', startDate: '2026-10-24T18:00:00.000Z', registrationDeadline: '2026-10-23T18:00:00.000Z', unregisterDeadline: '2026-10-24T12:00:00.000Z' };
    const fields = bot.buildEventEmbed(event, 'https://example.com').toJSON().fields;
    const field = (name) => fields.find(entry => entry.name === name);
    assert.equal(field('⏰ Anmeldung bis').value, new Date(event.registrationDeadline).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }));
    assert.equal(field('⏰ Abmeldung bis').value, new Date(event.unregisterDeadline).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }));
    const plain = bot.buildEventEmbed({ title: 'Ohne', startDate: event.startDate }, null).toJSON().fields;
    assert.equal(plain.some(entry => entry.name.includes('bis')), false);
});
