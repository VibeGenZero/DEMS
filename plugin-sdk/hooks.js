/**
 * Plugin hooks (SDK 1.0).
 *
 * The core calls `emitHook` after a change is committed. It never waits for
 * plugin handlers: every plugin has its own promise chain, so its handlers
 * run one after another in emission order while a slow plugin never delays
 * another one. Each handler gets its own deep copy of the payload, runs in
 * `try/catch`, and is skipped when the gate (the host's "is this plugin
 * enabled") says no at the moment it is about to run.
 */

const HOOK_NAMES = [
    'event.created', 'event.published', 'event.updated', 'event.ended',
    'event.cancelled', 'event.deleted', 'member.deleted'
];

/** Hooks that carry event data and need the `events:read` permission. */
const EVENT_HOOKS = HOOK_NAMES.filter(name => name.startsWith('event.'));

const DEFAULT_SLOW_HOOK_MS = 10000;

/** @type {Map<string, Map<string, Function[]>>} pluginId -> hook name -> handlers */
const handlers = new Map();
/** @type {Map<string, Promise<void>>} pluginId -> tail of its queue */
const queues = new Map();
/** @type {Map<string, number>} pluginId -> registration generation, bumped by clearHooks */
const generations = new Map();

let gate = null;
let errorReporter = null;
let slowHookMs = DEFAULT_SLOW_HOOK_MS;
let pending = 0;
let idleWaiters = [];

function assertHookName(name) {
    if (!HOOK_NAMES.includes(name)) throw new Error(`Unknown plugin hook: ${name}`);
}

/**
 * Register a handler of one plugin for one hook.
 *
 * @param {string} pluginId
 * @param {string} name -> One of HOOK_NAMES; anything else throws.
 * @param {(payload: object) => (void|Promise<void>)} handler
 */
function onHook(pluginId, name, handler) {
    assertHookName(name);
    if (typeof handler !== 'function') throw new Error(`Hook handler for ${name} must be a function`);
    if (!handlers.has(pluginId)) handlers.set(pluginId, new Map());
    const byName = handlers.get(pluginId);
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(handler);
}

/**
 * Remove every handler of a plugin; handlers it already has queued are dropped.
 *
 * @param {string} pluginId
 */
function clearHooks(pluginId) {
    handlers.delete(pluginId);
    generations.set(pluginId, (generations.get(pluginId) || 0) + 1);
}

/** @param {((pluginId: string) => boolean)|null} fn -> Consulted right before each queued handler runs. */
function setHookGate(fn) {
    gate = typeof fn === 'function' ? fn : null;
}

/** @param {((pluginId: string, message: string) => void)|null} fn -> Receives handler errors. */
function setHookErrorReporter(fn) {
    errorReporter = typeof fn === 'function' ? fn : null;
}

/** Tests only: threshold for the slow-hook warning in milliseconds. */
function setSlowHookMs(ms) {
    slowHookMs = ms;
}

function isAllowed(pluginId) {
    if (!gate) return true;
    try {
        return gate(pluginId) === true;
    } catch {
        return false;
    }
}

function reportError(pluginId, name, err) {
    console.error(`[plugin:${pluginId}] Hook ${name} failed:`, err);
    if (!errorReporter) return;
    try {
        errorReporter(pluginId, err && err.message ? err.message : String(err));
    } catch (reporterErr) {
        console.error(`[plugin:${pluginId}] Hook error reporter failed:`, reporterErr);
    }
}

async function runHandler(pluginId, name, handler, payload, generation) {
    if ((generations.get(pluginId) || 0) !== generation || !isAllowed(pluginId)) return;
    const timer = setTimeout(() => {
        console.warn(`⚠️ [plugin:${pluginId}] Hook ${name} braucht länger als ${slowHookMs / 1000} s`);
    }, slowHookMs);
    timer.unref?.();
    try {
        await handler(payload);
    } catch (err) {
        reportError(pluginId, name, err);
    } finally {
        clearTimeout(timer);
    }
}

function settle() {
    pending -= 1;
    if (pending > 0) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const resolve of waiters) resolve();
}

/**
 * Queue every registered handler for a hook; returns immediately.
 *
 * @param {string} name -> One of HOOK_NAMES; anything else throws (core bug).
 * @param {object} payload -> Copied per handler with `structuredClone`.
 */
function emitHook(name, payload) {
    assertHookName(name);
    for (const [pluginId, byName] of handlers) {
        const list = byName.get(name);
        if (!list || list.length === 0) continue;
        const generation = generations.get(pluginId) || 0;
        for (const handler of list) {
            const copy = structuredClone(payload);
            pending += 1;
            const tail = (queues.get(pluginId) || Promise.resolve())
                .then(() => runHandler(pluginId, name, handler, copy, generation))
                .finally(settle);
            queues.set(pluginId, tail);
        }
    }
}

/** @returns {Promise<void>} -> Resolves once every queue is drained (tests). */
function whenHooksIdle() {
    if (pending === 0) return Promise.resolve();
    return new Promise(resolve => idleWaiters.push(resolve));
}

/**
 * Event in the shape plugins see: the public shape plus `origin`.
 *
 * @param {string} id -> Event document id.
 * @param {object} data -> Stored event data.
 * @returns {object}
 */
function toPluginEvent(id, data) {
    // Lazy: eventUtils pulls in firebaseAdmin and the bot
    const { toPublicEvent } = require('../utils/eventUtils');
    return { ...toPublicEvent(id, data), origin: data.origin || null };
}

/**
 * Emit the status hooks for one saved event change.
 * A new event (`before === null`) counts as draft, a stored event without
 * a status as active (DEMS treats a missing status as active).
 *
 * @param {{ eventId: string, before: object|null, after: object }} change
 */
function emitEventStatusChange({ eventId, before, after }) {
    if (!after) return;
    const from = before ? (before.status || 'active') : 'draft';
    const to = after.status || 'active';
    let name = null;
    if (to === 'active' && from === 'draft') name = 'event.published';
    else if (to === 'archived' && from !== 'archived') name = 'event.ended';
    else if (to === 'cancelled' && from !== 'cancelled') name = 'event.cancelled';
    if (name) emitHook(name, { event: toPluginEvent(eventId, after) });
}

module.exports = {
    HOOK_NAMES,
    EVENT_HOOKS,
    onHook,
    clearHooks,
    setHookGate,
    setHookErrorReporter,
    setSlowHookMs,
    emitHook,
    whenHooksIdle,
    toPluginEvent,
    emitEventStatusChange
};
