/**
 * Optional bridge to the local plugin studio (`dev/studioEvents.js`).
 * dev/ may be absent and the studio is optional: without it every call is a no-op.
 */

/** @returns {object|null} -> The studioEvents module while the studio is active, else null. */
function studio() {
    try {
        const events = require('../dev/studioEvents');
        return events.isActive() ? events : null;
    } catch {
        return null;
    }
}

/** Send one event to the studio; never throws. */
function studioEmit(type, pluginId, data) {
    const events = studio();
    if (events) events.emit(type, pluginId, data);
}

module.exports = { studio, studioEmit };
