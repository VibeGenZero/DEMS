/**
 * Network settings of DEMS while it runs as the plugin studio's child.
 *
 * Active only with PLUGIN_STUDIO=1 in mock mode (never with NODE_ENV=production):
 * the child listens on 127.0.0.1 only and answers only requests whose Host is the
 * preview origin (BASE_URL, reached through the studio's proxy) or its own
 * loopback port (health checks and hook triggers of the studio). Every other
 * mode keeps the default address and gets no guard.
 */

function isStudioChild(env) {
    return env.PLUGIN_STUDIO === '1' && env.DEV_MOCK === 'true' && env.NODE_ENV !== 'production';
}

/** @returns {string|undefined} -> Listen address of the HTTP server; undefined keeps the default. */
function listenHost(env = process.env) {
    return isStudioChild(env) ? '127.0.0.1' : undefined;
}

function previewHost(baseUrl) {
    try {
        return new URL(baseUrl).host.toLowerCase();
    } catch {
        return null;
    }
}

/**
 * Express middleware that refuses requests with an unexpected Host (403).
 * BASE_URL and PORT are read per request.
 *
 * @param {object} [env] -> Environment (tests pass their own).
 * @returns {Function|null} -> The middleware in studio mode, else null.
 */
function createHostGuard(env = process.env) {
    if (!isStudioChild(env)) return null;
    return (req, res, next) => {
        const host = String(req.headers.host || '').toLowerCase();
        const port = String(env.PORT || 3000);
        const allowed = [previewHost(env.BASE_URL), `127.0.0.1:${port}`, `localhost:${port}`];
        if (host && allowed.includes(host)) return next();
        res.status(403).type('text/plain').send('Ungültiger Host.');
    };
}

module.exports = { listenHost, createHostGuard };
