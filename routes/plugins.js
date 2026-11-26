/**
 * Plugin API: `GET /api/plugins` (client list for the SPA) and the dispatcher
 * for the routes plugins register with `ctx.routes.*`
 * (`/api/plugins/<pluginId>/<path>`).
 *
 * Mounted after the session, CSRF, setup and privacy middleware, so plugin
 * routes run behind the same chain as every core route. A handler gets plain
 * copies (`{ user, params, query, body }`), never `req` or `res`; its result
 * is sent as JSON. The on/off switch is checked on every request because
 * `routesOf` returns the routes regardless of it. A handler that has not
 * answered after `handlerTimeoutMs` gets 504 and is reported; it cannot be
 * stopped, but its late result is dropped.
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const { requireAuth, requireAdmin, safeEqual } = require('../middleware/auth');
const { PluginHttpError } = require('../plugin-sdk/errors');
const { studio: studioEvents } = require('../plugin-sdk/studio');

const DEFAULT_HANDLER_TIMEOUT_MS = 30000;

/** Plain-text JSON of a body for the studio; '' when there is none. */
function bodyText(value) {
    if (value === undefined || value === null || (typeof value === 'object' && Object.keys(value).length === 0)) return '';
    return typeof value === 'string' ? value : JSON.stringify(value);
}

/** Report this request to the studio when it finishes; only wraps `res.send` while the studio listens. */
function watchRequest(studio, req, res, pluginId) {
    const started = process.hrtime.bigint();
    const requestPath = req.path;
    let responseBody = '';
    const send = res.send;
    res.send = function (body) {
        if (!responseBody) responseBody = bodyText(Buffer.isBuffer(body) ? '' : body);
        return send.call(this, body);
    };
    res.once('finish', () => {
        studio.emit('request', pluginId, {
            method: req.method,
            path: requestPath,
            status: res.statusCode,
            ms: Math.round(Number(process.hrtime.bigint() - started) / 1e4) / 100,
            requestBody: bodyText(req.body),
            responseBody
        });
    });
}

/** Real path of a plugin folder (junctions and links resolved, as `require` reports them), cached. */
const rootCache = new Map();
function realRoot(dir) {
    if (!rootCache.has(dir)) {
        let real = path.resolve(dir);
        try {
            real = fs.realpathSync(real);
        } catch {
            // keep the plain path
        }
        rootCache.set(dir, real);
    }
    return rootCache.get(dir);
}

/** First stack line that points into the plugin folder: `{ file, line }`, or `{}`. */
function pluginFrame(err, dir) {
    try {
        if (!err || !err.stack || !dir) return {};
        const root = realRoot(dir);
        for (const line of String(err.stack).split(/\r?\n/).slice(1)) {
            const match = /\(?((?:[A-Za-z]:)?[^():]+):(\d+):\d+\)?\s*$/.exec(line.trim().replace(/^at\s+/, ''));
            if (!match) continue;
            const file = path.resolve(match[1]);
            const same = text => (process.platform === 'win32' ? text.toLowerCase() : text);
            if (same(file).startsWith(same(root + path.sep))) {
                return { file: path.relative(root, file).split(path.sep).join('/'), line: Number(match[2]) };
            }
        }
    } catch {
        // best effort
    }
    return {};
}

/** Report a failed route to the studio. */
function studioRouteError(host, pluginId, err, message) {
    const studio = studioEvents();
    if (!studio) return;
    let dir = '';
    try {
        const entry = typeof host.entryOf === 'function' ? host.entryOf(pluginId) : null;
        dir = entry && entry.dir ? entry.dir : '';
    } catch {
        // no folder known
    }
    studio.emit('error', pluginId, { message, where: 'route', ...pluginFrame(err, dir) });
}

const MESSAGES = {
    pluginNotFound: 'Plugin nicht gefunden.',
    routeNotFound: 'Nicht gefunden.',
    pluginFailed: 'Im Plugin ist ein Fehler aufgetreten.',
    pluginTimeout: 'Das Plugin hat nicht rechtzeitig geantwortet.',
    listFailed: 'Die Plugins konnten nicht geladen werden.',
    badPassword: 'Ungültiges Admin-Reset-Passwort.'
};

const GUARDS = {
    member: [requireAuth],
    admin: [requireAuth, requireAdmin]
};

/** @returns {object|null} -> The started host, null before `initPlugins` is done. */
function readyHost(getHost) {
    try {
        return getHost();
    } catch {
        return null;
    }
}

/** The member as a plugin sees it. */
function pluginUser(user) {
    return {
        id: user.id,
        name: user.displayName || user.username || '',
        avatar: user.avatar || '',
        isAdmin: Boolean(user.isAdmin),
        roles: Array.isArray(user.roles) ? [...user.roles] : []
    };
}

const seconds = ms => String(ms / 1000).replace('.', ',');

/** Marks the timeout of `answerInTime`, so it is told apart from a throw of the handler. */
class HandlerTimeout extends Error {}

/** Resolve with `promise`, or reject with a `HandlerTimeout` after `ms`. */
async function answerInTime(promise, ms, message) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new HandlerTimeout(message)), ms);
    });
    try {
        return await Promise.race([promise, timeout]);
    } finally {
        clearTimeout(timer);
    }
}

const isHttpAnswer = err => err instanceof PluginHttpError && Number.isInteger(err.status) && err.status >= 400 && err.status <= 599;

/** Wrap a plugin handler: plain input in, JSON out, errors as German answers, at most `timeoutMs`. */
function wrapHandler(host, pluginId, route, timeoutMs) {
    const { handler } = route;
    return async (req, res) => {
        try {
            const input = {
                user: pluginUser(req.session.user),
                params: { ...req.params },
                query: structuredClone(req.query),
                body: structuredClone(req.body)
            };
            const result = await answerInTime(Promise.resolve().then(() => handler(input)), timeoutMs,
                `Route ${route.method} ${route.path} hat nicht innerhalb von ${seconds(timeoutMs)} s geantwortet.`);
            // structuredClone refuses functions and symbols anywhere, JSON.stringify refuses BigInt
            const json = JSON.stringify(structuredClone(result === undefined ? { success: true } : result));
            if (json === undefined) throw new Error('Das Ergebnis lässt sich nicht als JSON senden.');
            res.status(200).type('application/json').send(json);
        } catch (err) {
            if (isHttpAnswer(err)) return res.status(err.status).json({ error: String(err.message) });
            if (err instanceof HandlerTimeout) {
                console.error(`[plugin:${pluginId}] ${err.message}`);
                studioRouteError(host, pluginId, err, err.message);
                host.reportError(pluginId, err.message);
                return res.status(504).json({ error: MESSAGES.pluginTimeout });
            }
            const message = err && err.message ? err.message : String(err);
            console.error(`[plugin:${pluginId}] Route ${req.method} ${req.path} failed: ${message}`);
            studioRouteError(host, pluginId, err, message);
            host.reportError(pluginId, message);
            res.status(500).json({ error: MESSAGES.pluginFailed });
        }
    };
}

/** Same routes as when the cached router was built (a register retry swaps them). */
function sameRoutes(a, b) {
    return a.length === b.length && a.every((route, index) => {
        const other = b[index];
        return route.method === other.method && route.path === other.path
            && route.access === other.access && Boolean(route.password) === Boolean(other.password)
            && route.handler === other.handler;
    });
}

function requireResetPassword(req, res, next) {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    if (!safeEqual(body.password, process.env.ADMIN_RESET_PASSWORD)) {
        return res.status(401).json({ error: MESSAGES.badPassword });
    }
    const copy = { ...body };
    delete copy.password;
    req.body = copy;
    next();
}

/** Build the router of one plugin; a route Express refuses is skipped and reported. */
function buildPluginRouter(host, pluginId, routes, handlerTimeoutMs) {
    const router = express.Router();
    for (const route of routes) {
        const method = String(route.method).toLowerCase();
        try {
            const guards = GUARDS[route.access];
            if (!guards || !['get', 'post', 'put', 'delete'].includes(method)) throw new Error('unsupported method or access');
            const chain = route.password ? [...guards, requireResetPassword] : guards;
            router[method](route.path, ...chain, wrapHandler(host, pluginId, route, handlerTimeoutMs));
        } catch (err) {
            console.error(`[plugin:${pluginId}] Route ${route.method} ${route.path} skipped: ${err.message}`);
            studioRouteError(host, pluginId, null, `Route ${route.method} ${route.path} ist ungültig.`);
            host.reportError(pluginId, `Route ${route.method} ${route.path} ist ungültig.`);
        }
    }
    return router;
}

/**
 * Router mounted at `/api/plugins`.
 *
 * @param {() => object} getHost -> Returns the plugin host; throws while it is not started.
 * @param {object} [options]
 * @param {number} [options.handlerTimeoutMs] -> Time a handler has to answer (tests pass a short one).
 * @returns {import('express').Router}
 * @example
 * app.use('/api/plugins', createPluginRouter(() => pluginHost()));
 */
function createPluginRouter(getHost, { handlerTimeoutMs = DEFAULT_HANDLER_TIMEOUT_MS } = {}) {
    const router = express.Router();
    /** @type {Map<string, { routes: object[], router: import('express').Router }>} */
    const cache = new Map();

    function routerOf(host, pluginId) {
        const routes = host.routesOf(pluginId);
        const cached = cache.get(pluginId);
        if (cached && sameRoutes(cached.routes, routes)) return cached.router;
        const built = buildPluginRouter(host, pluginId, routes, handlerTimeoutMs);
        cache.set(pluginId, { routes, router: built });
        return built;
    }

    router.get('/', requireAuth, (req, res) => {
        try {
            const host = readyHost(getHost);
            if (!host) return res.json([]);
            res.json(host.clients().map(client => {
                const version = encodeURIComponent(client.version);
                return {
                    id: client.id,
                    name: client.name,
                    version: client.version,
                    official: client.official,
                    permissions: client.permissions,
                    client: `/plugins/${client.id}/client.js?v=${version}`,
                    css: client.hasCss ? `/plugins/${client.id}/client.css?v=${version}` : ''
                };
            }));
        } catch (err) {
            console.error('Plugin list error:', err);
            res.status(500).json({ error: MESSAGES.listFailed });
        }
    });

    router.use('/:pluginId', (req, res) => {
        try {
            const { pluginId } = req.params;
            const host = readyHost(getHost);
            if (!host || !host.isEnabled(pluginId)) return res.status(404).json({ error: MESSAGES.pluginNotFound });
            const studio = studioEvents();
            if (studio) watchRequest(studio, req, res, pluginId);
            routerOf(host, pluginId)(req, res, (err) => {
                if (err) {
                    console.error(`[plugin:${pluginId}] Dispatch error:`, err);
                    return res.status(500).json({ error: MESSAGES.pluginFailed });
                }
                res.status(404).json({ error: MESSAGES.routeNotFound });
            });
        } catch (err) {
            console.error('Plugin dispatch error:', err);
            res.status(500).json({ error: MESSAGES.pluginFailed });
        }
    });

    return router;
}

module.exports = { createPluginRouter, DEFAULT_HANDLER_TIMEOUT_MS };
