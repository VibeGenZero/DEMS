const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    TEMPLATE_FIELDS, TEMPLATE_NAME_MAX, MAX_TEMPLATES,
    pickTemplateSettings, normalizeTemplateName, nameTaken
} = require('../utils/eventTemplates');

const FULL_EVENT = {
    title: 'Raid-Abend',
    description: 'Wir raiden.',
    bannerUrl: 'https://example.com/banner.png',
    accentColor: '#8b5cf6',
    category: 'Raid',
    location: { text: 'Raid-Kanal', channelId: 'c1', channelType: 'voice' },
    maxParticipants: '12',
    accessMode: 'role-required',
    requiredRoles: ['r1'],
    approvalMode: 'manual',
    allowGuests: true,
    slots: [],
    assignRoleId: 'r2',
    formFields: [{ label: 'Charaktername', type: 'text', required: true, options: [], description: '' }],
    reminderHours: [{ hours: 24, sent: true }, { hours: 1, sent: false }],
    checkinMessage: 'Willkommen!',
    autoCreateChannels: true,
    channelConfig: { type: 'voice', voiceName: 'Raid', textName: '' },
    customBotMessages: { registration: 'Danke', accepted: '', rejected: '' },
    // Never part of a template
    startDate: '2099-03-06T19:00:00.000Z',
    endDate: '2099-03-06T22:00:00.000Z',
    registrationDeadline: '2099-03-05T19:00:00.000Z',
    unregisterDeadline: '2099-03-05T19:00:00.000Z',
    status: 'active',
    recurring: true,
    recurringInterval: 'weekly',
    recurringUntil: '2099-04-01',
    seriesId: 'serie',
    discordChannelId: 'd1',
    discordTextChannelId: 'd2',
    discordScheduledEventId: 'd3',
    announcements: [{ channelId: 'a', messageId: 'b' }],
    checkinCode: '123456',
    eventStartNotificationSent: true,
    registrationClosedRefreshed: true,
    sourcePollId: 'p1',
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'u1'
};

test('a template keeps exactly the recurring event settings', () => {
    const { settings, error } = pickTemplateSettings(FULL_EVENT);
    assert.equal(error, undefined);
    assert.deepEqual(Object.keys(settings).sort(), [...TEMPLATE_FIELDS].sort());
    assert.equal(settings.title, 'Raid-Abend');
    assert.equal(settings.maxParticipants, 12);
    assert.deepEqual(settings.requiredRoles, ['r1']);
    assert.equal(settings.autoCreateChannels, true);
    assert.deepEqual(settings.location, { text: 'Raid-Kanal', channelId: 'c1', channelType: 'voice' });
});

test('a template never holds date or lifecycle data', () => {
    const { settings } = pickTemplateSettings(FULL_EVENT);
    for (const field of ['startDate', 'endDate', 'registrationDeadline', 'unregisterDeadline', 'status', 'recurring',
        'recurringInterval', 'recurringUntil', 'seriesId', 'discordChannelId', 'discordTextChannelId',
        'discordScheduledEventId', 'announcements', 'checkinCode', 'eventStartNotificationSent',
        'registrationClosedRefreshed', 'sourcePollId', 'createdAt', 'createdBy']) {
        assert.equal(field in settings, false, field);
    }
});

test('template reminders keep the hours without a sent state', () => {
    const { settings } = pickTemplateSettings(FULL_EVENT);
    assert.deepEqual(settings.reminderHours, [{ hours: 24 }, { hours: 1 }]);
    assert.deepEqual(pickTemplateSettings({ reminderHours: '24, 1' }).settings.reminderHours, [{ hours: 24 }, { hours: 1 }]);
});

test('missing template settings get the defaults of a new event', () => {
    const { settings } = pickTemplateSettings({});
    assert.equal(settings.title, '');
    assert.equal(settings.maxParticipants, 0);
    assert.equal(settings.accessMode, 'open');
    assert.equal(settings.approvalMode, 'manual');
    assert.equal(settings.allowGuests, true);
    assert.equal(settings.autoCreateChannels, false);
    assert.deepEqual(settings.formFields, []);
    assert.deepEqual(settings.slots, []);
    assert.deepEqual(settings.requiredRoles, []);
    assert.deepEqual(settings.reminderHours, []);
    assert.deepEqual(settings.channelConfig, {});
    assert.deepEqual(settings.customBotMessages, {});
    assert.equal(settings.location, null);
});

test('template slots set the capacity and turn guests off like an event', () => {
    const { settings } = pickTemplateSettings({
        maxParticipants: 99,
        allowGuests: true,
        slots: [{ name: 'Tank', emoji: '', capacity: 2 }, { name: 'Heiler', emoji: '', capacity: 3 }]
    });
    assert.equal(settings.slots.length, 2);
    assert.ok(settings.slots.every(slot => slot.id));
    assert.equal(settings.maxParticipants, 5);
    assert.equal(settings.allowGuests, false);
});

test('invalid template slots are refused with the slot sentence', () => {
    assert.equal(pickTemplateSettings({ slots: 'Tank' }).error, 'Slots müssen eine Liste sein.');
});

test('template names are trimmed and limited to 1 to 80 characters', () => {
    const message = 'Der Name der Vorlage muss 1 bis 80 Zeichen lang sein.';
    assert.equal(TEMPLATE_NAME_MAX, 80);
    assert.equal(MAX_TEMPLATES, 50);
    assert.deepEqual(normalizeTemplateName('  Raid-Abend  '), { name: 'Raid-Abend' });
    assert.deepEqual(normalizeTemplateName('x'.repeat(80)), { name: 'x'.repeat(80) });
    assert.deepEqual(normalizeTemplateName('   '), { error: message });
    assert.deepEqual(normalizeTemplateName(undefined), { error: message });
    assert.deepEqual(normalizeTemplateName('x'.repeat(81)), { error: message });
});

test('a template name is taken regardless of case, except by the template itself', () => {
    const templates = [{ id: 't1', name: 'Raid-Abend' }, { id: 't2', name: 'Spieleabend' }];
    assert.equal(nameTaken(templates, 'raid-abend'), true);
    assert.equal(nameTaken(templates, 'RAID-ABEND', 't1'), false);
    assert.equal(nameTaken(templates, 'Spieleabend', 't1'), true);
    assert.equal(nameTaken(templates, 'Turnier'), false);
});

const { checkEventFields } = require('../middleware/validators');

test('event checks still demand a title and a start date for active events', async () => {
    const errors = await checkEventFields({ title: '', status: 'active' });
    assert.ok(errors.includes('Titel ist erforderlich.'));
    assert.ok(errors.includes('Aktive Events brauchen ein Startdatum.'));
});

test('template checks allow an empty title and skip date, status and deadline rules', async () => {
    const errors = await checkEventFields({
        title: '', status: 'kaputt', endDate: '2099-01-01T00:00:00.000Z', startDate: '2099-02-01T00:00:00.000Z',
        registrationDeadline: 'kein Datum'
    }, { template: true });
    assert.deepEqual(errors, []);
});

test('template checks keep the event rules for title length, banner, colour and enums', async () => {
    const errors = await checkEventFields({
        title: 'x'.repeat(201), bannerUrl: 'javascript:alert(1)', accentColor: 'red', accessMode: 'alle', maxParticipants: -1
    }, { template: true });
    assert.ok(errors.includes('Titel darf maximal 200 Zeichen lang sein.'));
    assert.ok(errors.includes('Banner muss eine http(s)-URL oder ein hochgeladenes Bild sein.'));
    assert.ok(errors.includes('Akzentfarbe muss ein Hex-Farbwert wie #8b5cf6 sein.'));
    assert.ok(errors.includes('Maximale Teilnehmerzahl muss eine Zahl >= 0 sein.'));
    assert.ok(errors.some(error => error.startsWith('Zugangsmodus muss')));
});
