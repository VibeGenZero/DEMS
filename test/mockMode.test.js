const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const { repoPath, runNode, parseLastLine } = require('./helpers');
const { GUILD, ROLE_ID, CHANNEL_ID } = require('../dev/mockGuild');

// Prints IS_MOCK_MODE and the variables mockMode.js is responsible for
const PRINT_ENV = `
    const { IS_MOCK_MODE } = require(${repoPath('dev/mockMode')});
    const keys = ['SQLITE_PATH', 'DATABASE_URL', 'PGHOST', 'PGPASSWORD_FILE', 'DISCORD_BOT_TOKEN',
        'DISCORD_GUILD_ID', 'DISCORD_ADMIN_ROLE_ID', 'DISCORD_ANNOUNCE_CHANNEL_ID',
        'DISCORD_EVENT_CATEGORY_ID', 'BASE_URL', 'SESSION_SECRET', 'ADMIN_RESET_PASSWORD', 'UPLOAD_DIR'];
    console.log(JSON.stringify({ IS_MOCK_MODE, env: Object.fromEntries(keys.map(k => [k, process.env[k]])) }));
`;

test('refuses to load in production', () => {
    const result = runNode(`require(${repoPath('dev/mockMode')})`, { DEV_MOCK: 'true', NODE_ENV: 'production' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /DEV_MOCK=true ist in Produktion \(NODE_ENV=production\) nicht erlaubt/);
});

test('forces the mock environment and ignores real credentials', () => {
    const result = runNode(PRINT_ENV, {
        DEV_MOCK: 'true',
        PORT: '4321',
        DATABASE_URL: 'postgres://real@db/dems',
        PGHOST: 'db',
        PGPASSWORD_FILE: '/run/secret',
        DISCORD_BOT_TOKEN: 'real-token',
        DISCORD_GUILD_ID: '999',
        DISCORD_EVENT_CATEGORY_ID: '888'
    });
    assert.equal(result.status, 0, result.stderr);

    const { IS_MOCK_MODE, env } = parseLastLine(result.stdout);
    assert.equal(IS_MOCK_MODE, true);
    assert.ok(path.isAbsolute(env.SQLITE_PATH));
    assert.ok(env.SQLITE_PATH.endsWith(path.join('data', 'dems.dev.sqlite')));
    assert.ok(path.isAbsolute(env.UPLOAD_DIR));
    assert.ok(env.UPLOAD_DIR.endsWith(path.join('data', 'dev-uploads')), env.UPLOAD_DIR);
    assert.equal(env.DATABASE_URL, '');
    assert.equal(env.PGHOST, '');
    assert.equal(env.PGPASSWORD_FILE, '');
    assert.equal(env.DISCORD_BOT_TOKEN, '');
    assert.equal(env.DISCORD_GUILD_ID, GUILD.id);
    assert.equal(env.DISCORD_ADMIN_ROLE_ID, ROLE_ID.ADMIN);
    assert.equal(env.DISCORD_ANNOUNCE_CHANNEL_ID, CHANNEL_ID.ANNOUNCEMENTS);
    assert.equal(env.DISCORD_EVENT_CATEGORY_ID, '');
    assert.equal(env.BASE_URL, 'http://localhost:4321');
    assert.equal(env.SESSION_SECRET, 'dems-dev-mock-secret');
    assert.equal(env.ADMIN_RESET_PASSWORD, 'dev');
});

test('keeps an own session secret, reset password, dev database path and upload folder', () => {
    const customDb = path.join(os.tmpdir(), 'dems-custom-dev.sqlite');
    const customUploads = path.join(os.tmpdir(), 'dems-custom-uploads');
    const result = runNode(PRINT_ENV, {
        DEV_MOCK: 'true',
        DEV_SQLITE_PATH: customDb,
        DEV_UPLOAD_DIR: customUploads,
        SESSION_SECRET: 'my-secret',
        ADMIN_RESET_PASSWORD: 'my-password'
    });
    assert.equal(result.status, 0, result.stderr);

    const { env } = parseLastLine(result.stdout);
    assert.equal(env.SQLITE_PATH, customDb);
    assert.equal(env.UPLOAD_DIR, customUploads);
    assert.equal(env.SESSION_SECRET, 'my-secret');
    assert.equal(env.ADMIN_RESET_PASSWORD, 'my-password');
});

test('changes nothing without DEV_MOCK', () => {
    const result = runNode(PRINT_ENV, { DATABASE_URL: 'postgres://real@db/dems', DISCORD_GUILD_ID: '999' });
    assert.equal(result.status, 0, result.stderr);

    const { IS_MOCK_MODE, env } = parseLastLine(result.stdout);
    assert.equal(IS_MOCK_MODE, false);
    assert.equal(env.DATABASE_URL, 'postgres://real@db/dems');
    assert.equal(env.DISCORD_GUILD_ID, '999');
    assert.equal(env.SQLITE_PATH, undefined);
    assert.equal(env.UPLOAD_DIR, undefined);
});

test('mock mode uses SQLite even with DATABASE_URL set', () => {
    const result = runNode(`require(${repoPath('dev/mockMode')}); console.log(JSON.stringify(require(${repoPath('firebaseAdmin')}).storeName))`, {
        DEV_MOCK: 'true',
        DEV_SQLITE_PATH: path.join(os.tmpdir(), `dems-mock-store-${process.pid}.sqlite`),
        DATABASE_URL: 'postgres://x@127.0.0.1:1/x'
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(parseLastLine(result.stdout), 'sqlite');
});

test('dev/start.js refuses to start in production', () => {
    const result = runNode(`require(${repoPath('dev/start.js')})`, { NODE_ENV: 'production' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /DEV_MOCK=true ist in Produktion \(NODE_ENV=production\) nicht erlaubt/);
});

test('mock mode switches the mock AI provider on unless already set', () => {
    const print = `require(${repoPath('dev/mockMode')}); console.log(JSON.stringify([process.env.AI_PROVIDER, process.env.AI_MODEL]))`;
    const fresh = runNode(print, { DEV_MOCK: 'true', AI_PROVIDER: '', AI_MODEL: '' });
    assert.equal(fresh.status, 0, fresh.stderr);
    assert.deepEqual(parseLastLine(fresh.stdout), ['mock', 'mock-1']);
    const set = runNode(print, { DEV_MOCK: 'true', AI_PROVIDER: 'ollama', AI_MODEL: 'llama' });
    assert.deepEqual(parseLastLine(set.stdout), ['ollama', 'llama']);
});
