/**
 * The discord.js client of the bot and the runtime state its modules share.
 */
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { isThreadSyncEnabled } = require('../utils/threadSync');

// The comment sync (B-16) reads thread messages: that needs the privileged Message
// Content intent, which must be switched on in the Developer Portal first, otherwise
// Discord refuses the login. So it is requested only with DISCORD_THREAD_SYNC=true.
// The partials let edits and deletions of messages from before a restart arrive.
const threadSync = isThreadSyncEnabled();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildScheduledEvents,
        ...(threadSync ? [GatewayIntentBits.MessageContent] : [])
    ],
    partials: threadSync ? [Partials.Message, Partials.Channel] : []
});

// Runtime state shared by the bot modules (an object, so every module sees updates)
const state = {
    isReady: false,
    startedAt: null,
    dmsSent: 0,
    commandsProcessed: 0
};

module.exports = {
    client,
    state
};
