/**
 * The discord.js client of the bot and the runtime state its modules share.
 */
const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildScheduledEvents
    ]
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
