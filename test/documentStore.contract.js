/**
 * Behaviour every storage behind db/documentStore.js must share.
 *
 * Not a *.test.js file: the runners documentStore.sqlite.test.js and
 * documentStore.postgres.test.js call defineDocumentStoreContract() with
 * their own storage, so SQLite and PostgreSQL run the same list.
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

/**
 * Register the contract tests for one storage.
 *
 * @param {string} label -> Name of the describe block, e.g. 'sqlite'.
 * @param {Function} makeStore -> async () => { api, storage, cleanup? } with a fresh, empty store.
 * @param {Object} [options] -> `{ skip }`: a reason string skips the whole block.
 */
function defineDocumentStoreContract(label, makeStore, { skip = false } = {}) {
    describe(`document store contract: ${label}`, { skip }, () => {
        // Run `fn` with a fresh store and always close it afterwards
        const withStore = (fn) => async () => {
            const store = await makeStore();
            try {
                await fn(store);
            } finally {
                await store.api.close();
                if (store.cleanup) await store.cleanup();
            }
        };

        test('setDoc and getDoc round-trip, missing doc reports exists() false', withStore(async ({ api }) => {
            const { db, doc, setDoc, getDoc } = api;
            await setDoc(doc(db, 'events', 'e1'), { title: 'A', n: 1 });

            const snap = await getDoc(doc(db, 'events', 'e1'));
            assert.equal(snap.exists(), true);
            assert.equal(snap.id, 'e1');
            assert.deepEqual(snap.data(), { title: 'A', n: 1 });

            const missing = await getDoc(doc(db, 'events', 'nope'));
            assert.equal(missing.exists(), false);
            assert.equal(missing.data(), undefined);
        }));

        test('addDoc returns a 20-character id that getDoc finds', withStore(async ({ api }) => {
            const { db, collection, doc, addDoc, getDoc } = api;
            const ref = await addDoc(collection(db, 'events'), { title: 'Neu' });

            assert.match(ref.id, /^[A-Za-z0-9]{20}$/);
            assert.deepEqual((await getDoc(doc(db, 'events', ref.id))).data(), { title: 'Neu' });
        }));

        test('updateDoc merges fields and throws on a missing document', withStore(async ({ api }) => {
            const { db, doc, setDoc, updateDoc, getDoc } = api;
            await setDoc(doc(db, 'events', 'e1'), { title: 'A', n: 1 });
            await updateDoc(doc(db, 'events', 'e1'), { n: 2, extra: true });

            assert.deepEqual((await getDoc(doc(db, 'events', 'e1'))).data(), { title: 'A', n: 2, extra: true });
            await assert.rejects(updateDoc(doc(db, 'events', 'nope'), { a: 1 }), /Dokument nicht gefunden: events\/nope/);
            assert.equal((await getDoc(doc(db, 'events', 'nope'))).exists(), false);
        }));

        test('deleteDoc removes the document', withStore(async ({ api }) => {
            const { db, doc, setDoc, deleteDoc, getDoc } = api;
            await setDoc(doc(db, 'events', 'e1'), { title: 'A' });
            await deleteDoc(doc(db, 'events', 'e1'));

            assert.equal((await getDoc(doc(db, 'events', 'e1'))).exists(), false);
        }));

        test('keeps the key order of stored objects', withStore(async ({ api }) => {
            const { db, doc, setDoc, getDoc } = api;
            // Form answers are keyed by field label; their order is the form's order
            await setDoc(doc(db, 'registrations', 'r1'), { answers: { Zweitens: 'b', Erstens: 'a', 10: 'x' } });

            const { answers } = (await getDoc(doc(db, 'registrations', 'r1'))).data();
            assert.deepEqual(Object.keys(answers), ['10', 'Zweitens', 'Erstens']);
        }));

        test('returns documents in id order without orderBy', withStore(async ({ api }) => {
            const { db, collection, doc, setDoc, getDocs } = api;
            for (const id of ['b', 'B', 'a', 'A1']) await setDoc(doc(db, 'c', id), { id });

            const snap = await getDocs(collection(db, 'c'));
            // Byte order: upper case before lower case
            assert.deepEqual(snap.docs.map(d => d.id), ['A1', 'B', 'a', 'b']);
            assert.equal(snap.size, 4);
            assert.equal(snap.empty, false);
        }));

        test('where supports every operator', withStore(async ({ api }) => {
            const { db, collection, doc, setDoc, getDocs, query, where } = api;
            await setDoc(doc(db, 'u', '1'), { n: 1, tags: ['a', 'b'], meta: { level: 'gold' } });
            await setDoc(doc(db, 'u', '2'), { n: 2, tags: ['c'], meta: { level: 'silver' } });
            await setDoc(doc(db, 'u', '3'), { n: 3, tags: [], meta: { level: 'gold' } });
            const ids = async (...constraints) =>
                (await getDocs(query(collection(db, 'u'), ...constraints))).docs.map(d => d.id);

            assert.deepEqual(await ids(where('n', '==', 2)), ['2']);
            assert.deepEqual(await ids(where('n', '!=', 2)), ['1', '3']);
            assert.deepEqual(await ids(where('n', '>', 1)), ['2', '3']);
            assert.deepEqual(await ids(where('n', '>=', 2)), ['2', '3']);
            assert.deepEqual(await ids(where('n', '<', 2)), ['1']);
            assert.deepEqual(await ids(where('n', '<=', 2)), ['1', '2']);
            assert.deepEqual(await ids(where('n', 'in', [1, 3])), ['1', '3']);
            assert.deepEqual(await ids(where('n', 'not-in', [1, 3])), ['2']);
            assert.deepEqual(await ids(where('tags', 'array-contains', 'c')), ['2']);
            assert.deepEqual(await ids(where('tags', 'array-contains-any', ['a', 'c'])), ['1', '2']);
            assert.deepEqual(await ids(where('meta.level', '==', 'gold'), where('n', '>', 1)), ['3']);
            await assert.rejects(ids(where('n', 'like', 1)), /nicht unterstützter where-Operator "like"/);
        }));

        test('orderBy sorts by several fields and puts missing values first ascending', withStore(async ({ api }) => {
            const { db, collection, doc, setDoc, getDocs, query, orderBy } = api;
            await setDoc(doc(db, 'p', '1'), { rank: 2, name: 'Anna' });
            await setDoc(doc(db, 'p', '2'), { rank: 1, name: 'Bert' });
            await setDoc(doc(db, 'p', '3'), { rank: 2, name: 'Cleo' });
            await setDoc(doc(db, 'p', '4'), { name: 'Dora' });
            const ids = async (...constraints) =>
                (await getDocs(query(collection(db, 'p'), ...constraints))).docs.map(d => d.id);

            assert.deepEqual(await ids(orderBy('rank'), orderBy('name', 'desc')), ['4', '2', '3', '1']);
            assert.deepEqual(await ids(orderBy('rank', 'desc')), ['1', '3', '2', '4']);
        }));

        test('writeBatch applies set, update and delete together; update creates a missing doc', withStore(async ({ api }) => {
            const { db, doc, setDoc, getDoc, writeBatch } = api;
            await setDoc(doc(db, 'c', 'keep'), { a: 1 });
            await setDoc(doc(db, 'c', 'gone'), { a: 1 });

            const batch = writeBatch(db);
            batch.set(doc(db, 'c', 'new'), { a: 2 });
            batch.update(doc(db, 'c', 'keep'), { b: 2 });
            batch.update(doc(db, 'c', 'created'), { c: 3 });
            batch.delete(doc(db, 'c', 'gone'));
            await batch.commit();

            assert.deepEqual((await getDoc(doc(db, 'c', 'new'))).data(), { a: 2 });
            assert.deepEqual((await getDoc(doc(db, 'c', 'keep'))).data(), { a: 1, b: 2 });
            assert.deepEqual((await getDoc(doc(db, 'c', 'created'))).data(), { c: 3 });
            assert.equal((await getDoc(doc(db, 'c', 'gone'))).exists(), false);
        }));

        test('applyBatch rolls back everything when one operation fails', withStore(async ({ storage }) => {
            await storage.ready();
            await assert.rejects(storage.applyBatch([
                { type: 'set', collection: 'c', id: 'x', data: {} },
                { type: 'update', collection: 'c', id: 'missing', data: {}, mustExist: true }
            ]), /Dokument nicht gefunden: c\/missing/);

            assert.equal(await storage.read('c', 'x'), undefined);
        }));

        test('concurrent updateDoc calls keep both fields', withStore(async ({ api }) => {
            const { db, doc, setDoc, updateDoc, getDoc } = api;
            const ref = doc(db, 'c', 'shared');
            await setDoc(ref, {});
            await Promise.all([updateDoc(ref, { a: 1 }), updateDoc(ref, { b: 2 })]);

            assert.deepEqual((await getDoc(ref)).data(), { a: 1, b: 2 });
        }));

        test('storeName names the storage', withStore(async ({ api, storage }) => {
            assert.equal(api.storeName, storage.name);
            assert.equal(api.storeName, label);
        }));
    });
}

module.exports = { defineDocumentStoreContract };
