/**
 * Error classes of the plugin SDK. Their messages are German because the
 * host may show them to admins (plugin errors, admin API answers).
 */

/** A plugin called `ctx.data` with an invalid collection, document id, operator or value. */
class PluginDataError extends Error {
    constructor(message) {
        super(message);
        this.name = 'PluginDataError';
    }
}

module.exports = { PluginDataError };
