/**
 * Discord roles for plugins (`ctx.discord.listRoles/addRole/removeRole`, SDK 1.1).
 *
 * A plugin may only touch roles that cannot make anyone a DEMS admin or hand
 * out moderation or server rights. The guard runs on the live role before
 * every change, so a role that gains such a right in Discord after an admin
 * chose it is refused from then on.
 */
const { client, state } = require('./client');
const { FORBIDDEN_ROLE_PERMISSIONS, isPluginAssignableRole } = require('../utils/pluginRoleGuard');

/** `#rrggbb` of a Discord colour number, null for "no colour" (0). */
function toHexColor(color) {
    return Number.isInteger(color) && color > 0 ? `#${color.toString(16).padStart(6, '0')}` : null;
}

/** Rights the channel overwrites of the guild allow a role (cached channels, so no extra request). */
function channelAllowsOf(guild, roleId) {
    const allows = [];
    const channels = guild.channels && guild.channels.cache ? [...guild.channels.cache.values()] : [];
    for (const channel of channels) {
        const overwrite = channel && channel.permissionOverwrites && channel.permissionOverwrites.cache
            ? channel.permissionOverwrites.cache.get(roleId) : null;
        if (overwrite) allows.push(...overwrite.allow.toArray());
    }
    return allows;
}

/** Plain data of a discord.js role for the guard, with the rights its channel overwrites allow. */
function toGuardRole(guild, role) {
    return {
        id: role.id, managed: role.managed, position: role.position,
        permissions: role.permissions.toArray(), channelAllows: channelAllowsOf(guild, role.id)
    };
}

/** The configured guild and what the guard needs from it. */
async function fetchGuardContext() {
    const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
    const me = guild.members.me || await guild.members.fetchMe();
    return {
        guild,
        options: { adminRoleId: process.env.DISCORD_ADMIN_ROLE_ID || '', botTopPosition: me.roles.highest.position, everyoneId: guild.id }
    };
}

/**
 * Roles of the configured guild a plugin may use, highest first.
 *
 * @returns {Promise<Array<{ id: string, name: string, color: string|null }>>} -> [] while the bot is not ready or on error.
 */
async function listPluginRoles() {
    if (!state.isReady) return [];
    try {
        const { guild, options } = await fetchGuardContext();
        const roles = await guild.roles.fetch();
        return [...roles.values()]
            .filter(role => isPluginAssignableRole(toGuardRole(guild, role), options))
            .sort((a, b) => b.position - a.position)
            .map(role => ({ id: role.id, name: role.name, color: toHexColor(role.color) }));
    } catch (err) {
        console.error('Failed to list plugin roles:', err.message);
        return [];
    }
}

/**
 * Give (`give: true`) or take a role from a member for a plugin, after the guard.
 *
 * @param {string} userId -> Discord user id.
 * @param {string} roleId -> Discord role id.
 * @param {boolean} give -> True adds the role, false removes it.
 * @returns {Promise<{ ok: true, changed: boolean } | { ok: false, code: 'not_ready'|'not_member'|'forbidden'|'refused' }>}
 */
async function setPluginRole(userId, roleId, give) {
    if (!state.isReady) return { ok: false, code: 'not_ready' };
    try {
        const { guild, options } = await fetchGuardContext();
        const role = await guild.roles.fetch(roleId).catch(() => null);
        if (!role || !isPluginAssignableRole(toGuardRole(guild, role), options)) return { ok: false, code: 'forbidden' };
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) return { ok: false, code: 'not_member' };
        const has = member.roles.cache.has(roleId);
        if (has === give) return { ok: true, changed: false };
        if (give) await member.roles.add(roleId);
        else await member.roles.remove(roleId);
        console.log(`🎭 Plugin role ${roleId} ${give ? 'given to' : 'taken from'} ${member.user.tag}`);
        return { ok: true, changed: true };
    } catch (err) {
        console.error(`Failed to ${give ? 'give' : 'take'} plugin role ${roleId} for ${userId}:`, err.message);
        return { ok: false, code: 'refused' };
    }
}

module.exports = { FORBIDDEN_ROLE_PERMISSIONS, isPluginAssignableRole, listPluginRoles, setPluginRole };
