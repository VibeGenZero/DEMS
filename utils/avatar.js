/**
 * Avatar URLs. The login stores a complete URL in session.user.avatar
 * (routes/auth.js, dev/devAuth.js) — use it as is.
 */

const DEFAULT_AVATAR = 'https://cdn.discordapp.com/embed/avatars/0.png';

// Comments written before the fix wrapped the complete URL into a second one:
// https://cdn.discordapp.com/avatars/<user id>/<complete URL>.png?size=64
const WRAPPED_AVATAR = /^https:\/\/cdn\.discordapp\.com\/avatars\/\d+\/(https:\/\/.+)\.png\?size=64$/;

/**
 * Avatar URL of a session user.
 *
 * @param {Object} user -> Session user.
 * @returns {string} -> The stored URL, else Discord's first default avatar.
 */
function avatarUrlOf(user) {
    return user?.avatar || DEFAULT_AVATAR;
}

/**
 * Unwrap an avatar URL that was built from a complete URL a second time.
 *
 * @param {*} url -> Stored avatar URL.
 * @returns {*} -> The inner URL for wrapped values, everything else unchanged.
 */
function repairAvatarUrl(url) {
    const match = typeof url === 'string' ? url.match(WRAPPED_AVATAR) : null;
    return match ? match[1] : url;
}

module.exports = { avatarUrlOf, repairAvatarUrl };
