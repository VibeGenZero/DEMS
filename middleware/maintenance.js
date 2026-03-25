const { db, doc, getDoc } = require('../firebaseAdmin');

/**
 * Middleware: Check if event registration is allowed
 * Blocks registration when maintenance mode has registrations disabled
 */
async function checkRegistrationAllowed(req, res, next) {
    try {
        const snap = await getDoc(doc(db, 'maintenanceSettings', 'config'));
        if (snap.exists()) {
            const data = snap.data();
            if (data.registrationDisabled || data.panicMode) {
                return res.status(503).json({
                    error: 'Event-Registrierungen sind wegen Wartungsarbeiten vorübergehend deaktiviert.'
                });
            }
        }
        next();
    } catch {
        // If we can't check, allow the request through
        next();
    }
}

module.exports = { checkRegistrationAllowed };
