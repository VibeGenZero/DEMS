/**
 * Entry point of the plugin SDK for the core: one plugin host per process.
 *
 * `server.js` calls `initPlugins` once at startup; routes, hooks and the
 * admin API reach the host through `pluginHost()`.
 */
const { createPluginHost } = require('./host');

let host = null;

/**
 * Create and start the plugin host; never rejects because of a plugin.
 *
 * @param {Parameters<typeof createPluginHost>[0]} options -> See `createPluginHost`.
 * @returns {Promise<ReturnType<typeof createPluginHost>>}
 * @example
 * await initPlugins({ officialDir: path.join(__dirname, 'plugins'), customDir: process.env.PLUGINS_DIR || 'data/plugins' });
 */
async function initPlugins(options) {
    const next = createPluginHost(options);
    await next.start();
    host = next;
    return host;
}

/** @returns {ReturnType<typeof createPluginHost>} -> The started host; throws before `initPlugins`. */
function pluginHost() {
    if (!host) throw new Error('Plugin host not initialized: call initPlugins() first.');
    return host;
}

module.exports = { initPlugins, pluginHost };
