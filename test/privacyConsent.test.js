const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir, startServer, createClient } = require('./helpers');

// #138: the admin-written privacy policy and the consent gate, in dev mock
// mode with an own server: a stored policy gates every persona.
let server;
before(async () => {
    server = await startServer('dev/start.js', { DEV_SQLITE_PATH: path.join(createTempDir('privacy-consent'), 'dev.sqlite') });
});
after(() => server.stop());

async function loginAs(personaId) {
    const client = createClient(server.baseUrl);
    assert.equal((await client.request(`/auth/dev-login/${personaId}`)).status, 302);
    return client;
}
const me = async (client) => (await client.request('/auth/me')).json();
const savePolicy = async (admin, markdown) => admin.send('PUT', '/api/admin/privacy', { markdown });
const GATE = { error: 'Bitte akzeptiere zuerst die Datenschutzerklärung.', privacyRequired: true };

// The tests build on each other: no policy → policy v1 → accept → v2 → removed
test('without a policy there is no page and no gate', async () => {
    const anonymous = createClient(server.baseUrl);
    const res = await anonymous.request('/api/privacy');
    assert.equal(res.status, 404);
    assert.match((await res.json()).error, /Datenschutzerklärung/);

    const member = await loginAs('member');
    assert.equal((await me(member)).privacyRequired, false);
    assert.equal((await member.request('/api/events')).status, 200);
});

test('only admins publish the policy', async () => {
    const member = await loginAs('member');
    assert.equal((await savePolicy(member, '# Datenschutz')).status, 403);

    const admin = await loginAs('admin');
    const first = await savePolicy(admin, '# Datenschutz\n\nErste Fassung');
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { success: true, version: 1, changed: true });
});

test('the policy is public', async () => {
    const res = await createClient(server.baseUrl).request('/api/privacy');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.markdown, '# Datenschutz\n\nErste Fassung');
    assert.equal(body.version, 1);
    assert.ok(Date.parse(body.updatedAt));
    assert.equal('updatedBy' in body, false);
});

test('a member who has not accepted sees only the consent gate', async () => {
    const member = await loginAs('member');
    const user = await me(member);
    assert.equal(user.privacyRequired, true);
    assert.equal(user.privacyVersion, 1);

    const events = await member.request('/api/events');
    assert.equal(events.status, 403);
    assert.deepEqual(await events.json(), GATE);
    assert.equal((await member.request('/api/user/profile')).status, 403);

    // Still reachable: the policy, CSRF, server info, maintenance, news and the logout
    for (const pathname of ['/api/privacy', '/api/csrf-token', '/api/server-info', '/api/maintenance/status', '/api/updates']) {
        assert.equal((await member.request(pathname)).status, 200, pathname);
    }
});

test('admins are gated the same way', async () => {
    const admin = await loginAs('admin');
    assert.equal((await me(admin)).privacyRequired, true);
    assert.equal((await admin.request('/api/admin/stats')).status, 403);
    // The public page stays reachable; to change the policy an admin accepts it first
    assert.equal((await admin.request('/api/privacy')).status, 200);
    assert.equal((await savePolicy(admin, '# Datenschutz')).status, 403);
});

test('after accepting, the admin saves again: an unchanged text keeps the version, the change is logged', async () => {
    const admin = await loginAs('admin');
    assert.equal((await admin.send('POST', '/api/user/privacy/accept', { version: 1 })).status, 200);

    const same = await savePolicy(admin, '# Datenschutz\n\nErste Fassung');
    assert.deepEqual(await same.json(), { success: true, version: 1, changed: false });
    const tooLong = await savePolicy(admin, 'x'.repeat(50001));
    assert.equal(tooLong.status, 400);
    assert.match((await tooLong.json()).error, /50000 Zeichen/);

    const logs = await (await admin.request('/api/admin/audit-log?limit=500')).json();
    const entries = logs.data.filter(log => log.action === 'UPDATE_PRIVACY_POLICY');
    assert.equal(entries.length, 1);
    assert.deepEqual(entries[0].details, { version: 1 });
});

test('accepting the current version lifts the gate at once and survives a new login', async () => {
    const member = await loginAs('member');
    const stale = await member.send('POST', '/api/user/privacy/accept', { version: 0 });
    assert.equal(stale.status, 409);
    assert.match((await stale.json()).error, /neue Fassung/);

    const res = await member.send('POST', '/api/user/privacy/accept', { version: 1 });
    assert.equal(res.status, 200);
    assert.equal((await me(member)).privacyRequired, false);
    assert.equal((await member.request('/api/events')).status, 200);

    assert.equal((await member.send('POST', '/auth/logout')).status, 200);
    const again = await loginAs('member');
    assert.equal((await me(again)).privacyRequired, false);
    assert.equal((await again.request('/api/events')).status, 200);
});

test('a new version gates every member again until they accept it', async () => {
    const member = await loginAs('member');
    assert.equal((await member.request('/api/events')).status, 200);

    const admin = await loginAs('admin');
    await admin.send('POST', '/api/user/privacy/accept', { version: 1 });
    const second = await savePolicy(admin, '# Datenschutz\n\nZweite Fassung');
    assert.equal((await second.json()).version, 2);

    // The open session of the member is gated as well
    assert.equal((await me(member)).privacyRequired, true);
    assert.deepEqual(await (await member.request('/api/events')).json(), GATE);
    const stale = await member.send('POST', '/api/user/privacy/accept', { version: 1 });
    assert.equal(stale.status, 409);
    assert.equal((await member.send('POST', '/api/user/privacy/accept', { version: 2 })).status, 200);
    assert.equal((await member.request('/api/events')).status, 200);
});

test('an empty text removes the policy and with it the gate', async () => {
    const admin = await loginAs('admin');
    await admin.send('POST', '/api/user/privacy/accept', { version: 2 });
    const removed = await savePolicy(admin, '');
    assert.deepEqual(await removed.json(), { success: true, version: 0, changed: true });
    assert.equal((await createClient(server.baseUrl).request('/api/privacy')).status, 404);

    const newbie = await loginAs('newbie');
    assert.equal((await me(newbie)).privacyRequired, false);
    assert.equal((await newbie.request('/api/events')).status, 200);
    assert.equal((await newbie.send('POST', '/api/user/privacy/accept', { version: 2 })).status, 409);
});
