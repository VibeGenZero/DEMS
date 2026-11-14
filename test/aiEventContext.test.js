const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildEventContext, splitSource, SOURCE_SECTIONS } = require('../ai/eventContext');

const NOW = new Date('2026-11-13T10:00:00Z');

function baseEvent(extra = {}) {
    return {
        title: 'Raid-Abend', category: 'Raid', status: 'active', description: 'Wir ziehen durch den **Turm**.',
        startDate: '2026-11-21T19:00:00Z', endDate: '2026-11-21T22:00:00Z',
        registrationDeadline: '2026-11-20T19:00:00Z', unregisterDeadline: '',
        maxParticipants: 10, accessMode: 'role-required', requiredRoles: ['role-777'], approvalMode: 'manual',
        allowGuests: true, allowTentative: false, checkinCode: '123456', location: { text: 'Voice 1', channelId: '999000', channelType: 'voice' },
        formFields: [{ label: 'Charakter', type: 'text', required: true, options: [], description: 'Name deiner Figur' }],
        ...extra
    };
}

const registrations = [
    { id: 'r1', userId: 'u-asker', userName: 'Ich', status: 'accepted', formAnswers: { Charakter: 'Meiner' }, guests: [], pendingGuests: [] },
    { id: 'r2', userId: 'u-other', userName: 'Fremder', status: 'accepted', formAnswers: { Charakter: 'Geheim' }, guests: ['g-42'], pendingGuests: [] }
];

function build(overrides = {}) {
    return buildEventContext({
        event: baseEvent(), eventId: 'ev-1', registrations, roleNames: { 'role-777': 'Raider' },
        asker: { registration: null, roleIds: [], waitlistPlace: null }, now: NOW, timezone: 'Europe/Berlin', ...overrides
    });
}

test('the context names start, deadline, free places, required role names and form fields', () => {
    const text = build();
    assert.match(text, /^Heute ist Freitag, 13\.11\.2026, 11:00 Uhr\./);
    assert.match(text, /Samstag, 21\.11\.2026, 20:00 Uhr/);
    assert.match(text, /Anmeldeschluss: Freitag, 20\.11\.2026, 20:00 Uhr/);
    assert.match(text, /3 von 10 Plätzen belegt/);
    assert.match(text, /7 frei/);
    assert.match(text, /Raider/);
    assert.match(text, /Charakter/);
    assert.match(text, /Name deiner Figur/);
    assert.match(text, /^Termin$/m);
    assert.match(text, /^Plätze$/m);
    assert.match(text, /^Ort: Voice 1$/m);
});

test("the context never contains the check-in code, Discord ids, other members' names or form answers", () => {
    const text = build({ asker: { registration: registrations[0], roleIds: ['role-777'], waitlistPlace: null } });
    for (const secret of ['123456', 'Fremder', 'Geheim', 'Meiner', 'u-asker', 'u-other', 'g-42', 'role-777']) {
        assert.ok(!text.includes(secret), `leaked ${secret}`);
    }
});

test('only whitelisted event fields reach the context', () => {
    const sentinels = {
        checkinMessage: 'S-checkinMessage', customBotMessages: { welcome: 'S-customBotMessages' }, discordChannelId: 'S-discordChannelId',
        discordTextChannelId: 'S-discordTextChannelId', discordScheduledEventId: 'S-discordScheduledEventId',
        discordThread: 'S-discordThread', announcements: [{ channelId: 'S-announcements' }], announceChannelId: 'S-announceChannelId',
        createdBy: 'S-createdBy', assignRoleId: 'S-assignRoleId', channelConfig: { name: 'S-channelConfig' },
        seriesId: 'S-seriesId', sourcePollId: 'S-sourcePollId', bannerUrl: 'https://S-bannerUrl.example/x.png'
    };
    const text = build({ event: baseEvent({ ...sentinels, location: { text: ' Voice 1 ', channelId: 'S-locationChannelId', channelType: 'voice' } }) });
    assert.match(text, /^Ort: Voice 1$/m);
    assert.ok(!text.includes('S-'), text.match(/S-w+/)?.[0]);
    assert.ok(!text.includes('object Object'));
    assert.match(build({ event: baseEvent({ location: null }) }), /^Termin$/m);
    assert.match(build({ event: baseEvent({ location: 'Alter Ort' }) }), /^Ort: Alter Ort$/m);
});

test('a role missing from the guild is written without its id', () => {
    const text = build({ roleNames: {} });
    assert.match(text, /eine bestimmte Rolle/);
    assert.ok(!text.includes('role-777'));
});

test("the asker's own status and role fit are stated", () => {
    const none = build();
    assert.match(none, /^Dein Status$/m);
    assert.match(none, /nicht angemeldet/);
    assert.match(none, /keine der nötigen Rollen/);

    const waiting = build({
        asker: { registration: { status: 'waitlisted', slotId: 'tank' }, roleIds: ['role-777'], waitlistPlace: 2 },
        event: baseEvent({ slots: [{ id: 'tank', name: 'Tank', emoji: '', capacity: 2 }] })
    });
    assert.match(waiting, /Warteliste/);
    assert.match(waiting, /Platz 2/);
    assert.match(waiting, /Tank/);
    assert.match(waiting, /Du hast eine der nötigen Rollen/);
    assert.ok(!/keine der nötigen Rollen/.test(waiting));
});

test('slots show their free places', () => {
    const text = build({
        event: baseEvent({
            accessMode: 'open', requiredRoles: [],
            slots: [{ id: 'tank', name: 'Tank', emoji: '', capacity: 2 }, { id: 'heal', name: 'Heiler', emoji: '', capacity: 3 }]
        }),
        registrations: [{ id: 'r1', status: 'accepted', slotId: 'tank', userId: 'x' }]
    });
    assert.match(text, /Tank: 1 von 2 belegt, 1 frei/);
    assert.match(text, /Heiler: 0 von 3 belegt, 3 frei/);
});

test('empty sections are left out; aiNotes appear under "Zusatzinfos"', () => {
    const bare = build({ event: { title: 'Nur Titel', status: 'active', startDate: '', endDate: '' }, registrations: [] });
    assert.ok(!/^Beschreibung$/m.test(bare));
    assert.ok(!/^Formular$/m.test(bare));
    assert.ok(!/^Zusatzinfos$/m.test(bare));
    const withNotes = build({ event: baseEvent({ aiNotes: 'Bitte Flasks mitbringen.' }) });
    assert.match(withNotes, /^Zusatzinfos\nBitte Flasks mitbringen\./m);
});

test('splitSource cuts a known source line and drops an unknown one', () => {
    assert.deepEqual(SOURCE_SECTIONS, ['Beschreibung', 'Teilnahmebedingungen', 'Termin', 'Plätze', 'Formular', 'Zusatzinfos']);
    assert.deepEqual(splitSource('Um 20 Uhr.\nQuelle: Termin'), { text: 'Um 20 Uhr.', source: 'Termin' });
    assert.deepEqual(splitSource('Um 20 Uhr.\nQuelle: Erfunden\n'), { text: 'Um 20 Uhr.', source: '' });
    assert.deepEqual(splitSource('Keine Quelle.'), { text: 'Keine Quelle.', source: '' });
});
