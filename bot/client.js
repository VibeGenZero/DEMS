/**
 * The discord.js client of the bot and the runtime state its modules share.
 */
const { Client, GatewayIntentBits, IntentsBitField, Partials } = require('discord.js');
const { isThreadSyncEnabled } = require('../utils/threadSync');

const BASE_INTENTS = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildScheduledEvents
];

// The comment sync (B-16) reads thread messages: that needs the privileged Message
// Content intent, which must be switched on in the Developer Portal first, otherwise
// Discord refuses the login. So it is requested only with DISCORD_THREAD_SYNC=true.
// The partials let edits and deletions of messages from before a restart arrive.
const client = new Client({ intents: BASE_INTENTS, partials: [] });

/**
 * Set intents and partials from the current DISCORD_THREAD_SYNC. Called right
 * before a login, not when this module loads: a value from the setup wizard
 * reaches process.env only in loadSystemConfig(), after server.js required the bot (#146).
 *
 * @param {boolean} [threadSync] -> Whether the comment sync runs.
 */
function applyGatewayOptions(threadSync = isThreadSyncEnabled()) {
    client.options.intents = new IntentsBitField([
        ...BASE_INTENTS,
        ...(threadSync ? [GatewayIntentBits.MessageContent] : [])
    ]).freeze();
    client.options.partials = threadSync ? [Partials.Message, Partials.Channel] : [];
}

// Runtime state shared by the bot modules (an object, so every module sees updates)
const state = {
    isReady: false,
    startedAt: null,
    dmsSent: 0,
    commandsProcessed: 0
};

module.exports = {
    client,
    state,
    applyGatewayOptions
};
