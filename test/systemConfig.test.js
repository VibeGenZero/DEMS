const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir } = require('./helpers');

// Own, empty SQLite database; the empty cwd keeps a local .env out
const tmpDir = createTempDir('system-config');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.SQLITE_PATH = path.join(tmpDir, 'system-config.sqlite');

const { db, doc, getDoc, setDoc, deleteDoc } = require('../firebaseAdmin');
const config = require('../utils/systemConfig');

const stored = async () => {
    const snap = await getDoc(doc(db, 'systemSettings', 'config'));
    return snap.exists() ? snap.data() : null;
};

beforeEach(async () => {
    await deleteDoc(doc(db, 'systemSettings', 'config'));
    config.forgetSystemConfig();
});

test('the managed keys are the database-backed configuration, nothing else', () => {
    assert.deepEqual(Object.keys(config.MANAGED_KEYS).sort(), [
        'ADMIN_RESET_PASSWORD', 'BASE_URL', 'DISCORD_ADMIN_ROLE_ID', 'DISCORD_ANNOUNCE_CHANNEL_ID',
        'DISCORD_BOT_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'DISCORD_EVENT_CATEGORY_ID',
        'DISCORD_GUILD_ID', 'DISCORD_THREAD_SYNC', 'SERVER_NAME', 'TIMEZONE'
    ]);
    const secrets = Object.entries(config.MANAGED_KEYS).filter(([, meta]) => meta.secret).map(([key]) => key).sort();
    assert.deepEqual(secrets, ['ADMIN_RESET_PASSWORD', 'DISCORD_BOT_TOKEN', 'DISCORD_CLIENT_SECRET']);
    assert.equal(config.MANAGED_KEYS.DISCORD_THREAD_SYNC.applies, 'restart');
    assert.equal(config.MANAGED_KEYS.DISCORD_BOT_TOKEN.applies, 'bot');
    assert.equal(config.MANAGED_KEYS.DISCORD_GUILD_ID.applies, 'bot');
    assert.equal(config.MANAGED_KEYS.TIMEZONE.applies, 'live');
});

test('a stored value fills an empty environment key, the environment wins and is locked', async () => {
    await setDoc(doc(db, 'systemSettings', 'config'), {
        values: { DISCORD_GUILD_ID: '222', TIMEZONE: 'Europe/Vienna', SESSION_SECRET: 's'.repeat(64) }
    });
    const env = { DISCORD_GUILD_ID: '111', TIMEZONE: '' };

    const result = await config.loadSystemConfig({ env });

    assert.equal(env.DISCORD_GUILD_ID, '111');
    assert.equal(env.TIMEZONE, 'Europe/Vienna');
    assert.equal(config.isLocked('DISCORD_GUILD_ID'), true);
    assert.equal(config.isLocked('TIMEZONE'), false);
    assert.deepEqual(result, { fromEnv: 1, fromDb: 1 });
});

test('a key removed from the environment uses the stored value on the next start', async () => {
    await setDoc(doc(db, 'systemSettings', 'config'), { values: { DISCORD_GUILD_ID: '222', SESSION_SECRET: 'x'.repeat(64) } });
    const env = {};
    await config.loadSystemConfig({ env });
    assert.equal(env.DISCORD_GUILD_ID, '222');
    assert.equal(config.isLocked('DISCORD_GUILD_ID'), false);
});

test('without SESSION_SECRET a secret is generated once, stored and reused', async () => {
    const first = {};
    await config.loadSystemConfig({ env: first });
    assert.match(first.SESSION_SECRET, /^[0-9a-f]{64}$/);
    assert.equal((await stored()).values.SESSION_SECRET, first.SESSION_SECRET);

    config.forgetSystemConfig();
    const second = {};
    await config.loadSystemConfig({ env: second });
    assert.equal(second.SESSION_SECRET, first.SESSION_SECRET);
});

test('a SESSION_SECRET in the environment is neither replaced nor stored', async () => {
    const env = { SESSION_SECRET: 'from-env' };
    await config.loadSystemConfig({ env });
    assert.equal(env.SESSION_SECRET, 'from-env');
    const saved = await stored();
    assert.equal(saved?.values?.SESSION_SECRET, undefined);
});

test('an installation with the three Discord values in the environment counts as set up', async () => {
    await config.loadSystemConfig({ env: { DISCORD_CLIENT_ID: '1', DISCORD_CLIENT_SECRET: '2', DISCORD_GUILD_ID: '3', SESSION_SECRET: 'x' } });
    const doc = await stored();
    assert.equal(doc.setupSource, 'env');
    assert.ok(Date.parse(doc.setupCompletedAt));
    assert.equal(await config.isSetupCompleted(), true);
});

test('an installation without the Discord values is not set up', async () => {
    await config.loadSystemConfig({ env: { DISCORD_CLIENT_ID: '1', SESSION_SECRET: 'x' } });
    assert.equal(await config.isSetupCompleted(), false);
    assert.equal(config.hasRequiredDiscordValues({ DISCORD_CLIENT_ID: '1', DISCORD_CLIENT_SECRET: '2' }), false);
    assert.equal(config.hasRequiredDiscordValues({ DISCORD_CLIENT_ID: '1', DISCORD_CLIENT_SECRET: '2', DISCORD_GUILD_ID: '3' }), true);
});

test('saving stores the value, applies it, and an empty value deletes the key', async () => {
    const env = { SESSION_SECRET: 'x' };
    await config.loadSystemConfig({ env });

    const saved = await config.saveSystemValues({ TIMEZONE: 'Europe/Vienna', DISCORD_BOT_TOKEN: 'abc' }, { by: 'admin-1', env });
    assert.deepEqual(saved.changed.sort(), ['DISCORD_BOT_TOKEN', 'TIMEZONE']);
    assert.deepEqual([...saved.applies].sort(), ['bot', 'live']);
    assert.equal(env.TIMEZONE, 'Europe/Vienna');
    assert.equal((await stored()).values.TIMEZONE, 'Europe/Vienna');
    assert.equal((await stored()).updatedBy, 'admin-1');

    await config.saveSystemValues({ TIMEZONE: '' }, { by: 'admin-1', env });
    assert.equal('TIMEZONE' in env, false);
    assert.equal('TIMEZONE' in (await stored()).values, false);
});

test('saving an unchanged value reports no change', async () => {
    const env = { SESSION_SECRET: 'x' };
    await config.loadSystemConfig({ env });
    await config.saveSystemValues({ SERVER_NAME: 'Gilde' }, { env });
    const again = await config.saveSystemValues({ SERVER_NAME: 'Gilde' }, { env });
    assert.deepEqual(again.changed, []);
});

test('saving refuses unknown, environment-only and locked keys and stores nothing', async () => {
    const env = { SESSION_SECRET: 'x', BASE_URL: 'https://from.env' };
    await config.loadSystemConfig({ env });

    for (const [values, code, key] of [
        [{ PGHOST: 'db' }, 'unknown_key', 'PGHOST'],
        [{ DEBUG_MODE: 'true' }, 'unknown_key', 'DEBUG_MODE'],
        [{ SESSION_SECRET: 'mine' }, 'unknown_key', 'SESSION_SECRET'],
        [{ TIMEZONE: 'UTC', BASE_URL: 'https://other' }, 'locked_key', 'BASE_URL']
    ]) {
        await assert.rejects(config.saveSystemValues(values, { env }), (err) => {
            assert.equal(err.code, code);
            assert.equal(err.key, key);
            return true;
        });
    }
    assert.equal(env.TIMEZONE, undefined);
    assert.equal(env.BASE_URL, 'https://from.env');
});

test('the settings list masks secrets and names the source of each key', async () => {
    await setDoc(doc(db, 'systemSettings', 'config'), {
        values: { DISCORD_BOT_TOKEN: 'secret-token', SERVER_NAME: 'Gilde', SESSION_SECRET: 'y'.repeat(64) }
    });
    const env = { BASE_URL: 'https://from.env', ADMIN_RESET_PASSWORD: 'env-password' };
    await config.loadSystemConfig({ env });

    const list = config.listSystemSettings({ env });
    const byKey = Object.fromEntries(list.map(entry => [entry.key, entry]));

    assert.equal(list.length, Object.keys(config.MANAGED_KEYS).length);
    assert.deepEqual(byKey.DISCORD_BOT_TOKEN, { key: 'DISCORD_BOT_TOKEN', group: 'discord', secret: true, value: null, isSet: true, source: 'db', locked: false, applies: 'bot' });
    assert.deepEqual(byKey.ADMIN_RESET_PASSWORD, { key: 'ADMIN_RESET_PASSWORD', group: 'security', secret: true, value: null, isSet: true, source: 'env', locked: true, applies: 'live' });
    assert.equal(byKey.DISCORD_CLIENT_SECRET.isSet, false);
    assert.equal(byKey.DISCORD_CLIENT_SECRET.source, 'none');
    assert.equal(byKey.SERVER_NAME.value, 'Gilde');
    assert.equal(byKey.BASE_URL.value, 'https://from.env');
    assert.equal(byKey.BASE_URL.locked, true);
    const text = JSON.stringify(list);
    for (const secret of ['secret-token', 'env-password', 'y'.repeat(64)]) assert.equal(text.includes(secret), false);
    assert.equal(text.includes('SESSION_SECRET'), false);
});

test('completing the setup stores its time and source', async () => {
    await config.loadSystemConfig({ env: { SESSION_SECRET: 'x' } });
    await config.markSetupCompleted('wizard', 'admin-1');
    const doc = await stored();
    assert.equal(doc.setupSource, 'wizard');
    assert.ok(Date.parse(doc.setupCompletedAt));
    assert.equal(await config.isSetupCompleted(), true);
});
