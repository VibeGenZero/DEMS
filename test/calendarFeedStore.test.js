const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir } = require('./helpers');

// Own SQLite database in mock mode; the empty cwd keeps a local .env out
const tmpDir = createTempDir('calendar-feed-store');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'feeds.sqlite');

const { getFeedOf, saveNewFeed, deleteFeed, findFeedByToken } = require('../utils/calendarFeedStore');
const { db, doc, getDoc } = require('../firebaseAdmin');

test('a member has no feed until one is saved', async () => {
    assert.equal(await getFeedOf('u-none'), null);
});

test('saving creates the feed, and the token finds it', async () => {
    const feed = await saveNewFeed('u1', new Date('2026-11-20T12:00:00.000Z'));
    assert.match(feed.token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(feed.userId, 'u1');
    assert.equal(feed.createdAt, '2026-11-20T12:00:00.000Z');
    assert.deepEqual(await getFeedOf('u1'), feed);
    assert.deepEqual(await findFeedByToken(feed.token), feed);
    const stored = (await getDoc(doc(db, 'calendarFeeds', 'u1'))).data();
    assert.deepEqual(stored, feed);
});

test('saving again replaces the token, and the old one finds nothing', async () => {
    const first = await saveNewFeed('u2');
    const second = await saveNewFeed('u2');
    assert.notEqual(first.token, second.token);
    assert.equal(await findFeedByToken(first.token), null);
    assert.deepEqual(await findFeedByToken(second.token), second);
});

test('deleting ends the feed', async () => {
    const feed = await saveNewFeed('u3');
    await deleteFeed('u3');
    assert.equal(await getFeedOf('u3'), null);
    assert.equal(await findFeedByToken(feed.token), null);
    // Deleting twice does no harm
    await deleteFeed('u3');
});

test('a malformed token never reaches the database', async () => {
    assert.equal(await findFeedByToken('kurz'), null);
    assert.equal(await findFeedByToken(undefined), null);
});

test('each member has their own feed', async () => {
    const a = await saveNewFeed('u4');
    const b = await saveNewFeed('u5');
    assert.notEqual(a.token, b.token);
    assert.equal((await findFeedByToken(a.token)).userId, 'u4');
    assert.equal((await findFeedByToken(b.token)).userId, 'u5');
});
