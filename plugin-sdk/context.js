/**
 * The `ctx` a plugin's `register(ctx)` gets.
 *
 * Built once per plugin by the host. Every part that reaches core data
 * checks the manifest permission first and throws `PluginPermissionError`
 * when it is missing (a guard rail, not a wall: plugin code runs in-process).
 * Values going in and out are plain data, never `req`, `res`, Discord
 * objects or database handles.
 */
const { db, collection, doc, getDoc, getDocs } = require('../firebaseAdmin');
const { buildEventUrl, buildSiteUrl } = require('../utils/eventUrl');
const { avatarUrlOf, repairAvatarUrl } = require('../utils/avatar');
const { parseDate, isEventOver } = require('../utils/eventListing');
const { createDataApi } = require('./data');
const { createDiscordApi } = require('./discord');
const { createThemeApi } = require('./theme');
const { createRegistrationsApi } = require('./registrations');
const { HOOK_NAMES, EVENT_HOOKS, REGISTRATION_HOOKS, onHook, toPluginEvent } = require('./hooks');
const { PluginPermissionError, PluginHttpError } = require('./errors');
const state = require('./state');

const ACCESS = ['member', 'admin'];
const METHODS = ['get', 'post', 'put', 'delete'];
const MAX_PATH_LENGTH = 200;
// Express path syntax without wildcards (`*`, `{*splat}`), query, fragment or whitespace
const ROUTE_PATH = /^\/[^\s*?#]*$/;
const MAX_DOC_ID_LENGTH = 128;
const AUDIT_ACTION = /^[a-zA-Z0-9_.-]{1,64}$/;
const SEALED = 'Routen und Hooks lassen sich nur während register() anmelden.';

/**
 * @typedef {object} RouteDef
 * @property {'GET'|'POST'|'PUT'|'DELETE'} method
 * @property {string} path -> Express path below `/api/plugins/<id>`.
 * @property {'member'|'admin'} access
 * @property {boolean} password -> Whether the route requires `ADMIN_RESET_PASSWORD`.
 * @property {(request: { user: object, params: object, query: object, body: object }) => unknown} handler
 */

/**
 * @typedef {object} ContextHost
 * @property {ReturnType<import('./discord').createMessageLimiter>} limiter -> Shared by all plugins.
 * @property {(coll: string) => Promise<void>} recordCollection -> Remembers a data collection of the plugin.
 * @property {RouteDef[]} routes -> Filled by `ctx.routes.*`.
 * @property {Function[]} disableCallbacks -> Filled by `ctx.onDisable`.
 * @property {() => boolean} [isRegistering] -> False once `register()` is over; routes and hooks are refused then.
 */

const isDocId = id => typeof id === 'string' && id.length >= 1 && id.length <= MAX_DOC_ID_LENGTH && !id.includes('/');

/** Console logger that prefixes every line with `[plugin:<id>]`. */
function createLog(pluginId) {
    const prefix = `[plugin:${pluginId}]`;
    return Object.freeze({
        info: (...args) => console.log(prefix, ...args),
        warn: (...args) => console.warn(prefix, ...args),
        error: (...args) => console.error(prefix, ...args)
    });
}

/** Start time of a stored event as milliseconds, Infinity without a valid date (sorts last). */
function startTime(event) {
    const start = parseDate(event.startDate);
    return start ? start.getTime() : Infinity;
}

/**
 * Build `ctx` for one plugin.
 *
 * @param {object} options
 * @param {import('./discovery').PluginEntry} options.entry -> A discovered plugin with a valid manifest.
 * @param {ContextHost} options.host -> What the host shares with this plugin's ctx.
 * @returns {object} -> The frozen ctx (see the spec table "Server side: ctx").
 * @example
 * const ctx = createContext({ entry, host: { limiter, recordCollection, routes: [], disableCallbacks: [] } });
 * await plugin.register(ctx);
 */
function createContext({ entry, host }) {
    const { id, manifest, official } = entry;
    const granted = new Set(manifest.permissions);
    const settingKeys = manifest.settings.map(setting => setting.key);
    const log = createLog(id);
    const isRegistering = typeof host.isRegistering === 'function' ? host.isRegistering : () => true;

    function requirePermission(permission) {
        if (!granted.has(permission)) throw new PluginPermissionError(permission);
    }

    function requireOpen() {
        if (!isRegistering()) throw new Error(SEALED);
    }

    /** Stored values of the manifest's setting keys, secrets included (server side only). */
    async function readSettings() {
        const stored = await state.readSettings(id);
        const values = {};
        for (const key of settingKeys) if (Object.hasOwn(stored, key)) values[key] = stored[key];
        return values;
    }

    function addRoute(method, path, options, handler) {
        const label = `Route ${method} ${typeof path === 'string' ? path : String(path)}`;
        requireOpen();
        if (typeof path !== 'string' || path.length > MAX_PATH_LENGTH || !ROUTE_PATH.test(path)) {
            throw new Error(`${label}: Pfad muss mit / beginnen und darf keine Platzhalter mit * enthalten.`);
        }
        const access = options && typeof options === 'object' ? options.access : undefined;
        if (!ACCESS.includes(access)) throw new Error(`${label}: access muss member oder admin sein.`);
        const password = options && typeof options === 'object' ? options.password : undefined;
        if (password !== undefined && typeof password !== 'boolean') {
            throw new Error(`${label}: password muss true oder false sein.`);
        }
        if (password === true && access !== 'admin') {
            throw new Error(`${label}: password: true gibt es nur mit access admin.`);
        }
        if (typeof handler !== 'function') throw new Error(`${label}: Handler muss eine Funktion sein.`);
        if (host.routes.some(route => route.method === method && route.path === path)) {
            throw new Error(`${label} ist bereits angemeldet.`);
        }
        host.routes.push({ method, path, access, password: password === true, handler });
    }

    const routes = {};
    for (const name of METHODS) {
        routes[name] = (path, options, handler) => addRoute(name.toUpperCase(), path, options, handler);
    }

    const events = {
        /** @returns {Promise<object|null>} -> The event in the plugin shape, null when there is none. */
        async get(eventId) {
            requirePermission('events:read');
            if (!isDocId(eventId)) return null;
            const snap = await getDoc(doc(db, 'events', eventId));
            return snap.exists() ? toPluginEvent(snap.id, snap.data()) : null;
        },
        /**
         * Every event (any status), sorted by start; `upcoming` keeps the ones not over yet.
         *
         * @param {{ upcoming?: boolean }} [options]
         * @returns {Promise<object[]>}
         */
        async list({ upcoming = false } = {}) {
            requirePermission('events:read');
            const snapshot = await getDocs(collection(db, 'events'));
            const now = new Date();
            return snapshot.docs
                .map(item => ({ id: item.id, data: item.data() }))
                .filter(({ data }) => !upcoming || (parseDate(data.startDate) !== null && !isEventOver(data, now)))
                .sort((a, b) => startTime(a.data) - startTime(b.data))
                .map(({ id: eventId, data }) => toPluginEvent(eventId, data));
        },
        /** @returns {string} -> Link that opens the event in DEMS. */
        url: eventId => buildEventUrl(eventId)
    };

    const members = {
        /** @returns {Promise<{ id: string, name: string, avatar: string }|null>} -> null for an unknown member. */
        async get(userId) {
            requirePermission('members:read');
            if (!isDocId(userId)) return null;
            const snap = await getDoc(doc(db, 'users', userId));
            if (!snap.exists()) return null;
            const user = snap.data();
            return {
                id: userId,
                name: String(user.displayName || user.username || user.globalName || ''),
                avatar: repairAvatarUrl(avatarUrlOf(user))
            };
        }
    };

    const hooks = {
        /**
         * @param {string} name -> One of the hook names; event hooks need `events:read`, registration hooks `registrations:read`.
         * @param {(payload: object) => (void|Promise<void>)} handler
         */
        on(name, handler) {
            requireOpen();
            if (!HOOK_NAMES.includes(name)) throw new Error(`Unbekannter Hook: ${name}`);
            if (EVENT_HOOKS.includes(name)) requirePermission('events:read');
            if (REGISTRATION_HOOKS.includes(name)) requirePermission('registrations:read');
            if (typeof handler !== 'function') throw new Error(`Hook ${name}: Handler muss eine Funktion sein.`);
            onHook(id, name, handler);
        }
    };

    /**
     * Write an audit log entry with the action `plugin:<id>:<action>`.
     *
     * @param {string} action -> `^[a-zA-Z0-9_.-]{1,64}$`.
     * @param {string} adminId -> The acting admin (or member) id.
     * @param {string} details -> German text for the audit log.
     * @param {string|null} [targetId]
     */
    async function audit(action, adminId, details, targetId = null) {
        if (typeof action !== 'string' || !AUDIT_ACTION.test(action)) throw new Error(`Ungültige Aktion für das Audit-Log: ${action}`);
        // Lazy: eventUtils pulls in the bot
        const { addAuditLog } = require('../utils/eventUtils');
        await addAuditLog(`plugin:${id}:${action}`, adminId, details, targetId);
    }

    function onDisable(fn) {
        if (typeof fn !== 'function') throw new Error('onDisable erwartet eine Funktion.');
        host.disableCallbacks.push(fn);
    }

    return Object.freeze({
        plugin: Object.freeze({ id, version: manifest.version, official }),
        log,
        routes: Object.freeze(routes),
        data: createDataApi(id, { recordCollection: host.recordCollection }),
        theme: createThemeApi(id, { granted }),
        settings: Object.freeze({ get: readSettings }),
        events: Object.freeze(events),
        registrations: createRegistrationsApi({ granted }),
        members: Object.freeze(members),
        discord: createDiscordApi({
            pluginId: id,
            permissions: manifest.permissions,
            readSettings: () => state.readSettings(id),
            settingsSchema: manifest.settings,
            limiter: host.limiter,
            log
        }),
        siteUrl: hash => buildSiteUrl(hash),
        audit,
        hooks: Object.freeze(hooks),
        onDisable,
        httpError: (status, message) => new PluginHttpError(status, message)
    });
}

module.exports = { createContext };
