/**
 * The core's side of the plugin hooks (SDK 1.0).
 *
 * Routes, the Discord commands and the auto-archive call these helpers after
 * a write is committed. Nothing in here may change or break a core answer:
 * every emission catches and logs its own errors (host not ready, a payload
 * that cannot be copied, ...). The origin check for `POST /api/admin/events`
 * lives here too, so the core has one place that decides what a plugin may
 * stamp on a new event.
 */
const { emitHook, emitEventStatusChange, toPluginEvent } = require('./hooks');

const ORIGIN_REF_MAX = 100;
const DRAFT_PERMISSION = 'events:draft';

/**
 * Emit a hook without ever throwing to the caller.
 *
 * @param {string} name -> Hook name.
 * @param {object|(() => object)} payload -> The payload, or a function that builds it (runs inside the guard).
 */
function safeEmit(name, payload) {
    try {
        emitHook(name, typeof payload === 'function' ? payload() : payload);
    } catch (err) {
        console.error(`Plugin hook ${name} could not be emitted:`, err);
    }
}

/**
 * `emitEventStatusChange` without ever throwing to the caller.
 *
 * @param {{ eventId: string, before: object|null, after: object }} change -> `after` is the full stored event after the write.
 */
function safeStatusChange(change) {
    try {
        emitEventStatusChange(change);
    } catch (err) {
        console.error('Plugin status hook could not be emitted:', err);
    }
}

/**
 * Hooks of a newly stored event: `event.created`, then its status hook.
 *
 * @param {string} eventId -> Event document id.
 * @param {object} stored -> The stored event data.
 */
function emitEventCreated(eventId, stored) {
    safeEmit('event.created', () => ({ event: toPluginEvent(eventId, stored) }));
    safeStatusChange({ eventId, before: null, after: stored });
}

/**
 * Keys of `updates` whose value differs from the stored event, without `updatedAt`.
 *
 * @param {object} oldEvent -> Stored event before the write.
 * @param {object} updates -> The written fields.
 * @returns {string[]}
 */
function changedFields(oldEvent, updates) {
    return Object.keys(updates).filter(key =>
        key !== 'updatedAt' && JSON.stringify(updates[key]) !== JSON.stringify(oldEvent[key]));
}

/**
 * Hooks of a saved edit (`PUT /api/admin/events/:id`, also each series date):
 * `event.updated` when a field changed, then the status hook.
 *
 * @param {string} eventId -> Event document id.
 * @param {object} oldEvent -> Stored event before the write.
 * @param {object} updates -> The written fields.
 */
function emitEventSaved(eventId, oldEvent, updates) {
    try {
        const after = { ...oldEvent, ...updates };
        const changed = changedFields(oldEvent, updates);
        if (changed.length > 0) safeEmit('event.updated', () => ({ event: toPluginEvent(eventId, after), changed }));
        safeStatusChange({ eventId, before: oldEvent, after });
    } catch (err) {
        console.error('Plugin hooks of a saved event could not be emitted:', err);
    }
}

/**
 * `event.deleted` for one deleted event.
 *
 * @param {string} eventId -> Event document id.
 * @param {object|null} stored -> The event read before the deletion.
 */
function emitEventDeleted(eventId, stored) {
    safeEmit('event.deleted', () => ({ eventId, origin: (stored && stored.origin) || null }));
}

const isPlainObject = (value) => value !== null && typeof value === 'object'
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));

/**
 * Check `pluginOrigin` of a create: a known, switched-on plugin with
 * `events:draft` and a `ref` of 1…100 characters (trimmed).
 *
 * @param {unknown} value -> `req.body.pluginOrigin`.
 * @param {{ isEnabled: Function, entryOf: Function }} [host] -> The plugin host (tests pass a double).
 * @returns {{ ok: true, origin: { plugin: string, ref: string } } | { ok: false }}
 */
function validatePluginOrigin(value, host) {
    try {
        if (!isPlainObject(value)) return { ok: false };
        const { plugin, ref } = value;
        if (typeof plugin !== 'string' || typeof ref !== 'string') return { ok: false };
        const trimmed = ref.trim();
        if (trimmed.length < 1 || trimmed.length > ORIGIN_REF_MAX) return { ok: false };
        const pluginHost = host || require('./index').pluginHost();
        const entry = pluginHost.entryOf(plugin);
        if (!entry || !pluginHost.isEnabled(plugin)) return { ok: false };
        const permissions = entry.manifest && Array.isArray(entry.manifest.permissions) ? entry.manifest.permissions : [];
        if (!permissions.includes(DRAFT_PERMISSION)) return { ok: false };
        return { ok: true, origin: { plugin, ref: trimmed } };
    } catch (err) {
        console.error('Plugin origin could not be checked:', err);
        return { ok: false };
    }
}

module.exports = {
    safeEmit,
    safeStatusChange,
    emitEventCreated,
    emitEventSaved,
    emitEventDeleted,
    changedFields,
    validatePluginOrigin
};
