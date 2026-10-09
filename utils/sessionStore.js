/**
 * express-session store on top of firebaseAdmin.js (SQLite or Firestore), so
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
}

module.exports = { PersistentSessionStore, SESSION_COLLECTION };
