/**
 * Members for plugins (`ctx.members`, permission `members:read`): one member
 * by id (SDK 1.0) and a name search (SDK 1.1). Only name and avatar of
 * members who logged in once (a `users` document) ever leave this module.
 */
const { db, collection, doc, getDoc, getDocs } = require('../firebaseAdmin');
const { avatarUrlOf, repairAvatarUrl } = require('../utils/avatar');
const { PluginPermissionError } = require('./errors');

const PERMISSION = 'members:read';
const MAX_ID_LENGTH = 128;
const SEARCH_MIN = 2;
const SEARCH_MAX = 50;
const SEARCH_LIMIT = 20;

const isDocId = id => typeof id === 'string' && id.length >= 1 && id.length <= MAX_ID_LENGTH && !id.includes('/');

/** A stored user in the shape plugins see. */
function toPluginMember(userId, user) {
    return {
        id: userId,
        name: String(user.displayName || user.username || user.globalName || ''),
        avatar: repairAvatarUrl(avatarUrlOf(user))
    };
}

/**
 * Build `ctx.members` for one plugin.
 *
 * @param {{ granted: Set<string> }} options -> Granted manifest permissions.
 * @returns {{ get: (userId: string) => Promise<object|null>, search: (query: string) => Promise<object[]> }}
 */
function createMembersApi({ granted }) {
    function requirePermission() {
        if (!granted.has(PERMISSION)) throw new PluginPermissionError(PERMISSION);
    }

    return Object.freeze({
        /** @returns {Promise<{ id: string, name: string, avatar: string }|null>} -> null for an unknown member. */
        async get(userId) {
            requirePermission();
            if (!isDocId(userId)) return null;
            const snap = await getDoc(doc(db, 'users', userId));
            return snap.exists() ? toPluginMember(userId, snap.data()) : null;
        },

        /**
         * Members whose display, user or global name contains the query (trimmed, any case, 2–50 characters).
         *
         * @returns {Promise<Array<{ id: string, name: string, avatar: string }>>} -> At most 20, sorted by name.
         */
        async search(query) {
            requirePermission();
            if (typeof query !== 'string') return [];
            const needle = query.trim().toLowerCase();
            if (needle.length < SEARCH_MIN || needle.length > SEARCH_MAX) return [];
            const snapshot = await getDocs(collection(db, 'users'));
            return snapshot.docs
                .filter(item => {
                    const user = item.data();
                    return [user.displayName, user.username, user.globalName]
                        .some(name => typeof name === 'string' && name.toLowerCase().includes(needle));
                })
                .map(item => toPluginMember(item.id, item.data()))
                .sort((a, b) => a.name.localeCompare(b.name, 'de'))
                .slice(0, SEARCH_LIMIT);
        }
    });
}

module.exports = { createMembersApi };
