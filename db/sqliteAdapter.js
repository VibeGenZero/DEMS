/**
 * SQLite-Adapter mit Firestore-kompatibler API.
 *
 * Bildet exakt die Teilmenge der Firebase-Firestore-Client-SDK nach, die in
 * firebaseAdmin.js re-exportiert und im gesamten Projekt (bot.js, routes/*,
 * utils/*, middleware/*, server.js) verwendet wird. Dadurch kann DEMS ohne
 * jede Änderung an den Aufrufstellen auf eine lokale SQLite-Datenbank
 * zurückfallen, wenn keine Firebase-Konfiguration hinterlegt ist.
 *
 * Speichermodell: ein generischer JSON-Dokumentenspeicher (schemalos wie
 * Firestore). Jede "Collection" ist einfach ein Namensraum in derselben
 * Tabelle; jedes Dokument wird als JSON-Text abgelegt. Filter (where) und
 * Sortierung (orderBy) werden in JS ausgewertet – die Datenmengen pro
 * Discord-Server sind klein, und der bestehende Code filtert/sortiert an
 * vielen Stellen ohnehin in-memory.
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

// ── Datenbank initialisieren ─────────────────────────────────────────────
const dbPath = process.env.SQLITE_PATH || path.join(process.cwd(), 'data', 'dems.sqlite');

// Zielverzeichnis anlegen, falls nötig (z. B. ./data)
const dbDir = path.dirname(dbPath);
if (dbDir && dbDir !== '.' && !fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    collection TEXT NOT NULL,
    id         TEXT NOT NULL,
    data       TEXT NOT NULL,
    PRIMARY KEY (collection, id)
  );
  CREATE INDEX IF NOT EXISTS idx_documents_collection ON documents(collection);
`);

// Vorbereitete Statements
const stmtGet = sqlite.prepare('SELECT id, data FROM documents WHERE collection = ? AND id = ?');
const stmtAll = sqlite.prepare('SELECT id, data FROM documents WHERE collection = ?');
const stmtUpsert = sqlite.prepare(
  'INSERT INTO documents (collection, id, data) VALUES (?, ?, ?) ' +
  'ON CONFLICT(collection, id) DO UPDATE SET data = excluded.data'
);
const stmtDelete = sqlite.prepare('DELETE FROM documents WHERE collection = ? AND id = ?');

// ── Hilfsfunktionen ──────────────────────────────────────────────────────

// Firestore-ähnliche Auto-IDs (URL-sichere Zeichen, 20 Stellen).
const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function generateId() {
  const bytes = crypto.randomBytes(20);
  let id = '';
  for (let i = 0; i < 20; i++) id += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  return id;
}

function readDoc(collection, id) {
  const row = stmtGet.get(collection, id);
  return row ? JSON.parse(row.data) : undefined;
}

function writeDoc(collection, id, data) {
  stmtUpsert.run(collection, id, JSON.stringify(data));
}

// Snapshot-Objekte, die getDoc / getDocs-Ergebnisse nachbilden.
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

// Wert eines (verschachtelten) Feldpfads aus einem Dokument lesen.
function getFieldValue(obj, fieldPath) {
  if (obj == null) return undefined;
  if (!fieldPath.includes('.')) return obj[fieldPath];
  return fieldPath.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

// Einen where-Constraint auf ein Dokument anwenden.
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
      throw new Error(`sqliteAdapter: nicht unterstützter where-Operator "${op}"`);
  }
}

// Eine Collection oder Query laden und Constraints in JS anwenden.
function runQuery(target) {
  const collection = target.collection;
  const constraints = target.constraints || [];

  let rows = stmtAll.all(collection).map((row) => ({ id: row.id, data: JSON.parse(row.data) }));

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

  return makeQuerySnapshot(collection, rows);
}

// ── Firestore-kompatible API ─────────────────────────────────────────────

// db-Sentinel – wird nur durchgereicht, hat aber keine Bedeutung für SQLite.
const db = { __type: 'sqlite-db' };

function collection(_db, name) {
  return { __type: 'collection', collection: name, constraints: [] };
}

function doc(_db, name, id) {
  return { __type: 'doc', collection: name, id: id != null ? String(id) : generateId() };
}

async function getDoc(docRef) {
  const data = readDoc(docRef.collection, docRef.id);
  return makeDocSnapshot(docRef.collection, docRef.id, data);
}

async function getDocs(target) {
  // target ist entweder eine collection-Ref oder eine query-Ref.
  return runQuery(target);
}

async function addDoc(colRef, data) {
  const id = generateId();
  writeDoc(colRef.collection, id, data);
  return { id, __type: 'doc', collection: colRef.collection };
}

async function setDoc(docRef, data) {
  // Firestore setDoc (ohne merge) ersetzt das gesamte Dokument.
  writeDoc(docRef.collection, docRef.id, data);
}

async function updateDoc(docRef, updates) {
  const existing = readDoc(docRef.collection, docRef.id);
  if (existing === undefined) {
    // Firestore updateDoc schlägt bei nicht existierendem Dokument fehl.
    throw new Error(`sqliteAdapter: updateDoc auf nicht existierendes Dokument ${docRef.collection}/${docRef.id}`);
  }
  writeDoc(docRef.collection, docRef.id, { ...existing, ...updates });
}

async function deleteDoc(docRef) {
  stmtDelete.run(docRef.collection, docRef.id);
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
  return {
    set(docRef, data) { ops.push({ type: 'set', docRef, data }); return this; },
    update(docRef, data) { ops.push({ type: 'update', docRef, data }); return this; },
    delete(docRef) { ops.push({ type: 'delete', docRef }); return this; },
    async commit() {
      const run = sqlite.transaction(() => {
        for (const op of ops) {
          if (op.type === 'set') {
            writeDoc(op.docRef.collection, op.docRef.id, op.data);
          } else if (op.type === 'update') {
            const existing = readDoc(op.docRef.collection, op.docRef.id);
            writeDoc(op.docRef.collection, op.docRef.id, { ...(existing || {}), ...op.data });
          } else if (op.type === 'delete') {
            stmtDelete.run(op.docRef.collection, op.docRef.id);
          }
        }
      });
      run();
    }
  };
}

module.exports = {
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
  writeBatch
};
