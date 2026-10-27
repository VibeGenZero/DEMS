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

after(async () => {
    await bot.client.destroy();
});

const SLOTS = [
    { id: 'tank', name: 'Tank', emoji: '🛡️', capacity: 2 },
    { id: 'heal', name: 'Heiler', emoji: '💚', capacity: 2 },
    { id: 'dps', name: 'Schaden', emoji: '⚔️', capacity: 3 }
];
const slotEvent = (fields = {}) => ({ title: 'Raid', status: 'active', slots: SLOTS, maxParticipants: 7, formFields: [], ...fields });
const textField = (label) => ({ label, type: 'text', required: false });
let regCounter = 0;
const member = (slotId, name, status = 'accepted') => ({
    id: `r${++regCounter}`, status, slotId, preferredSlotId: slotId, altSlotIds: [],
    userId: `u${regCounter}`, userName: name, createdAt: String(regCounter).padStart(4, '0'), guests: [], pendingGuests: []
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

    // The announcement then offers no slot buttons (test/eventAnnouncement.test.js)
    assert.equal(bot.canRegisterViaDiscord(slotEvent({ formFields: fiveFields })), false);
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

