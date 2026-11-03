const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir } = require('./helpers');

// Event announcement as a Components V2 message (B-05). Mock mode with an own
// database; the builders are pure and stay real in mock mode.
const tmpDir = createTempDir('event-announcement');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'announcement.sqlite');

const bot = require('../bot');
const { buildRoster } = require('../utils/slotService');
const { countComponents, textLength } = require('../bot/layout');

after(async () => {
    await bot.client.destroy();
});

const IS_COMPONENTS_V2 = 1 << 15;
const TYPE = { ROW: 1, BUTTON: 2, SECTION: 9, TEXT: 10, GALLERY: 12, SEPARATOR: 14, CONTAINER: 17 };
const BUTTON_STYLE = { PRIMARY: 1, SECONDARY: 2, SUCCESS: 3, LINK: 5 };
const SLOTS = [
    { id: 'tank', name: 'Tank', emoji: '🛡️', capacity: 2 },
    { id: 'heal', name: 'Heiler', emoji: '💚', capacity: 2 },
    { id: 'dps', name: 'Schaden', emoji: '⚔️', capacity: 3 }
];

const slotEvent = (fields = {}) => ({ title: 'Raid', status: 'active', slots: SLOTS, maxParticipants: 7, formFields: [], ...fields });
const plainEvent = (fields = {}) => ({ title: 'Abend', status: 'active', maxParticipants: 10, ...fields });
let regCounter = 0;
const member = (slotId, name, status = 'accepted') => ({
    id: `r${++regCounter}`, status, slotId, preferredSlotId: slotId, altSlotIds: [],
    userId: `u${regCounter}`, userName: name, createdAt: String(regCounter).padStart(4, '0'), guests: [], pendingGuests: []
});

const announce = (event, roster, intro) => bot.buildEventAnnouncement(event, 'evt1', roster, intro);
const topLevel = (payload) => payload.components.map(component => component.toJSON());
const containerOf = (payload) => topLevel(payload).find(component => component.type === TYPE.CONTAINER);
const textsOf = (payload) => containerOf(payload).components.filter(c => c.type === TYPE.TEXT).map(c => c.content);
const factsOf = (payload) => textsOf(payload)[1].split('\n');
const rowButtons = (payload) => {
    const row = containerOf(payload).components.find(c => c.type === TYPE.ROW);
    return row ? row.components : [];
};
// Line-up blocks: everything between the separator and the button row
const blocksOf = (payload) => {
    const parts = containerOf(payload).components;
    const start = parts.findIndex(c => c.type === TYPE.SEPARATOR) + 1;
    return parts.slice(start)
        .filter(c => c.type !== TYPE.ROW)
        .map(c => (c.type === TYPE.SECTION ? { text: c.components[0].content, button: c.accessory } : { text: c.content, button: null }));
};

test('an announcement is one V2 message with a container in the event colour', () => {
    const payload = announce(plainEvent({ accentColor: '#f59e0b' }));
    assert.equal(payload.flags, IS_COMPONENTS_V2);
    const parts = topLevel(payload);
    assert.deepEqual(parts.map(c => c.type), [TYPE.CONTAINER]);
    assert.equal(parts[0].accent_color, 0xf59e0b);
});

test('without a valid event colour the container takes the DEMS accent', () => {
    for (const accentColor of ['', 'blau', '#abc', undefined]) {
        assert.equal(containerOf(announce(plainEvent({ accentColor }))).accent_color, 0x8b5cf6, String(accentColor));
    }
});

test('the ping line stands above the container, only when there is one', () => {
    const payload = announce(plainEvent(), undefined, '<@&42>\nHeute Abend!');
    const parts = topLevel(payload);
    assert.deepEqual(parts.map(c => c.type), [TYPE.TEXT, TYPE.CONTAINER]);
    assert.equal(parts[0].content, '<@&42>\nHeute Abend!');
    assert.deepEqual(topLevel(announce(plainEvent(), undefined, '')).map(c => c.type), [TYPE.CONTAINER]);
});

test('title as heading, then the description', () => {
    const [head] = textsOf(announce(plainEvent({ title: '*Star* Abend', description: 'Bringt **Tränke** mit.' })));
    assert.equal(head, '## 🎉 \\*Star\\* Abend\nBringt **Tränke** mit.');
    const [empty] = textsOf(announce(plainEvent({ description: '' })));
    assert.equal(empty, '## 🎉 Abend\nKeine Beschreibung.');
});

test('the facts list date, places, access, waitlist, category and deadlines', () => {
    const event = plainEvent({
        startDate: '2026-12-01T18:00:00.000Z',
        accessMode: 'open',
        category: 'Raid',
        registrationDeadline: '2026-12-01T17:00:00.000Z',
        unregisterDeadline: '2026-11-30T17:00:00.000Z'
    });
    const registrations = [member(undefined, 'A'), member(undefined, 'B'), member(undefined, 'C'), member(undefined, 'W', 'waitlisted')];
    assert.deepEqual(factsOf(announce(event, buildRoster(event, registrations))), [
        '🗓️ **Datum:** 1.12.2026, 19:00:00',
        '👥 **Plätze:** 3 von 10 Plätzen belegt',
        '🔓 **Zugang:** Offen für alle',
        '⏳ **Warteliste:** 1',
        '🏷️ **Kategorie:** Raid',
        '⏰ **Anmeldung bis:** 1.12.2026, 18:00:00',
        '⏰ **Abmeldung bis:** 30.11.2026, 18:00:00'
    ]);
});

test('without date, roster and options the facts stay short', () => {
    assert.deepEqual(factsOf(announce(plainEvent({ accessMode: 'roles' }))), [
        '🗓️ **Datum:** TBA',
        '👥 **Plätze:** Max. 10',
        '🔓 **Zugang:** Rollen-Requirement'
    ]);
    assert.equal(factsOf(announce(plainEvent({ maxParticipants: 0 })))[1], '👥 **Plätze:** Unbegrenzt');
});

test('the places sentence tells guests and open requests; nobody waiting means no waitlist line', () => {
    const event = plainEvent();
    const registrations = [{ ...member(undefined, 'Mit Gast'), guests: ['g1'] }, member(undefined, 'Anfrage', 'pending')];
    const facts = factsOf(announce(event, buildRoster(event, registrations)));
    assert.equal(facts[1], '👥 **Plätze:** 3 von 10 Plätzen belegt (inkl. 1 Gast, 1 Anfrage offen)');
    assert.ok(!facts.some(line => line.includes('Warteliste')));
});

test('a normal event ends with "Anmelden" and "Zum Event"', () => {
    const payload = announce(plainEvent());
    assert.deepEqual(blocksOf(payload), []);
    const buttons = rowButtons(payload);
    assert.deepEqual(buttons.map(button => button.label), ['Anmelden', 'Zum Event']);
    assert.equal(buttons[0].custom_id, 'event_register:evt1');
    assert.equal(buttons[0].style, BUTTON_STYLE.SUCCESS);
    assert.equal(buttons[1].style, BUTTON_STYLE.LINK);
    assert.ok(buttons[1].url.endsWith('#event/evt1'));
});

test('every slot is a block with its button beside it; the row keeps only the link', () => {
    const payload = announce(slotEvent());
    const blocks = blocksOf(payload);
    assert.deepEqual(blocks.map(block => block.button.custom_id), ['event_slot:evt1:tank', 'event_slot:evt1:heal', 'event_slot:evt1:dps']);
    assert.deepEqual(blocks.map(block => block.button.label), ['Tank', 'Heiler', 'Schaden']);
    assert.equal(blocks[0].button.emoji.name, '🛡️');
    assert.equal(blocks[0].button.style, BUTTON_STYLE.PRIMARY);
    assert.deepEqual(rowButtons(payload).map(button => button.label), ['Zum Event']);
});

test('the blocks show the line-up; a full slot is marked and its button stays clickable', () => {
    const event = slotEvent();
    const registrations = [
        member('tank', 'Ana'), member('tank', '*Star*'),
        ...['C1', 'C2', 'C3', 'C4', 'C5', 'C6'].map(name => member('dps', name)),
        member(null, 'Wartend', 'waitlisted')
    ];
    const payload = announce(event, buildRoster(event, registrations));
    const blocks = blocksOf(payload);
    assert.deepEqual(blocks.map(block => block.text), [
        '**🛡️ Tank 2/2 ✅**\nAna, \\*Star\\*',
        '**💚 Heiler 0/2**\n— frei —',
        '**⚔️ Schaden 6/3 ⚠️**\nC1, C2, C3, C4, C5, +1'
    ]);
    assert.equal(blocks[0].button.label, 'Tank (voll)');
    assert.equal(blocks[0].button.style, BUTTON_STYLE.SECONDARY);
    assert.equal(blocks[0].button.disabled, undefined);
    assert.equal(blocks[1].button.style, BUTTON_STYLE.PRIMARY);
    assert.ok(factsOf(payload).includes('⏳ **Warteliste:** 1'));
});

test('closed registration keeps the line-up as text and only the link button', () => {
    const HOUR = 60 * 60 * 1000;
    const closed = [
        slotEvent({ status: 'archived' }),
        slotEvent({ registrationDeadline: new Date(Date.now() - HOUR).toISOString() }),
        slotEvent({ startDate: new Date(Date.now() - 3 * HOUR).toISOString(), endDate: new Date(Date.now() - HOUR).toISOString() })
    ];
    for (const event of closed) {
        const payload = announce(event);
        const blocks = blocksOf(payload);
        assert.equal(blocks.length, 3);
        assert.ok(blocks.every(block => block.button === null));
        assert.equal(blocks[0].text, '**🛡️ Tank 0/2**\n— frei —');
        assert.deepEqual(rowButtons(payload).map(button => button.label), ['Zum Event']);
    }
});

test('a form too big for a Discord modal leaves only the link button', () => {
    const fields = ['A', 'B', 'C', 'D', 'E', 'F'].map(label => ({ label, type: 'text', required: false }));
    const plain = announce(plainEvent({ formFields: fields }));
    assert.deepEqual(rowButtons(plain).map(button => button.label), ['Zum Event']);
    const slots = announce(slotEvent({ formFields: fields }));
    assert.ok(blocksOf(slots).every(block => block.button === null));
});

test('an event that allows „Vielleicht“ gets the button between „Anmelden“ and „Zum Event“ (B-17)', () => {
    const buttons = rowButtons(announce(plainEvent({ allowTentative: true })));
    assert.deepEqual(buttons.map(button => button.label), ['Anmelden', 'Vielleicht', 'Zum Event']);
    assert.equal(buttons[1].custom_id, 'event_maybe:evt1');
    assert.equal(buttons[1].style, BUTTON_STYLE.SECONDARY);
    assert.equal(buttons[1].emoji.name, '🤔');

    // Slot events keep their role buttons beside the line-up
    const slot = announce(slotEvent({ allowTentative: true }));
    assert.deepEqual(rowButtons(slot).map(button => button.label), ['Vielleicht', 'Zum Event']);
    assert.equal(blocksOf(slot).length, 3);
});

test('no „Vielleicht“ without the setting, once registration is closed or with a form too big (B-17)', () => {
    const HOUR = 60 * 60 * 1000;
    const fields = ['A', 'B', 'C', 'D', 'E', 'F'].map(label => ({ label, type: 'text', required: false }));
    for (const event of [
        plainEvent(),
        plainEvent({ allowTentative: 'ja' }),
        plainEvent({ allowTentative: true, registrationDeadline: new Date(Date.now() - HOUR).toISOString() }),
        plainEvent({ allowTentative: true, status: 'archived' }),
        plainEvent({ allowTentative: true, formFields: fields })
    ]) {
        assert.ok(!rowButtons(announce(event)).some(button => button.label === 'Vielleicht'), JSON.stringify(event));
    }
});

test('the facts name the bench after the waitlist, not in the places (B-17)', () => {
    const event = plainEvent({ allowTentative: true, startDate: '2026-12-01T18:00:00.000Z', accessMode: 'open', category: 'Raid' });
    const registrations = [member(undefined, 'A'), member(undefined, 'W', 'waitlisted'), member(undefined, 'T1', 'tentative'), member(undefined, 'T2', 'tentative')];
    assert.deepEqual(factsOf(announce(event, buildRoster(event, registrations))), [
        '🗓️ **Datum:** 1.12.2026, 19:00:00',
        '👥 **Plätze:** 1 von 10 Plätzen belegt',
        '🔓 **Zugang:** Offen für alle',
        '⏳ **Warteliste:** 1',
        '🤔 **Ersatzbank:** 2',
        '🏷️ **Kategorie:** Raid'
    ]);
    const empty = factsOf(announce(event, buildRoster(event, [member(undefined, 'A')])));
    assert.ok(!empty.some(line => line.includes('Ersatzbank')));
});

test('a 5000-character description is cut so the whole message stays within 4000 characters', () => {
    const description = `${'a'.repeat(3998)}🎉${'b'.repeat(1000)}`;
    const payload = announce(slotEvent({ description, category: 'Raid' }), undefined, '<@&1>\n@everyone\nLos!');
    assert.ok(textLength(payload) <= 4000, String(textLength(payload)));
    const [head] = textsOf(payload);
    assert.ok(head.endsWith('…'));
    assert.doesNotMatch(head, /[\uD800-\uDBFF]…$/);
});

test('ten slots with banner and ping line stay within 40 components', () => {
    const slots = Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, name: `Slot ${i}`, emoji: '🛡️', capacity: 1 }));
    const payload = announce(slotEvent({ slots, bannerUrl: 'https://example.com/raid.png' }), undefined, '<@&1>');
    assert.equal(blocksOf(payload).length, 10);
    assert.ok(blocksOf(payload).every(block => block.button));
    assert.ok(countComponents(payload) <= 40, String(countComponents(payload)));
});

test('the banner opens the container as an image', () => {
    const parts = containerOf(announce(plainEvent({ bannerUrl: 'https://example.com/raid.png' }))).components;
    assert.equal(parts[0].type, TYPE.GALLERY);
    assert.deepEqual(parts[0].items.map(item => item.media.url), ['https://example.com/raid.png']);
    assert.notEqual(containerOf(announce(plainEvent())).components[0].type, TYPE.GALLERY);
});
