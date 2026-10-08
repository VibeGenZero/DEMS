const crypto = require('crypto');

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
 * Checks if the user has the admin role configured in ENV,
 * or has the ADMINISTRATOR permission on Discord.
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

module.exports = { requireAuth, requireAdmin, createCsrfToken, startUserSession };
