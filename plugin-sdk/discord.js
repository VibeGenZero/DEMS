/**
 * Discord access for plugins (`ctx.discord`) with its limits: messages (SDK 1.0)
 * and role changes through the bot's role guard (SDK 1.1, `discord:roles`).
 *
 * Plugins are not trusted to behave, so every rule is enforced here: the
 * permission (`discord:dm` / `discord:channel`), text length, a link button
 * only into this DEMS, DMs only to members DEMS knows, channel posts only to
 * the channel of one of the plugin's own `channel` settings, and a sliding
 * per-plugin budget of messages. Every message is sent with
 * `allowedMentions: { parse: [] }`, so plugin text never pings anyone.
 * Refusals answer `false` and log one warning; only a missing permission throws.
 */
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { buildSiteUrl } = require('../utils/eventUrl');
const { getTimezone } = require('../utils/timezone');
const { PluginPermissionError, PluginDataError } = require('./errors');

const WINDOW_MS = 600000;
const DM_LIMIT = 200;
const POST_LIMIT = 30;
const ROLE_LIMIT = 500;
const FORBIDDEN_ROLE = 'Diese Rolle darf ein Plugin nicht vergeben.';
const ROLE_REASONS = Object.freeze({
    not_ready: 'Der Bot ist nicht verbunden.',
    not_member: 'Das Mitglied ist nicht auf dem Server.',
    refused: 'Discord hat die Änderung abgelehnt.'
});
const TEXT_MAX = 2000;
const LABEL_MAX = 80;
const URL_MAX = 512;
const SNOWFLAKE = /^\d{17,20}$/;

const isSnowflake = value => typeof value === 'string' && SNOWFLAKE.test(value);

/**
 * Whether a URL points into this DEMS (an event, a plugin page, …).
 *
 * @param {unknown} url
 * @returns {boolean} -> True when it starts with `<BASE_URL>/#`.
 */
function isDemsUrl(url) {
    return typeof url === 'string' && url.startsWith(buildSiteUrl(''));
}

/** `HH:MM` of a timestamp in the DEMS time zone. */
function formatClock(ms) {
    return new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: getTimezone() }).format(new Date(ms));
}

/**
 * Per-plugin budget of messages and role changes in a sliding window, kept in memory (a restart resets it).
 *
 * @param {object} [options]
 * @param {number} [options.dms=200] -> DMs per plugin and window.
 * @param {number} [options.posts=30] -> Channel posts per plugin and window.
 * @param {number} [options.roles=500] -> Role changes per plugin and window (SDK 1.1).
 * @param {number} [options.windowMs=600000] -> Window length.
 * @param {() => number} [options.now=Date.now] -> Clock (tests).
 * @returns {{ take: (pluginId: string, kind: 'dm'|'post'|'role') => boolean, until: (pluginId: string, kind: string) => number|null,
 *   warning: (pluginId: string) => string|null }}
 * @example
 * const limiter = createMessageLimiter();
 * if (limiter.take('event-submissions', 'dm')) { ... }
 * limiter.warning('event-submissions'); // 'Nachrichtengrenze erreicht (bis 19:10)' or null
 */
function createMessageLimiter({ dms = DM_LIMIT, posts = POST_LIMIT, roles = ROLE_LIMIT, windowMs = WINDOW_MS, now = Date.now } = {}) {
    const limits = { dm: dms, post: posts, role: roles };
    /** @type {Map<string, number[]>} `<pluginId>:<kind>` -> send times inside the window, oldest first */
    const sent = new Map();

    function recent(pluginId, kind) {
        const key = `${pluginId}:${kind}`;
        const since = now() - windowMs;
        const times = (sent.get(key) || []).filter(time => time > since);
        if (times.length) sent.set(key, times);
        else sent.delete(key);
        return times;
    }

    /** @returns {number|null} -> When the kind can send again, null while it is not blocked. */
    function blockedUntil(pluginId, kind) {
        const times = recent(pluginId, kind);
        if (times.length < limits[kind]) return null;
        return times[times.length - limits[kind]] + windowMs;
    }

    return {
        take(pluginId, kind) {
            if (!(kind in limits)) throw new Error(`Unknown message kind: ${kind}`);
            const times = recent(pluginId, kind);
            if (times.length >= limits[kind]) return false;
            times.push(now());
            sent.set(`${pluginId}:${kind}`, times);
            return true;
        },
        until: blockedUntil,
        warning(pluginId) {
            const parts = [];
            const messages = Math.max(...['dm', 'post'].map(kind => blockedUntil(pluginId, kind) ?? -Infinity));
            if (messages !== -Infinity) parts.push(`Nachrichtengrenze erreicht (bis ${formatClock(messages)})`);
            const role = blockedUntil(pluginId, 'role');
            if (role !== null) parts.push(`Rollengrenze erreicht (bis ${formatClock(role)})`);
            return parts.length > 0 ? parts.join(' · ') : null;
        }
    };
}

/** @returns {string|null} -> Why the text is refused, null when it is fine. */
function checkText(text) {
    if (typeof text !== 'string' || text.trim() === '' || text.length > TEXT_MAX) {
        return `Der Text muss 1 bis ${TEXT_MAX} Zeichen lang sein.`;
    }
    return null;
}

/** @returns {string|null} -> Why the link is refused, null when it is fine or absent. */
function checkLink(link) {
    if (link === undefined || link === null) return null;
    const label = link && link.label;
    if (typeof label !== 'string' || label.trim() === '' || label.length > LABEL_MAX) {
        return `Der Link braucht eine Beschriftung mit 1 bis ${LABEL_MAX} Zeichen.`;
    }
    if (!isDemsUrl(link.url) || link.url.length > URL_MAX) return 'Der Link muss auf diese DEMS-Seite zeigen.';
    return null;
}

/** Message payload: plain text, an optional link button, never a mention. */
function buildPayload(text, link) {
    const components = link
        ? [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(link.url).setLabel(link.label)
        )]
        : [];
    return { content: text, components, allowedMentions: { parse: [] } };
}

const POST_NOT_DELIVERED = 'Die Kanalnachricht wurde nicht gesendet (der Bot ist nicht bereit oder der Kanal ist nicht erreichbar).';
const DM_NOT_DELIVERED = 'Die Direktnachricht wurde nicht zugestellt (DM-Benachrichtigungen sind ausgeschaltet oder das Mitglied ist nicht erreichbar).';

/** Forward a debug event to the local plugin studio (no-op without it; the dev module is optional). */
function studioEmit(type, pluginId, data) {
    try {
        require('../dev/studioEvents').emit(type, pluginId, data);
    } catch {
        // dev/ is not part of the runtime image
    }
}

/** Display name of a member for the studio's debug panel; null when unknown. Studio only. */
async function studioUserName(userId) {
    try {
        if (!require('../dev/studioEvents').isActive()) return null;
        const { db, doc, getDoc } = require('../firebaseAdmin');
        const snap = await getDoc(doc(db, 'users', String(userId)));
        return snap.exists() ? snap.data().displayName || null : null;
    } catch {
        return null;
    }
}

const defaultSendDm = (userId, payload) => require('../utils/botSettings').sendAutomaticDM(userId, payload);
const defaultSendChannel = (channelId, payload) => require('../bot').sendPluginChannelMessage(channelId, payload);
const defaultSetRole = (userId, roleId, give) => require('../bot').setPluginRole(userId, roleId, give);
const defaultListRoles = () => require('../bot').listPluginRoles();
async function defaultUserExists(userId) {
    const { db, doc, getDoc } = require('../firebaseAdmin');
    return (await getDoc(doc(db, 'users', String(userId)))).exists();
}

/**
 * Build `ctx.discord` for one plugin.
 *
 * @param {object} options
 * @param {string} options.pluginId
 * @param {string[]} options.permissions -> Granted permissions from the manifest.
 * @param {() => Promise<object>} options.readSettings -> Current setting values by key.
 * @param {import('./manifest').Setting[]} options.settingsSchema -> The manifest's settings.
 * @param {ReturnType<typeof createMessageLimiter>} options.limiter -> Shared by all plugins.
 * @param {{ info: Function, warn: Function, error: Function }} options.log -> Prefixed plugin logger.
 * @param {(userId: string, payload: object) => Promise<boolean>} [options.sendDm] -> Default: `sendAutomaticDM` (respects the bot center's DM switch).
 * @param {(channelId: string, payload: object) => Promise<boolean>} [options.sendChannel] -> Default: `bot.sendPluginChannelMessage`.
 * @param {(userId: string) => Promise<boolean>} [options.userExists] -> Default: `users/<userId>` exists.
 * @param {(userId: string, roleId: string, give: boolean) => Promise<object>} [options.setRole] -> Default: `bot.setPluginRole`.
 * @param {() => Promise<object[]>} [options.listRoles] -> Default: `bot.listPluginRoles`.
 * @param {() => number} [options.now=Date.now] -> Clock for "one limit warning per window" (tests).
 * @returns {{ sendDM: Function, sendChannelMessage: Function, listRoles: Function, addRole: Function, removeRole: Function }}
 */
function createDiscordApi({
    pluginId, permissions, readSettings, settingsSchema, limiter, log,
    sendDm = defaultSendDm, sendChannel = defaultSendChannel, userExists = defaultUserExists,
    setRole = defaultSetRole, listRoles = defaultListRoles, now = Date.now
}) {
    const granted = new Set(permissions || []);
    const limitWarnedAt = { dm: -Infinity, post: -Infinity };

    function requirePermission(permission) {
        if (!granted.has(permission)) throw new PluginPermissionError(permission);
    }

    /** Take from the budget; a refusal warns at most once per window and kind. */
    function take(kind, what) {
        if (limiter.take(pluginId, kind)) return true;
        if (now() - limitWarnedAt[kind] >= WINDOW_MS) {
            limitWarnedAt[kind] = now();
            log.warn(`${what} nicht gesendet: ${limitReason()}`);
        }
        return false;
    }

    const limitReason = () => `${limiter.warning(pluginId) || 'Nachrichtengrenze erreicht'}.`;

    function refuse(what, reason) {
        log.warn(`${what} nicht gesendet: ${reason}`);
        return false;
    }

    /**
     * Give or take a role through the bot's guard. Every call that reaches the bot uses one unit of budget.
     *
     * @returns {Promise<{ ok: true, changed: boolean } | { ok: false, reason: string }>}
     * @throws {PluginDataError} -> For a role id that is malformed or that the guard refuses.
     */
    async function changeRole(userId, roleId, give) {
        requirePermission('discord:roles');
        const report = (result, reason) => studioEmit('role', pluginId, { userId, roleId, give, result, reason: reason || null });
        if (!isSnowflake(roleId)) {
            report('refused', FORBIDDEN_ROLE);
            throw new PluginDataError(FORBIDDEN_ROLE);
        }
        if (!isSnowflake(userId)) {
            report('refused', 'Die Nutzer-ID ist ungültig.');
            return { ok: false, reason: 'Die Nutzer-ID ist ungültig.' };
        }
        if (!limiter.take(pluginId, 'role')) {
            const reason = `Rollengrenze erreicht (bis ${formatClock(limiter.until(pluginId, 'role'))})`;
            report('refused', reason);
            return { ok: false, reason };
        }
        let result;
        try {
            result = await setRole(userId, roleId, give);
        } catch (err) {
            log.error('Rollenänderung fehlgeschlagen:', err && err.message ? err.message : err);
            report('refused', ROLE_REASONS.refused);
            return { ok: false, reason: ROLE_REASONS.refused };
        }
        if (result && result.ok === true) {
            report('ok');
            return { ok: true, changed: result.changed === true };
        }
        if (result && result.code === 'forbidden') {
            report('refused', FORBIDDEN_ROLE);
            throw new PluginDataError(FORBIDDEN_ROLE);
        }
        const reason = ROLE_REASONS[result && result.code] || ROLE_REASONS.refused;
        report('refused', reason);
        return { ok: false, reason };
    }

    return {
        /**
         * Send a DM to a member DEMS knows.
         *
         * @param {string} userId -> Discord user id.
         * @param {{ text: string, link?: { label: string, url: string } }} message
         * @returns {Promise<boolean>} -> True when the DM was sent.
         */
        async sendDM(userId, { text, link } = {}) {
            requirePermission('discord:dm');
            const what = 'Direktnachricht';
            const report = async (result, reason) => studioEmit('dm', pluginId, {
                userId, userName: await studioUserName(userId), text, link: link || null, result, reason: reason || null
            });
            /** Log the refusal, tell the studio, answer false. */
            const refuseDm = async reason => {
                refuse(what, reason);
                await report('dropped', reason);
                return false;
            };
            if (!isSnowflake(userId)) return refuseDm('Die Nutzer-ID ist ungültig.');
            const problem = checkText(text) || checkLink(link);
            if (problem) return refuseDm(problem);
            try {
                if (!(await userExists(userId))) return refuseDm('DEMS kennt dieses Mitglied nicht.');
                if (!take('dm', what)) {
                    await report('dropped', limitReason());
                    return false;
                }
                const sent = (await sendDm(userId, buildPayload(text, link))) === true;
                await report(sent ? 'sent' : 'dropped', sent ? null : DM_NOT_DELIVERED);
                return sent;
            } catch (err) {
                log.error(`${what} fehlgeschlagen:`, err.message);
                await report('dropped', `Senden fehlgeschlagen: ${err.message}`);
                return false;
            }
        },

        /**
         * Post in the channel that one of the plugin's `channel` settings names.
         *
         * @param {string} settingKey -> Key of a `channel` setting of this plugin (never a raw channel id).
         * @param {{ text: string, link?: { label: string, url: string } }} message
         * @returns {Promise<boolean>} -> True when the message was posted.
         */
        async sendChannelMessage(settingKey, { text, link } = {}) {
            requirePermission('discord:channel');
            const what = 'Kanalnachricht';
            const report = (result, reason) => studioEmit('channel', pluginId, {
                channel: settingKey, text, link: link || null, result, reason: reason || null
            });
            /** Log the refusal, tell the studio, answer false. */
            const refusePost = reason => {
                refuse(what, reason);
                report('dropped', reason);
                return false;
            };
            const problem = checkText(text) || checkLink(link);
            if (problem) return refusePost(problem);
            const setting = (settingsSchema || []).find(entry => entry.key === settingKey && entry.type === 'channel');
            if (!setting) return refusePost(`„${settingKey}“ ist keine Kanal-Einstellung dieses Plugins.`);
            try {
                const values = (await readSettings()) || {};
                const channelId = values[settingKey];
                if (channelId === undefined || channelId === null || channelId === '') {
                    return refusePost(`Die Einstellung „${settingKey}“ ist leer.`);
                }
                if (!isSnowflake(channelId)) return refusePost(`Die Einstellung „${settingKey}“ enthält keine gültige Kanal-ID.`);
                if (!take('post', what)) {
                    report('dropped', limitReason());
                    return false;
                }
                const sent = (await sendChannel(channelId, buildPayload(text, link))) === true;
                report(sent ? 'sent' : 'dropped', sent ? null : POST_NOT_DELIVERED);
                return sent;
            } catch (err) {
                log.error(`${what} fehlgeschlagen:`, err.message);
                report('dropped', `Senden fehlgeschlagen: ${err.message}`);
                return false;
            }
        },

        /**
         * Roles of the server a plugin may give or take (the bot's guard), highest first.
         *
         * @returns {Promise<Array<{ id: string, name: string, color: string|null }>>} -> [] while the bot is not ready.
         */
        async listRoles() {
            requirePermission('discord:roles');
            try {
                const roles = await listRoles();
                return (Array.isArray(roles) ? roles : []).map(({ id, name, color }) => ({ id, name, color: color || null }));
            } catch (err) {
                log.error('Rollen konnten nicht gelesen werden:', err && err.message ? err.message : err);
                return [];
            }
        },

        /** @returns {Promise<{ ok: true, changed: boolean } | { ok: false, reason: string }>} -> `changed: false` when the member had it. */
        addRole: (userId, roleId) => changeRole(userId, roleId, true),

        /** @returns {Promise<{ ok: true, changed: boolean } | { ok: false, reason: string }>} -> `changed: false` when the member lacked it. */
        removeRole: (userId, roleId) => changeRole(userId, roleId, false)
    };
}

module.exports = { createMessageLimiter, createDiscordApi, isDemsUrl };
