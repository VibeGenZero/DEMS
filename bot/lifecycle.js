/**
 * Lifecycle of the bot: wiring the client listeners, login, waiting for the
 * ready event, the invite URL in the log and the graceful stop.
 */
const { Events } = require('discord.js');
const { debugLog } = require('../utils/debugLog');
const { buildBotInviteUrl } = require('../utils/botPermissions');
const { client, state } = require('./client');
const { registerSlashCommands } = require('./commands');
const { applyBotSettings, stopPresenceUpdates } = require('./settings');
const { handleInteraction } = require('./interactions');
const { stopReminderScheduler } = require('./scheduler');

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

    client.once(Events.ClientReady, async () => {
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
        await client.login(token);
        return true;
    } catch (err) {
        console.error('❌ Bot login fehlgeschlagen:', err.message);
        settleBotStart(false);
        return false;
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
    whenBotSettled,
    stopBot
};
