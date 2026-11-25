const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createUploadStore } = require('../routes/pluginUploadStore');

const bytes = text => Buffer.from(text);

test('an upload is taken once, by its own session only', () => {
    const store = createUploadStore();
    const id = store.put('s1', bytes('a'));
    assert.match(id, /^[0-9a-f]{32}$/);
    assert.equal(store.take('s2', id), null);
    assert.deepEqual(store.take('s1', id), bytes('a'));
    assert.equal(store.take('s1', id), null);
});

test('an upload expires after ttlMs', () => {
    let now = 1000;
    const store = createUploadStore({ ttlMs: 500, now: () => now });
    const kept = store.put('s1', bytes('a'));
    const expired = store.put('s1', bytes('b'));
    now += 499;
    assert.deepEqual(store.take('s1', kept), bytes('a'));
    now += 1;
    assert.equal(store.take('s1', expired), null);
});

test('a fourth put drops the oldest upload of that session', () => {
    const store = createUploadStore();
    const ids = ['a', 'b', 'c', 'd'].map(text => store.put('s1', bytes(text)));
    const other = store.put('s2', bytes('x'));
    assert.equal(store.take('s1', ids[0]), null);
    assert.deepEqual(ids.slice(1).map(id => store.take('s1', id)), [bytes('b'), bytes('c'), bytes('d')]);
    assert.deepEqual(store.take('s2', other), bytes('x'));
});

test('take refuses ids that are no string', () => {
    const store = createUploadStore();
    store.put('s1', bytes('a'));
    for (const id of [undefined, null, 1, {}, '']) assert.equal(store.take('s1', id), null);
});
