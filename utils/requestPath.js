/**
 * Path checks of the security middleware (CSRF check, setup and privacy gates).
 *
 * The checks compare the lower-cased path: a router mounted at /api answers
 * /API too as long as 'case sensitive routing' is off, so a case-sensitive
 * check would let such a request skip the gate (security report 2026-11).
 * server.js also switches case-sensitive routing on; both together keep a
 * gate correct even if one of them is changed later.
 */

/**
 * The request path in lower case, for comparisons only.
 *
 * @param {Object} req -> Express request.
 * @returns {string}
 */
function lowerPath(req) {
    return String((req && req.path) || '').toLowerCase();
}

/**
 * Whether the request goes to /api/….
 *
 * @param {Object} req -> Express request.
 * @returns {boolean}
 */
function isApiPath(req) {
    return lowerPath(req).startsWith('/api/');
}

/**
 * Whether the request goes to /api/… or /auth/….
 *
 * @param {Object} req -> Express request.
 * @returns {boolean}
 */
function isApiOrAuthPath(req) {
    return isApiPath(req) || lowerPath(req).startsWith('/auth/');
}

module.exports = { lowerPath, isApiPath, isApiOrAuthPath };
