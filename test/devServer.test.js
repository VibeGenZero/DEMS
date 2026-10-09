const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir, startServer, createClient } = require('./helpers');
const { PERSONAS, ROLE_ID } = require('../dev/mockGuild');
const { EVENT_ID, SERIES_EVENT_IDS, CHECKIN_CODE } = require('../dev/seedData');

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

test('the persona login starts a new session like the Discord login', async () => {
    const client = createClient(server.baseUrl);
    await client.request('/api/csrf-token');
    const sessionBeforeLogin = client.cookie('connect.sid');
    assert.ok(sessionBeforeLogin);

    await loginAs('member', client);
    assert.notEqual(client.cookie('connect.sid'), sessionBeforeLogin);
    assert.equal((await currentUser(client)).username, 'tom');
});

test('requests without a session cookie store no session until the CSRF token is fetched', async () => {
    // Sessions live in the database -> pages, assets and crawlers must not create one each
    for (const url of ['/', '/css/style.css', '/irgendein/pfad', '/api/server-info', '/auth/me']) {
        const res = await fetch(server.baseUrl + url, { redirect: 'manual' });
        assert.equal(res.headers.getSetCookie().find(cookie => cookie.startsWith('connect.sid=')), undefined, url);
    }

    const tokenRes = await fetch(`${server.baseUrl}/api/csrf-token`);
    assert.ok(tokenRes.headers.getSetCookie().some(cookie => cookie.startsWith('connect.sid=')));
    assert.match((await tokenRes.json()).token, /^[0-9a-f]{64}$/);
});

test('parallel first changes after a login all pass the CSRF check', async () => {
    // Each send() fetches the token, then writes. Without a token minted by the login,
    // parallel requests each mint their own and all but the last stored one get 403.
    // Timing-dependent, hence several logins.
    for (let round = 0; round < 5; round++) {
        const raider = await loginAs('raider');
        const responses = await Promise.all([1, 2, 3].map(() => raider.send('PUT', '/api/user/settings', { acceptInvitations: true })));
        assert.deepEqual(responses.map(res => res.status), [200, 200, 200], `round ${round}`);
    }
});

test('an unknown persona is rejected', async () => {
    const client = createClient(server.baseUrl);
    assert.equal((await client.request('/auth/dev-login/nobody')).status, 404);
    assert.equal(await currentUser(client), null);
});

test('the content security policy allows only own scripts, styles and fonts and no eval', async () => {
    const res = await createClient(server.baseUrl).request('/');
    assert.equal(res.status, 200);
    const directives = Object.fromEntries(res.headers.get('content-security-policy').split(';')
        .map(part => part.trim().split(/\s+/))
        .map(([name, ...sources]) => [name, sources.join(' ')]));

    assert.equal(directives['script-src'], "'self' 'unsafe-inline'");
    assert.equal(directives['style-src'], "'self' 'unsafe-inline'");
    assert.equal(directives['font-src'], "'self'");
    assert.ok(!directives['connect-src'].includes('cdn.jsdelivr.net'), directives['connect-src']);
});

test('seeded events are served', async () => {
    const member = await loginAs('member');
    const res = await member.request('/api/events');
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

test('no event answer outside the admin area contains a check-in code', async () => {
    const admin = await loginAs('admin');
    assert.equal((await admin.send('POST', `/api/admin/events/${SERIES_EVENT_IDS[0]}/generate-checkin`)).status, 200);
    const member = await loginAs('member');
    const { seriesId } = await (await member.request(`/api/events/${SERIES_EVENT_IDS[0]}`)).json();

    const answers = {
        list: '/api/events',
        series: `/api/events/series/${seriesId}`,
        single: `/api/events/${EVENT_ID.RUNNING}`,
        registrations: '/api/user/registrations',
        profile: '/api/user/profile'
    };
    for (const [name, url] of Object.entries(answers)) {
        const res = await member.request(url);
        assert.equal(res.status, 200, name);
        const body = await res.text();
        assert.match(body, new RegExp(`"id":"(${EVENT_ID.RUNNING}|${SERIES_EVENT_IDS[0]})"`), `${name} lists an event with a code`);
        assert.doesNotMatch(body, /checkinCode/, name);
    }
});

test('a guest sees only status and id of the registration that invited them', async () => {
    const newbie = await loginAs('newbie');
    const res = await newbie.request(`/api/events/${EVENT_ID.BIG_FORM}/my-registration`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { registered: true, asGuest: true, id: 'dev-reg-bigform-chiara', status: 'pending' });
});

test('the event API answers only logged-in users', async () => {
    const admin = await loginAs('admin');
    const { seriesId } = await (await admin.request(`/api/events/${SERIES_EVENT_IDS[0]}`)).json();
    const anonymous = createClient(server.baseUrl);

    for (const url of ['/api/events', '/api/events/categories', `/api/events/series/${seriesId}`, `/api/events/${EVENT_ID.OPEN}`]) {
        const res = await anonymous.request(url);
        assert.equal(res.status, 401, url);
    }
});

test('draft and archived events exist only for admins', async () => {
    const admin = await loginAs('admin');
    const member = await loginAs('member');
    const draftId = SERIES_EVENT_IDS[2];
    assert.equal((await admin.send('PUT', `/api/admin/events/${draftId}/status`, { status: 'draft' })).status, 200);
    try {
        for (const id of [draftId, EVENT_ID.ARCHIVED]) {
            const res = await member.request(`/api/events/${id}`);
            assert.equal(res.status, 404, id);
            assert.equal((await res.json()).error, 'Event nicht gefunden');
            assert.equal((await member.request(`/api/events/${id}/comments`)).status, 404, `${id}/comments`);
            assert.equal((await admin.request(`/api/events/${id}`)).status, 200, `${id} as admin`);
        }

        const { seriesId } = await (await admin.request(`/api/events/${draftId}`)).json();
        const seriesEventIds = async (client) => (await (await client.request(`/api/events/series/${seriesId}`)).json()).map(event => event.id);
        assert.ok(!(await seriesEventIds(member)).includes(draftId));
        assert.ok((await seriesEventIds(admin)).includes(draftId));
    } finally {
        await admin.send('PUT', `/api/admin/events/${draftId}/status`, { status: 'active' });
    }
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

test('a comment shows the avatar of its author', async () => {
    const member = await loginAs('member');
    const { avatar } = await currentUser(member);

    const res = await member.send('POST', `/api/events/${EVENT_ID.OPEN}/comments`, { text: 'Avatar-Test' });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).userAvatar, avatar);

    const comments = await (await member.request(`/api/events/${EVENT_ID.OPEN}/comments`)).json();
    assert.equal(comments.find(comment => comment.text === 'Avatar-Test').userAvatar, avatar);
});

test('deleting an event deletes its Discord channels', async () => {
    const admin = await loginAs('admin');
    const created = await createSlotEvent(admin, 'Channel-Löschtest', [], { autoCreateChannels: true, channelConfig: { type: 'both' } });
    await server.waitForOutput('Event-Channels für "Channel-Löschtest" erstellt');

    assert.equal((await admin.send('DELETE', `/api/admin/events/${created.id}`)).status, 200);
    await server.waitForOutput('Event-Channels für "Channel-Löschtest" gelöscht');
});

test('deleting a series deletes the Discord channels of its events', async () => {
    const admin = await loginAs('admin');
    const res = await admin.send('POST', '/api/admin/events', {
        title: 'Serien-Löschtest', status: 'draft', accessMode: 'open', approvalMode: 'instant',
        autoCreateChannels: true, channelConfig: { type: 'voice' },
        recurring: true, recurringInterval: 'weekly', startDate: '2026-11-02T18:00:00.000Z', recurringUntil: '2026-11-10'
    });
    const { events } = await res.json();
    assert.equal(events.length, 2);
    // Channels appear when an instance becomes active
    assert.equal((await admin.send('PUT', `/api/admin/events/${events[0].id}/status`, { status: 'active' })).status, 200);
    await server.waitForOutput('Event-Channels für "Serien-Löschtest" erstellt');

    assert.equal((await admin.send('DELETE', `/api/admin/events/series/${events[0].seriesId}`)).status, 200);
    await server.waitForOutput('Event-Channels für "Serien-Löschtest" gelöscht');
});

test('a duplicated event gets its reminders and start notification again', async () => {
    const admin = await loginAs('admin');
    // Seed: the past event already sent its 24 h reminder and its start notification
    const res = await admin.send('POST', `/api/admin/events/${EVENT_ID.PAST}/duplicate`);
    assert.equal(res.status, 200);
    const copy = await res.json();
    assert.deepEqual(copy.reminderHours, [{ hours: 24, sent: false }]);
    assert.equal(copy.eventStartNotificationSent, false);
});

test('saving an event keeps sent reminders sent until the start moves', async () => {
    const admin = await loginAs('admin');
    const storedReminders = async () => (await (await admin.request('/api/admin/all-events')).json())
        .find(event => event.id === EVENT_ID.PAST).reminderHours;
    const event = await (await admin.request(`/api/events/${EVENT_ID.PAST}`)).json();

    // The event form sends the reminder as a plain number
    assert.equal((await admin.send('PUT', `/api/admin/events/${EVENT_ID.PAST}`, { ...event, reminderHours: 24 })).status, 200);
    assert.deepEqual(await storedReminders(), [{ hours: 24, sent: true }]);

    const movedStart = new Date(new Date(event.startDate).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    assert.equal((await admin.send('PUT', `/api/admin/events/${EVENT_ID.PAST}`, { ...event, startDate: movedStart, reminderHours: 24 })).status, 200);
    assert.deepEqual(await storedReminders(), [{ hours: 24, sent: false }]);
});

test('the event form saves several reminders and an empty field removes them', async () => {
    const admin = await loginAs('admin');
    const storedReminders = async () => (await (await admin.request('/api/admin/all-events')).json())
        .find(event => event.id === EVENT_ID.FULL).reminderHours;
    const event = await (await admin.request(`/api/events/${EVENT_ID.FULL}`)).json();

    assert.equal((await admin.send('PUT', `/api/admin/events/${EVENT_ID.FULL}`, { ...event, reminderHours: '24, 1' })).status, 200);
    assert.deepEqual(await storedReminders(), [{ hours: 24, sent: false }, { hours: 1, sent: false }]);

    assert.equal((await admin.send('PUT', `/api/admin/events/${EVENT_ID.FULL}`, { ...event, reminderHours: '' })).status, 200);
    assert.deepEqual(await storedReminders(), []);
});

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

test('re-accepting a rejected registration does not silently overbook its old slot', async () => {
    const admin = await loginAs('admin');
    const event = await createSlotEvent(admin, 'Raid-Wiederaufnahme', [{ name: 'Tank', emoji: '🛡️', capacity: 1 }]);
    const [tank] = event.slots;
    await (await loginAs('raider')).send('POST', `/api/events/${event.id}/register`, { slotId: tank.id });
    const { registration } = await adminRegistrationOf(admin, event.id, 'raider');

    assert.equal((await admin.send('PUT', `/api/admin/registrations/${registration.id}/status`, { status: 'rejected' })).status, 200);
    await (await loginAs('member')).send('POST', `/api/events/${event.id}/register`, { slotId: tank.id });

    const res = await admin.send('PUT', `/api/admin/registrations/${registration.id}/status`, { status: 'accepted' });
    const body = await res.json();
    assert.equal(body.slotId, tank.id);
    assert.equal(body.warning, 'Slot „Tank“ ist jetzt überbucht.');
});

// ── Date polls ──────────────────────────────────────────────────────────

/** ISO date `days` from now at `hour` UTC. */
function futureDate(days, hour = 18) {
    const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    date.setUTCHours(hour, 0, 0, 0);
    return date.toISOString();
}

/** Create a date poll with two dates; returns the API response. */
async function createPollViaApi(admin, title, fields = {}) {
    const res = await admin.send('POST', '/api/admin/polls', {
        title, description: 'Wann passt es euch?',
        options: [{ startDate: futureDate(8) }, { startDate: futureDate(9) }],
        ...fields
    });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    return body;
}

test('admins create date polls', async () => {
    const admin = await loginAs('admin');
    const poll = await createPollViaApi(admin, 'Neue Abstimmung');
    assert.equal(poll.status, 'open');
    assert.equal(poll.options.length, 2);
    assert.ok(poll.options.every(option => /^[0-9a-f]{8}$/.test(option.id)));
    assert.equal(poll.createdBy, personaById('admin').userId);
});

test('admins choose their own answers for a poll', async () => {
    const admin = await loginAs('admin');
    const labels = { yes: 'Bin dabei', maybe: 'Vielleicht', no: 'Kann nicht' };
    const poll = await createPollViaApi(admin, 'Antwort-Abstimmung', { labels });
    assert.deepEqual(poll.labels, labels);

    const raider = await loginAs('raider');
    assert.deepEqual((await (await raider.request(`/api/polls/${poll.id}`)).json()).labels, labels);
    const entry = (await (await raider.request('/api/polls')).json()).find(item => item.id === poll.id);
    assert.deepEqual(entry.labels, labels);

    const renamed = await admin.send('PUT', `/api/admin/polls/${poll.id}`, {
        title: poll.title, options: poll.options, labels: { ...labels, no: 'Bin raus' }
    });
    assert.equal(renamed.status, 200);
    assert.equal((await renamed.json()).labels.no, 'Bin raus');
});

test('invalid date polls are refused with a German message', async () => {
    const admin = await loginAs('admin');
    const res = await admin.send('POST', '/api/admin/polls', { title: 'Zu wenig', options: [{ startDate: futureDate(8) }] });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'Eine Abstimmung braucht 2–10 Termine.');
});

test('posting a poll to Discord is logged', async () => {
    const admin = await loginAs('admin');
    const poll = await createPollViaApi(admin, 'Poster-Abstimmung');
    const res = await admin.send('POST', `/api/admin/polls/${poll.id}/announce`, { text: 'Stimmt ab, Leute!' });
    assert.equal(res.status, 200);
    await server.waitForOutput('Stimmt ab, Leute!');
});

test('a poll can only be turned into an event once', async () => {
    const admin = await loginAs('admin');
    const poll = await createPollViaApi(admin, 'Event-Abstimmung');
    const [first] = poll.options;
    const body = { title: 'Aus der Abstimmung', status: 'active', startDate: first.startDate, fromPoll: { pollId: poll.id, optionId: first.id } };

    const created = await admin.send('POST', '/api/admin/events', body);
    assert.equal(created.status, 200);
    assert.equal((await created.json()).sourcePollId, poll.id);

    const again = await admin.send('POST', '/api/admin/events', body);
    assert.equal(again.status, 400);
    assert.equal((await again.json()).error, 'Diese Abstimmung ist bereits entschieden.');

    const other = await createPollViaApi(admin, 'Falscher Termin');
    const wrong = await admin.send('POST', '/api/admin/events', { ...body, fromPoll: { pollId: other.id, optionId: 'nope' } });
    assert.equal(wrong.status, 400);
    assert.equal((await wrong.json()).error, 'Termin nicht gefunden');
});

test('a poll can only become an active event', async () => {
    const admin = await loginAs('admin');
    const poll = await createPollViaApi(admin, 'Entwurf-Abstimmung');
    const [first] = poll.options;

    const res = await admin.send('POST', '/api/admin/events', {
        title: 'Entwurf aus Abstimmung', status: 'draft', startDate: first.startDate,
        fromPoll: { pollId: poll.id, optionId: first.id }
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'Ein Event aus einer Abstimmung muss aktiv sein.');
    assert.equal((await (await admin.request(`/api/polls/${poll.id}`)).json()).status, 'open');
    const events = await (await admin.request('/api/admin/all-events')).json();
    assert.equal(events.some(event => event.title === 'Entwurf aus Abstimmung'), false);
});

test('admins close and delete polls', async () => {

    const admin = await loginAs('admin');
    const poll = await createPollViaApi(admin, 'Weg damit');
    assert.equal((await admin.send('POST', `/api/admin/polls/${poll.id}/close`)).status, 200);
    assert.equal((await admin.send('DELETE', `/api/admin/polls/${poll.id}`)).status, 200);
    assert.equal((await admin.send('DELETE', `/api/admin/polls/${poll.id}`)).status, 404);
});

test('members vote on the web and see the tally', async () => {
    const admin = await loginAs('admin');
    const poll = await createPollViaApi(admin, 'Web-Abstimmung');
    const [first, second] = poll.options;
    const raider = await loginAs('raider');
    const member = await loginAs('member');

    const res = await raider.send('PUT', `/api/polls/${poll.id}/vote`, { yes: [first.id], maybe: [second.id] });
    assert.equal(res.status, 200);
    const voted = await res.json();
    assert.deepEqual(voted.myVote, { yes: [first.id], maybe: [second.id] });
    assert.deepEqual(voted.tally.options.map(o => [o.yes, o.maybe]), [[1, 0], [0, 1]]);
    assert.equal(voted.tally.options[0].yesVoters[0].displayName, personaById('raider').displayName);
    assert.equal(voted.favoriteOptionId, first.id);
    assert.equal(voted.announcements, undefined);

    const memberList = await (await member.request('/api/polls')).json();
    const entry = memberList.find(item => item.id === poll.id);
    assert.deepEqual([entry.myVoteStatus, entry.canVote, entry.voterCount, entry.status], ['open', true, 1, 'open']);
    const raiderList = await (await raider.request('/api/polls')).json();
    assert.equal(raiderList.find(item => item.id === poll.id).myVoteStatus, 'voted');
});

test('fast per-date clicks on the web keep every change', async () => {
    const admin = await loginAs('admin');
    const poll = await createPollViaApi(admin, 'Klick-Abstimmung');
    const [first, second] = poll.options;
    const raider = await loginAs('raider');
    const url = `/api/polls/${poll.id}/vote`;

    const responses = await Promise.all([
        raider.send('PUT', url, { optionId: first.id, state: 'yes' }),
        raider.send('PUT', url, { optionId: second.id, state: 'maybe' })
    ]);
    assert.deepEqual(responses.map(res => res.status), [200, 200]);
    const stored = await (await raider.request(`/api/polls/${poll.id}`)).json();
    assert.deepEqual(stored.myVote, { yes: [first.id], maybe: [second.id] });

    const invalid = await raider.send('PUT', url, { optionId: first.id, state: 'egal' });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error, 'Ungültige Auswahl');
});

test('role-restricted polls refuse other members', async () => {

    const admin = await loginAs('admin');
    const poll = await createPollViaApi(admin, 'Raid-Abstimmung', { accessMode: 'role-required', requiredRoles: [ROLE_ID.RAID_TEAM] });
    const member = await loginAs('member');
    const refused = await member.send('PUT', `/api/polls/${poll.id}/vote`, { yes: [poll.options[0].id] });
    assert.equal(refused.status, 403);
    assert.equal((await refused.json()).error, 'Du hast nicht die erforderliche Rolle für diese Abstimmung.');
    assert.equal((await (await member.request(`/api/polls/${poll.id}`)).json()).canVote, false);

    const raider = await loginAs('raider');
    assert.equal((await raider.send('PUT', `/api/polls/${poll.id}/vote`, { yes: [poll.options[0].id] })).status, 200);
});

test('closed polls refuse votes', async () => {
    const admin = await loginAs('admin');
    const poll = await createPollViaApi(admin, 'Geschlossene Abstimmung');
    await admin.send('POST', `/api/admin/polls/${poll.id}/close`);
    const raider = await loginAs('raider');
    const res = await raider.send('PUT', `/api/polls/${poll.id}/vote`, { yes: [poll.options[0].id] });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'Die Abstimmung ist beendet.');
    assert.equal((await raider.request('/api/polls/does-not-exist')).status, 404);
});

test('a date with votes cannot be removed', async () => {
    const admin = await loginAs('admin');
    const poll = await createPollViaApi(admin, 'Bearbeiten-Abstimmung');
    const raider = await loginAs('raider');
    await raider.send('PUT', `/api/polls/${poll.id}/vote`, { yes: [poll.options[0].id] });

    const res = await admin.send('PUT', `/api/admin/polls/${poll.id}`, {
        title: poll.title, options: [poll.options[1], { startDate: futureDate(10) }]
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /hat bereits Stimmen/);
});

test('a vote refreshes the posted poll message', async () => {
    const admin = await loginAs('admin');
    const poll = await createPollViaApi(admin, 'Live-Abstimmung');
    await admin.send('POST', `/api/admin/polls/${poll.id}/announce`, {});
    const raider = await loginAs('raider');
    await raider.send('PUT', `/api/polls/${poll.id}/vote`, { yes: [poll.options[0].id] });
    await server.waitForOutput('Abstimmung "Live-Abstimmung" aktualisiert', 6000);
});

test('deciding a poll tells the voters by DM', async () => {
    const admin = await loginAs('admin');
    const poll = await createPollViaApi(admin, 'DM-Abstimmung');
    const raider = await loginAs('raider');
    await raider.send('PUT', `/api/polls/${poll.id}/vote`, { yes: [poll.options[0].id] });

    const res = await admin.send('POST', '/api/admin/events', {
        title: 'DM-Event', status: 'active', startDate: poll.options[0].startDate,
        fromPoll: { pollId: poll.id, optionId: poll.options[0].id }
    });
    const event = await res.json();
    await server.waitForOutput('Der Termin für **DM-Abstimmung** steht');

    const decided = await (await raider.request(`/api/polls/${poll.id}`)).json();
    assert.deepEqual([decided.status, decided.eventId, decided.winnerOptionId], ['decided', event.id, poll.options[0].id]);
});

test('deleting an account removes the own poll votes', async () => {
    const admin = await loginAs('admin');
    const poll = await createPollViaApi(admin, 'Konto-Abstimmung');
    const newbie = await loginAs('newbie');
    await newbie.send('PUT', `/api/polls/${poll.id}/vote`, { yes: [poll.options[0].id] });
    assert.equal((await (await admin.request(`/api/polls/${poll.id}`)).json()).tally.voterCount, 1);

    assert.equal((await newbie.send('DELETE', '/api/user/account')).status, 200);
    assert.equal((await (await admin.request(`/api/polls/${poll.id}`)).json()).tally.voterCount, 0);
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
