const { db, doc, getDoc } = require('../firebaseAdmin');

/**
 * Check whether event registrations are currently blocked.
 *
 * Registrations are blocked while maintenance mode disables them or while
 * panic mode is active. When the settings cannot be read the registration is
 * allowed -> a failing settings lookup must not lock users out.
 *
 * @returns {Promise<boolean>} -> True when no new registration may be created.
 * @example
 * if (await isRegistrationBlocked()) return;
 */
async function isRegistrationBlocked() {
    try {
        const snap = await getDoc(doc(db, 'maintenanceSettings', 'config'));
        if (!snap.exists()) return false;
        const data = snap.data();
        return !!(data.registrationDisabled || data.panicMode);
    } catch {
        return false;
    }
}

/**
 * Check whether the maintenance settings block a login.
 *
 * Mirrors the rules of the Discord OAuth2 callback: panic mode and "login
 * disabled" lock out everybody except admins. When the settings cannot be
 * read the login is allowed -> a failing settings lookup must not lock users out.
 *
 * @param {boolean} isAdmin -> Whether the user logging in is an admin.
 * @returns {Promise<string|null>} -> Error code for the `/?error=` redirect, null when the login may proceed.
 */
async function getLoginBlockReason(isAdmin) {
    if (isAdmin) return null;
    try {
        const snap = await getDoc(doc(db, 'maintenanceSettings', 'config'));
        if (!snap.exists()) return null;
        const data = snap.data();
        if (data.panicMode) return 'panic_mode';
        if (data.loginDisabled) return 'maintenance_login_disabled';
        return null;
    } catch {
        return null;
    }
}

/**
 * Middleware: Check if event registration is allowed
 * Blocks registration when maintenance mode has registrations disabled
 */
async function checkRegistrationAllowed(req, res, next) {
    if (await isRegistrationBlocked()) {
        return res.status(503).json({
            error: 'Event-Registrierungen sind wegen Wartungsarbeiten vorübergehend deaktiviert.'
        });
    }
    next();
}

module.exports = { checkRegistrationAllowed, isRegistrationBlocked, getLoginBlockReason };
