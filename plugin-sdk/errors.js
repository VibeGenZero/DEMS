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

/** A plugin used a part of `ctx` its manifest does not ask permission for. */
class PluginPermissionError extends Error {
    /**
     * @param {string} permission -> The missing permission, e.g. `discord:dm`.
     */
    constructor(permission) {
        super(`Dem Plugin fehlt die Berechtigung „${permission}“.`);
        this.name = 'PluginPermissionError';
        this.permission = permission;
    }
}

/** Thrown by a plugin route handler (`ctx.httpError`) to answer with a status and a German message. */
class PluginHttpError extends Error {
    /**
     * @param {number} status -> HTTP status of the answer.
     * @param {string} message -> German text of `{ error }`.
     */
    constructor(status, message) {
        super(message);
        this.name = 'PluginHttpError';
        this.status = Number(status);
    }
}

/** The plugin host refused an admin action (switch, settings, data delete); the message is German. */
class PluginHostError extends Error {
    constructor(message) {
        super(message);
        this.name = 'PluginHostError';
    }
}

/** A `.dems` package is unreadable or breaks a limit; the message is German. */
class PackageError extends Error {
    constructor(message) {
        super(message);
        this.name = 'PackageError';
    }
}

module.exports = { PackageError, PluginDataError, PluginPermissionError, PluginHttpError, PluginHostError };
