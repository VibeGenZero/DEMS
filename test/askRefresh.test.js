const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir } = require('./helpers');

// The settings routes start the Discord refresh of /ask and „Frage stellen“
// only when the feature flipped, and never wait for it (utils/askRefresh.js).
const tmpDir = createTempDir('ask-refresh');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'ask-refresh.sqlite');

require('../dev/mockMode');
const { db, doc, deleteDoc } = require('../firebaseAdmin');
const settings = require('../ai/settings');
const { refreshAskIfSwitched } = require('../utils/askRefresh');

/** A bot double whose refresh answers with `result()` and counts the calls. */
function fakeBot(result = () => Promise.resolve(true)) {
    const bot = { calls: 0, refreshAskFeature: () => { bot.calls++; return result(); } };
    return bot;
}

let errors;
let originalError;
beforeEach(async () => {
    await deleteDoc(doc(db, 'aiSettings', 'config'));
    await settings.loadAiSettings();
    errors = [];
    originalError = console.error;
    console.error = (...args) => errors.push(args.map(String).join(' '));
});
afterEach(() => {
    console.error = originalError;
});

const settle = () => new Promise(resolve => setImmediate(resolve));

test('no refresh while the feature stays as it was', async () => {
    const bot = fakeBot();
    assert.equal(settings.isFeatureOn('memberDiscord'), true);
    assert.equal(refreshAskIfSwitched(true, { bot }), false);
    await settings.saveAiSettings({ assistantName: 'Gildenhelfer', memberQuestionsPerHour: 3 });
    assert.equal(refreshAskIfSwitched(true, { bot }), false);
    await settle();
    assert.equal(bot.calls, 0);
});

test('a flip starts exactly one refresh, in both directions', async () => {
    const bot = fakeBot();
    await settings.saveAiSettings({ memberDiscord: false });
    assert.equal(refreshAskIfSwitched(true, { bot }), true);
    await settle();
    assert.equal(bot.calls, 1);

    await settings.saveAiSettings({ memberDiscord: true });
    assert.equal(refreshAskIfSwitched(false, { bot }), true);
    await settle();
    assert.equal(bot.calls, 2);
});

test('a refresh that never settles does not hold the caller', async () => {
    const bot = fakeBot(() => new Promise(() => {}));
    await settings.saveAiSettings({ memberDiscord: false });
    const started = Date.now();
    // Synchronous: the route answers right after it
    assert.equal(refreshAskIfSwitched(true, { bot }), true);
    assert.ok(Date.now() - started < 50);
    await settle();
    assert.equal(bot.calls, 1);
});

test('a rejecting or throwing refresh is logged with its code only and never escapes', async () => {
    const rejecting = fakeBot(() => Promise.reject(Object.assign(new Error('Discord sagt geheim'), { code: 50013 })));
    const throwing = fakeBot(() => { throw new TypeError('kaputt'); });
    await settings.saveAiSettings({ memberDiscord: false });
    assert.equal(refreshAskIfSwitched(true, { bot: rejecting }), true);
    assert.equal(refreshAskIfSwitched(true, { bot: throwing }), true);
    await settle();
    // A throw settles one microtask earlier than a rejection: the order is not part of the contract
    assert.deepEqual(errors.sort(), ['Discord refresh of the event assistant failed: 50013', 'Discord refresh of the event assistant failed: TypeError']);
});
