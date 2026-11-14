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
const { db, collection, doc, getDoc, getDocs, query, setDoc, where } = require('../firebaseAdmin');
const { buildEventUrl } = require('../utils/eventUrl');

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

// Mock mode turns the mock AI provider on: „Frage stellen“ stays while the event is active and not over
test('after the registration deadline the announcement keeps only the question and the link', async () => {
    const closed = { title: 'Zu', status: 'active', approvalMode: 'instant', startDate: inTwoDays(), registrationDeadline: passed() };
    // Every button of the V2 announcement: slot buttons beside their blocks, then the last row (B-05)
    const labels = (event) => {
        const container = bot.buildEventAnnouncement(event, 'int-x').components.map(part => part.toJSON()).find(part => part.type === 17);
        return container.components.flatMap(part => {
            if (part.type === 9) return [part.accessory.label];
            return part.type === 1 ? part.components.map(button => button.label) : [];
        });
    };
    assert.deepEqual(labels(closed), ['Frage stellen', 'Zum Event']);
    assert.deepEqual(labels({ ...closed, slots: SLOTS, maxParticipants: 2 }), ['Frage stellen', 'Zum Event']);
    assert.deepEqual(labels({ ...closed, registrationDeadline: inTwoDays() }), ['Anmelden', 'Frage stellen', 'Zum Event']);
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
    // Facts are the second text of the container (B-05)
    const factsOf = (data) => bot.buildEventAnnouncement(data, 'int-x').components.map(part => part.toJSON())
        .find(part => part.type === 17).components.filter(part => part.type === 10)[1].content.split('\n');
    const facts = factsOf(event);
    const berlin = (value) => new Date(value).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
    assert.ok(facts.includes(`⏰ **Anmeldung bis:** ${berlin(event.registrationDeadline)}`), facts.join('\n'));
    assert.ok(facts.includes(`⏰ **Abmeldung bis:** ${berlin(event.unregisterDeadline)}`), facts.join('\n'));
    assert.equal(factsOf({ title: 'Ohne', startDate: event.startDate }).some(line => line.includes('bis:')), false);
});

// ── Paths pinned before splitting bot.js (B-01) ─────────────────────────

// ── /register registers in Discord (B-03) ───────────────────────────────

async function registrationsOf(eventId) {
    const snapshot = await getDocs(query(collection(db, 'registrations'), where('eventId', '==', eventId)));
    return snapshot.docs.map(entry => entry.data());
}

async function runRegisterCommand(eventId, userId) {
    const interaction = createFakeInteraction({ kind: 'command', commandName: 'register', eventOption: eventId, userId });
    await dispatchInteraction(bot.client, interaction);
    // The registration answers with editReply after the defer
    await waitFor(() => interaction.calls.some(([name]) => name !== 'deferReply'));
    return interaction;
}

const waitFor = async (check, timeoutMs = 3000) => {
    const start = Date.now();
    while (!check()) {
        if (Date.now() - start > timeoutMs) throw new Error('condition not met');
        await sleep(10);
    }
};

test('/register registers for an event without slots and form at once', async () => {
    await setDoc(doc(db, 'events', 'int-reg-direct'), { title: 'Direkt-Abend', status: 'active', approvalMode: 'instant', maxParticipants: 5 });

    const interaction = await runRegisterCommand('int-reg-direct', 'int-reg-user');

    assert.deepEqual(interaction.calls.map(([name]) => name), ['deferReply', 'editReply']);
    assert.equal(interaction.calls[1][1].embeds[0].toJSON().title, '✅ Anmeldung bestätigt');
    const registrations = await registrationsOf('int-reg-direct');
    assert.equal(registrations.length, 1);
    assert.equal(registrations[0].userId, 'int-reg-user');
    assert.equal(registrations[0].source, 'discord');
});

test('/register opens the registration modal for an event with a small form', async () => {
    await setDoc(doc(db, 'events', 'int-reg-form'), {
        title: 'Formular-Abend', status: 'active', approvalMode: 'instant', maxParticipants: 5,
        formFields: [{ label: 'Charakter', type: 'text' }, { label: 'Erfahrung', type: 'text' }]
    });

    const interaction = await runRegisterCommand('int-reg-form', 'int-reg-user');

    const [name, modal] = interaction.calls[0];
    assert.equal(name, 'showModal');
    assert.equal(modal.toJSON().custom_id, 'event_register_modal:int-reg-form');
    assert.equal((await registrationsOf('int-reg-form')).length, 0);
});

test('/register refuses a member who is already registered', async () => {
    await setDoc(doc(db, 'events', 'int-reg-twice'), { title: 'Doppel-Abend', status: 'active', approvalMode: 'instant', maxParticipants: 5 });
    await seedRegistration('int-reg-twice-reg', 'int-reg-twice', 'int-reg-user', { status: 'accepted' });

    const interaction = await runRegisterCommand('int-reg-twice', 'int-reg-user');

    assert.equal(interaction.calls[0][0], 'reply');
    assert.equal(interaction.calls[0][1].content, '❌ Du bist bereits für dieses Event registriert.');
    assert.equal((await registrationsOf('int-reg-twice')).length, 1);
});

test('/register refuses after the registration deadline', async () => {
    await setDoc(doc(db, 'events', 'int-reg-late'), {
        title: 'Spät-Abend', status: 'active', approvalMode: 'instant', maxParticipants: 5,
        registrationDeadline: new Date(Date.now() - 60 * 60 * 1000).toISOString()
    });

    const interaction = await runRegisterCommand('int-reg-late', 'int-reg-user');

    assert.equal(interaction.calls[0][1].content, '❌ Die Anmeldung für dieses Event ist geschlossen.');
    assert.equal((await registrationsOf('int-reg-late')).length, 0);
});

test('/register offers the slots of a slot event as buttons', async () => {
    await seedSlotEvent('int-reg-slots');
    await seedRegistration('int-reg-slots-tank', 'int-reg-slots', 'int-reg-other', { status: 'accepted', slotId: 'tank', preferredSlotId: 'tank', altSlotIds: [] });

    const interaction = await runRegisterCommand('int-reg-slots', 'int-reg-user');

    const [name, payload] = interaction.calls[0];
    assert.equal(name, 'reply');
    assert.match(payload.content, /\*\*Raid int-reg-slots\*\*/);
    const buttons = payload.components.flatMap(row => row.toJSON().components);
    assert.deepEqual(buttons.map(button => [button.label, button.custom_id]), [
        ['Tank (voll)', 'event_slot:int-reg-slots:tank'],
        ['Heiler', 'event_slot:int-reg-slots:heal']
    ]);
    assert.equal((await registrationsOf('int-reg-slots')).length, 1);
});

test('a slot button of the /register answer continues in the slot flow', async () => {
    await seedSlotEvent('int-reg-pick');

    const interaction = createFakeInteraction({ kind: 'button', customId: 'event_slot:int-reg-pick:heal', userId: 'int-reg-user' });
    await dispatchInteraction(bot.client, interaction);

    // Two slots -> the slot modal asks for fallback roles
    const [name, modal] = interaction.calls[0];
    assert.equal(name, 'showModal');
    assert.equal(modal.toJSON().custom_id, 'event_slot_modal:int-reg-pick:heal');
});

test('/register sends members to the website when the form is too big for Discord', async () => {
    await setDoc(doc(db, 'events', 'int-reg-big'), {
        title: 'Groß-Abend', status: 'active', approvalMode: 'instant', maxParticipants: 5,
        formFields: ['A', 'B', 'C', 'D', 'E', 'F'].map(label => ({ label, type: 'text' }))
    });
    // Five fields fit a plain modal, but a slot event needs one row for the fallback roles
    await setDoc(doc(db, 'events', 'int-reg-big-slots'), {
        title: 'Groß-Raid', status: 'active', approvalMode: 'instant', slots: SLOTS, maxParticipants: 2,
        formFields: ['A', 'B', 'C', 'D', 'E'].map(label => ({ label, type: 'text' }))
    });

    for (const eventId of ['int-reg-big', 'int-reg-big-slots']) {
        const interaction = await runRegisterCommand(eventId, 'int-reg-user');
        assert.equal(interaction.calls[0][0], 'reply');
        assert.ok(interaction.calls[0][1].content.includes(buildEventUrl(eventId)), eventId);
        assert.equal((await registrationsOf(eventId)).length, 0);
    }
});

test('/register and /unregister carry German names for German clients', () => {
    const { buildSlashCommands } = require('../bot/commands');
    const commands = Object.fromEntries(buildSlashCommands().map(command => [command.name, command]));

    // polls is B-12 (test/infoCommands.test.js), ask the event assistant (test/askCommand.test.js; on in mock mode),
    // event and poll the admin commands of B-13 (test/adminCommands.test.js)
    assert.deepEqual(Object.keys(commands), ['events', 'register', 'unregister', 'my-events', 'polls', 'ask', 'event', 'poll']);
    assert.equal(commands['my-events'].name_localizations.de, 'meine-events');
    assert.equal(commands['my-events'].description_localizations.de, 'Zeigt deine kommenden Anmeldungen');
    assert.equal(commands.register.name_localizations.de, 'anmelden');
    assert.equal(commands.unregister.name_localizations.de, 'abmelden');
    assert.equal(commands.register.description_localizations.de, 'Melde dich für ein Event an');
    assert.equal(commands.unregister.description_localizations.de, 'Melde dich von einem Event ab');
    assert.equal(commands.events.name_localizations, undefined);
});

test('/register for an unknown event says it was not found', async () => {
    const interaction = createFakeInteraction({ kind: 'command', commandName: 'register', eventOption: 'int-missing', userId: 'int-reg-user' });
    await dispatchInteraction(bot.client, interaction);
    assert.equal(interaction.calls[0][1].content, '❌ Event nicht gefunden.');
});

test('the /register autocomplete offers active events matching the typed text', async () => {
    await setDoc(doc(db, 'events', 'int-ac-raid'), { title: 'Autocomplete Raid', status: 'active' });
    await setDoc(doc(db, 'events', 'int-ac-old'), { title: 'Autocomplete Alt', status: 'archived' });

    const interaction = createFakeInteraction({ kind: 'autocomplete', commandName: 'register', focused: 'AUTOCOMPLETE', userId: 'int-ac-user' });
    await dispatchInteraction(bot.client, interaction);

    assert.deepEqual(interaction.calls, [['respond', [{ name: 'Autocomplete Raid', value: 'int-ac-raid' }]]]);
});

test('the /unregister autocomplete offers only events the user is registered for', async () => {
    await setDoc(doc(db, 'events', 'int-ac-mine'), { title: 'Abmelde-Abend', status: 'active' });
    await setDoc(doc(db, 'events', 'int-ac-other'), { title: 'Abmelde-Fremd', status: 'active' });
    await seedRegistration('int-ac-reg', 'int-ac-mine', 'int-ac-member', { status: 'accepted' });

    const interaction = createFakeInteraction({ kind: 'autocomplete', commandName: 'unregister', focused: 'abmelde', userId: 'int-ac-member' });
    await dispatchInteraction(bot.client, interaction);

    assert.deepEqual(interaction.calls, [['respond', [{ name: 'Abmelde-Abend', value: 'int-ac-mine' }]]]);
});

test('an accepted guest invitation adds the guest and answers in place', async () => {
    await setDoc(doc(db, 'events', 'int-guest-yes'), { title: 'Gast-Abend', status: 'active', approvalMode: 'instant', maxParticipants: 4 });
    await seedRegistration('int-guest-yes-host', 'int-guest-yes', 'int-host-2', {
        status: 'accepted',
        pendingGuests: [{ userId: 'int-guest-2', displayName: 'Gast Zwei', avatar: '', status: 'pending' }]
    });

    const interaction = createFakeInteraction({ kind: 'button', customId: 'guest_accept:int-guest-yes-host:int-guest-2', userId: 'int-guest-2' });
    await dispatchInteraction(bot.client, interaction);

    const [name, payload] = interaction.calls[0];
    assert.equal(name, 'update');
    assert.equal(payload.embeds[0].toJSON().title, '✅ Einladung angenommen');
    const registration = (await getDoc(doc(db, 'registrations', 'int-guest-yes-host'))).data();
    assert.deepEqual(registration.guests, ['int-guest-2']);
    assert.equal(registration.pendingGuests[0].status, 'accepted');
});

test('a guest button pressed by somebody else is refused', async () => {
    const interaction = createFakeInteraction({ kind: 'button', customId: 'guest_accept:int-guest-yes-host:int-guest-2', userId: 'int-stranger' });
    await dispatchInteraction(bot.client, interaction);
    assert.equal(interaction.calls[0][1].content, '❌ Diese Einladung ist nicht für dich.');
});

test('two guests accepting at the same time are both added', async () => {
    await setDoc(doc(db, 'events', 'int-guest-both'), { title: 'Doppel-Abend', status: 'active', approvalMode: 'instant', maxParticipants: 6 });
    await seedRegistration('int-guest-both-host', 'int-guest-both', 'int-host-3', {
        status: 'accepted',
        pendingGuests: [
            { userId: 'int-guest-a', displayName: 'Gast A', avatar: '', status: 'pending' },
            { userId: 'int-guest-b', displayName: 'Gast B', avatar: '', status: 'pending' }
        ]
    });

    const accept = (guestId) => dispatchInteraction(bot.client, createFakeInteraction({
        kind: 'button', customId: `guest_accept:int-guest-both-host:${guestId}`, userId: guestId
    }));
    await Promise.all([accept('int-guest-a'), accept('int-guest-b')]);

    const registration = (await getDoc(doc(db, 'registrations', 'int-guest-both-host'))).data();
    assert.deepEqual([...registration.guests].sort(), ['int-guest-a', 'int-guest-b']);
    assert.deepEqual(registration.pendingGuests.map(guest => guest.status), ['accepted', 'accepted']);
});
