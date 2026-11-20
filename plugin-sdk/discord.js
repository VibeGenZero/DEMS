/**
 * Discord access for plugins (`ctx.discord`) with its limits.
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
const { PluginPermissionError } = require('./errors');

const WINDOW_MS = 600000;
const DM_LIMIT = 200;
const POST_LIMIT = 30;
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
 * Per-plugin message budget in a sliding window, kept in memory (a restart resets it).
 *
 * @param {object} [options]
 * @param {number} [options.dms=200] -> DMs per plugin and window.
 * @param {number} [options.posts=30] -> Channel posts per plugin and window.
 * @param {number} [options.windowMs=600000] -> Window length.
 * @param {() => number} [options.now=Date.now] -> Clock (tests).
 * @returns {{ take: (pluginId: string, kind: 'dm'|'post') => boolean, warning: (pluginId: string) => string|null }}
 * @example
 * const limiter = createMessageLimiter();
 * if (limiter.take('event-submissions', 'dm')) { ... }
 * limiter.warning('event-submissions'); // 'Nachrichtengrenze erreicht (bis 19:10)' or null
 */
function createMessageLimiter({ dms = DM_LIMIT, posts = POST_LIMIT, windowMs = WINDOW_MS, now = Date.now } = {}) {
    const limits = { dm: dms, post: posts };
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
        warning(pluginId) {
            const until = Math.max(...Object.keys(limits).map(kind => blockedUntil(pluginId, kind) ?? -Infinity));
            return until === -Infinity ? null : `Nachrichtengrenze erreicht (bis ${formatClock(until)})`;
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

const defaultSendDm = (userId, payload) => require('../utils/botSettings').sendAutomaticDM(userId, payload);
const defaultSendChannel = (channelId, payload) => require('../bot').sendPluginChannelMessage(channelId, payload);
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
 * @param {() => number} [options.now=Date.now] -> Clock for "one limit warning per window" (tests).
 * @returns {{ sendDM: Function, sendChannelMessage: Function }}
 */
function createDiscordApi({
    pluginId, permissions, readSettings, settingsSchema, limiter, log,
    sendDm = defaultSendDm, sendChannel = defaultSendChannel, userExists = defaultUserExists, now = Date.now
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
            log.warn(`${what} nicht gesendet: ${limiter.warning(pluginId) || 'Nachrichtengrenze erreicht'}.`);
        }
        return false;
    }

    function refuse(what, reason) {
        log.warn(`${what} nicht gesendet: ${reason}`);
        return false;
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
            if (!isSnowflake(userId)) return refuse(what, 'Die Nutzer-ID ist ungültig.');
            const problem = checkText(text) || checkLink(link);
            if (problem) return refuse(what, problem);
            try {
                if (!(await userExists(userId))) return refuse(what, 'DEMS kennt dieses Mitglied nicht.');
                if (!take('dm', what)) return false;
                return (await sendDm(userId, buildPayload(text, link))) === true;
            } catch (err) {
                log.error(`${what} fehlgeschlagen:`, err.message);
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
            const problem = checkText(text) || checkLink(link);
            if (problem) return refuse(what, problem);
            const setting = (settingsSchema || []).find(entry => entry.key === settingKey && entry.type === 'channel');
            if (!setting) return refuse(what, `„${settingKey}“ ist keine Kanal-Einstellung dieses Plugins.`);
            try {
                const values = (await readSettings()) || {};
                const channelId = values[settingKey];
                if (channelId === undefined || channelId === null || channelId === '') {
                    return refuse(what, `Die Einstellung „${settingKey}“ ist leer.`);
                }
                if (!isSnowflake(channelId)) return refuse(what, `Die Einstellung „${settingKey}“ enthält keine gültige Kanal-ID.`);
                if (!take('post', what)) return false;
                return (await sendChannel(channelId, buildPayload(text, link))) === true;
            } catch (err) {
                log.error(`${what} fehlgeschlagen:`, err.message);
                return false;
            }
        }
    };
}

module.exports = { createMessageLimiter, createDiscordApi, isDemsUrl };
