const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir, createFakeInteraction, dispatchInteraction } = require('./helpers');

// „Vielleicht“ from a Discord announcement (B-17). Mock mode with an own database.
const tmpDir = createTempDir('tentative-interactions');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'tentative.sqlite');

const bot = require('../bot');
const { db, collection, doc, getDocs, query, setDoc, where } = require('../firebaseAdmin');

after(async () => {
    await bot.client.destroy();
});

const HOUR = 60 * 60 * 1000;
const SLOTS = [
    { id: 'tank', name: 'Tank', emoji: '🛡️', capacity: 1 },
    { id: 'heal', name: 'Heiler', emoji: '💚', capacity: 1 }
];

async function seedEvent(id, fields = {}) {
    await setDoc(doc(db, 'events', id), {
        title: `Raid ${id}`, status: 'active', approvalMode: 'instant', accessMode: 'open', allowTentative: true,
        maxParticipants: 2, formFields: [], startDate: new Date(Date.now() + 48 * HOUR).toISOString(), ...fields
    });
}

async function registrationOf(eventId, userId) {
    const snap = await getDocs(query(collection(db, 'registrations'), where('eventId', '==', eventId), where('userId', '==', userId)));
    return snap.empty ? null : snap.docs[0].data();
}

/** Text of every answer (reply / editReply) of an interaction. */
const answersOf = (interaction) => interaction.calls
    .filter(([name]) => name === 'reply' || name === 'editReply')
    .map(([, payload]) => (typeof payload === 'string' ? payload : payload.content || ''));

/** Modal interaction with text and select answers by custom id. */
function modalOf(customId, userId, { texts = {}, selects = {} } = {}) {
    const interaction = createFakeInteraction({ kind: 'modal', customId, userId });
    interaction.fields = {
        getTextInputValue: (id) => (id in texts ? texts[id] : ''),
        getStringSelectValues: (id) => (id in selects ? selects[id] : []),
        getField: () => null
    };
    return interaction;
}

test('without form and slots a click puts the member on the bench at once', async () => {
    await seedEvent('maybe-plain');
    const interaction = createFakeInteraction({ kind: 'button', customId: 'event_maybe:maybe-plain', userId: 'maybe-user-1' });
    await dispatchInteraction(bot.client, interaction);

    assert.equal(interaction.calls[0][0], 'deferReply');
    assert.match(answersOf(interaction).at(-1), /^🤔 Du stehst auf der Ersatzbank für \*\*Raid maybe-plain\*\*\. Du belegst keinen Platz\. Fest zusagen kannst du auf der Event-Seite: .*#event\/maybe-plain$/);
    const stored = await registrationOf('maybe-plain', 'maybe-user-1');
    assert.equal(stored.status, 'tentative');
    assert.equal(stored.source, 'discord');
});

test('a form opens the „Vielleicht“ modal; its answers are stored', async () => {
    await seedEvent('maybe-form', { formFields: [{ label: 'Klasse', type: 'text', required: true }] });
    const click = createFakeInteraction({ kind: 'button', customId: 'event_maybe:maybe-form', userId: 'maybe-user-2' });
    await dispatchInteraction(bot.client, click);
    const shown = click.calls.find(([name]) => name === 'showModal');
    assert.ok(shown, 'a modal was shown');
    const json = shown[1].toJSON();
    assert.equal(json.custom_id, 'event_maybe_modal:maybe-form');
    assert.match(json.title, /^Vielleicht: /);

    const submit = modalOf('event_maybe_modal:maybe-form', 'maybe-user-2', { texts: { 'field:0': 'Druide' } });
    await dispatchInteraction(bot.client, submit);
    assert.match(answersOf(submit).at(-1), /Du stehst auf der Ersatzbank/);
    const stored = await registrationOf('maybe-form', 'maybe-user-2');
    assert.equal(stored.status, 'tentative');
    assert.deepEqual(stored.formAnswers, { Klasse: 'Druide' });
});

test('on slot events the modal asks for the wanted role and keeps it without a slot', async () => {
    await seedEvent('maybe-slots', { slots: SLOTS });
    const click = createFakeInteraction({ kind: 'button', customId: 'event_maybe:maybe-slots', userId: 'maybe-user-3' });
    await dispatchInteraction(bot.client, click);
    const json = click.calls.find(([name]) => name === 'showModal')[1].toJSON();
    const select = json.components.find(component => component.component?.custom_id === 'wanted_slot');
    assert.ok(select, 'wanted role select');
    assert.equal(select.label, 'Wunschrolle');
    assert.deepEqual(select.component.options.map(option => option.value), ['tank', 'heal']);

    const submit = modalOf('event_maybe_modal:maybe-slots', 'maybe-user-3', { selects: { wanted_slot: ['heal'] } });
    await dispatchInteraction(bot.client, submit);
    assert.match(answersOf(submit).at(-1), /Du stehst auf der Ersatzbank für \*\*Raid maybe-slots\*\* als \*\*💚 Heiler\*\*/);
    const stored = await registrationOf('maybe-slots', 'maybe-user-3');
    assert.deepEqual([stored.status, stored.slotId, stored.preferredSlotId], ['tentative', null, 'heal']);
});

test('refusals answer privately and store nothing', async () => {
    const NOT_ALLOWED = 'Für dieses Event gibt es kein „Vielleicht“.';
    await seedEvent('maybe-off', { allowTentative: false });
    await seedEvent('maybe-closed', { registrationDeadline: new Date(Date.now() - HOUR).toISOString() });
    await seedEvent('maybe-twice');
    await setDoc(doc(db, 'registrations', 'maybe-twice-reg'), {
        eventId: 'maybe-twice', userId: 'maybe-user-4', userName: 'x', status: 'accepted', guests: [], pendingGuests: [], formAnswers: {}, createdAt: new Date().toISOString()
    });
    const cases = [
        ['event_maybe:maybe-off', NOT_ALLOWED],
        ['event_maybe:maybe-closed', 'Die Anmeldung für dieses Event ist geschlossen.'],
        ['event_maybe:maybe-twice', 'Du bist bereits für dieses Event registriert.']
    ];
    for (const [customId, message] of cases) {
        const interaction = createFakeInteraction({ kind: 'button', customId, userId: 'maybe-user-4' });
        await dispatchInteraction(bot.client, interaction);
        assert.ok(answersOf(interaction).some(text => text.includes(message)), `${customId}: ${JSON.stringify(interaction.calls)}`);
        const reply = interaction.calls.find(([name]) => name === 'reply');
        if (reply) assert.ok(reply[1].flags, 'ephemeral');
    }
    assert.equal(await registrationOf('maybe-off', 'maybe-user-4'), null);
    assert.equal(await registrationOf('maybe-closed', 'maybe-user-4'), null);

    // A modal sent after the setting was turned off changes nothing either
    await seedEvent('maybe-later', { allowTentative: false, formFields: [{ label: 'Klasse', type: 'text', required: false }] });
    const submit = modalOf('event_maybe_modal:maybe-later', 'maybe-user-5', { texts: { 'field:0': 'x' } });
    await dispatchInteraction(bot.client, submit);
    assert.ok(answersOf(submit).some(text => text.includes(NOT_ALLOWED)));
    assert.equal(await registrationOf('maybe-later', 'maybe-user-5'), null);
});

test('a role button tells a member on the bench where they stand and lets them leave after the deadline', async () => {
    await seedEvent('maybe-role', { slots: SLOTS, unregisterDeadline: new Date(Date.now() - HOUR).toISOString() });
    await setDoc(doc(db, 'registrations', 'maybe-role-reg'), {
        eventId: 'maybe-role', userId: 'maybe-user-6', userName: 'x', status: 'tentative', slotId: null, preferredSlotId: 'tank', altSlotIds: [],
        guests: [], pendingGuests: [], formAnswers: {}, createdAt: new Date().toISOString()
    });
    const interaction = createFakeInteraction({ kind: 'button', customId: 'event_slot:maybe-role:heal', userId: 'maybe-user-6' });
    await dispatchInteraction(bot.client, interaction);
    const reply = interaction.calls.find(([name]) => name === 'reply' || name === 'editReply')[1];
    assert.match(reply.content, /^🤔 Du stehst für \*\*Raid maybe-role\*\* auf der Ersatzbank \(Wunschrolle 🛡️ Tank\)\.$/);
    const labels = reply.components.flatMap(row => row.components.map(button => button.toJSON().label));
    assert.deepEqual(labels, ['Zu Heiler wechseln', 'Abmelden']);
});
