/**
 * Firestore-style document API on top of a small storage interface.
 *
 * Mirrors exactly the subset of the Firestore client SDK that DEMS uses
 * (collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc,
 * query, where, orderBy, writeBatch). Filters and sorting run here in
 * JavaScript, so every storage (SQLite for dev and tests, PostgreSQL in
 * production) behaves the same by construction.
 *
 * Storage interface (all methods async):
 *   name                     'sqlite' | 'postgres'
 *   ready()                  create table/index if missing
 *   read(collection, id)     -> data object or undefined
 *   readAll(collection)      -> [{ id, data }] ordered by id (byte order)
 *   applyBatch(ops)          atomic; op = { type: 'set'|'update'|'delete', collection, id, data?, mustExist? }
 *   close()
 */
const crypto = require('crypto');

// Firestore-like auto IDs (URL-safe characters, 20 long)
const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * New random document ID.
 *
 * @returns {string} -> 20 characters from ID_ALPHABET.
 */
function generateId() {
  const bytes = crypto.randomBytes(20);
  let id = '';
  for (let i = 0; i < 20; i++) id += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  return id;
}

/**
 * Merge rule of updateDoc and writeBatch().update — shared by all storages.
 *
 * @param {Object|undefined} existing -> Stored document or undefined.
 * @param {Object} updates -> Fields to set.
 * @returns {Object} -> The new document.
 */
function mergeUpdate(existing, updates) {
  return { ...(existing || {}), ...updates };
}

/**
 * Error for an update on a document that does not exist.
 *
 * @param {string} collection -> Collection name.
 * @param {string} id -> Document ID.
 * @returns {Error}
 */
function missingDocumentError(collection, id) {
  return new Error(`Dokument nicht gefunden: ${collection}/${id}`);
}

// Snapshot objects shaped like getDoc / getDocs results
function makeDocSnapshot(collection, id, data) {
  return {
    id,
    ref: { __type: 'doc', collection, id },
    exists: () => data !== undefined && data !== null,
    data: () => data
  };
}

function makeQuerySnapshot(collection, rows) {
  const docs = rows.map(({ id, data }) => makeDocSnapshot(collection, id, data));
  return {
    docs,
    size: docs.length,
    empty: docs.length === 0,
    forEach: (cb) => docs.forEach(cb)
  };
}

// Value of a (nested) field path of a document
function getFieldValue(obj, fieldPath) {
  if (obj == null) return undefined;
  if (!fieldPath.includes('.')) return obj[fieldPath];
  return fieldPath.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

// Apply one where constraint to a document
function matchesWhere(data, { field, op, value }) {
  const actual = getFieldValue(data, field);
  switch (op) {
    case '==': return actual === value;
    case '!=': return actual !== value;
    case '>': return actual > value;
    case '>=': return actual >= value;
    case '<': return actual < value;
    case '<=': return actual <= value;
    case 'in': return Array.isArray(value) && value.includes(actual);
    case 'not-in': return Array.isArray(value) && !value.includes(actual);
    case 'array-contains': return Array.isArray(actual) && actual.includes(value);
    case 'array-contains-any':
      return Array.isArray(actual) && Array.isArray(value) && value.some((v) => actual.includes(v));
    default:
      throw new Error(`documentStore: nicht unterstützter where-Operator "${op}"`);
  }
}

// Apply where and orderBy constraints to rows of one collection
function applyConstraints(rows, constraints) {
  const wheres = constraints.filter((c) => c.kind === 'where');
  if (wheres.length) {
    rows = rows.filter((row) => wheres.every((w) => matchesWhere(row.data, w)));
  }

  const orders = constraints.filter((c) => c.kind === 'orderBy');
  for (let i = orders.length - 1; i >= 0; i--) {
    const { field, direction } = orders[i];
    const dir = direction === 'desc' ? -1 : 1;
    rows.sort((a, b) => {
      const av = getFieldValue(a.data, field);
      const bv = getFieldValue(b.data, field);
      if (av === bv) return 0;
      if (av === undefined || av === null) return -1 * dir;
      if (bv === undefined || bv === null) return 1 * dir;
      return (av < bv ? -1 : 1) * dir;
    });
  }
  return rows;
}

/**
 * Build the Firestore-style API on top of a storage.
 *
 * @param {Object} storage -> See the storage interface at the top of this file.
 * @returns {Object} -> db, collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc,
 *   deleteDoc, query, where, orderBy, writeBatch, ready, close, storeName.
 */
function createDocumentStore(storage) {
  // Every call waits for the storage; a failed start may be retried
  let readyPromise = null;
  function ready() {
    if (!readyPromise) {
      readyPromise = storage.ready().catch((err) => {
        readyPromise = null;
        throw err;
      });
    }
    return readyPromise;
  }

  async function apply(ops) {
    await ready();
    await storage.applyBatch(ops);
  }

  // db sentinel — passed through; dev/seed.js checks for 'sqlite-db' before it writes
  const db = { __type: `${storage.name}-db` };

  function collection(_db, name) {
    return { __type: 'collection', collection: name, constraints: [] };
  }

  function doc(parent, name, id) {
    // Firestore also accepts doc(collectionRef, id) -> the collection name then
    // comes from the reference and the second argument is the document ID.
    if (parent && parent.__type === 'collection') {
      [name, id] = [parent.collection, name];
    }
    return { __type: 'doc', collection: name, id: id != null ? String(id) : generateId() };
  }

  async function getDoc(docRef) {
    await ready();
    const data = await storage.read(docRef.collection, docRef.id);
    return makeDocSnapshot(docRef.collection, docRef.id, data);
  }

  async function getDocs(target) {
    // target is a collection or a query reference
    await ready();
    const rows = await storage.readAll(target.collection);
    return makeQuerySnapshot(target.collection, applyConstraints(rows, target.constraints || []));
  }

  async function addDoc(colRef, data) {
    const id = generateId();
    await apply([{ type: 'set', collection: colRef.collection, id, data }]);
    return { id, __type: 'doc', collection: colRef.collection };
  }

  async function setDoc(docRef, data) {
    // Firestore setDoc (without merge) replaces the whole document
    await apply([{ type: 'set', collection: docRef.collection, id: docRef.id, data }]);
  }

  async function updateDoc(docRef, updates) {
    // Firestore updateDoc fails on a missing document
    await apply([{ type: 'update', collection: docRef.collection, id: docRef.id, data: updates, mustExist: true }]);
  }

  async function deleteDoc(docRef) {
    await apply([{ type: 'delete', collection: docRef.collection, id: docRef.id }]);
  }

  function query(colRef, ...constraints) {
    return {
      __type: 'query',
      collection: colRef.collection,
      constraints: [...(colRef.constraints || []), ...constraints]
    };
  }

  function where(field, op, value) {
    return { kind: 'where', field, op, value };
  }

  function orderBy(field, direction = 'asc') {
    return { kind: 'orderBy', field, direction };
  }

  function writeBatch(_db) {
    const ops = [];
    const target = (docRef) => ({ collection: docRef.collection, id: docRef.id });
    return {
      set(docRef, data) { ops.push({ type: 'set', ...target(docRef), data }); return this; },
      // Unlike updateDoc, a batch update creates a missing document (behaviour since the SQLite adapter)
      update(docRef, data) { ops.push({ type: 'update', ...target(docRef), data, mustExist: false }); return this; },
      delete(docRef) { ops.push({ type: 'delete', ...target(docRef) }); return this; },
      async commit() { await apply(ops); }
    };
  }

  return {
    db,
    collection,
    doc,
    getDoc,
    getDocs,
    addDoc,
    setDoc,
    updateDoc,
    deleteDoc,
    query,
    where,
    orderBy,
    writeBatch,
    ready,
    close: () => storage.close(),
    storeName: storage.name
  };
}

module.exports = { createDocumentStore, mergeUpdate, missingDocumentError, generateId };
