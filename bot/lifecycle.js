/**
 * Lifecycle of the bot: wiring the client listeners, login, waiting for the
 * ready event, the invite URL in the log and the graceful stop.
 */
const { Events } = require('discord.js');
const { debugLog } = require('../utils/debugLog');
const { buildBotInviteUrl } = require('../utils/botPermissions');
const { client, state, applyGatewayOptions } = require('./client');
const { registerSlashCommands } = require('./commands');
const { applyBotSettings, stopPresenceUpdates } = require('./settings');
const { handleInteraction } = require('./interactions');
const { stopReminderScheduler } = require('./scheduler');
const { handleThreadMessage, handleThreadMessageUpdate, handleThreadMessageDelete } = require('./threadSync');

// Settles with true once the bot is ready, with false when it will not start
let settleBotStart;
const botStartSettled = new Promise(resolve => { settleBotStart = resolve; });
const BOT_SETTLE_TIMEOUT_MS = 2 * 60 * 1000;

let clientWired = false;

/**
 * Attach the ready, error and interaction listeners to the client, once.
 * bot.js calls it when it is loaded.
 */
function wireClient() {
    if (clientWired) return;
    clientWired = true;

    // "on", not "once": restartBot() logs in again after a token or guild change (#138)
    client.on(Events.ClientReady, async () => {
        console.log(`🤖 Bot logged in as ${client.user.tag}`);
        debugLog('bot.ready', { tag: client.user.tag, guildId: process.env.DISCORD_GUILD_ID });
        state.isReady = true;
        state.startedAt = new Date();
        settleBotStart(true);
        await registerSlashCommands();
        logBotInviteUrl();
        await applyBotSettings();
    });

    client.on('error', (err) => {
        console.error('🤖 Bot error:', err.message);
    });

    client.on('interactionCreate', handleInteraction);

    // Comment ↔ thread sync (B-16); the handlers return at once without DISCORD_THREAD_SYNC
    client.on(Events.MessageCreate, (message) => {
        handleThreadMessage(message).catch(err => console.error('Thread message sync error:', err.message));
    });
    client.on(Events.MessageUpdate, (oldMessage, newMessage) => {
        handleThreadMessageUpdate(oldMessage, newMessage).catch(err => console.error('Thread edit sync error:', err.message));
    });
    client.on(Events.MessageDelete, (message) => {
        handleThreadMessageDelete(message).catch(err => console.error('Thread delete sync error:', err.message));
    });
}

/**
 * Generate and log the bot invite URL with all required permissions
 */
function logBotInviteUrl() {
    const clientId = process.env.DISCORD_CLIENT_ID || client.user?.id;
    if (!clientId) {
        console.warn('⚠️ Keine Client ID verfügbar — Invite URL konnte nicht generiert werden.');
        return;
    }

    // Permission list with reasons: utils/botPermissions.js
    const inviteUrl = buildBotInviteUrl(clientId);

    console.log('\n🔗 ════════════════════════════════════════════════════');
    console.log('   Bot Invite URL (mit allen benötigten Rechten):');
    console.log(`   ${inviteUrl}`);
    console.log('════════════════════════════════════════════════════════\n');
}

/**
 * Start the bot — returns a Promise that resolves when ready or rejects on error
 */
async function startBot(token) {
    if (!token) {
        console.warn('⚠️ No bot token provided, bot will not start.');
        settleBotStart(false);
        return false;
    }
    try {
        applyGatewayOptions();
        await client.login(token);
        return true;
    } catch (err) {
        console.error('❌ Bot login fehlgeschlagen:', err.message);
        settleBotStart(false);
        return false;
    }
}

// How long a re-login may take before the setup reports it as failed
const RESTART_TIMEOUT_MS = 30 * 1000;
// Gateway close codes: 4004 = authentication failed, 4014 = disallowed intents
const CLOSE_AUTH_FAILED = 4004;
const CLOSE_DISALLOWED_INTENTS = 4014;

/**
 * Map a login error to the code the setup wizard and the "System" view
 * turn into a German message.
 *
 * @param {Error|null} err -> Error thrown by client.login().
 * @returns {'invalid_token'|'disallowed_intents'|'unknown'}
 */
function classifyLoginError(err) {
    if (!err) return 'unknown';
    if (err.code === CLOSE_DISALLOWED_INTENTS || /disallowed intents/i.test(err.message || '')) return 'disallowed_intents';
    if (err.code === 'TokenInvalid' || err.code === CLOSE_AUTH_FAILED || /invalid token|authentication failed/i.test(err.message || '')) return 'invalid_token';
    return 'unknown';
}

/**
 * Log the bot out (if it is logged in) and in again with a token, without a
 * restart of DEMS (#138). The reminder scheduler keeps running; the ready
 * handler registers the slash commands and applies the bot-center settings again.
 *
 * @param {string} token -> Bot token.
 * @param {Object} [options] -> `{ timeoutMs }` how long to wait for the ready event.
 * @returns {Promise<{ ok: true, guildName: string|null }|{ ok: false, error: string }>}
 */
async function restartBot(token, { timeoutMs = RESTART_TIMEOUT_MS } = {}) {
    if (!token) return { ok: false, error: 'invalid_token' };
    let timer;
    try {
        stopPresenceUpdates();
        state.isReady = false;
        await client.destroy();

        const ready = new Promise(resolve => client.once(Events.ClientReady, () => resolve(true)));
        const timeout = new Promise(resolve => {
            timer = setTimeout(() => resolve(false), timeoutMs);
            if (typeof timer.unref === 'function') timer.unref();
        });
        // Takes effect on a first login (setup wizard); an existing gateway keeps its intents
        applyGatewayOptions();
        await client.login(token);
        if (!(await Promise.race([ready, timeout]))) return { ok: false, error: 'timeout' };

        settleBotStart(true);
        const guild = client.guilds.cache.get(process.env.DISCORD_GUILD_ID);
        return { ok: true, guildName: guild ? guild.name : null };
    } catch (err) {
        console.error('❌ Bot-Neuanmeldung fehlgeschlagen:', err.message);
        return { ok: false, error: classifyLoginError(err) };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Wait until the bot is ready, or until it is clear that it will not be:
 * no token, a failed login, or no ready event within two minutes.
 *
 * @param {number} [timeoutMs] -> How long to wait for the ready event.
 * @returns {Promise<boolean>} -> True once ready, else false.
 */
function whenBotSettled(timeoutMs = BOT_SETTLE_TIMEOUT_MS) {
    let timer;
    const timeout = new Promise(resolve => {
        timer = setTimeout(() => resolve(false), timeoutMs);
        if (typeof timer.unref === 'function') timer.unref();
    });
    return Promise.race([botStartSettled, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Stop the bot and clear the reminder scheduler (for graceful shutdown)
 */
function stopBot() {
    stopReminderScheduler();
    stopPresenceUpdates();
    if (state.isReady) {
        client.destroy();
        state.isReady = false;
    }
    console.log('🤖 Bot & Reminder Scheduler gestoppt.');
}

module.exports = {
    wireClient,
    startBot,
    restartBot,
    classifyLoginError,
    whenBotSettled,
    stopBot
};
