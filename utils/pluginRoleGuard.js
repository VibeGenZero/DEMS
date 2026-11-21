/**
 * The role guard for plugins (SDK 1.1): which Discord roles a plugin may give
 * or take. Pure, so the real bot (bot/pluginRoles.js) and the mock server
 * (dev/mockBot.js) apply the same rule.
 */

/**
 * Permission names (discord.js `PermissionFlagsBits` keys) a plugin role must not carry, neither on
 * the server nor through a channel overwrite: administration, moderation (text and voice) and insight.
 * Plain channel access (ViewChannel, SendMessages, Connect, …) is fine, also on private channels.
 */
const FORBIDDEN_ROLE_PERMISSIONS = Object.freeze([
    'Administrator', 'ManageGuild', 'ManageRoles', 'ManageChannels', 'ManageWebhooks', 'ManageGuildExpressions',
    'ManageEvents', 'ManageMessages', 'ManageThreads', 'ManageNicknames', 'KickMembers', 'BanMembers',
    'ModerateMembers', 'MentionEveryone', 'ViewAuditLog', 'ViewGuildInsights',
    'MuteMembers', 'DeafenMembers', 'MoveMembers', 'PinMessages', 'BypassSlowmode', 'ViewCreatorMonetizationAnalytics'
]);

/**
 * Whether a plugin may give or take a role.
 *
 * @param {{ id: string, managed: boolean, position: number, permissions: string[], channelAllows?: string[] }|null} role ->
 *   Plain role data; `channelAllows` = every right the role's channel overwrites allow (absent = none).
 * @param {{ adminRoleId?: string, botTopPosition: number, everyoneId: string }} guild -> DEMS admin role, the
 *   position of the bot's highest role and the id of @everyone (the guild id).
 * @returns {boolean}
 */
function isPluginAssignableRole(role, { adminRoleId = '', botTopPosition, everyoneId }) {
    if (!role || typeof role.id !== 'string' || !Array.isArray(role.permissions)) return false;
    if (role.id === everyoneId || role.managed === true) return false;
    if (adminRoleId && role.id === adminRoleId) return false;
    if (!(Number(role.position) < Number(botTopPosition))) return false;
    if (role.channelAllows !== undefined && !Array.isArray(role.channelAllows)) return false;
    const rights = [...role.permissions, ...(role.channelAllows || [])];
    return !rights.some(permission => FORBIDDEN_ROLE_PERMISSIONS.includes(permission));
}

module.exports = { FORBIDDEN_ROLE_PERMISSIONS, isPluginAssignableRole };
