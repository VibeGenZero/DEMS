/**
 * The role guard for plugins (SDK 1.1): which Discord roles a plugin may give
 * or take. Pure, so the real bot (bot/pluginRoles.js) and the mock server
 * (dev/mockBot.js) apply the same rule.
 */

/** Permission names (discord.js `PermissionFlagsBits` keys) a plugin role must not carry. */
const FORBIDDEN_ROLE_PERMISSIONS = Object.freeze([
    'Administrator', 'ManageGuild', 'ManageRoles', 'ManageChannels', 'ManageWebhooks', 'ManageGuildExpressions',
    'ManageEvents', 'ManageMessages', 'ManageThreads', 'ManageNicknames', 'KickMembers', 'BanMembers',
    'ModerateMembers', 'MentionEveryone', 'ViewAuditLog', 'ViewGuildInsights'
]);

/**
 * Whether a plugin may give or take a role.
 *
 * @param {{ id: string, managed: boolean, position: number, permissions: string[] }|null} role -> Plain role data.
 * @param {{ adminRoleId?: string, botTopPosition: number, everyoneId: string }} guild -> DEMS admin role, the
 *   position of the bot's highest role and the id of @everyone (the guild id).
 * @returns {boolean}
 */
function isPluginAssignableRole(role, { adminRoleId = '', botTopPosition, everyoneId }) {
    if (!role || typeof role.id !== 'string' || !Array.isArray(role.permissions)) return false;
    if (role.id === everyoneId || role.managed === true) return false;
    if (adminRoleId && role.id === adminRoleId) return false;
    if (!(Number(role.position) < Number(botTopPosition))) return false;
    return !role.permissions.some(permission => FORBIDDEN_ROLE_PERMISSIONS.includes(permission));
}

module.exports = { FORBIDDEN_ROLE_PERMISSIONS, isPluginAssignableRole };
