const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const vm = require('vm');
const { loadFrontendModules, REPO_ROOT } = require('./helpers');
const { normalizeSlots } = require('../utils/slotService');

const FILE = path.join(REPO_ROOT, 'public', 'js', 'admin', 'wizard-checks.js');
const load = async () => (await loadFrontendModules(FILE, vm.createContext({}))).get('wizard-checks.js');

// A draft as collectEventDraft() returns it, everything valid
const draft = (fields = {}) => ({
    title: 'Raidnacht', description: '', bannerUrl: '', startDate: '2026-12-01T18:00:00.000Z', endDate: '2026-12-01T21:00:00.000Z',
    maxParticipants: '0', category: '', accessMode: 'open', approvalMode: 'manual', status: 'active', reminderHours: '24, 1',
    assignRoleId: '', requiredRoles: [], formFields: [], recurring: false, recurringInterval: 'weekly', recurringUntil: '',
    registrationDeadline: '', unregisterDeadline: '',
    slots: [], ...fields
});

/** checkWizardStep with plain results: the module runs in its own realm, whose arrays deepEqual would not accept. */
async function checker() {
    const { checkWizardStep } = await load();
    return (step, fields) => JSON.parse(JSON.stringify(checkWizardStep(step, draft(fields))));
}

test('a valid draft passes every step', async () => {
    const check = await checker();
    for (const step of [1, 2, 3, 4, 5]) assert.deepEqual(check(step), [], `step ${step}`);
});

test('step 1 wants a title and an http(s) banner', async () => {
    const check = await checker();
    assert.deepEqual(check(1, { title: '   ' }), [{ field: 'title', message: 'Bitte einen Titel eingeben.' }]);
    assert.deepEqual(check(1, { bannerUrl: 'ftp://example.com/a.png' }), [{ field: 'bannerUrl', message: 'Die Banner-URL muss mit http:// oder https:// beginnen oder ein hochgeladenes Bild sein.' }]);
    assert.deepEqual(check(1, { bannerUrl: '/relative.png' }).map(item => item.field), ['bannerUrl']);
    assert.deepEqual(check(1, { bannerUrl: 'HTTPS://example.com/a.png' }), []);
    assert.deepEqual(check(1, { bannerUrl: '/uploads/banners/0f8fad5b-d9cb-469f-a165-70867728950e.png' }), [], 'uploaded banner (W-12)');
});

test('step 2: an active event needs a start, a draft does not; the end cannot come first', async () => {
    const check = await checker();
    assert.deepEqual(check(2, { startDate: '', endDate: '' }), [{ field: 'startDate', message: 'Aktive Events brauchen ein Startdatum.' }]);
    assert.deepEqual(check(2, { status: 'draft', startDate: '', endDate: '' }), []);
    assert.deepEqual(check(2, { endDate: '2026-12-01T17:00:00.000Z' }), [{ field: 'endDate', message: 'Das Ende liegt vor dem Start.' }]);
    // A start in the past is fine: admins edit past events too
    assert.deepEqual(check(2, { startDate: '2020-01-01T18:00:00.000Z', endDate: '' }), []);
});

test('step 2: a series needs a start and an end of the repetition after it', async () => {
    const check = await checker();
    assert.deepEqual(check(2, { recurring: true }), [{ field: 'recurringUntil', message: 'Bis wann soll sich das Event wiederholen?' }]);
    assert.deepEqual(check(2, { recurring: true, recurringUntil: '2026-11-30' }), [{ field: 'recurringUntil', message: '„Wiederholen bis“ liegt vor dem Start.' }]);
    // Same day as the start: the server includes the whole last day
    assert.deepEqual(check(2, { recurring: true, recurringUntil: '2026-12-01' }), []);
    assert.deepEqual(check(2, { status: 'draft', recurring: true, recurringUntil: '2026-12-31', startDate: '', endDate: '' }), [{ field: 'startDate', message: 'Eine Serie braucht ein Startdatum.' }]);
});

test('step 3: places, reminders and the roles of a role event', async () => {
    const check = await checker();
    for (const max of ['-1', '2.5', 'zehn']) {
        assert.deepEqual(check(3, { maxParticipants: max }), [{ field: 'maxParticipants', message: 'Bitte eine ganze Zahl ab 0 eingeben.' }], max);
    }
    assert.deepEqual(check(3, { maxParticipants: '' }), []);
    for (const reminders of ['24, 1,', ' 24 ; 1 ', '', '0.5']) assert.deepEqual(check(3, { reminderHours: reminders }), [], reminders);
    assert.deepEqual(check(3, { reminderHours: '24, 24h, 0' }), [{ field: 'reminderHours', message: '„24h“ ist keine Stundenzahl.' }]);
    assert.deepEqual(check(3, { reminderHours: '0' }), [{ field: 'reminderHours', message: '„0“ ist keine Stundenzahl.' }]);
    assert.deepEqual(check(3, { accessMode: 'role-required' }), [{ field: 'requiredRoles', message: 'Wähle mindestens eine Rolle.' }]);
    assert.deepEqual(check(3, { accessMode: 'role-required', requiredRoles: ['r1'] }), []);
});

test('step 3: slots need a unique name and 1–100 places; the place field is ignored then', async () => {
    const check = await checker();
    const slot = (name, capacity = 2) => ({ name, emoji: '', capacity });
    assert.deepEqual(check(3, { maxParticipants: 'egal', slots: [slot('Tank'), slot('Heiler')] }), []);
    assert.deepEqual(check(3, { slots: [slot('Tank'), slot('')] }), [{ field: 'slots.1.name', message: 'Jeder Slot braucht einen Namen mit 1–30 Zeichen.' }]);
    assert.deepEqual(check(3, { slots: [slot('Tank'), slot(' tank ')] }), [{ field: 'slots.1.name', message: 'Slot-Name „tank“ ist doppelt vergeben.' }]);
    assert.deepEqual(check(3, { slots: [slot('Tank', 0), slot('Heiler', 101)] }), [
        { field: 'slots.0.capacity', message: 'Slot „Tank“ braucht 1–100 Plätze.' },
        { field: 'slots.1.capacity', message: 'Slot „Heiler“ braucht 1–100 Plätze.' }
    ]);
    assert.deepEqual(check(3, { slots: [slot('x'.repeat(31))] }).map(error => error.field), ['slots.0.name']);
});

test('the slot sentences are the ones of the server', async () => {
    const check = await checker();
    const cases = [
        [{ name: '', capacity: 1 }],
        [{ name: 'Tank', capacity: 1 }, { name: 'tank', capacity: 1 }],
        [{ name: 'Tank', capacity: 0 }]
    ];
    for (const slots of cases) assert.equal(check(3, { slots })[0].message, normalizeSlots(slots).error, JSON.stringify(slots));
});

test('step 4: every field has a label of its own and a choice field has options', async () => {
    const check = await checker();
    const field = (label, extra = {}) => ({ label, type: 'text', required: false, ...extra });
    assert.deepEqual(check(4, { formFields: [field('Name'), field('')] }), [{ field: 'formFields.1.label', message: 'Jedes Feld braucht ein Label.' }]);
    assert.deepEqual(check(4, { formFields: [field('Discord-Name'), field(' discord-name ')] }), [
        { field: 'formFields.1.label', message: 'Das Label „discord-name“ gibt es schon. Antworten werden nach dem Label gespeichert.' }
    ]);
    assert.deepEqual(check(4, { formFields: [field('Klasse', { type: 'dropdown', options: [] })] }), [{ field: 'formFields.0.options', message: 'Ein Auswahlfeld braucht mindestens eine Option.' }]);
    assert.deepEqual(check(4, { formFields: [field('Klasse', { type: 'dropdown', options: ['Magier'] })] }), []);
});

test('step 5 has nothing to check, and every step names its fields', async () => {
    const check = await checker();
    const { STEP_FIELDS } = await load();
    assert.deepEqual(check(5, { title: '' }), []);
    assert.deepEqual(JSON.parse(JSON.stringify(STEP_FIELDS)), {
        1: ['title', 'bannerUrl'], 2: ['startDate', 'endDate', 'registrationDeadline', 'unregisterDeadline', 'recurringUntil'],
        3: ['maxParticipants', 'reminderHours', 'requiredRoles', 'slots'], 4: ['formFields'], 5: []
    });
});

test('step 2: both deadlines must lie before the end of the event (W-03)', async () => {
    const check = await checker();
    assert.deepEqual(check(2, { registrationDeadline: '2026-11-30T18:00:00.000Z', unregisterDeadline: '2026-12-01T12:00:00.000Z' }), []);
    assert.deepEqual(check(2, { registrationDeadline: '2026-12-01T22:00:00.000Z' }), [{ field: 'registrationDeadline', message: 'Der Anmeldeschluss liegt nach dem Ende des Events.' }]);
    assert.deepEqual(check(2, { unregisterDeadline: '2026-12-02T10:00:00.000Z' }), [{ field: 'unregisterDeadline', message: 'Der Abmeldeschluss liegt nach dem Ende des Events.' }]);
    // Without an end date the event lasts two hours, like on the server
    assert.deepEqual(check(2, { endDate: '', registrationDeadline: '2026-12-01T19:30:00.000Z' }), []);
    assert.deepEqual(check(2, { endDate: '', registrationDeadline: '2026-12-01T20:30:00.000Z' }), [{ field: 'registrationDeadline', message: 'Der Anmeldeschluss liegt nach dem Ende des Events.' }]);
    // Without a start there is no end to compare with
    assert.deepEqual(check(2, { status: 'draft', startDate: '', endDate: '', registrationDeadline: '2030-01-01T00:00:00.000Z' }), []);
});

test('step 2 has an input with feedback for each deadline (W-03)', () => {
    const html = require('fs').readFileSync(path.join(REPO_ROOT, 'public', 'index.html'), 'utf8');
    const page = html.slice(html.indexOf('id="wizard-page-2"'), html.indexOf('id="wizard-page-3"'));
    for (const id of ['event-registration-deadline', 'event-unregister-deadline']) {
        assert.match(page, new RegExp(`<input[^>]*id="${id}"`), id);
        assert.match(page, new RegExp(`id="${id}-feedback"`), `${id}-feedback`);
        assert.match(page, new RegExp(`<label[^>]*for="${id}"`), `label of ${id}`);
    }
    const marks = require('fs').readFileSync(path.join(REPO_ROOT, 'public', 'js', 'admin', 'wizard-marks.js'), 'utf8');
    assert.match(marks, /registrationDeadline: 'event-registration-deadline'/);
    assert.match(marks, /unregisterDeadline: 'event-unregister-deadline'/);
});
