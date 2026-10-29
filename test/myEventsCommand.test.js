const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir } = require('./helpers');

// Mock mode with an own database; the empty cwd keeps a local .env out
const tmpDir = createTempDir('my-events');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'my-events.sqlite');

const bot = require('../bot');
const { db, doc, setDoc } = require('../firebaseAdmin');
const { loadUpcomingRegistrations } = require('../bot/myEvents');

after(async () => {
    await bot.client.destroy();
});

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const inHours = (hours) => new Date(Date.now() + hours * HOUR).toISOString();
const SLOTS = [
    { id: 'tank', name: 'Tank', emoji: '🛡️', capacity: 1 },
    { id: 'heal', name: 'Heiler', emoji: '💚', capacity: 2 },
    { id: 'dps', name: 'Schaden', emoji: '⚔️', capacity: 1 }
];

async function seedEvent(id, fields = {}) {
    await setDoc(doc(db, 'events', id), {
        title: `Event ${id}`, status: 'active', approvalMode: 'instant', maxParticipants: 5,
        startDate: inHours(48), endDate: inHours(50), ...fields
    });
}

async function seedRegistration(id, eventId, userId, fields = {}) {
    await setDoc(doc(db, 'registrations', id), {
        eventId, userId, userName: userId, guests: [], pendingGuests: [], formAnswers: {}, source: 'web',
        status: 'accepted', createdAt: new Date(Date.now() - DAY).toISOString(), ...fields
    });
}

// ── Loading the upcoming registrations ──────────────────────────────────

test('only upcoming registrations of the member are loaded, next event first', async () => {
    await seedEvent('load-later', { title: 'Später', startDate: inHours(72), endDate: inHours(74) });
    await seedEvent('load-soon', { title: 'Bald', startDate: inHours(24), endDate: inHours(26) });
    await seedEvent('load-past', { startDate: inHours(-50), endDate: inHours(-48) });
    await seedEvent('load-archived', { status: 'archived' });
    await seedEvent('load-cancelled', { status: 'cancelled' });
    for (const eventId of ['load-later', 'load-soon', 'load-past', 'load-archived', 'load-cancelled']) {
        await seedRegistration(`${eventId}-me`, eventId, 'load-user');
    }
    await seedRegistration('load-soon-other', 'load-soon', 'load-other');

    const entries = await loadUpcomingRegistrations('load-user');

    assert.deepEqual(entries.map(entry => entry.registration.eventId), ['load-soon', 'load-later']);
    assert.equal(entries[0].event.title, 'Bald');
    assert.equal(entries[0].entry.status, 'accepted');
});

test('a waitlisted entry carries its place and the raw registration keeps the slot', async () => {
    await seedEvent('load-full', { maxParticipants: 1 });
    await seedRegistration('load-full-a', 'load-full', 'load-wait-a', { status: 'waitlisted', createdAt: inHours(-5) });
    await seedRegistration('load-full-b', 'load-full', 'load-wait-b', { status: 'waitlisted', createdAt: inHours(-4) });
    await seedRegistration('load-full-c', 'load-full', 'load-wait-c', { status: 'waitlisted', createdAt: inHours(-3) });
    await seedEvent('load-raid', { slots: SLOTS });
    await seedRegistration('load-raid-b', 'load-raid', 'load-wait-b', { slotId: 'heal', preferredSlotId: 'heal', altSlotIds: [] });

    const entries = await loadUpcomingRegistrations('load-wait-b');
    const waiting = entries.find(entry => entry.registration.eventId === 'load-full');
    const raid = entries.find(entry => entry.registration.eventId === 'load-raid');

    assert.deepEqual(waiting.entry.waitlistPosition, { position: 2, total: 3 });
    assert.equal(raid.registration.slotId, 'heal');
    assert.deepEqual(raid.entry.slot, { name: 'Heiler', emoji: '💚', wish: false });
});

// ── The overview message ────────────────────────────────────────────────

const { MessageFlags } = require('discord.js');
const { toProfileEntry } = require('../utils/profileEvents');
const { buildEventUrl, buildSiteUrl } = require('../utils/eventUrl');
const { buildMyEventsMessage } = require('../bot/myEvents');

/** Entry as loadUpcomingRegistrations returns it. */
function makeEntry(eventId, event, registration, waitlistPosition = null) {
    const fullEvent = { title: `Event ${eventId}`, status: 'active', startDate: inHours(48), endDate: inHours(50), ...event };
    const fullRegistration = { id: `${eventId}-reg`, eventId, userId: 'msg-user', status: 'accepted', ...registration };
    return { entry: toProfileEntry(fullRegistration, fullEvent, waitlistPosition), registration: fullRegistration, event: fullEvent };
}

/** Text displays and action rows of the overview container, in order. */
function containerParts(message) {
    const container = message.components[0].toJSON();
    return container.components;
}

function countComponents(list) {
    return list.reduce((sum, component) => sum + 1 + countComponents(component.components || []), 0);
}

function buttonsOf(row) {
    return row.components.map(button => ({ label: button.label, id: button.custom_id || null, url: button.url || null }));
}

test('the overview is a private V2 message with one block per registration', () => {
    const start = inHours(30);
    const message = buildMyEventsMessage([makeEntry('msg-a', { title: 'Raid', startDate: start }, {})]);

    assert.equal(message.flags, MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);
    const [heading, text, row] = containerParts(message);
    assert.match(heading.content, /Deine Events/);
    assert.match(text.content, /\*\*Raid\*\*/);
    assert.ok(text.content.includes(new Date(start).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })));
    assert.match(text.content, /✅ Angemeldet/);
    assert.deepEqual(buttonsOf(row), [
        { label: 'Abmelden', id: 'my_leave:msg-a', url: null },
        { label: 'Zum Event', id: null, url: buildEventUrl('msg-a') }
    ]);
});

test('the status line names pending, waitlist place and rejection', () => {
    const message = buildMyEventsMessage([
        makeEntry('msg-p', {}, { status: 'pending' }),
        makeEntry('msg-w', {}, { status: 'waitlisted' }, { position: 2, total: 3 }),
        makeEntry('msg-r', {}, { status: 'rejected' })
    ]);
    const [, pending, , waiting, , rejected, rejectedRow] = containerParts(message);

    assert.match(pending.content, /📋 Anfrage ausstehend/);
    assert.match(waiting.content, /🕒 Warteliste – Platz 2 von 3/);
    assert.match(rejected.content, /❌ Abgelehnt/);
    assert.deepEqual(buttonsOf(rejectedRow).map(button => button.label), ['Zum Event']);
});

test('slot events show the slot or the wish and offer "Slot wechseln" while open', () => {
    const message = buildMyEventsMessage([
        makeEntry('msg-slot', { slots: SLOTS }, { slotId: 'heal', preferredSlotId: 'heal' }),
        makeEntry('msg-wish', { slots: SLOTS }, { status: 'waitlisted', slotId: null, preferredSlotId: 'tank' }),
        makeEntry('msg-closed', { slots: SLOTS, registrationDeadline: inHours(-1) }, { slotId: 'tank', preferredSlotId: 'tank' })
    ]);
    const [, slot, slotRow, wish, wishRow, , closedRow] = containerParts(message);

    assert.match(slot.content, /💚 Heiler/);
    assert.deepEqual(buttonsOf(slotRow).map(button => button.id), ['my_leave:msg-slot', 'my_switch:msg-slot', null]);
    assert.match(wish.content, /Wunsch: 🛡️ Tank/);
    assert.deepEqual(buttonsOf(wishRow).map(button => button.id), ['my_leave:msg-wish', null]);
    assert.deepEqual(buttonsOf(closedRow).map(button => button.id), ['my_leave:msg-closed', null]);
});

test('"Abmelden" is left out after the unregister deadline', () => {
    const message = buildMyEventsMessage([makeEntry('msg-locked', { unregisterDeadline: inHours(-1) }, {})]);
    const [, , row] = containerParts(message);
    assert.deepEqual(buttonsOf(row).map(button => button.label), ['Zum Event']);
});

test('seven registrations show five and point to the profile page for the rest', () => {
    const entries = Array.from({ length: 7 }, (_, index) => makeEntry(`msg-many-${index}`, { slots: SLOTS }, { slotId: 'heal' }));
    const message = buildMyEventsMessage(entries);
    const parts = containerParts(message);

    assert.equal(parts.filter(part => part.type === 1).length, 5);
    const closing = parts[parts.length - 1];
    assert.match(closing.content, /2 weitere/);
    assert.ok(closing.content.includes(buildSiteUrl('profile')));
    assert.ok(countComponents(message.components.map(component => component.toJSON())) <= 40);
});

test('without registrations the answer links the event overview', () => {
    const message = buildMyEventsMessage([]);
    assert.equal(message.flags, MessageFlags.Ephemeral);
    assert.match(message.content, /kein kommendes Event/);
    assert.ok(message.content.includes(buildSiteUrl('events')));
});

// ── Command and buttons ─────────────────────────────────────────────────

const { createFakeInteraction, dispatchInteraction } = require('./helpers');

test('/my-events answers privately with the overview of the member', async () => {
    await seedEvent('cmd-event', { title: 'Befehls-Abend' });
    await seedRegistration('cmd-event-reg', 'cmd-event', 'cmd-user');

    const interaction = createFakeInteraction({ kind: 'command', commandName: 'my-events', userId: 'cmd-user' });
    await dispatchInteraction(bot.client, interaction);

    const [name, payload] = interaction.calls[0];
    assert.equal(name, 'reply');
    assert.equal(payload.flags, MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);
    assert.match(containerParts(payload)[1].content, /\*\*Befehls-Abend\*\*/);
});

test('/my-events without registrations links the event overview', async () => {
    const interaction = createFakeInteraction({ kind: 'command', commandName: 'my-events', userId: 'cmd-nobody' });
    await dispatchInteraction(bot.client, interaction);
    assert.match(interaction.calls[0][1].content, /kein kommendes Event/);
});

const { getDoc } = require('../firebaseAdmin');
const registrationExists = async (id) => (await getDoc(doc(db, 'registrations', id))).exists();

test('"Abmelden" asks first and leaves the registration untouched', async () => {
    await seedEvent('leave-event', { title: 'Abmelde-Abend' });
    await seedRegistration('leave-reg', 'leave-event', 'leave-user');

    const interaction = createFakeInteraction({ kind: 'button', customId: 'my_leave:leave-event', userId: 'leave-user' });
    await dispatchInteraction(bot.client, interaction);

    const [name, payload] = interaction.calls[0];
    assert.equal(name, 'reply');
    assert.equal(payload.flags, MessageFlags.Ephemeral);
    assert.equal(payload.content, 'Wirklich von **Abmelde-Abend** abmelden?');
    assert.deepEqual(buttonsOf(payload.components[0].toJSON()), [
        { label: 'Ja, abmelden', id: 'slot_leave:leave-event', url: null },
        { label: 'Abbrechen', id: 'my_leave_cancel:leave-event', url: null }
    ]);
    assert.equal(await registrationExists('leave-reg'), true);
});

test('"Abbrechen" keeps the registration', async () => {
    await seedEvent('cancel-event');
    await seedRegistration('cancel-reg', 'cancel-event', 'cancel-user');

    const interaction = createFakeInteraction({ kind: 'button', customId: 'my_leave_cancel:cancel-event', userId: 'cancel-user' });
    await dispatchInteraction(bot.client, interaction);

    assert.deepEqual(interaction.calls, [['update', { content: 'Abmeldung abgebrochen.', components: [] }]]);
    assert.equal(await registrationExists('cancel-reg'), true);
});

test('"Ja, abmelden" unregisters through the existing leave flow', async () => {
    await seedEvent('confirm-event', { title: 'Bestätigungs-Abend' });
    await seedRegistration('confirm-reg', 'confirm-event', 'confirm-user');

    const interaction = createFakeInteraction({ kind: 'button', customId: 'slot_leave:confirm-event', userId: 'confirm-user' });
    await dispatchInteraction(bot.client, interaction);

    assert.equal(interaction.calls[1][1].content, '✅ Du wurdest von **Bestätigungs-Abend** abgemeldet.');
    assert.equal(await registrationExists('confirm-reg'), false);
});

async function seedRaidWithTank(eventId, userId, { healFull = false } = {}) {
    await seedEvent(eventId, { title: `Raid ${eventId}`, slots: SLOTS, maxParticipants: 4 });
    await seedRegistration(`${eventId}-me`, eventId, userId, { slotId: 'tank', preferredSlotId: 'tank', altSlotIds: [] });
    await seedRegistration(`${eventId}-dps`, eventId, `${eventId}-dps-user`, { slotId: 'dps', preferredSlotId: 'dps', altSlotIds: [] });
    if (healFull) {
        for (const n of [1, 2]) {
            await seedRegistration(`${eventId}-heal${n}`, eventId, `${eventId}-heal-user${n}`, { slotId: 'heal', preferredSlotId: 'heal', altSlotIds: [] });
        }
    }
}

test('"Slot wechseln" offers only the other slots with a free place', async () => {
    await seedRaidWithTank('switch-raid', 'switch-user');

    const interaction = createFakeInteraction({ kind: 'button', customId: 'my_switch:switch-raid', userId: 'switch-user' });
    await dispatchInteraction(bot.client, interaction);

    const [name, payload] = interaction.calls[0];
    assert.equal(name, 'reply');
    assert.equal(payload.flags, MessageFlags.Ephemeral);
    const buttons = payload.components.flatMap(row => row.toJSON().components);
    assert.deepEqual(buttons.map(button => [button.label, button.custom_id]), [['Zu Heiler wechseln', 'slot_switch:switch-raid:heal']]);
});

test('"Slot wechseln" says so when no other slot is free', async () => {
    await seedRaidWithTank('switch-full', 'switch-user', { healFull: true });

    const interaction = createFakeInteraction({ kind: 'button', customId: 'my_switch:switch-full', userId: 'switch-user' });
    await dispatchInteraction(bot.client, interaction);

    assert.equal(interaction.calls[0][1].content, 'Gerade ist kein anderer Slot frei.');
    assert.deepEqual(interaction.calls[0][1].components, []);
});

test('a switch button of that answer moves the member through the existing flow', async () => {
    await seedRaidWithTank('switch-move', 'switch-user');

    const interaction = createFakeInteraction({ kind: 'button', customId: 'slot_switch:switch-move:heal', userId: 'switch-user' });
    await dispatchInteraction(bot.client, interaction);

    assert.match(interaction.calls[1][1].content, /^✅/);
    assert.equal((await getDoc(doc(db, 'registrations', 'switch-move-me'))).data().slotId, 'heal');
});
