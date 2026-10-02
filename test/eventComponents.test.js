const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir } = require('./helpers');

// Mock mode with an own database; the empty cwd keeps a local .env out
const tmpDir = createTempDir('event-components');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'components.sqlite');

const bot = require('../bot');
const { fitsIntoDiscordModal, getModalFieldLimit } = require('../utils/formFields');
const { buildRoster } = require('../utils/slotService');

after(async () => {
    await bot.client.destroy();
});

const SLOTS = [
    { id: 'tank', name: 'Tank', emoji: '🛡️', capacity: 2 },
    { id: 'heal', name: 'Heiler', emoji: '💚', capacity: 2 },
    { id: 'dps', name: 'Schaden', emoji: '⚔️', capacity: 3 }
];
const BUTTON_STYLE = { PRIMARY: 1, SECONDARY: 2, SUCCESS: 3, LINK: 5 };

const slotEvent = (fields = {}) => ({ title: 'Raid', status: 'active', slots: SLOTS, maxParticipants: 7, formFields: [], ...fields });
const buttonsOf = (components) => components.map(row => row.toJSON().components);
const textField = (label) => ({ label, type: 'text', required: false });
let regCounter = 0;
const member = (slotId, name, status = 'accepted') => ({
    id: `r${++regCounter}`, status, slotId, preferredSlotId: slotId, altSlotIds: [],
    userId: `u${regCounter}`, userName: name, createdAt: String(regCounter).padStart(4, '0'), guests: [], pendingGuests: []
});

test('slot events get one button per slot and the link button last', () => {
    const [row] = buttonsOf(bot.buildEventComponents(slotEvent(), 'evt1'));
    assert.deepEqual(row.map(button => button.custom_id).slice(0, 3), ['event_slot:evt1:tank', 'event_slot:evt1:heal', 'event_slot:evt1:dps']);
    assert.deepEqual(row.map(button => button.label), ['Tank', 'Heiler', 'Schaden', 'Zum Event']);
    assert.equal(row[0].emoji.name, '🛡️');
    assert.equal(row[0].style, BUTTON_STYLE.PRIMARY);
    assert.equal(row[3].style, BUTTON_STYLE.LINK);
    assert.ok(row[3].url.endsWith('#event/evt1'));
});

test('a full slot is marked but stays clickable', () => {
    const event = slotEvent();
    const roster = buildRoster(event, [member('tank', 'Ana'), member('tank', 'Ben')]);
    const [row] = buttonsOf(bot.buildEventComponents(event, 'evt1', roster));
    assert.equal(row[0].label, 'Tank (voll)');
    assert.equal(row[0].style, BUTTON_STYLE.SECONDARY);
    assert.equal(row[0].disabled, undefined);
    assert.equal(row[1].style, BUTTON_STYLE.PRIMARY);
});

test('ten slots are spread over rows of five buttons', () => {
    const slots = Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, name: `Slot ${i}`, emoji: '', capacity: 1 }));
    const rows = buttonsOf(bot.buildEventComponents(slotEvent({ slots }), 'evt1'));
    assert.deepEqual(rows.map(row => row.length), [5, 5, 1]);
    assert.equal(rows[2][0].style, BUTTON_STYLE.LINK);
});

test('inactive slot events only keep the link button', () => {
    const rows = buttonsOf(bot.buildEventComponents(slotEvent({ status: 'archived' }), 'evt1'));
    assert.deepEqual(rows.map(row => row.length), [1]);
});

test('the fallback select takes one modal place away from the form', () => {
    assert.equal(getModalFieldLimit(slotEvent()), 4);
    assert.equal(getModalFieldLimit(slotEvent({ slots: [SLOTS[0]] })), 5);
    assert.equal(getModalFieldLimit({}), 5);

    const fourFields = ['A', 'B', 'C', 'D'].map(textField);
    assert.equal(fitsIntoDiscordModal(slotEvent({ formFields: fourFields })), true);
    const fiveFields = [...fourFields, textField('E')];
    assert.equal(fitsIntoDiscordModal(slotEvent({ formFields: fiveFields })), false);
    assert.equal(fitsIntoDiscordModal(slotEvent({ slots: [SLOTS[0]], formFields: fiveFields })), true);

    const rows = buttonsOf(bot.buildEventComponents(slotEvent({ formFields: fiveFields }), 'evt1'));
    assert.deepEqual(rows.map(row => row.map(button => button.label)), [['Zum Event']]);
});

test('normal events keep the register button', () => {
    const [row] = buttonsOf(bot.buildEventComponents({ title: 'Abend', status: 'active' }, 'evt2'));
    assert.deepEqual(row.map(button => button.label), ['Anmelden', 'Zum Event']);
    assert.equal(row[0].custom_id, 'event_register:evt2');
});

test('the embed shows the line-up per slot', () => {
    const event = slotEvent();
    const registrations = [
        member('tank', 'Ana'), member('tank', '*Star*'),
        ...['C1', 'C2', 'C3', 'C4', 'C5', 'C6'].map(name => member('dps', name)),
        member(null, 'Wartend', 'waitlisted')
    ];
    const fields = bot.buildEventEmbed(event, 'https://dems.example/#event/evt1', buildRoster(event, registrations)).toJSON().fields;
    const byName = Object.fromEntries(fields.map(field => [field.name, field.value]));

    assert.equal(byName['👥 Teilnehmer'], '8/7');
    assert.equal(byName['🛡️ Tank 2/2 ✅'], 'Ana, \\*Star\\*');
    assert.equal(byName['💚 Heiler 0/2'], '— frei —');
    assert.equal(byName['⚔️ Schaden 6/3 ⚠️'], 'C1, C2, C3, C4, C5, +1');
    assert.equal(byName['⏳ Warteliste'], '1');
});

test('normal events show the live participant count', () => {
    const registrations = [member(undefined, 'A'), member(undefined, 'B'), member(undefined, 'C')];
    const limited = { title: 'Abend', status: 'active', maxParticipants: 10 };
    const unlimited = { title: 'Abend', status: 'active', maxParticipants: 0 };
    const valueOf = (embed) => embed.toJSON().fields.find(field => field.name === '👥 Teilnehmer').value;

    assert.equal(valueOf(bot.buildEventEmbed(limited, '', buildRoster(limited, registrations))), '3/10');
    assert.equal(valueOf(bot.buildEventEmbed(unlimited, '', buildRoster(unlimited, registrations))), '3 (unbegrenzt)');
    assert.equal(valueOf(bot.buildEventEmbed(limited)), 'Max. 10');
});

const COMPONENT_TYPE = { TEXT_DISPLAY: 10, LABEL: 18 };
const EPHEMERAL = 64;

test('the slot modal offers the other slots as fallback roles', () => {
    const modal = bot.buildSlotModal(slotEvent({ formFields: [textField('Ingame-Name')] }), 'evt1', SLOTS[0]).toJSON();
    assert.equal(modal.custom_id, 'event_slot_modal:evt1:tank');
    assert.deepEqual(modal.components.map(component => component.type), [COMPONENT_TYPE.TEXT_DISPLAY, COMPONENT_TYPE.LABEL, COMPONENT_TYPE.LABEL]);

    const altSelect = modal.components[1].component;
    assert.equal(altSelect.custom_id, 'alt_slots');
    assert.deepEqual(altSelect.options.map(option => option.value), ['heal', 'dps']);
    assert.equal(altSelect.options[0].emoji.name, '💚');
    assert.equal(altSelect.min_values, 0);
    assert.equal(altSelect.max_values, 2);
    assert.equal(modal.components[2].component.custom_id, 'field:0');
});

test('four form fields leave no room for the intro text', () => {
    const fields = ['A', 'B', 'C', 'D'].map(textField);
    const modal = bot.buildSlotModal(slotEvent({ formFields: fields }), 'evt1', SLOTS[0]).toJSON();
    assert.equal(modal.components.length, 5);
    assert.ok(modal.components.every(component => component.type === COMPONENT_TYPE.LABEL));
});

test('a single-slot event has no fallback select', () => {
    const modal = bot.buildSlotModal(slotEvent({ slots: [SLOTS[0]], formFields: [textField('A')] }), 'evt1', SLOTS[0]).toJSON();
    assert.ok(!modal.components.some(component => component.component && component.component.custom_id === 'alt_slots'));
});

test('registered members can switch into a free slot or leave', () => {
    const own = { id: 'r1', userId: 'u1', status: 'accepted', slotId: 'tank', preferredSlotId: 'tank', altSlotIds: [] };
    const reply = bot.buildRegisteredSlotReply(slotEvent(), 'evt1', own, SLOTS[1], [own]);
    assert.equal(reply.flags, EPHEMERAL);
    assert.ok(reply.content.includes('als **🛡️ Tank** eingeplant'));
    const buttons = reply.components[0].toJSON().components;
    assert.deepEqual(buttons.map(button => button.custom_id), ['slot_switch:evt1:heal', 'slot_leave:evt1']);
    assert.equal(buttons[0].label, 'Zu Heiler wechseln');

    const ownSlot = bot.buildRegisteredSlotReply(slotEvent(), 'evt1', own, SLOTS[0], [own]);
    assert.deepEqual(ownSlot.components[0].toJSON().components.map(button => button.custom_id), ['slot_leave:evt1']);

    const healers = [own, member('heal', 'X'), member('heal', 'Y')];
    const fullTarget = bot.buildRegisteredSlotReply(slotEvent(), 'evt1', own, SLOTS[1], healers);
    assert.deepEqual(fullTarget.components[0].toJSON().components.map(button => button.custom_id), ['slot_leave:evt1']);
});

test('waitlisted and rejected members get a matching answer', () => {
    const waiting = { id: 'r2', userId: 'u2', status: 'waitlisted', slotId: null, preferredSlotId: 'tank', altSlotIds: [] };
    assert.ok(bot.buildRegisteredSlotReply(slotEvent(), 'evt1', waiting, SLOTS[0], [waiting]).content.includes('Warteliste'));

    const rejected = { ...waiting, status: 'rejected' };
    const reply = bot.buildRegisteredSlotReply(slotEvent(), 'evt1', rejected, SLOTS[0], [rejected]);
    assert.ok(reply.content.includes('abgelehnt'));
    assert.deepEqual(reply.components, []);
});
