const crypto = require('crypto');
const { isDemsAdmin } = require('../utils/adminAccess');

/**
 * Middleware: Require authenticated user
 */
function requireAuth(req, res, next) {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ error: 'Nicht eingeloggt. Bitte melde dich über Discord an.' });
    }
    next();
}

/**
 * Middleware: Require admin role
 * Reads `isAdmin` of the session: the admin role (DISCORD_ADMIN_ROLE_ID) or the
 * Discord permission "Administrator", set at login and by createRoleRefresh.
 */
function requireAdmin(req, res, next) {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ error: 'Nicht eingeloggt.' });
    }

    const user = req.session.user;

    // Check if user is marked as admin
    if (!user.isAdmin) {
        return res.status(403).json({ error: 'Keine Administrator-Berechtigung.' });
    }

    next();
}

const ROLE_REFRESH_MS = 5 * 60 * 1000;
const ROLE_RETRY_MS = 60 * 1000;

/**
 * Middleware that re-reads the Discord roles of a logged-in user at most every
 * five minutes, so a revoked admin role (or a new one, or the Discord
 * permission "Administrator") takes effect without a new login. If Discord
 * cannot answer, the session keeps its values and the check is retried a
 * minute later — a bot outage must not lock admins out.
 *
 * @param {Object} options -> Dependencies.
 * @param {Function} options.fetchMemberRoleIds -> (userId) => { isMember, roleIds, isAdministrator } or null (bot.js).
 * @param {Function} [options.getAdminRoleId] -> Admin role id, default DISCORD_ADMIN_ROLE_ID.
 * @param {Function} [options.now] -> Clock in ms.
 * @returns {Function} -> Express middleware.
 */
function createRoleRefresh({ fetchMemberRoleIds, getAdminRoleId = () => process.env.DISCORD_ADMIN_ROLE_ID, now = Date.now }) {
    const lookups = new Map(); // userId -> pending lookup, shared by parallel requests

    const lookup = (userId) => {
        if (!lookups.has(userId)) {
            const pending = Promise.resolve()
                .then(() => fetchMemberRoleIds(userId))
                .catch(err => {
                    console.error(`Role check for ${userId} failed:`, err.message);
                    return null;
                })
                .finally(() => lookups.delete(userId));
            lookups.set(userId, pending);
        }
        return lookups.get(userId);
    };

    return async function refreshSessionRoles(req, res, next) {
        const user = req.session?.user;
        if (!user || now() - (user.rolesCheckedAt || 0) < ROLE_REFRESH_MS) return next();

        const result = await lookup(user.id);
        if (result) {
            user.roles = result.isMember ? result.roleIds : [];
            user.isAdmin = result.isMember && isDemsAdmin({
                roleIds: user.roles,
                isAdministrator: result.isAdministrator === true,
                adminRoleId: getAdminRoleId()
            });
            user.rolesCheckedAt = now();
        } else {
            // Discord unreachable: keep the values, ask again in a minute
            user.rolesCheckedAt = now() - ROLE_REFRESH_MS + ROLE_RETRY_MS;
        }
        next();
    };
}

/**
 * Compare a submitted secret with the configured one in constant time: both
 * are hashed first, so neither length nor content leak through timing.
 *
 * @param {*} submitted -> Value from the request.
 * @param {*} expected -> Configured secret.
 * @returns {boolean} -> True only for equal, non-empty strings.
 */
function safeEqual(submitted, expected) {
    if (typeof submitted !== 'string' || typeof expected !== 'string' || !expected) return false;
    const digest = (text) => crypto.createHash('sha256').update(text).digest();
    return crypto.timingSafeEqual(digest(submitted), digest(expected));
}

/**
 * New CSRF token for a session (double-submit check in server.js).
 *
 * @returns {string} -> 64 hex characters.
 */
function createCsrfToken() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Replace the session with a fresh one (new id) and log the user in, so a
 * session id planted before the login is worthless afterwards. Used by the
 * Discord login and the persona login of the dev mock mode.
 *
 * The CSRF token is minted here, not by the next request: the SPA fires
 * several requests at once after the login, and each would mint its own.
 *
 * @param {Object} req -> Express request.
 * @param {Object} user -> Session user.
 * @returns {Promise<void>} -> Resolves once the new session is stored.
 */
function startUserSession(req, user) {
    return new Promise((resolve, reject) => {
        req.session.regenerate(err => {
            if (err) return reject(err);
            req.session.user = user;
            req.session.csrfToken = createCsrfToken();
            req.session.save(saveErr => (saveErr ? reject(saveErr) : resolve()));
        });
    });
}

module.exports = { requireAuth, requireAdmin, createRoleRefresh, safeEqual, createCsrfToken, startUserSession };
