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

module.exports = { requireAuth, requireAdmin };
