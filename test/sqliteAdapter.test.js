const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// The adapter opens its database on require -> point it to a temp file first
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dems-adapter-'));
process.env.SQLITE_PATH = path.join(tmpDir, 'adapter.sqlite');

const { db, collection, doc, getDoc, setDoc, updateDoc } = require('../db/sqliteAdapter');

test('doc() accepts a collection reference as first argument', async () => {
    await setDoc(doc(db, 'events', 'evt-1'), { title: 'Original' });

    const events = collection(db, 'events');
    const snap = await getDoc(doc(events, 'evt-1'));
    assert.equal(snap.exists(), true);
    assert.equal(snap.data().title, 'Original');

    await updateDoc(doc(events, 'evt-1'), { title: 'Updated' });
    const updated = await getDoc(doc(db, 'events', 'evt-1'));
    assert.equal(updated.data().title, 'Updated');
});

test('doc() with only a collection reference generates an ID in that collection', () => {
    const ref = doc(collection(db, 'events'));
    assert.equal(ref.collection, 'events');
    assert.equal(typeof ref.id, 'string');
    assert.equal(ref.id.length, 20);
});
