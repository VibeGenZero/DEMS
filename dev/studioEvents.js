/**
 * Debug events for the local plugin studio.
 *
 * The studio runs DEMS in mock mode as a forked child process and listens on
 * the fork IPC channel. Active only with PLUGIN_STUDIO=1, DEV_MOCK=true (never
 * together with NODE_ENV=production) and an IPC channel; otherwise every call
 * is a no-op.
 */
const MAX_STRING = 10240;

let customSender = null;

/** Replace the `process.send` lookup (tests); `null` restores it. */
function setSender(fn) {
    customSender = typeof fn === 'function' ? fn : null;
}

function sender() {
    if (customSender) return customSender;
    return typeof process.send === 'function' ? process.send.bind(process) : null;
}

/** @returns {boolean} -> True while DEMS runs as the studio's child in mock mode. */
function isActive() {
    return process.env.PLUGIN_STUDIO === '1'
        && process.env.DEV_MOCK === 'true'
        && process.env.NODE_ENV !== 'production'
        && sender() !== null;
}

function truncate(value) {
    if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}\u2026` : value;
    if (Array.isArray(value)) return value.map(truncate);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, truncate(entry)]));
    }
    return value;
}

/**
 * Send one event to the studio. Never throws.
 *
 * @param {string} type -> `dm`, `channel`, `role`, `log`, `request`, `hook`, `error` or `lifecycle`.
 * @param {string} pluginId
 * @param {object} data -> Event payload; strings are cut at 10 240 characters.
 */
function emit(type, pluginId, data) {
    try {
        if (!isActive()) return;
        sender()({ studio: true, type, pluginId, at: new Date().toISOString(), data: truncate(data) });
    } catch {
        // the studio is optional; a broken channel must never reach a plugin
    }
}

/**
 * In studio mode, end DEMS when the studio drops the IPC channel (studio closed or crashed),
 * so no orphaned child keeps its port.
 *
 * @param {object} proc -> `process` (tests pass a fake).
 * @returns {boolean} -> True when the handler was installed.
 */
function exitOnDisconnect(proc = process) {
    if (proc.env.PLUGIN_STUDIO !== '1' || typeof proc.send !== 'function') return false;
    proc.once('disconnect', () => proc.exit(0));
    return true;
}

module.exports = { isActive, emit, setSender, exitOnDisconnect };
