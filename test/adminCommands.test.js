const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { PermissionsBitField, PermissionFlagsBits } = require('discord.js');
const { createTempDir, createFakeInteraction, dispatchInteraction } = require('./helpers');

// Mock mode with an own, seeded database; the empty cwd keeps a local .env out
const tmpDir = createTempDir('admin-commands');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'commands.sqlite');

const bot = require('../bot');
const { db, collection, doc, getDoc, getDocs, setDoc } = require('../firebaseAdmin');
const { PERSONAS, ROLE_ID } = require('../dev/mockGuild');
const { buildSlashCommands } = require('../bot/commands');

const ADMIN = PERSONAS.find(persona => persona.id === 'admin');
const MEMBER = PERSONAS.find(persona => persona.id === 'member');
const RAID_TEMPLATE = 'dev-template-raid';
const PLAIN_TEMPLATE = 'dev-template-community';

before(async () => {
    process.env.DISCORD_ADMIN_ROLE_ID = ROLE_ID.ADMIN;
    await require('../dev/seed').seedIfEmpty();
});

after(async () => {
    await bot.client.destroy();
});

/**
 * A fake interaction of a persona with subcommand, options and modal values.
 *
 * @param {Object} spec -> `{ kind, persona, commandName, subcommand, customId, options, fields, focused }`.
 */
function interactionOf({ kind, persona = ADMIN, commandName, subcommand = 'create', customId, options = {}, fields = {}, focused = '', permissions = null }) {
    const interaction = createFakeInteraction({ kind, customId, commandName, userId: persona.userId, roles: persona.roles, focused, permissions });
    interaction.options = {
        getSubcommand: () => subcommand,
        getString: (name) => (name in options ? options[name] : null),
        getFocused: () => focused
    };
    interaction.fields = {
        getTextInputValue: (id) => (id in fields ? fields[id] : '')
    };
    interaction.guildId = 'guild-1';
    return interaction;
}

const lastCall = (interaction) => interaction.calls[interaction.calls.length - 1];
/** Answer text of the last reply / editReply / update. */
const answerText = (interaction) => {
    const [, payload] = lastCall(interaction);
    return typeof payload === 'string' ? payload : (payload.content || '');
};
/** Text inputs of a shown modal as { customId: value }. */
function modalInputs(interaction) {
    const shown = interaction.calls.find(([name]) => name === 'showModal');
    assert.ok(shown, 'a modal was shown');
    const json = shown[1].toJSON();
    return { customId: json.custom_id, inputs: Object.fromEntries(json.components.map(label => [label.component.custom_id, label.component.value ?? ''])) };
}

// ── Definitions and access ──────────────────────────────────────────────

test('the admin commands are defined with German names', () => {
    const commands = Object.fromEntries(buildSlashCommands().map(command => [command.name, command]));
    for (const [name, german] of [['event', 'event'], ['poll', 'abstimmung']]) {
        assert.ok(commands[name], name);
        assert.equal(commands[name].name_localizations.de, german);
        const [create] = commands[name].options;
        assert.equal(create.name, 'create');
        assert.equal(create.name_localizations.de, 'erstellen');
    }
    const [eventCreate] = commands.event.options;
    assert.equal(eventCreate.options[0].name, 'template');
    assert.equal(eventCreate.options[0].name_localizations.de, 'vorlage');
    assert.equal(eventCreate.options[0].autocomplete, true);
    assert.equal(eventCreate.options[0].required, false);
});

test('members without the admin role are refused everywhere', async () => {
    for (const commandName of ['event', 'poll']) {
        const interaction = interactionOf({ kind: 'command', persona: MEMBER, commandName });
        await dispatchInteraction(bot.client, interaction);
        assert.equal(answerText(interaction), '⛔ Nur Admins können Events und Abstimmungen erstellen.');
        assert.ok(!interaction.calls.some(([name]) => name === 'showModal'));
    }
    const autocomplete = interactionOf({ kind: 'autocomplete', persona: MEMBER, commandName: 'event', focused: 'ra' });
    await dispatchInteraction(bot.client, autocomplete);
    assert.deepEqual(lastCall(autocomplete), ['respond', []]);

    const button = interactionOf({ kind: 'button', persona: MEMBER, customId: 'admin_event_publish:dev-event-draft' });
    await dispatchInteraction(bot.client, button);
    assert.match(answerText(button), /Nur Admins/);
    assert.equal((await getDoc(doc(db, 'events', 'dev-event-draft'))).data().status, 'draft');
});

test('a Discord Administrator passes without the admin role, also with none configured', async () => {
    const previous = process.env.DISCORD_ADMIN_ROLE_ID;
    try {
        for (const adminRoleId of [previous, '']) {
            process.env.DISCORD_ADMIN_ROLE_ID = adminRoleId;
            const interaction = interactionOf({
                kind: 'command', persona: MEMBER, commandName: 'event',
                permissions: new PermissionsBitField(PermissionFlagsBits.Administrator)
            });
            await dispatchInteraction(bot.client, interaction);
            assert.ok(interaction.calls.some(([name]) => name === 'showModal'), `admin role "${adminRoleId}"`);
        }
        // Other rights such as "Manage Server" are not enough
        const manager = interactionOf({
            kind: 'command', persona: MEMBER, commandName: 'event',
            permissions: new PermissionsBitField(PermissionFlagsBits.ManageGuild)
        });
        await dispatchInteraction(bot.client, manager);
        assert.match(answerText(manager), /Nur Admins/);
    } finally {
        process.env.DISCORD_ADMIN_ROLE_ID = previous;
    }
});

test('the template autocomplete offers matching templates to admins', async () => {
    const interaction = interactionOf({ kind: 'autocomplete', commandName: 'event', focused: 'RA' });
    await dispatchInteraction(bot.client, interaction);
    assert.deepEqual(lastCall(interaction), ['respond', [{ name: 'Raid-Abend', value: RAID_TEMPLATE }]]);

    const all = interactionOf({ kind: 'autocomplete', commandName: 'event', focused: '' });
    await dispatchInteraction(bot.client, all);
    assert.equal(lastCall(all)[1].length, 2);
});

// ── Modals ──────────────────────────────────────────────────────────────

test('an admin gets the empty event modal', async () => {
    const interaction = interactionOf({ kind: 'command', commandName: 'event' });
    await dispatchInteraction(bot.client, interaction);
    const { customId, inputs } = modalInputs(interaction);
    assert.equal(customId, 'admin_event_modal:-');
    assert.deepEqual(Object.keys(inputs), ['title', 'start', 'end', 'places', 'description']);
    assert.ok(Object.values(inputs).every(value => value === ''));
});

test('a template prefills the modal; a slot template leaves out the places', async () => {
    const plain = interactionOf({ kind: 'command', commandName: 'event', options: { template: PLAIN_TEMPLATE } });
    await dispatchInteraction(bot.client, plain);
    const prefilled = modalInputs(plain);
    assert.equal(prefilled.customId, `admin_event_modal:${PLAIN_TEMPLATE}`);
    assert.equal(prefilled.inputs.title, 'Community-Abend');
    assert.equal(prefilled.inputs.places, '12');
    assert.equal(prefilled.inputs.description, 'Brettspiele, Quatschen und Snacks im Voice.');

    const raid = interactionOf({ kind: 'command', commandName: 'event', options: { template: RAID_TEMPLATE } });
    await dispatchInteraction(bot.client, raid);
    assert.deepEqual(Object.keys(modalInputs(raid).inputs), ['title', 'start', 'end', 'description']);
});

test('an unknown template is refused', async () => {
    const interaction = interactionOf({ kind: 'command', commandName: 'event', options: { template: 'gone' } });
    await dispatchInteraction(bot.client, interaction);
    assert.equal(answerText(interaction), 'Diese Vorlage gibt es nicht mehr.');
});

test('an admin gets the poll modal', async () => {
    const interaction = interactionOf({ kind: 'command', commandName: 'poll' });
    await dispatchInteraction(bot.client, interaction);
    const { customId, inputs } = modalInputs(interaction);
    assert.equal(customId, 'admin_poll_modal');
    assert.deepEqual(Object.keys(inputs), ['title', 'dates', 'description']);
});

// ── Event modal → draft (3.2) ───────────────────────────────────────────

const TZ = process.env.TIMEZONE || 'Europe/Berlin';
/** A future day as the admin types it: "TT.MM.JJJJ HH:MM" in the server time zone. */
function typedDate(days, time = '19:30') {
    const date = new Date(Date.now() + days * 86_400_000);
    const parts = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
    return `${parts} ${time}`;
}
async function eventsTitled(title) {
    const snap = await getDocs(collection(db, 'events'));
    return snap.docs.map(entry => ({ id: entry.id, ...entry.data() })).filter(event => event.title === title);
}
async function auditEntries(action) {
    const snap = await getDocs(collection(db, 'auditLogs'));
    return snap.docs.map(entry => entry.data()).filter(entry => entry.action === action);
}
/** Buttons of the last answer as [label, customId or url]. */
function answerButtons(interaction) {
    const [, payload] = lastCall(interaction);
    return (payload.components || []).flatMap(row => row.toJSON().components).map(button => [button.label, button.custom_id || button.url]);
}
async function submitEventModal(fields, { templateId = '-', persona = ADMIN } = {}) {
    const interaction = interactionOf({ kind: 'modal', persona, customId: `admin_event_modal:${templateId}`, fields });
    await dispatchInteraction(bot.client, interaction);
    // The answer comes after the defer
    for (let i = 0; i < 100 && lastCall(interaction)[0] !== 'editReply'; i++) await new Promise(resolve => setTimeout(resolve, 10));
    return interaction;
}

test('a valid event modal saves a draft and offers publish, announce and the web link', async () => {
    const interaction = await submitEventModal({
        title: 'Discord-Abend', start: typedDate(10), end: '23:00', places: '8', description: 'Aus Discord angelegt'
    }, { templateId: PLAIN_TEMPLATE });

    assert.equal(interaction.calls[0][0], 'deferReply');
    const [event] = await eventsTitled('Discord-Abend');
    assert.ok(event, 'event stored');
    assert.equal(event.status, 'draft');
    assert.equal(event.maxParticipants, 8);
    assert.equal(event.approvalMode, 'instant', 'from the template');
    assert.equal(event.description, 'Aus Discord angelegt');
    assert.equal(event.createdBy, ADMIN.userId);
    assert.ok(new Date(event.endDate) > new Date(event.startDate));

    const text = answerText(interaction);
    assert.match(text, /Entwurf/);
    assert.match(text, /Discord-Abend/);
    assert.match(text, /19:30/);
    assert.deepEqual(answerButtons(interaction), [
        ['Veröffentlichen & ankündigen', `admin_event_publish:${event.id}`],
        ['Nur veröffentlichen', `admin_event_activate:${event.id}`],
        ['Im Web öffnen', `http://localhost:3000/#event/${event.id}`]
    ]);
    const created = (await auditEntries('CREATE_EVENT')).find(entry => entry.targetId === event.id);
    assert.equal(created.adminId, ADMIN.userId);
    assert.equal(created.details, 'Created event "Discord-Abend" in Discord');
});

test('a template with its own announcement channel passes it to the draft (B-11)', async () => {
    const templateId = 'test-template-channel';
    await setDoc(doc(db, 'eventTemplates', templateId), {
        name: 'Mit Kanal', settings: { title: 'Mit Kanal', slots: [], announceChannelId: '120000000000000003' }
    });
    await submitEventModal({ title: 'Kanal aus Vorlage', start: typedDate(13, '20:00') }, { templateId });
    const [event] = await eventsTitled('Kanal aus Vorlage');
    assert.equal(event.announceChannelId, '120000000000000003');
});

test('a slot template gives slots, places and access of the template', async () => {
    await submitEventModal({ title: 'Raid aus Discord', start: typedDate(11, '20:00'), description: '' }, { templateId: RAID_TEMPLATE });
    const [event] = await eventsTitled('Raid aus Discord');
    assert.equal(event.slots.length, 3);
    assert.equal(event.maxParticipants, 6);
    assert.equal(event.accessMode, 'role-required');
    assert.equal(event.allowGuests, false);
    assert.equal(event.endDate, '');
});

test('refused input saves nothing and names the reason with „Korrigieren“', async () => {
    const cases = [
        [{ title: 'Falsch 1', start: '24.13.2026 19:30' }, /Beginn: bitte als TT\.MM\.JJJJ HH:MM/],
        [{ title: 'Falsch 2', start: '01.01.2020 19:30' }, /Der Beginn muss in der Zukunft liegen\./],
        [{ title: 'Falsch 3', start: typedDate(12), end: 'spät' }, /Ende: bitte als Uhrzeit/],
        [{ title: 'Falsch 4', start: typedDate(12), end: typedDate(11) }, /Das Ende muss nach dem Beginn liegen\./],
        [{ title: 'Falsch 5', start: typedDate(12), places: 'viele' }, /Plätze: bitte eine ganze Zahl ab 0 angeben\./]
    ];
    for (const [fields, reason] of cases) {
        const interaction = await submitEventModal(fields);
        assert.match(answerText(interaction), reason, fields.title);
        assert.deepEqual(await eventsTitled(fields.title), [], fields.title);
        const [[label, customId]] = answerButtons(interaction);
        assert.equal(label, 'Korrigieren');
        assert.match(customId, /^admin_retry:[A-Za-z0-9]{8}$/);
    }
});

test('„Korrigieren“ reopens the modal with the typed values for the same admin', async () => {
    const fields = { title: 'Tippfehler', start: '24.13.2026 19:30', end: '22:00', places: '5', description: 'Text' };
    const refused = await submitEventModal(fields, { templateId: PLAIN_TEMPLATE });
    const [[, retryId]] = answerButtons(refused);

    const retry = interactionOf({ kind: 'button', customId: retryId });
    await dispatchInteraction(bot.client, retry);
    const { customId, inputs } = modalInputs(retry);
    assert.equal(customId, `admin_event_modal:${PLAIN_TEMPLATE}`);
    assert.deepEqual(inputs, { title: 'Tippfehler', start: '24.13.2026 19:30', end: '22:00', places: '5', description: 'Text' });

    const otherAdmin = { ...ADMIN, userId: 'other-admin' };
    const foreign = interactionOf({ kind: 'button', persona: otherAdmin, customId: retryId });
    await dispatchInteraction(bot.client, foreign);
    assert.equal(answerText(foreign), 'Die Eingabe ist abgelaufen. Starte den Befehl neu.');
});

test('a correction expires after 15 minutes', () => {
    const { corrections } = require('../bot/adminCommands');
    const now = Date.now();
    const key = corrections.remember({ kind: 'poll', values: { title: 'Alt' } }, 'user-x', now);
    assert.deepEqual(corrections.recall(key, 'user-x', now + 14 * 60_000).values, { title: 'Alt' });
    assert.equal(corrections.recall(key, 'user-x', now + 16 * 60_000), null);
    assert.equal(corrections.recall('unknown', 'user-x', now), null);
});

// ── Publish and announce (3.3) ──────────────────────────────────────────

const { forgetBotSettings } = require('../utils/botSettings');
const { updateDoc } = require('../firebaseAdmin');

/** Run fn without any announcement channel (bot center and env). */
async function withoutAnnounceChannel(fn) {
    const settingsRef = doc(db, 'botSettings', 'config');
    const stored = (await getDoc(settingsRef)).data()?.announceChannel || '';
    const saved = process.env.DISCORD_ANNOUNCE_CHANNEL_ID;
    if (stored) await updateDoc(settingsRef, { announceChannel: '' });
    delete process.env.DISCORD_ANNOUNCE_CHANNEL_ID;
    forgetBotSettings();
    try {
        return await fn();
    } finally {
        if (stored) await updateDoc(settingsRef, { announceChannel: stored });
        process.env.DISCORD_ANNOUNCE_CHANNEL_ID = saved;
        forgetBotSettings();
    }
}

/** A fresh draft through the modal; returns its id. */
async function createDraft(title) {
    await submitEventModal({ title, start: typedDate(14, '18:00'), places: '10', description: 'Entwurf' });
    const [event] = await eventsTitled(title);
    return event.id;
}
async function clickDraftButton(prefix, eventId, persona = ADMIN) {
    const interaction = interactionOf({ kind: 'button', persona, customId: `${prefix}:${eventId}` });
    await dispatchInteraction(bot.client, interaction);
    for (let i = 0; i < 100 && lastCall(interaction)[0] !== 'editReply'; i++) await new Promise(resolve => setTimeout(resolve, 10));
    return interaction;
}
const storedEvent = async (id) => (await getDoc(doc(db, 'events', id))).data();

test('„Nur veröffentlichen“ makes the draft active and leaves only the link', async () => {
    const id = await createDraft('Nur aktiv');
    const interaction = await clickDraftButton('admin_event_activate', id);
    assert.equal(interaction.calls[0][0], 'deferUpdate');
    assert.equal((await storedEvent(id)).status, 'active');
    assert.equal((await storedEvent(id)).announcements, undefined);
    assert.match(answerText(interaction), /✅ Veröffentlicht\./);
    assert.deepEqual(answerButtons(interaction), [['Im Web öffnen', `http://localhost:3000/#event/${id}`]]);
});

test('„Veröffentlichen & ankündigen“ also posts the announcement', async () => {
    const id = await createDraft('Mit Ankündigung');
    const interaction = await clickDraftButton('admin_event_publish', id);
    const event = await storedEvent(id);
    assert.equal(event.status, 'active');
    assert.equal(event.announcements.length, 1);
    assert.match(answerText(interaction), /✅ Veröffentlicht und angekündigt\./);
    assert.ok((await auditEntries('ANNOUNCE_EVENT')).some(entry => entry.targetId === id && /in Discord/.test(entry.details)));

    // A second click finds no draft any more
    const again = await clickDraftButton('admin_event_publish', id);
    assert.match(answerText(again), /schon veröffentlicht/);
    assert.equal((await storedEvent(id)).announcements.length, 1);
});

test('without announcement channel the event is published and the reason named', async () => {
    const id = await createDraft('Ohne Kanal');
    await withoutAnnounceChannel(async () => {
        const interaction = await clickDraftButton('admin_event_publish', id);
        assert.equal((await storedEvent(id)).status, 'active');
        assert.match(answerText(interaction), /Veröffentlicht, aber nicht angekündigt: Kein Ankündigungskanal/);
    });
});

test('a deleted draft is reported as gone', async () => {
    const interaction = await clickDraftButton('admin_event_activate', 'no-such-event');
    assert.match(answerText(interaction), /gibt es nicht mehr/);
});

// ── Poll modal (3.4) ────────────────────────────────────────────────────

async function submitPollModal(fields) {
    const interaction = interactionOf({ kind: 'modal', customId: 'admin_poll_modal', fields });
    await dispatchInteraction(bot.client, interaction);
    for (let i = 0; i < 100 && lastCall(interaction)[0] !== 'editReply'; i++) await new Promise(resolve => setTimeout(resolve, 10));
    return interaction;
}
async function pollsTitled(title) {
    const snap = await getDocs(collection(db, 'polls'));
    return snap.docs.map(entry => ({ id: entry.id, ...entry.data() })).filter(poll => poll.title === title);
}

test('a valid poll modal creates the poll, posts it and links the message', async () => {
    const interaction = await submitPollModal({
        title: 'Wann zocken wir?',
        dates: `${typedDate(20, '19:00')}\n${typedDate(21, '19:00')} – 22:00\n\n${typedDate(22, '18:30')}`,
        description: 'Stimmt bis Freitag ab.'
    });
    const [poll] = await pollsTitled('Wann zocken wir?');
    assert.ok(poll, 'poll stored');
    assert.equal(poll.status, 'open');
    assert.equal(poll.options.length, 3);
    assert.ok(poll.options[1].endDate);
    assert.equal(poll.description, 'Stimmt bis Freitag ab.');
    assert.equal(poll.createdBy, ADMIN.userId);
    assert.equal(poll.announcements.length, 1);

    const { channelId, messageId } = poll.announcements[0];
    assert.match(answerText(interaction), /✅ Abstimmung „Wann zocken wir\?“ gepostet\./);
    assert.ok(answerText(interaction).includes(`https://discord.com/channels/guild-1/${channelId}/${messageId}`));
    assert.ok((await auditEntries('CREATE_POLL')).some(entry => entry.targetId === poll.id && /in Discord/.test(entry.details)));
    assert.ok((await auditEntries('ANNOUNCE_POLL')).some(entry => entry.targetId === poll.id));
});

test('a poll with one date or an unreadable line is refused with „Korrigieren“', async () => {
    const one = await submitPollModal({ title: 'Nur einer', dates: typedDate(20) });
    assert.match(answerText(one), /Eine Abstimmung braucht 2–10 Termine\./);
    assert.deepEqual(await pollsTitled('Nur einer'), []);
    assert.equal(answerButtons(one)[0][0], 'Korrigieren');

    const wrong = await submitPollModal({ title: 'Kaputt', dates: `${typedDate(20)}\nirgendwann` });
    assert.match(answerText(wrong), /Zeile 2: „irgendwann“ ist kein Termin/);

    // „Korrigieren“ reopens the poll modal with the lines
    const retry = interactionOf({ kind: 'button', customId: answerButtons(wrong)[0][1] });
    await dispatchInteraction(bot.client, retry);
    const { customId, inputs } = modalInputs(retry);
    assert.equal(customId, 'admin_poll_modal');
    assert.equal(inputs.dates, `${typedDate(20)}\nirgendwann`);
});

test('without announcement channel the poll is created but not posted', async () => {
    await withoutAnnounceChannel(async () => {
        const interaction = await submitPollModal({ title: 'Stiller Poll', dates: `${typedDate(30)}\n${typedDate(31)}` });
        const [poll] = await pollsTitled('Stiller Poll');
        assert.equal(poll.status, 'open');
        assert.deepEqual(poll.announcements, []);
        assert.match(answerText(interaction), /Abstimmung „Stiller Poll“ angelegt, aber nicht gepostet: Kein Ankündigungskanal/);
    });
});
