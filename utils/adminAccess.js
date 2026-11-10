/**
 * Who is a DEMS admin: a member with the admin role (DISCORD_ADMIN_ROLE_ID) or
 * with the Discord permission "Administrator" (the server owner has every
 * permission). One rule for the website login, the periodic role check and
 * the bot's admin buttons and commands.
 */

const ADMINISTRATOR = 1n << 3n; // PermissionFlagsBits.Administrator

/**
 * Whether a permission bitfield contains "Administrator".
 *
 * @param {string|bigint|{has: Function}|null|undefined} permissions -> Decimal string (OAuth
 *   /users/@me/guilds), bigint, or a discord.js PermissionsBitField.
 * @returns {boolean} -> False for missing or unreadable values.
 */
function hasAdministratorPermission(permissions) {
    if (permissions && typeof permissions.has === 'function') return permissions.has(ADMINISTRATOR);
    if (typeof permissions === 'bigint') return (permissions & ADMINISTRATOR) === ADMINISTRATOR;
    if (typeof permissions !== 'string' || !/^\d+$/.test(permissions)) return false;
    return (BigInt(permissions) & ADMINISTRATOR) === ADMINISTRATOR;
}

/**
 * Whether a partial guild from OAuth `/users/@me/guilds` makes its user an administrator.
 *
 * @param {{owner?: boolean, permissions?: string}|undefined} guild -> Entry of the guild list.
 * @returns {boolean}
 */
function isGuildAdministrator(guild) {
    if (!guild) return false;
    return guild.owner === true || hasAdministratorPermission(guild.permissions);
}

/**
 * Whether a member is a DEMS admin.
 *
 * @param {Object} member -> `{ roleIds, isAdministrator, adminRoleId }`; `adminRoleId` defaults to DISCORD_ADMIN_ROLE_ID.
 * @returns {boolean}
 */
function isDemsAdmin({ roleIds = [], isAdministrator = false, adminRoleId = process.env.DISCORD_ADMIN_ROLE_ID } = {}) {
    if (isAdministrator === true) return true;
    return !!adminRoleId && roleIds.includes(adminRoleId);
}

module.exports = { hasAdministratorPermission, isGuildAdministrator, isDemsAdmin };
