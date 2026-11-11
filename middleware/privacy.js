/**
 * Consent gate of the privacy policy (#138). While a policy exists, a member
 * whose accepted version is lower than the current one gets 403 with
 * `privacyRequired: true` on every /api request except the few the consent
 * dialog and the start page need. /auth is never gated (login, /auth/me, logout).
 *
 * The current version comes from memory (utils/privacyPolicy.js), the accepted
 * one from the session; a session without it reads the user document once.
 */
const { db, doc, getDoc } = require('../firebaseAdmin');
const { currentPrivacyVersion, needsConsent } = require('../utils/privacyPolicy');

const OPEN_PATHS = ['/api/privacy', '/api/user/privacy/accept', '/api/csrf-token', '/api/server-info', '/api/maintenance/status', '/api/updates'];
const GATE_ANSWER = { error: 'Bitte akzeptiere zuerst die Datenschutzerklärung.', privacyRequired: true };

/**
 * Version the logged-in member accepted; loaded into the session on first use.
 *
 * @param {Object} req -> Request with a logged-in session.
 * @returns {Promise<number|null>}
 */
async function acceptedVersionOf(req) {
    const user = req.session.user;
    if (user.privacyAcceptedVersion === undefined) {
        const snap = await getDoc(doc(db, 'users', user.id));
        const stored = snap.exists() ? snap.data().privacyAcceptedVersion : null;
        user.privacyAcceptedVersion = Number.isInteger(stored) ? stored : null;
    }
    return user.privacyAcceptedVersion;
}

/**
 * Whether the logged-in member still has to accept the policy.
 *
 * @param {Object} req -> Request with a logged-in session.
 * @returns {Promise<{ required: boolean, version: number }>} -> `version` = current policy version (0 = none).
 */
async function privacyStateOf(req) {
    const version = await currentPrivacyVersion();
    if (version === 0) return { required: false, version };
    return { required: needsConsent(version, await acceptedVersionOf(req)), version };
}

/**
 * Middleware for /api: answer 403 until the member accepted the current policy.
 * A failing lookup lets the request through, so it never locks everybody out.
 */
async function privacyGate(req, res, next) {
    if (!req.path.startsWith('/api/') || OPEN_PATHS.includes(req.path) || !req.session || !req.session.user) return next();
    try {
        if ((await privacyStateOf(req)).required) return res.status(403).json(GATE_ANSWER);
    } catch (err) {
        console.error('Datenschutz-Prüfung fehlgeschlagen:', err.message);
    }
    next();
}

module.exports = { privacyGate, privacyStateOf, GATE_ANSWER };
