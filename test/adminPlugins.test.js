// Admin API of the plugins (routes/adminPlugins.js), account deletion and the
// system reset through the real server (dev mock mode, fixture plugins).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { PLUGIN, IDLE_PLUGIN, OFFICIAL_PLUGIN, startPluginServer, loginAt } = require('./pluginTestServer');
const { PERSONAS } = require('../dev/mockGuild');

const TRUST_SENTENCE = 'Bitte bestätige, dass du dem Code dieses Plugins vertraust.';
const PASSWORD_SENTENCE = 'Ungültiges Admin-Reset-Passwort.';

let server;

before(async () => {
    server = await startPluginServer();
});

after(() => server.stop());

const loginAs = (personaId) => loginAt(server.baseUrl, personaId);
const memberId = () => PERSONAS.find(persona => persona.id === 'member').userId;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function auditEntries(admin, action) {
    const res = await admin.request('/api/admin/audit-log?limit=500');
    assert.equal(res.status, 200);
    return (await res.json()).data.filter(entry => entry.action === action);
}

/** Admin read of a hook-recorder collection route (`/owned`, `/log`). */
async function pluginList(admin, route) {
    const res = await admin.request(`/api/plugins/${PLUGIN}${route}`);
    assert.equal(res.status, 200);
    return res.json();
}

/** A document of hook-recorder owned by the persona. */
async function addOwned(personaId) {
    const client = await loginAs(personaId);
    const res = await client.send('POST', `/api/plugins/${PLUGIN}/owned`, {});
    assert.equal(res.status, 200);
    return res.json();
}

test('a member gets 403 on every admin plugin route', async () => {
    const member = await loginAs('member');
    assert.equal((await member.request('/api/admin/plugins')).status, 403);
    assert.equal((await member.send('PUT', `/api/admin/plugins/${IDLE_PLUGIN}/enabled`, { enabled: true, trust: true, password: 'dev' })).status, 403);
    assert.equal((await member.send('PUT', `/api/admin/plugins/${PLUGIN}/settings`, { values: {} })).status, 403);
    assert.equal((await member.send('DELETE', `/api/admin/plugins/${IDLE_PLUGIN}/data`)).status, 403);
});

test('the admin list shows every plugin with its status and public setting values', async () => {
    const admin = await loginAs('admin');
    const res = await admin.request('/api/admin/plugins');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.safeMode, false);
    assert.deepEqual(body.plugins.map(plugin => [plugin.id, plugin.status, plugin.official]), [
        // Dev mock mode switches the official plugins on
        [OFFICIAL_PLUGIN, 'on', true],
        [PLUGIN, 'on', false],
        [IDLE_PLUGIN, 'off', false]
    ]);
    assert.deepEqual(body.plugins.find(plugin => plugin.id === PLUGIN).settingsValues, {});
});

test('a bad switch request answers 400, an unknown plugin 404', async () => {
    const admin = await loginAs('admin');
    const bad = await admin.send('PUT', `/api/admin/plugins/${IDLE_PLUGIN}/enabled`, { enabled: 'ja' });
    assert.equal(bad.status, 400);
    assert.deepEqual(await bad.json(), { error: 'Ungültige Eingabe.' });

    const unknown = await admin.send('PUT', '/api/admin/plugins/no-such-plugin/enabled', { enabled: false });
    assert.equal(unknown.status, 404);
    assert.deepEqual(await unknown.json(), { error: 'Plugin nicht gefunden.' });
});

test('switching on a custom plugin needs trust and the reset password, and is audited', async () => {
    const admin = await loginAs('admin');
    const route = `/api/admin/plugins/${IDLE_PLUGIN}/enabled`;

    const untrusted = await admin.send('PUT', route, { enabled: true, password: 'dev' });
    assert.equal(untrusted.status, 400);
    assert.deepEqual(await untrusted.json(), { error: TRUST_SENTENCE });

    for (const password of ['falsch', undefined, '']) {
        const wrong = await admin.send('PUT', route, { enabled: true, trust: true, password });
        assert.equal(wrong.status, 401);
        assert.deepEqual(await wrong.json(), { error: PASSWORD_SENTENCE });
    }
    assert.equal((await admin.request(`/api/plugins/${IDLE_PLUGIN}/me`)).status, 404);

    const res = await admin.send('PUT', route, { enabled: true, trust: true, password: 'dev' });
    assert.equal(res.status, 200);
    const { plugin } = await res.json();
    assert.equal(plugin.id, IDLE_PLUGIN);
    assert.equal(plugin.status, 'on');
    assert.equal((await admin.request(`/api/plugins/${IDLE_PLUGIN}/me`)).status, 200);

    const [entry] = await auditEntries(admin, 'PLUGIN_ENABLE');
    assert.equal(entry.details, 'Plugin „Hook-Rekorder“ eingeschaltet');
    assert.equal(entry.targetId, IDLE_PLUGIN);
});

test('plugin data can be deleted only while the plugin is off', async () => {
    const admin = await loginAs('admin');
    const member = await loginAs('member');
    assert.equal((await member.send('POST', `/api/plugins/${IDLE_PLUGIN}/owned`, {})).status, 200);

    const refused = await admin.send('DELETE', `/api/admin/plugins/${IDLE_PLUGIN}/data`);
    assert.equal(refused.status, 409);
    assert.deepEqual(await refused.json(), { error: 'Schalte das Plugin zuerst aus.' });

    // Switching off needs neither trust nor the password
    const off = await admin.send('PUT', `/api/admin/plugins/${IDLE_PLUGIN}/enabled`, { enabled: false });
    assert.equal(off.status, 200);
    assert.equal((await off.json()).plugin.status, 'off');
    const [disabled] = await auditEntries(admin, 'PLUGIN_DISABLE');
    assert.equal(disabled.details, 'Plugin „Hook-Rekorder“ ausgeschaltet');
    assert.equal(disabled.targetId, IDLE_PLUGIN);

    const res = await admin.send('DELETE', `/api/admin/plugins/${IDLE_PLUGIN}/data`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { deleted: 1 });
    const [deletedEntry] = await auditEntries(admin, 'PLUGIN_DELETE_DATA');
    assert.equal(deletedEntry.details, 'Daten von Plugin „Hook-Rekorder“ gelöscht');
    assert.equal(deletedEntry.targetId, IDLE_PLUGIN);

    // Switched on again (same version and permissions: no new confirmation), its collection is empty
    const again = await admin.send('PUT', `/api/admin/plugins/${IDLE_PLUGIN}/enabled`, { enabled: true, trust: true, password: 'dev' });
    assert.equal(again.status, 200);
    const owned = await admin.request(`/api/plugins/${IDLE_PLUGIN}/owned`);
    assert.deepEqual(await owned.json(), []);
    assert.equal((await admin.send('PUT', `/api/admin/plugins/${IDLE_PLUGIN}/enabled`, { enabled: false })).status, 200);
});

test('account deletion removes the member documents of plugins and emits member.deleted', async () => {
    const admin = await loginAs('admin');
    await addOwned('member');
    const adminDoc = await addOwned('admin');

    const member = await loginAs('member');
    const res = await member.send('DELETE', '/api/user/account');
    assert.equal(res.status, 200);

    const owned = await pluginList(admin, '/owned');
    assert.deepEqual(owned.map(item => item.id), [adminDoc.id]);
    assert.equal(owned.some(item => item.userId === memberId()), false);

    // Hooks run asynchronously
    let deleted = [];
    for (let tries = 0; tries < 40 && deleted.length === 0; tries += 1) {
        deleted = (await pluginList(admin, '/log')).filter(entry => entry.hook === 'member.deleted');
        if (deleted.length === 0) await sleep(50);
    }
    assert.equal(deleted.length, 1);
    assert.deepEqual(deleted[0].payload, { userId: memberId() });
});

test('a reset of other targets keeps the plugin data', async () => {
    const admin = await loginAs('admin');
    await addOwned('member');
    const before = await pluginList(admin, '/owned');
    assert.ok(before.length > 0);

    const res = await admin.send('DELETE', '/api/admin/reset', { password: 'dev', targets: ['comments'] });
    assert.equal(res.status, 200);
    assert.deepEqual(await pluginList(admin, '/owned'), before);
});

for (const target of ['pluginData', 'users']) {
    test(`a reset with ${target} wipes the plugin data and keeps the plugin on`, async () => {
        await addOwned('member');
        const admin = await loginAs('admin');
        assert.ok((await pluginList(admin, '/owned')).length > 0);

        const res = await admin.send('DELETE', '/api/admin/reset', { password: 'dev', targets: [target] });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.ok(body.count > 0);

        assert.deepEqual(await pluginList(admin, '/owned'), []);
        assert.deepEqual(await pluginList(admin, '/log'), []);
        const list = await (await admin.request('/api/admin/plugins')).json();
        assert.equal(list.plugins.find(plugin => plugin.id === PLUGIN).status, 'on');
    });
}
