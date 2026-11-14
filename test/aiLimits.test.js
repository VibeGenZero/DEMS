const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir } = require('./helpers');

const tmpDir = createTempDir('ai-limits');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'ai-limits.sqlite');
process.env.TIMEZONE = 'Europe/Berlin';

const { db, collection, getDocs, doc, deleteDoc } = require('../firebaseAdmin');
const settings = require('../ai/settings');
const usage = require('../ai/usage');
const limits = require('../ai/limits');

const T0 = new Date('2026-06-10T10:00:00Z');
const minutes = (n) => new Date(T0.getTime() + n * 60000);

beforeEach(async () => {
    limits.resetLimits();
    const snap = await getDocs(collection(db, 'aiUsage'));
    for (const d of snap.docs) await deleteDoc(doc(db, 'aiUsage', d.id));
    await deleteDoc(doc(db, 'aiSettings', 'config'));
    await settings.loadAiSettings();
});

async function ask(userId, now) {
    const result = await limits.beginMemberQuestion(userId, now);
    if (result.ok) limits.endMemberQuestion(userId);
    return result;
}

test('the 21st question within the hour is refused, 61 minutes later it is allowed', async () => {
    for (let i = 0; i < 20; i++) assert.deepEqual(await ask('u1', minutes(i)), { ok: true });
    assert.deepEqual(await ask('u1', minutes(30)), { ok: false, reason: 'hourly' });
    assert.deepEqual(await ask('u2', minutes(30)), { ok: true });
    assert.deepEqual(await ask('u1', minutes(61)), { ok: true });
});

test('the hourly limit follows the saved setting', async () => {
    await settings.saveAiSettings({ memberQuestionsPerHour: 2 });
    await ask('u1', minutes(0));
    await ask('u1', minutes(1));
    assert.equal((await ask('u1', minutes(2))).reason, 'hourly');
});

test('a second question before endMemberQuestion is busy', async () => {
    assert.deepEqual(await limits.beginMemberQuestion('u1', T0), { ok: true });
    assert.deepEqual(await limits.beginMemberQuestion('u1', T0), { ok: false, reason: 'busy' });
    limits.endMemberQuestion('u1');
    assert.deepEqual(await limits.beginMemberQuestion('u1', T0), { ok: true });
});

test('the daily limit refuses once reached; 0 never refuses', async () => {
    await settings.saveAiSettings({ dailyQuestionLimit: 2 });
    await usage.recordUsage({ kind: 'member', now: T0 });
    await usage.recordUsage({ kind: 'member', now: T0 });
    assert.deepEqual(await ask('u1', T0), { ok: false, reason: 'daily' });
    await settings.saveAiSettings({ dailyQuestionLimit: 0 });
    assert.deepEqual(await ask('u1', T0), { ok: true });
});

test('a refused question does not count against the hour or keep the member busy', async () => {
    await settings.saveAiSettings({ dailyQuestionLimit: 1, memberQuestionsPerHour: 1 });
    await usage.recordUsage({ kind: 'member', now: T0 });
    assert.equal((await ask('u1', T0)).reason, 'daily');
    await settings.saveAiSettings({ dailyQuestionLimit: 0 });
    assert.deepEqual(await ask('u1', T0), { ok: true });
});

test('web and Discord share the counter through the user id', async () => {
    await settings.saveAiSettings({ memberQuestionsPerHour: 1 });
    await ask('same-user', minutes(0)); // web
    assert.equal((await ask('same-user', minutes(1))).reason, 'hourly'); // Discord
});

test('admin requests: 60 per sliding hour and admin', () => {
    for (let i = 0; i < 60; i++) assert.equal(limits.allowAdminRequest('a1', minutes(i / 2)), true);
    assert.equal(limits.allowAdminRequest('a1', minutes(31)), false);
    assert.equal(limits.allowAdminRequest('a2', minutes(31)), true);
    assert.equal(limits.allowAdminRequest('a1', minutes(61)), true);
});

test('the refusal texts are German sentences', () => {
    assert.deepEqual(Object.keys(limits.MEMBER_REFUSALS).sort(), ['busy', 'daily', 'hourly']);
    assert.equal(limits.MEMBER_REFUSALS.busy, 'Bitte warte, bis deine letzte Frage beantwortet ist.');
});
