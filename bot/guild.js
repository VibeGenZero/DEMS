/**
 * Guild data of the bot: roles, members, server name and icon, channels.
 */
const { PermissionsBitField, ChannelType } = require('discord.js');
const { debugLog } = require('../utils/debugLog');
const { client, state } = require('./client');
const { SELECTABLE_CHANNEL_TYPES } = require('./constants');

/**
 * Assign a role to a user in the configured guild
 */
async function assignRole(userId, roleId, guildId) {
    if (!state.isReady) {
        console.warn('Bot not ready yet, cannot assign role');
        return false;
    }
    debugLog('bot.assignRole', { userId, roleId });
    try {
        const guild = await client.guilds.fetch(guildId);
        const member = await guild.members.fetch(userId);
        await member.roles.add(roleId);
        console.log(`🎭 Role ${roleId} assigned to ${member.user.tag}`);
        return true;
    } catch (err) {
        console.error(`Failed to assign role to ${userId}:`, err.message);
        return false;
    }
}

/**
 * Remove a role from a user in the configured guild
 */
async function removeRole(userId, roleId, guildId) {
    if (!state.isReady) {
        console.warn('Bot not ready yet, cannot remove role');
        return false;
    }
    try {
        const guild = await client.guilds.fetch(guildId);
        const member = await guild.members.fetch(userId);
        await member.roles.remove(roleId);
        console.log(`🎭 Role ${roleId} removed from ${member.user.tag}`);
        return true;
    } catch (err) {
        console.error(`Failed to remove role from ${userId}:`, err.message);
        return false;
    }
}

/**
 * Take one role from several members of the configured guild, e.g. the event
 * role after an event is over (B-10). A member that cannot be fetched (left
 * the server) or refused counts as failed; the others still lose the role.
 *
 * @param {string} roleId -> Role to take.
 * @param {Array<string>} userIds -> Discord user ids.
 * @returns {Promise<{ removed: number, failed: number }|false>} -> Counts, or false while the bot is not ready.
 */
async function removeRoleFromMembers(roleId, userIds) {
    if (!state.isReady) return false;
    debugLog('bot.removeRoleFromMembers', { roleId, count: userIds.length });
    const result = { removed: 0, failed: 0 };
    let guild;
    try {
        guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
    } catch (err) {
        console.error(`Failed to fetch the guild to remove role ${roleId}:`, err.message);
        return { removed: 0, failed: userIds.length };
    }
    for (const userId of userIds) {
        try {
            const member = await guild.members.fetch(userId);
            await member.roles.remove(roleId);
            result.removed++;
        } catch (err) {
            console.error(`Failed to remove role ${roleId} from ${userId}:`, err.message);
            result.failed++;
        }
    }
    console.log(`🎭 Role ${roleId} removed from ${result.removed} member(s)`);
    return result;
}

/**
 * Get a user's roles in the guild
 */
async function getUserRoles(userId, guildId) {
    if (!state.isReady) return [];
    try {
        const guild = await client.guilds.fetch(guildId);
        const member = await guild.members.fetch(userId);
        return member.roles.cache.map(r => ({ id: r.id, name: r.name, color: r.hexColor }));
    } catch (err) {
        console.error(`Failed to get roles for ${userId}:`, err.message);
        return [];
    }
}

/**
 * Current role ids of a member for the periodic rights check (createRoleRefresh).
 * Unlike getUserRoles it tells "not a member" apart from "Discord cannot answer".
 *
 * @param {string} userId -> Discord user id.
 * @returns {Promise<{isMember: boolean, roleIds: string[]}|null>} -> null when the bot is not ready or Discord fails.
 */
async function fetchMemberRoleIds(userId) {
    if (!state.isReady) return null;
    try {
        const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
        const member = await guild.members.fetch({ user: userId, force: true });
        // roles.cache contains @everyone (id = guild id); the OAuth login does not list it
        return { isMember: true, roleIds: [...member.roles.cache.keys()].filter(id => id !== guild.id) };
    } catch (err) {
        if (err.code === 10007 || err.code === 10013) return { isMember: false, roleIds: [] }; // Unknown Member / User
        console.error(`Failed to check roles of ${userId}:`, err.message);
        return null;
    }
}

/**
 * Plain member data for the admin member search and manual registration (W-06).
 *
 * @param {import('discord.js').GuildMember} member -> Guild member.
 * @returns {{id: string, username: string, displayName: string, avatar: string}} -> Member data.
 */
function toMemberInfo(member) {
    return {
        id: member.id,
        username: member.user.username,
        displayName: member.displayName,
        avatar: member.displayAvatarURL() || ''
    };
}

/**
 * Search members of the guild by the start of their username or nickname (Discord's member search).
 *
 * @param {string} query -> Search text.
 * @param {number} [limit] -> Maximum number of hits.
 * @returns {Promise<Array<{id, username, displayName, avatar}>>} -> Members without bots; [] when the bot is not ready or Discord fails.
 */
async function searchGuildMembers(query, limit = 10) {
    if (!state.isReady) return [];
    try {
        const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
        const members = await guild.members.search({ query, limit });
        return [...members.values()].filter(member => !member.user.bot).map(toMemberInfo);
    } catch (err) {
        console.error('Failed to search guild members:', err.message);
        return [];
    }
}

/**
 * Look up one member of the guild.
 *
 * @param {string} userId -> Discord user id.
 * @returns {Promise<{id, username, displayName, avatar}|false|null>} -> The member, false when the user is no member,
 *   null when the bot is not ready or Discord fails.
 */
async function fetchGuildMember(userId) {
    if (!state.isReady) return null;
    try {
        const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
        const member = await guild.members.fetch(userId);
        return member.user.bot ? false : toMemberInfo(member);
    } catch (err) {
        if (err.code === 10007 || err.code === 10013) return false; // Unknown Member / User
        console.error(`Failed to fetch member ${userId}:`, err.message);
        return null;
    }
}

/**
 * Check if user is a member of the guild
 */
async function isGuildMember(userId, guildId) {
    if (!state.isReady) return false;
    try {
        const guild = await client.guilds.fetch(guildId);
        await guild.members.fetch(userId);
        return true;
    } catch {
        return false;
    }
}

/**
 * Get the guild/server name
 */
async function getGuildName(guildId) {
    if (!state.isReady) return '';
    try {
        const guild = await client.guilds.fetch(guildId);
        return guild.name || '';
    } catch (err) {
        console.error('Failed to get guild name:', err.message);
        return '';
    }
}

/**
 * Icon of the Discord server for the login page.
 *
 * @param {string} guildId -> Discord server ID.
 * @returns {Promise<string|null>} -> Image URL, null without an icon or while the bot is not ready.
 */
async function getGuildIconUrl(guildId) {
    if (!state.isReady) return null;
    try {
        const guild = await client.guilds.fetch(guildId);
        return guild.iconURL({ size: 256 }) || null;
    } catch (err) {
        console.error('Failed to get guild icon:', err.message);
        return null;
    }
}

/**
 * Get all roles from the guild (for admin dropdown)
 */
async function getGuildRoles(guildId) {
    if (!state.isReady) return [];
    try {
        const guild = await client.guilds.fetch(guildId);
        const roles = await guild.roles.fetch();
        return roles
            .filter(r => r.name !== '@everyone')
            .sort((a, b) => b.position - a.position)
            .map(r => ({ id: r.id, name: r.name, color: r.color, managed: r.managed }));
    } catch (err) {
        console.error('Failed to get guild roles:', err.message);
        return [];
    }
}

/**
 * Get all channels from the guild (for location autocomplete)
 */
async function getGuildChannels(guildId) {
    if (!state.isReady) return [];
    try {
        const guild = await client.guilds.fetch(guildId);
        const channels = await guild.channels.fetch();
        return channels
            .filter(c => c && [ChannelType.GuildVoice, ChannelType.GuildText, ChannelType.GuildStageVoice, ChannelType.GuildForum].includes(c.type))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(c => ({
                id: c.id,
                name: c.name,
                type: (c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice) ? 'voice' : 'text'
            }));
    } catch (err) {
        console.error('Failed to get guild channels:', err.message);
        return [];
    }
}

/**
 * Get the channels every guild member can see.
 *
 * Used for the channel picker of the web registration form -> private
 * channels must not leak to users that cannot see them anyway.
 *
 * @param {string} guildId -> The guild to read the channels from.
 * @returns {Promise<Array<Object>>} -> Channels as `{ id, name, type }`.
 * @example
 * const channels = await getPublicGuildChannels(process.env.DISCORD_GUILD_ID);
 */
async function getPublicGuildChannels(guildId) {
    if (!state.isReady) return [];
    try {
        const guild = await client.guilds.fetch(guildId);
        const channels = await guild.channels.fetch();
        const everyone = guild.roles.everyone;

        return channels
            .filter(channel => channel
                && SELECTABLE_CHANNEL_TYPES.includes(channel.type)
                && channel.permissionsFor(everyone)?.has(PermissionsBitField.Flags.ViewChannel))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(channel => ({
                id: channel.id,
                name: channel.name,
                type: (channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice) ? 'voice' : 'text'
            }));
    } catch (err) {
        console.error('Failed to get public guild channels:', err.message);
        return [];
    }
}

module.exports = {
    assignRole,
    removeRole,
    removeRoleFromMembers,
    getUserRoles,
    fetchMemberRoleIds,
    searchGuildMembers,
    fetchGuildMember,
    isGuildMember,
    getGuildName,
    getGuildIconUrl,
    getGuildRoles,
    getGuildChannels,
    getPublicGuildChannels
};
