const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir } = require('./helpers');

const tmpDir = createTempDir('ai-usage');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'ai-usage.sqlite');
process.env.TIMEZONE = 'Europe/Berlin';

const { db, collection, getDocs, doc, setDoc, deleteDoc } = require('../firebaseAdmin');
const usage = require('../ai/usage');

const ids = async () => (await getDocs(collection(db, 'aiUsage'))).docs.map(d => d.id).sort();

beforeEach(async () => {
    const snap = await getDocs(collection(db, 'aiUsage'));
    for (const d of snap.docs) await deleteDoc(doc(db, 'aiUsage', d.id));
});

test('two records on one day add up', async () => {
    const now = new Date('2026-06-10T10:00:00Z');
    await usage.recordUsage({ kind: 'member', usage: { inputTokens: 10, outputTokens: 5 }, now });
    await usage.recordUsage({ kind: 'admin', usage: { inputTokens: 1, outputTokens: 2 }, failed: true, now });
    await usage.recordUsage({ kind: 'member', now });
    assert.deepEqual(await usage.readUsage(30, now), [{
        date: '2026-06-10', memberQuestions: 2, adminRequests: 1, inputTokens: 11, outputTokens: 7, errors: 1
    }]);
    assert.equal(await usage.questionsToday(now), 2);
});

test('concurrent records are not lost', async () => {
    const now = new Date('2026-06-10T10:00:00Z');
    await Promise.all(Array.from({ length: 10 }, () => usage.recordUsage({ kind: 'member', now })));
    assert.equal(await usage.questionsToday(now), 10);
});

test('a record after local midnight opens a new document', async () => {
    // 21:59Z = 23:59 in Berlin (summer), 22:01Z = 00:01 the next day
    await usage.recordUsage({ kind: 'member', now: new Date('2026-06-10T21:59:00Z') });
    await usage.recordUsage({ kind: 'member', now: new Date('2026-06-10T22:01:00Z') });
    assert.deepEqual(await ids(), ['2026-06-10', '2026-06-11']);
    const rows = await usage.readUsage(30, new Date('2026-06-10T22:01:00Z'));
    assert.deepEqual(rows.map(r => r.date), ['2026-06-11', '2026-06-10']);
});

test('readUsage limits the window and omits missing days', async () => {
    const now = new Date('2026-06-10T10:00:00Z');
    await usage.recordUsage({ kind: 'member', now: new Date('2026-06-10T10:00:00Z') });
    await usage.recordUsage({ kind: 'member', now: new Date('2026-06-07T10:00:00Z') });
    await usage.recordUsage({ kind: 'member', now: new Date('2026-05-01T10:00:00Z') });
    assert.deepEqual((await usage.readUsage(7, now)).map(r => r.date), ['2026-06-10', '2026-06-07']);
    assert.equal(await usage.questionsToday(new Date('2026-06-09T10:00:00Z')), 0);
});

test('pruneUsage removes day 91 and keeps day 90', async () => {
    const now = new Date('2026-06-10T10:00:00Z');
    await setDoc(doc(db, 'aiUsage', '2026-03-12'), { memberQuestions: 1 }); // 90 days back
    await setDoc(doc(db, 'aiUsage', '2026-03-11'), { memberQuestions: 1 }); // 91 days back
    await usage.recordUsage({ kind: 'member', now });
    await usage.pruneUsage(now);
    assert.deepEqual(await ids(), ['2026-03-12', '2026-06-10']);
});
