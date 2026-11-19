/**
 * Plugin API: `GET /api/plugins` (client list for the SPA) and the dispatcher
 * for the routes plugins register with `ctx.routes.*`
 * (`/api/plugins/<pluginId>/<path>`).
 *
 * Mounted after the session, CSRF, setup and privacy middleware, so plugin
 * routes run behind the same chain as every core route. A handler gets plain
 * copies (`{ user, params, query, body }`), never `req` or `res`; its result
 * is sent as JSON. The on/off switch is checked on every request because
 * `routesOf` returns the routes regardless of it.
 */
const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { PluginHttpError } = require('../plugin-sdk/errors');

const MESSAGES = {
    pluginNotFound: 'Plugin nicht gefunden.',
    routeNotFound: 'Nicht gefunden.',
    pluginFailed: 'Im Plugin ist ein Fehler aufgetreten.',
    listFailed: 'Die Plugins konnten nicht geladen werden.'
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

const isHttpAnswer = err => err instanceof PluginHttpError && Number.isInteger(err.status) && err.status >= 400 && err.status <= 599;

/** Wrap a plugin handler: plain input in, JSON out, errors as German answers. */
function wrapHandler(host, pluginId, handler) {
    return async (req, res) => {
        try {
            const result = await handler({
                user: pluginUser(req.session.user),
                params: { ...req.params },
                query: structuredClone(req.query),
                body: structuredClone(req.body)
            });
            // structuredClone refuses functions and symbols anywhere, JSON.stringify refuses BigInt
            const json = JSON.stringify(structuredClone(result === undefined ? { success: true } : result));
            if (json === undefined) throw new Error('Das Ergebnis lässt sich nicht als JSON senden.');
            res.status(200).type('application/json').send(json);
        } catch (err) {
            if (isHttpAnswer(err)) return res.status(err.status).json({ error: String(err.message) });
            const message = err && err.message ? err.message : String(err);
            console.error(`[plugin:${pluginId}] Route ${req.method} ${req.path} failed: ${message}`);
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
            && route.access === other.access && route.handler === other.handler;
    });
}

/** Build the router of one plugin; a route Express refuses is skipped and reported. */
function buildPluginRouter(host, pluginId, routes) {
    const router = express.Router();
    for (const route of routes) {
        const method = String(route.method).toLowerCase();
        try {
            const guards = GUARDS[route.access];
            if (!guards || !['get', 'post', 'put', 'delete'].includes(method)) throw new Error('unsupported method or access');
            router[method](route.path, ...guards, wrapHandler(host, pluginId, route.handler));
        } catch (err) {
            console.error(`[plugin:${pluginId}] Route ${route.method} ${route.path} skipped: ${err.message}`);
            host.reportError(pluginId, `Route ${route.method} ${route.path} ist ungültig.`);
        }
    }
    return router;
}

/**
 * Router mounted at `/api/plugins`.
 *
 * @param {() => object} getHost -> Returns the plugin host; throws while it is not started.
 * @returns {import('express').Router}
 * @example
 * app.use('/api/plugins', createPluginRouter(() => pluginHost()));
 */
function createPluginRouter(getHost) {
    const router = express.Router();
    /** @type {Map<string, { routes: object[], router: import('express').Router }>} */
    const cache = new Map();

    function routerOf(host, pluginId) {
        const routes = host.routesOf(pluginId);
        const cached = cache.get(pluginId);
        if (cached && sameRoutes(cached.routes, routes)) return cached.router;
        const built = buildPluginRouter(host, pluginId, routes);
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

module.exports = { createPluginRouter };
