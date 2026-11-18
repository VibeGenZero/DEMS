/**
 * Name of the community as the website and the calendar feed show it:
 * SERVER_NAME overrides the Discord server name, „DEMS“ is the fallback.
 * The bot is loaded inside the function (`require('../bot')`), so mock mode
 * swaps it as everywhere else; getGuildName answers '' while it is not ready.
 */

/**
 * @param {Object} [bot] -> Bot helpers with `getGuildName(guildId)`; defaults to `require('../bot')`.
 * @returns {Promise<string>}
 */
async function resolveServerName(bot) {
    if (process.env.SERVER_NAME) return process.env.SERVER_NAME;
    const guildId = process.env.DISCORD_GUILD_ID || '';
    if (!guildId) return 'DEMS';
    const name = await (bot || require('../bot')).getGuildName(guildId);
    return name || 'DEMS';
}

module.exports = { resolveServerName };
