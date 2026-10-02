const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir, startServer, createClient } = require('./helpers');
const { PERSONAS, ROLE_ID } = require('../dev/mockGuild');
const { EVENT_ID, CHECKIN_CODE } = require('../dev/seedData');

let server;

before(async () => {
    server = await startServer('dev/start.js', {
        DEV_SQLITE_PATH: path.join(createTempDir('dev-server'), 'dev.sqlite')
    });
});

after(() => server.stop());

const personaById = (id) => PERSONAS.find(persona => persona.id === id);

async function loginAs(personaId, client = createClient(server.baseUrl)) {
    const res = await client.request(`/auth/dev-login/${personaId}`);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/#events');
    return client;
}

async function currentUser(client) {
    return (await client.request('/auth/me')).json();
}

test('the login button leads to the persona page', async () => {
    const client = createClient(server.baseUrl);

    const redirect = await client.request('/auth/discord');
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get('location'), '/auth/dev-login');

    const page = await client.request('/auth/dev-login');
    assert.equal(page.status, 200);
    const html = await page.text();
    for (const persona of PERSONAS) {
        assert.ok(html.includes(`/auth/dev-login/${persona.id}`), persona.id);
    }
});

test('the Discord callback does not reach Discord in mock mode', async () => {
    const res = await createClient(server.baseUrl).request('/auth/discord/callback?code=abc');
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/auth/dev-login');
});

test('the admin persona gets into the admin area', async () => {
    const client = await loginAs('admin');
    const me = await currentUser(client);
    assert.equal(me.id, personaById('admin').userId);
    assert.equal(me.isAdmin, true);
    assert.equal((await client.request('/api/admin/stats')).status, 200);
});

test('the member persona is refused by the admin area', async () => {
    const client = await loginAs('member');
    assert.equal((await currentUser(client)).isAdmin, false);
    assert.equal((await client.request('/api/admin/stats')).status, 403);
});

test('the raider persona carries the Raid-Team role', async () => {
    const me = await currentUser(await loginAs('raider'));
    assert.ok(me.roles.includes(ROLE_ID.RAID_TEAM));
    assert.equal(me.isAdmin, false);
});

test('the newbie persona is a new user on the first login only', async () => {
    const first = await loginAs('newbie');
    assert.equal((await currentUser(first)).isNewUser, true);
    assert.equal((await currentUser(first)).isNewUser, false);

    const second = await loginAs('newbie');
    assert.equal((await currentUser(second)).isNewUser, false);
});

test('a second login in the same browser replaces the persona', async () => {
    const client = await loginAs('admin');
    await loginAs('member', client);

    const me = await currentUser(client);
    assert.equal(me.id, personaById('member').userId);
    assert.equal(me.isAdmin, false);
    assert.equal((await client.request('/api/admin/stats')).status, 403);
});

test('an unknown persona is rejected', async () => {
    const client = createClient(server.baseUrl);
    assert.equal((await client.request('/auth/dev-login/nobody')).status, 404);
    assert.equal(await currentUser(client), null);
});

test('seeded events are served', async () => {
    const res = await createClient(server.baseUrl).request('/api/events');
    assert.equal(res.status, 200);
    const { data } = await res.json();
    assert.ok(data.some(event => event.id === EVENT_ID.OPEN));
    assert.ok(!data.some(event => event.id === EVENT_ID.DRAFT));
});

test('the routes read the mock Discord server', async () => {
    const admin = await loginAs('admin');
    const roles = await (await admin.request('/api/admin/roles')).json();
    assert.ok(roles.some(role => role.name === 'Raid-Team'));
    const channels = await (await admin.request('/api/admin/channels')).json();
    assert.ok(channels.some(channel => channel.name === 'mod-intern'));
    assert.equal((await (await admin.request('/api/admin/bot/status')).json()).online, true);

    const member = await loginAs('member');
    const options = await (await member.request('/api/events/form-options')).json();
    assert.ok(options.roles.some(role => role.name === 'Raid-Team'));
    assert.ok(!options.roles.some(role => role.name === 'DEMS Bot'));
    assert.ok(!options.channels.some(channel => channel.name === 'mod-intern'));
});

test('announcing an event is logged instead of sent to Discord', async () => {
    const admin = await loginAs('admin');
    const res = await admin.send('POST', `/api/admin/events/${EVENT_ID.OPEN}/announce`, { text: 'Heute Abend geht es los!' });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).success, true);
    await server.waitForOutput('Heute Abend geht es los!');
    assert.ok(server.output().includes('[MOCK-DISCORD]'));
});

test('announcing stores the message for live updates', async () => {
    const admin = await loginAs('admin');
    const res = await admin.send('POST', `/api/admin/events/${EVENT_ID.OPEN}/announce`, { text: 'Live!' });
    assert.equal(res.status, 200);

    const events = await (await admin.request('/api/admin/all-events')).json();
    const announcements = events.find(event => event.id === EVENT_ID.OPEN).announcements;
    assert.ok(announcements.length >= 1);
    assert.match(announcements[announcements.length - 1].messageId, /^\d+$/);
});

test('starting a draft event works on SQLite', async () => {
    const admin = await loginAs('admin');
    const res = await admin.send('POST', `/api/admin/events/${EVENT_ID.DRAFT}/start`);
    assert.equal(res.status, 200);

    const events = await (await admin.request('/api/admin/all-events')).json();
    assert.equal(events.find(event => event.id === EVENT_ID.DRAFT).status, 'active');
});

test('the member persona can check in to the running event', async () => {
    const member = await loginAs('member');
    const wrong = await member.send('POST', `/api/events/${EVENT_ID.RUNNING}/checkin`, { code: '000000' });
    assert.equal(wrong.status, 400);

    const right = await member.send('POST', `/api/events/${EVENT_ID.RUNNING}/checkin`, { code: CHECKIN_CODE });
    assert.equal(right.status, 200);
    assert.equal((await right.json()).success, true);
});

test('the rate limiters do not get in the way during development', async () => {
    const client = createClient(server.baseUrl);
    for (let i = 0; i < 40; i++) {
        assert.equal((await client.request('/auth/me')).status, 200, `request ${i + 1}`);
    }
});

test('members are locked out while login is disabled, admins are not', async () => {
    const admin = await loginAs('admin');
    const enable = await admin.send('PUT', '/api/admin/maintenance', { loginDisabled: true });
    assert.equal(enable.status, 200);

    try {
        const member = createClient(server.baseUrl);
        const res = await member.request('/auth/dev-login/member');
        assert.equal(res.status, 302);
        assert.equal(res.headers.get('location'), '/?error=maintenance_login_disabled');
        assert.equal(await currentUser(member), null);
        await loginAs('admin');
    } finally {
        await admin.send('PUT', '/api/admin/maintenance', { loginDisabled: false });
    }
});

test('members are locked out in panic mode, admins are not', async () => {
    const admin = await loginAs('admin');
    const activate = await admin.send('POST', '/api/admin/maintenance/panic');
    assert.equal(activate.status, 200);

    try {
        const member = createClient(server.baseUrl);
        const res = await member.request('/auth/dev-login/member');
        assert.equal(res.status, 302);
        assert.equal(res.headers.get('location'), '/?error=panic_mode');
        assert.equal(await currentUser(member), null);
        await loginAs('admin');
    } finally {
        const deactivate = await admin.send('POST', '/api/admin/maintenance/panic/deactivate', { password: 'dev' });
        assert.equal(deactivate.status, 200);
    }
});

// ── Role slots ──────────────────────────────────────────────────────────

const RAID_SLOTS = [
    { name: 'Tank', emoji: '🛡️', capacity: 1 },
    { name: 'Heiler', emoji: '💚', capacity: 1 }
];

/** Create an active instant-approval event with role slots; returns the API response. */
async function createSlotEvent(admin, title, slots, fields = {}) {
    const res = await admin.send('POST', '/api/admin/events', {
        title, status: 'active', accessMode: 'open', approvalMode: 'instant', slots, ...fields
    });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    return body;
}

test('admins create events with role slots', async () => {
    const admin = await loginAs('admin');
    const created = await createSlotEvent(admin, 'Slot-Anlage', [
        { name: 'Tank', emoji: '🛡️', capacity: 2 },
        { name: 'Heiler', emoji: '💚', capacity: 3 }
    ], { maxParticipants: 99, allowGuests: true });

    assert.equal(created.maxParticipants, 5);
    assert.equal(created.allowGuests, false);
    assert.deepEqual(created.slots.map(slot => slot.name), ['Tank', 'Heiler']);
    assert.ok(created.slots.every(slot => /^[0-9a-f]{8}$/.test(slot.id)));

    const detail = await (await admin.request(`/api/events/${created.id}`)).json();
    assert.deepEqual(detail.slots, created.slots);
});

test('invalid slots are rejected with a German message', async () => {
    const admin = await loginAs('admin');
    const res = await admin.send('POST', '/api/admin/events', {
        title: 'Kaputte Slots', status: 'active', slots: [{ name: 'Tank', emoji: ':shield:', capacity: 1 }]
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'Das Emoji von Slot „Tank“ muss ein einzelnes Emoji sein.');
});

test('slots cannot be switched on while people are registered', async () => {
    const admin = await loginAs('admin');
    const event = await (await admin.request(`/api/events/${EVENT_ID.OPEN}`)).json();
    const res = await admin.send('PUT', `/api/admin/events/${EVENT_ID.OPEN}`, { ...event, slots: [{ name: 'Tank', capacity: 2 }] });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'Slots können nur aktiviert werden, solange es keine Anmeldungen gibt.');
});

test('duplicating keeps the slots but not the announcements', async () => {
    const admin = await loginAs('admin');
    const created = await createSlotEvent(admin, 'Slot-Kopie', RAID_SLOTS);
    assert.equal((await admin.send('POST', `/api/admin/events/${created.id}/announce`, {})).status, 200);

    const copy = await (await admin.send('POST', `/api/admin/events/${created.id}/duplicate`)).json();
    assert.deepEqual(copy.slots, created.slots);
    assert.deepEqual(copy.announcements, []);
});

test('a full main role falls back to the alternative, then to the waitlist', async () => {
    const admin = await loginAs('admin');
    const event = await createSlotEvent(admin, 'Raid-Ausweich', RAID_SLOTS);
    const [tank, heal] = event.slots;
    const raider = await loginAs('raider');
    const member = await loginAs('member');
    const newbie = await loginAs('newbie');

    const first = await (await raider.send('POST', `/api/events/${event.id}/register`, { slotId: tank.id })).json();
    assert.deepEqual([first.status, first.slotId, first.isAlt], ['accepted', tank.id, false]);

    const second = await (await member.send('POST', `/api/events/${event.id}/register`, { slotId: tank.id, altSlotIds: [heal.id] })).json();
    assert.deepEqual([second.slotId, second.isAlt], [heal.id, true]);
    assert.ok(second.message.includes('🛡️ Tank war voll'));

    const third = await (await newbie.send('POST', `/api/events/${event.id}/register`, { slotId: tank.id, altSlotIds: [heal.id] })).json();
    assert.equal(third.status, 'waitlisted');

    const detail = await (await raider.request(`/api/events/${event.id}`)).json();
    assert.deepEqual(detail.slotSummary.map(slot => slot.taken), [1, 1]);

    assert.equal((await member.send('DELETE', `/api/events/${event.id}/register`)).status, 200);
    const promoted = await (await newbie.request(`/api/events/${event.id}/my-registration`)).json();
    assert.deepEqual([promoted.status, promoted.slotId], ['accepted', heal.id]);
});

test('registering for a slot event needs a valid slot', async () => {
    const admin = await loginAs('admin');
    const event = await createSlotEvent(admin, 'Raid-Pflichtslot', RAID_SLOTS);
    const member = await loginAs('member');
    const res = await member.send('POST', `/api/events/${event.id}/register`, {});
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'Bitte wähle einen gültigen Slot.');
});

test('members switch into free slots only and the line-up follows', async () => {
    const admin = await loginAs('admin');
    const event = await createSlotEvent(admin, 'Raid-Wechsel', [
        { name: 'Alpha', capacity: 1 }, { name: 'Beta', capacity: 1 }, { name: 'Gamma', capacity: 1 }
    ]);
    const [alpha, beta, gamma] = event.slots;
    const raider = await loginAs('raider');
    const member = await loginAs('member');
    await raider.send('POST', `/api/events/${event.id}/register`, { slotId: alpha.id });
    await member.send('POST', `/api/events/${event.id}/register`, { slotId: beta.id });

    const full = await raider.send('PUT', `/api/events/${event.id}/register/slot`, { slotId: beta.id });
    assert.equal(full.status, 409);
    assert.equal((await full.json()).error, 'Dieser Slot ist bereits voll.');

    const moved = await raider.send('PUT', `/api/events/${event.id}/register/slot`, { slotId: gamma.id });
    assert.equal(moved.status, 200);
    assert.equal((await moved.json()).slotId, gamma.id);

    const participants = await (await raider.request(`/api/events/${event.id}/participants`)).json();
    assert.deepEqual(participants.slots.map(slot => slot.taken), [0, 1, 1]);
    assert.equal(participants.slots[2].members[0].displayName, personaById('raider').displayName);
    assert.deepEqual(participants.waitlist, []);
});

test('a slot that still has registrations cannot be removed', async () => {
    const admin = await loginAs('admin');
    const event = await createSlotEvent(admin, 'Raid-Umbau', RAID_SLOTS);
    const raider = await loginAs('raider');
    await raider.send('POST', `/api/events/${event.id}/register`, { slotId: event.slots[0].id });

    const removed = await admin.send('PUT', `/api/admin/events/${event.id}`, { ...event, slots: event.slots.slice(1) });
    assert.equal(removed.status, 400);
    assert.equal((await removed.json()).error, 'Slot „Tank“ hat noch 1 Anmeldung – bitte zuerst verschieben.');

    const grown = await admin.send('PUT', `/api/admin/events/${event.id}`, {
        ...event, slots: event.slots.map(slot => ({ ...slot, capacity: 3 }))
    });
    assert.equal(grown.status, 200);
    assert.equal((await grown.json()).maxParticipants, 6);
});

test('a new registration refreshes the live announcement', async () => {
    const admin = await loginAs('admin');
    const event = await createSlotEvent(admin, 'Live-Embed-Test', RAID_SLOTS);
    assert.equal((await admin.send('POST', `/api/admin/events/${event.id}/announce`, {})).status, 200);

    const raider = await loginAs('raider');
    await raider.send('POST', `/api/events/${event.id}/register`, { slotId: event.slots[0].id });
    await server.waitForOutput('Ankündigung von "Live-Embed-Test" aktualisiert', 6000);
});

/** Registration of a persona in the admin list of an event. */
async function adminRegistrationOf(admin, eventId, personaId) {
    const result = await (await admin.request(`/api/admin/events/${eventId}/registrations`)).json();
    return { registration: result.data.find(entry => entry.userId === personaById(personaId).userId), slots: result.slots };
}

test('admins move a registration into a full slot with a warning', async () => {
    const admin = await loginAs('admin');
    const event = await createSlotEvent(admin, 'Raid-Verschieben', RAID_SLOTS);
    const [tank, heal] = event.slots;
    await (await loginAs('raider')).send('POST', `/api/events/${event.id}/register`, { slotId: tank.id });
    await (await loginAs('member')).send('POST', `/api/events/${event.id}/register`, { slotId: heal.id });

    const { registration, slots } = await adminRegistrationOf(admin, event.id, 'member');
    assert.deepEqual(slots, event.slots);
    const res = await admin.send('PUT', `/api/admin/registrations/${registration.id}/slot`, { slotId: tank.id });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).warning, 'Slot „Tank“ ist jetzt überbucht.');

    const detail = await (await admin.request(`/api/events/${event.id}`)).json();
    assert.deepEqual(detail.slotSummary.map(slot => slot.taken), [2, 0]);
});

test('accepting a waitlisted registration gives it a slot', async () => {
    const admin = await loginAs('admin');
    const event = await createSlotEvent(admin, 'Raid-Annehmen', RAID_SLOTS);
    const [tank] = event.slots;
    await (await loginAs('raider')).send('POST', `/api/events/${event.id}/register`, { slotId: tank.id });
    await (await loginAs('member')).send('POST', `/api/events/${event.id}/register`, { slotId: tank.id });

    const { registration } = await adminRegistrationOf(admin, event.id, 'member');
    assert.equal(registration.status, 'waitlisted');
    const res = await admin.send('PUT', `/api/admin/registrations/${registration.id}/status`, { status: 'accepted' });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.slotId, tank.id);
    assert.equal(body.warning, 'Slot „Tank“ ist jetzt überbucht.');
});

test('the export lists slot and wish of every registration', async () => {
    const admin = await loginAs('admin');
    const event = await createSlotEvent(admin, 'Raid-Export', RAID_SLOTS);
    await (await loginAs('raider')).send('POST', `/api/events/${event.id}/register`, { slotId: event.slots[0].id });

    const csv = await (await admin.request(`/api/admin/events/${event.id}/registrations/export`)).text();
    assert.ok(csv.split('\n')[0].includes('Slot,Wunschrolle'));
    assert.ok(csv.includes('"🛡️ Tank","🛡️ Tank"'));
});

// Keep this test last -> it deletes the newbie persona's account
test('deleting an account lets the waitlist move up', async () => {
    const admin = await loginAs('admin');
    const event = await createSlotEvent(admin, 'Raid-Konto', [{ name: 'Tank', emoji: '🛡️', capacity: 1 }]);
    const slotId = event.slots[0].id;
    const newbie = await loginAs('newbie');
    const member = await loginAs('member');
    await newbie.send('POST', `/api/events/${event.id}/register`, { slotId });
    await member.send('POST', `/api/events/${event.id}/register`, { slotId });

    assert.equal((await newbie.send('DELETE', '/api/user/account')).status, 200);
    const promoted = await (await member.request(`/api/events/${event.id}/my-registration`)).json();
    assert.deepEqual([promoted.status, promoted.slotId], ['accepted', slotId]);
});
