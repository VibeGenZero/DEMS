const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir } = require('./helpers');

// Own, empty SQLite database; the empty cwd keeps a local .env out
const tmpDir = createTempDir('plugin-data');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.SQLITE_PATH = path.join(tmpDir, 'plugin-data.sqlite');

const { db, collection, doc, getDocs, deleteDoc, setDoc } = require('../firebaseAdmin');
const { PluginDataError } = require('../plugin-sdk/errors');
const data = require('../plugin-sdk/data');

const USED = [
    'plugin:alpha:items', 'plugin:beta:items', 'plugin:alpha:votes', 'plugin:beta:notes', 'events'
];

/** Data API whose recordCollection calls land in `calls`. */
function apiWithLog(pluginId) {
    const calls = [];
    const api = data.createDataApi(pluginId, { recordCollection: async coll => { calls.push(coll); } });
    return { api, calls };
}

async function ids(name) {
    const snapshot = await getDocs(collection(db, name));
    return snapshot.docs.map(entry => entry.id).sort();
}

beforeEach(async () => {
    for (const name of USED) {
        const snapshot = await getDocs(collection(db, name));
        for (const entry of snapshot.docs) await deleteDoc(doc(db, name, entry.id));
    }
});

test('collectionName namespaces a collection by plugin id', () => {
    assert.equal(data.collectionName('event-submissions', 'items'), 'plugin:event-submissions:items');
});

test('two plugins writing the same collection never see each other\'s documents', async () => {
    const { api: alpha } = apiWithLog('alpha');
    const { api: beta } = apiWithLog('beta');

    const a = await alpha.add('items', { title: 'A' });
    await beta.set('items', 'shared', { title: 'B' });
    await alpha.set('items', 'shared', { title: 'A2' });

    assert.deepEqual((await alpha.list('items')).map(entry => entry.title).sort(), ['A', 'A2']);
    assert.deepEqual(await beta.list('items'), [{ id: 'shared', title: 'B' }]);
    assert.equal(await beta.get('items', a.id), null);
    assert.deepEqual(await beta.get('items', 'shared'), { id: 'shared', title: 'B' });
    assert.deepEqual(await ids('plugin:beta:items'), ['shared']);
});

test('get, add, set, update and delete round-trip', async () => {
    const { api } = apiWithLog('alpha');

    assert.equal(await api.get('items', 'missing'), null);

    const added = await api.add('items', { title: 'X', count: 1 });
    assert.equal(typeof added.id, 'string');
    assert.deepEqual(added, { id: added.id, title: 'X', count: 1 });
    assert.deepEqual(await api.get('items', added.id), added);

    assert.deepEqual(await api.set('items', 'one', { title: 'Eins' }), { id: 'one', title: 'Eins' });
    assert.deepEqual(await api.update('items', 'one', { count: 2 }), { id: 'one', title: 'Eins', count: 2 });
    assert.deepEqual(await api.get('items', 'one'), { id: 'one', title: 'Eins', count: 2 });

    await api.delete('items', 'one');
    assert.equal(await api.get('items', 'one'), null);
});

test('update of a missing document throws PluginDataError', async () => {
    const { api } = apiWithLog('alpha');
    await assert.rejects(api.update('items', 'missing', { a: 1 }), PluginDataError);
});

test('where filters with the allowed operators and refuses others', async () => {
    const { api } = apiWithLog('alpha');
    await api.set('items', 'a', { n: 1, tag: 'x' });
    await api.set('items', 'b', { n: 2, tag: 'y' });
    await api.set('items', 'c', { n: 3, tag: 'x' });

    const found = async (field, op, value) => (await api.where('items', field, op, value)).map(entry => entry.id).sort();
    assert.deepEqual(await found('tag', '==', 'x'), ['a', 'c']);
    assert.deepEqual(await found('tag', '!=', 'x'), ['b']);
    assert.deepEqual(await found('n', '<', 2), ['a']);
    assert.deepEqual(await found('n', '<=', 2), ['a', 'b']);
    assert.deepEqual(await found('n', '>', 2), ['c']);
    assert.deepEqual(await found('n', '>=', 2), ['b', 'c']);
    assert.deepEqual(await found('n', 'in', [1, 3]), ['a', 'c']);

    await assert.rejects(api.where('items', 'tags', 'array-contains', 'x'), PluginDataError);
    await assert.rejects(api.where('items', 'n', 'in', 1), PluginDataError);
    await assert.rejects(api.where('items', '', '==', 1), PluginDataError);
});

test('invalid collection names throw PluginDataError with the name', async () => {
    const { api, calls } = apiWithLog('alpha');
    for (const coll of ['../x', 'Items', 'a'.repeat(33), '', 'a:b', 'a/b', 5]) {
        await assert.rejects(api.list(coll), err => err instanceof PluginDataError
            && err.message === `Ungültiger Sammlungsname: ${coll}`);
        await assert.rejects(api.add(coll, { a: 1 }), PluginDataError);
    }
    assert.deepEqual(calls, []);
    // 32 characters is still fine
    await api.add('a'.repeat(32), { a: 1 });
    await data.wipePluginData('alpha', ['a'.repeat(32)]);
});

test('invalid document ids and data throw PluginDataError', async () => {
    const { api } = apiWithLog('alpha');
    for (const id of ['', 'a/b', 'x'.repeat(129), 7, null]) {
        await assert.rejects(api.get('items', id), err => err.message === 'Ungültige Dokument-ID.');
        await assert.rejects(api.set('items', id, { a: 1 }), PluginDataError);
    }
    for (const value of [null, [], 'text', 3, new Date(), undefined]) {
        await assert.rejects(api.add('items', value), err => err instanceof PluginDataError
            && err.message === 'Ungültige Daten: Es wird ein Objekt erwartet.');
        await assert.rejects(api.update('items', 'a', value), PluginDataError);
    }
    assert.ok(new PluginDataError('x') instanceof Error);
    assert.equal(new PluginDataError('x').name, 'PluginDataError');
});

test('recordCollection runs once per collection, before the first write, never for reads', async () => {
    const order = [];
    const api = data.createDataApi('alpha', {
        recordCollection: async coll => { order.push(`record:${coll}`); }
    });

    await api.list('items');
    await api.get('items', 'x');
    await api.where('items', 'a', '==', 1);
    assert.deepEqual(order, []);

    await Promise.all([api.add('items', { a: 1 }), api.add('items', { a: 2 })]);
    await api.set('items', 'x', { a: 3 });
    await api.update('items', 'x', { a: 4 });
    await api.delete('items', 'x');
    await api.add('votes', { a: 1 });

    assert.deepEqual(order, ['record:items', 'record:votes']);
});

test('a failed recordCollection is retried on the next write and blocks the write', async () => {
    let fail = true;
    const calls = [];
    const api = data.createDataApi('alpha', {
        recordCollection: async coll => {
            calls.push(coll);
            if (fail) throw new Error('kaputt');
        }
    });

    await assert.rejects(api.add('items', { a: 1 }), /kaputt/);
    assert.deepEqual(await api.list('items'), []);
    fail = false;
    await api.add('items', { a: 1 });
    assert.deepEqual(calls, ['items', 'items']);
});

test('returned documents are copies', async () => {
    const { api } = apiWithLog('alpha');
    const input = { nested: { n: 1 } };
    await api.set('items', 'a', input);
    input.nested.n = 99;

    const first = await api.get('items', 'a');
    first.nested.n = 42;
    assert.deepEqual(await api.get('items', 'a'), { id: 'a', nested: { n: 1 } });

    const listed = await api.list('items');
    listed[0].nested.n = 7;
    assert.deepEqual((await api.list('items'))[0], { id: 'a', nested: { n: 1 } });
});

test('purgeUserData removes only the user\'s documents in every listed collection', async () => {
    const { api: alpha } = apiWithLog('alpha');
    const { api: beta } = apiWithLog('beta');
    await alpha.set('items', 'a1', { userId: 'u1' });
    await alpha.set('items', 'a2', { userId: 'u2' });
    await alpha.set('votes', 'v1', { userId: 'u1' });
    await alpha.set('votes', 'v2', { other: 'u1' });
    await beta.set('notes', 'n1', { userId: 'u1' });
    await beta.set('items', 'b1', { userId: 'u1' }); // not listed below
    await setDoc(doc(db, 'events', 'e1'), { userId: 'u1' });

    const removed = await data.purgeUserData('u1', new Map([
        ['alpha', ['items', 'votes']],
        ['beta', ['notes']]
    ]));

    assert.equal(removed, 3);
    assert.deepEqual(await ids('plugin:alpha:items'), ['a2']);
    assert.deepEqual(await ids('plugin:alpha:votes'), ['v2']);
    assert.deepEqual(await ids('plugin:beta:notes'), []);
    assert.deepEqual(await ids('plugin:beta:items'), ['b1']);
    assert.deepEqual(await ids('events'), ['e1']);
});

test('purgeUserData compares user ids as strings', async () => {
    const { api } = apiWithLog('alpha');
    await api.set('items', 'a', { userId: 123 });
    await api.set('items', 'b', { userId: '1234' });

    assert.equal(await data.purgeUserData('123', new Map([['alpha', ['items']]])), 1);
    assert.deepEqual(await ids('plugin:alpha:items'), ['b']);
});

test('purgeUserData and wipePluginData skip invalid collection names', async () => {
    await setDoc(doc(db, 'events', 'e1'), { userId: 'u1' });
    assert.equal(await data.purgeUserData('u1', new Map([['alpha', ['../../events']]])), 0);
    assert.equal(await data.wipePluginData('alpha', ['../../events']), 0);
    assert.deepEqual(await ids('events'), ['e1']);
});

test('wipePluginData empties only that plugin\'s collections and counts the documents', async () => {
    const { api: alpha } = apiWithLog('alpha');
    const { api: beta } = apiWithLog('beta');
    for (let i = 0; i < 503; i++) await alpha.set('items', `i${String(i).padStart(3, '0')}`, { i });
    await alpha.add('votes', { a: 1 });
    await beta.add('items', { b: 1 });

    assert.equal(await data.wipePluginData('alpha', ['items', 'votes']), 504);
    assert.deepEqual(await ids('plugin:alpha:items'), []);
    assert.deepEqual(await ids('plugin:alpha:votes'), []);
    assert.equal((await ids('plugin:beta:items')).length, 1);
});
