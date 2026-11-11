const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir, startServer, createClient } = require('./helpers');

// #138: the admin "System" view (GET/PUT /api/admin/system/settings) in dev
// mock mode with its own server, so changed values never reach other suites.
// Mock mode forces guild, admin role, announcement channel, BASE_URL, thread
// sync and the reset password "dev" -> those keys count as set by .env.
let server;
before(async () => {
    server = await startServer('dev/start.js', { DEV_SQLITE_PATH: path.join(createTempDir('system-settings'), 'dev.sqlite') });
});
after(() => server.stop());

async function loginAs(personaId) {
    const client = createClient(server.baseUrl);
    assert.equal((await client.request(`/auth/dev-login/${personaId}`)).status, 302);
    return client;
}

const settingsOf = async (client) => (await (await client.request('/api/admin/system/settings')).json()).settings;
const byKey = (settings) => Object.fromEntries(settings.map(entry => [entry.key, entry]));

test('admins read every setting with its source; secrets only as set or not set', async () => {
    const admin = await loginAs('admin');
    const res = await admin.request('/api/admin/system/settings');
    assert.equal(res.status, 200);
    const settings = byKey((await res.json()).settings);

    assert.equal(settings.DISCORD_GUILD_ID.source, 'env');
    assert.equal(settings.DISCORD_GUILD_ID.locked, true);
    assert.equal(settings.ADMIN_RESET_PASSWORD.value, null);
    assert.equal(settings.ADMIN_RESET_PASSWORD.isSet, true);
    assert.equal(settings.DISCORD_CLIENT_SECRET.isSet, false);
    assert.equal(settings.DISCORD_THREAD_SYNC.applies, 'restart');
    assert.equal(settings.TIMEZONE.locked, false);
    const text = JSON.stringify(settings);
    assert.equal(text.includes('"dev"'), false);
    assert.equal(text.includes('SESSION_SECRET'), false);
});

test('members without admin rights get 403', async () => {
    const member = await loginAs('member');
    assert.equal((await member.request('/api/admin/system/settings')).status, 403);
    assert.equal((await member.send('PUT', '/api/admin/system/settings', { password: 'dev', values: { SERVER_NAME: 'x' } })).status, 403);
    assert.equal((await member.request('/api/admin/system/invite-url')).status, 403);
});

test('saving needs the reset password', async () => {
    const admin = await loginAs('admin');
    const res = await admin.send('PUT', '/api/admin/system/settings', { password: 'falsch', values: { SERVER_NAME: 'Neu' } });
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: 'Ungültiges Admin-Reset-Passwort.' });
    assert.equal(byKey(await settingsOf(admin)).SERVER_NAME.value, '');
});

test('locked, unknown and invalid values are refused and nothing changes', async () => {
    const admin = await loginAs('admin');
    for (const [values, pattern] of [
        [{ DISCORD_GUILD_ID: '100000000000000999' }, /DISCORD_GUILD_ID.*\.env/],
        [{ PGHOST: 'db' }, /PGHOST/],
        [{ SERVER_NAME: 'Ok', TIMEZONE: 'Mars/Olympus' }, /Zeitzone/],
        [{ DISCORD_EVENT_CATEGORY_ID: 'abc' }, /Kategorie/]
    ]) {
        const res = await admin.send('PUT', '/api/admin/system/settings', { password: 'dev', values });
        assert.equal(res.status, 400, JSON.stringify(values));
        assert.match((await res.json()).error, pattern);
    }
    assert.equal(byKey(await settingsOf(admin)).SERVER_NAME.value, '');
});

test('a valid change is stored, in effect at once and in the audit log without secrets', async () => {
    const admin = await loginAs('admin');
    const res = await admin.send('PUT', '/api/admin/system/settings', {
        password: 'dev',
        values: { SERVER_NAME: 'Testgilde', DISCORD_CLIENT_SECRET: 'super-geheim', DISCORD_CLIENT_ID: '' }
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.deepEqual(body.changed.sort(), ['DISCORD_CLIENT_SECRET', 'SERVER_NAME']);
    assert.equal(body.restartRequired, false);

    const settings = byKey(await settingsOf(admin));
    assert.equal(settings.SERVER_NAME.value, 'Testgilde');
    assert.equal(settings.SERVER_NAME.source, 'db');
    assert.equal(settings.DISCORD_CLIENT_SECRET.isSet, true);
    assert.equal((await (await admin.request('/api/server-info')).json()).serverName, 'Testgilde');

    const logs = await (await admin.request('/api/admin/audit-log?limit=500')).json();
    const entry = logs.data.find(log => log.action === 'UPDATE_SYSTEM_SETTINGS');
    assert.ok(entry, 'audit entry');
    assert.deepEqual([...entry.details.keys].sort(), ['DISCORD_CLIENT_SECRET', 'SERVER_NAME']);
    assert.equal(JSON.stringify(entry).includes('super-geheim'), false);
});

test('an empty secret field keeps the stored secret', async () => {
    const admin = await loginAs('admin');
    await admin.send('PUT', '/api/admin/system/settings', { password: 'dev', values: { DISCORD_CLIENT_SECRET: 'erstes-secret' } });
    const res = await admin.send('PUT', '/api/admin/system/settings', { password: 'dev', values: { DISCORD_CLIENT_SECRET: '' } });
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).changed, []);
    assert.equal(byKey(await settingsOf(admin)).DISCORD_CLIENT_SECRET.isSet, true);
});

test('a new bot token logs the bot in again without a restart', async () => {
    const admin = await loginAs('admin');
    const res = await admin.send('PUT', '/api/admin/system/settings', { password: 'dev', values: { DISCORD_BOT_TOKEN: 'neuer-token' } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.changed, ['DISCORD_BOT_TOKEN']);
    assert.deepEqual(body.bot, { ok: true, guildName: 'DEMS Dev Server' });
    await server.waitForOutput('Bot simuliert neu angemeldet');
});

test('the invite link of the current client id is offered to admins', async () => {
    const admin = await loginAs('admin');
    await admin.send('PUT', '/api/admin/system/settings', { password: 'dev', values: { DISCORD_CLIENT_ID: '123456789012345678' } });
    const res = await admin.request('/api/admin/system/invite-url');
    assert.equal(res.status, 200);
    assert.match((await res.json()).url, /client_id=123456789012345678&permissions=\d+&scope=bot%20applications\.commands/);
});

test('admins read the update status, members do not', async () => {
    const admin = await loginAs('admin');
    const res = await admin.request('/api/admin/system/update-status');
    assert.equal(res.status, 200);
    const status = await res.json();
    // Dev mock mode never asks GitHub
    assert.equal(status.enabled, false);
    assert.equal(status.reason, 'mock');
    assert.equal(status.current, require('../package.json').version);
    assert.equal(status.updateAvailable, false);

    const member = await loginAs('member');
    assert.equal((await member.request('/api/admin/system/update-status')).status, 403);
});
