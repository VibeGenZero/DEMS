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
