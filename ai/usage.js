'use strict';

/**
 * Daily usage counters of the AI integration (collection `aiUsage`, one
 * document per local calendar day, id `YYYY-MM-DD` in the server time zone).
 * Counters only: no question or answer text is ever stored.
 */
const { db, collection, doc, getDoc, getDocs, setDoc, deleteDoc } = require('../firebaseAdmin');
const { getTimezone } = require('../utils/timezone');

const COLLECTION = 'aiUsage';
const KEEP_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Local calendar day (`YYYY-MM-DD`) of a moment in the server time zone. */
function dayId(now) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: getTimezone(), year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(now);
}

/** The day id `days` calendar days before another day id (pure date arithmetic, no DST). */
function shiftDay(id, days) {
    return new Date(Date.parse(`${id}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);
}

const num = (value) => (Number.isFinite(value) ? value : 0);

function emptyDay(date) {
    return { date, memberQuestions: 0, adminRequests: 0, inputTokens: 0, outputTokens: 0, errors: 0 };
}

function toRow(date, data) {
    const row = emptyDay(date);
    for (const key of Object.keys(row)) if (key !== 'date') row[key] = num(data[key]);
    return row;
}

// Read-modify-write of one document: serialised so parallel requests do not lose counts
let writeQueue = Promise.resolve();

/**
 * Count one AI call.
 *
 * @param {Object} params
 * @param {'member'|'admin'} params.kind -> Which counter grows.
 * @param {{ inputTokens?: number, outputTokens?: number }|null} [params.usage] -> Token usage the provider reported.
 * @param {boolean} [params.failed] -> The call failed: `errors` grows.
 * @param {Date} [params.now]
 */
function recordUsage({ kind, usage = null, failed = false, now = new Date() }) {
    const run = async () => {
        const ref = doc(db, COLLECTION, dayId(now));
        const snap = await getDoc(ref);
        const row = toRow(ref.id, snap.exists() ? snap.data() : {});
        if (kind === 'admin') row.adminRequests += 1; else row.memberQuestions += 1;
        if (usage) {
            row.inputTokens += num(usage.inputTokens);
            row.outputTokens += num(usage.outputTokens);
        }
        if (failed) row.errors += 1;
        const { date, ...data } = row;
        await setDoc(ref, data);
    };
    const result = writeQueue.then(run);
    writeQueue = result.catch(() => {});
    return result;
}

/** Member questions asked today (local day). */
async function questionsToday(now = new Date()) {
    const snap = await getDoc(doc(db, COLLECTION, dayId(now)));
    return snap.exists() ? num(snap.data().memberQuestions) : 0;
}

/**
 * Usage of the last days, newest first; days without a document are omitted.
 *
 * @param {number} [days] -> Window size including today.
 * @param {Date} [now]
 */
async function readUsage(days = 30, now = new Date()) {
    const today = dayId(now);
    const oldest = shiftDay(today, days - 1);
    const snap = await getDocs(collection(db, COLLECTION));
    return snap.docs
        .filter(entry => entry.id >= oldest && entry.id <= today)
        .map(entry => toRow(entry.id, entry.data()))
        .sort((a, b) => (a.date < b.date ? 1 : -1));
}

/** Delete usage documents older than 90 days; returns how many were removed. */
async function pruneUsage(now = new Date()) {
    const cutoff = shiftDay(dayId(now), KEEP_DAYS);
    const snap = await getDocs(collection(db, COLLECTION));
    const old = snap.docs.filter(entry => entry.id < cutoff);
    for (const entry of old) await deleteDoc(doc(db, COLLECTION, entry.id));
    return old.length;
}

module.exports = { recordUsage, questionsToday, readUsage, pruneUsage };
