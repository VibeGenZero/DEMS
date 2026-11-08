/**
 * express-session store on top of firebaseAdmin.js (PostgreSQL or SQLite), so
 * logins survive restarts and deploys.
 *
 * - Write-through cache: this single process keeps every session it knows in
 *   memory and reads the database only on a miss (after a restart). The session
 *   middleware runs for every request incl. static files -> no read per request.
 * - No touch(): express-session would call it on every unchanged request, i.e.
 *   one write each. Without it a session expires with its cookie, which is only
 *   renewed when the session changes (rolling is off).
 * - Document id = SHA-256 of the session id: whoever can read the database
 *   cannot take over a session.
 */
const crypto = require('crypto');
const { Store } = require('express-session');
const { db, collection, doc, getDoc, getDocs, setDoc, deleteDoc } = require('../firebaseAdmin');

const SESSION_COLLECTION = 'sessions';
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;

const documentId = (sid) => crypto.createHash('sha256').update(sid).digest('hex');

// One store instance for the whole process: every session write is visible to
// every caller, so panic mode can end sessions it did not create itself.
let defaultStore;

/**
 * Expiry of a session: its cookie expiry, else DEFAULT_TTL_MS from now.
 *
 * @param {Object} session -> Session data from express-session.
 * @returns {string} -> ISO date.
 */
function expiryOf(session) {
    const expires = session?.cookie?.expires;
    return new Date(expires ? new Date(expires).getTime() : Date.now() + DEFAULT_TTL_MS).toISOString();
}

const isExpired = (expiresAt) => new Date(expiresAt).getTime() <= Date.now();

class PersistentSessionStore extends Store {
    /**
     * @param {Object} [options] -> Store options.
     * @param {number} [options.pruneIntervalMs] -> How often expired sessions are deleted; 0 = never.
     */
    constructor({ pruneIntervalMs = DEFAULT_PRUNE_INTERVAL_MS } = {}) {
        super();
        this.cache = new Map(); // sid -> { json, expiresAt }
        if (pruneIntervalMs > 0) {
            setInterval(() => {
                this.pruneExpired().catch(err => console.error('Session cleanup failed:', err.message));
            }, pruneIntervalMs).unref();
        }
    }

    get(sid, callback) {
        this.load(sid).then(session => callback(null, session), callback);
    }

    set(sid, session, callback = () => {}) {
        const json = JSON.stringify(session);
        const expiresAt = expiryOf(session);
        this.cache.set(sid, { json, expiresAt });
        setDoc(doc(db, SESSION_COLLECTION, documentId(sid)), { data: json, expiresAt, updatedAt: new Date().toISOString() })
            .then(() => callback(null), callback);
    }

    destroy(sid, callback = () => {}) {
        this.cache.delete(sid);
        deleteDoc(doc(db, SESSION_COLLECTION, documentId(sid))).then(() => callback(null), callback);
    }

    /**
     * Session from memory, else from the database; expired ones are deleted.
     *
     * @param {string} sid -> Session id.
     * @returns {Promise<Object|null>} -> Fresh session object or null.
     */
    async load(sid) {
        let entry = this.cache.get(sid);
        if (!entry) {
            const snap = await getDoc(doc(db, SESSION_COLLECTION, documentId(sid)));
            if (!snap.exists()) return null;
            entry = { json: snap.data().data, expiresAt: snap.data().expiresAt };
            this.cache.set(sid, entry);
        }
        if (isExpired(entry.expiresAt)) {
            await new Promise(resolve => this.destroy(sid, resolve));
            return null;
        }
        return JSON.parse(entry.json);
    }

    /**
     * Delete every expired session from memory and database.
     *
     * @returns {Promise<number>} -> Number of deleted database documents.
     */
    async pruneExpired() {
        for (const [sid, entry] of this.cache) {
            if (isExpired(entry.expiresAt)) this.cache.delete(sid);
        }
        const snapshot = await getDocs(collection(db, SESSION_COLLECTION));
        const expired = snapshot.docs.filter(snap => isExpired(snap.data().expiresAt));
        for (const snap of expired) {
            await deleteDoc(doc(db, SESSION_COLLECTION, snap.id));
        }
        return expired.length;
    }

    /**
     * Destroy every session whose user is not an admin.
     *
     * The `keepAdmins` option leaves admin sessions in place (panic mode uses
     * it so the lockdown can be deactivated).
     * @returns {Promise<number>} -> Number of destroyed sessions.
     */
    async destroyAll({ keepAdmins = false } = {}) {
        // An unreadable record belongs to no admin we must keep -> it goes too,
        // instead of aborting the lockdown halfway
        const isAdminSession = (json) => {
            try {
                return JSON.parse(json)?.user?.isAdmin === true;
            } catch {
                return false;
            }
        };
        let destroyed = 0;
        for (const [sid, entry] of [...this.cache]) {
            if (keepAdmins && isAdminSession(entry.json)) continue;
            await new Promise(resolve => this.destroy(sid, resolve));
            destroyed++;
        }
        const snapshot = await getDocs(collection(db, SESSION_COLLECTION));
        for (const snap of snapshot.docs) {
            if (keepAdmins && isAdminSession(snap.data().data)) continue;
            await deleteDoc(doc(db, SESSION_COLLECTION, snap.id));
            destroyed++;
        }
        return destroyed;
    }
}

/**
 * The shared store instance, so every caller (server bootstrap, panic mode)
 * works against the same cache and database.
 *
 * @returns {PersistentSessionStore} -> Process-wide store.
 */
function sharedSessionStore() {
    if (!defaultStore) defaultStore = new PersistentSessionStore();
    return defaultStore;
}

module.exports = { PersistentSessionStore, sharedSessionStore, SESSION_COLLECTION };
