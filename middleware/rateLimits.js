/**
 * The general limiter of /api/*: a logged-in user has an own budget (an
 * admin setting up events makes many requests, and several users may share
 * one address behind a router), everybody else counts per IP. Both limits can
 * be set with RATE_LIMIT_MAX_USER and RATE_LIMIT_MAX; they are read on every
 * request, so a changed environment needs no new limiter. Mounted after the
 * session middleware (server.js).
 */
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_IP_LIMIT = 200;
const DEFAULT_USER_LIMIT = 1000;

function positiveInteger(raw, fallback) {
    const value = Number(raw);
    return Number.isInteger(value) && value > 0 ? value : fallback;
}

const userOf = (req) => (req.session && req.session.user && req.session.user.id ? req.session.user : null);

/**
 * Requests allowed per 15 minutes for this request's caller.
 *
 * @param {Object} req -> Express request (session already read).
 * @param {Object} [env] -> Environment (process.env).
 * @returns {number}
 */
function apiLimitFor(req, env = process.env) {
    return userOf(req)
        ? positiveInteger(env.RATE_LIMIT_MAX_USER, DEFAULT_USER_LIMIT)
        : positiveInteger(env.RATE_LIMIT_MAX, DEFAULT_IP_LIMIT);
}

/**
 * The bucket a request counts against: the user once logged in, else the address.
 *
 * @param {Object} req -> Express request.
 * @returns {string}
 */
function apiLimitKey(req) {
    const user = userOf(req);
    return user ? `user:${user.id}` : `ip:${ipKeyGenerator(req.ip || '')}`;
}

/**
 * German refusal with the wait in whole minutes (at least one).
 *
 * @param {number} msLeft -> Time until the window resets.
 * @returns {string}
 */
function tooManyRequestsMessage(msLeft) {
    const minutes = Math.max(1, Math.ceil(msLeft / 60000));
    return `Zu viele Anfragen. Bitte warte etwa ${minutes} ${minutes === 1 ? 'Minute' : 'Minuten'} und versuche es dann erneut.`;
}

/**
 * The limiter for app.use('/api/', …).
 *
 * @param {Object} [options]
 * @param {Object} [options.env] -> Environment to read the limits from (process.env).
 * @param {boolean} [options.skip] -> True switches it off (dev mock mode: frequent reloads while developing).
 * @returns {Function} -> Express middleware.
 */
function createApiLimiter({ env = process.env, skip = false } = {}) {
    return rateLimit({
        windowMs: WINDOW_MS,
        limit: (req) => apiLimitFor(req, env),
        keyGenerator: apiLimitKey,
        standardHeaders: true,
        legacyHeaders: false,
        skip: () => skip,
        handler: (req, res) => {
            const reset = req.rateLimit && req.rateLimit.resetTime ? new Date(req.rateLimit.resetTime).getTime() : Date.now() + WINDOW_MS;
            res.status(429).json({ error: tooManyRequestsMessage(reset - Date.now()) });
        }
    });
}

module.exports = { apiLimitFor, apiLimitKey, tooManyRequestsMessage, createApiLimiter };
