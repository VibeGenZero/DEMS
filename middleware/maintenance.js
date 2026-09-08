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

module.exports = { checkRegistrationAllowed, isRegistrationBlocked };
