const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const { getLoginBlockReason } = require('../middleware/maintenance');
const { startUserSession } = require('../middleware/auth');
const { saveUserProfile } = require('../utils/userProfile');
const { debugLog } = require('../utils/debugLog');
const { DISCORD_API, discordFetch } = require('../utils/discordFetch');
const { privacyStateOf } = require('../middleware/privacy');
const { isDemsAdmin, isGuildAdministrator } = require('../utils/adminAccess');

/**
 * Whether the logged-in user is owner or "Administrator" of the guild, read from
 * the OAuth guild list (scope `guilds`). An error only costs this path: the admin
 * role still counts, and the role check repeats it every five minutes.
 *
 * @param {string} accessToken -> OAuth access token of the user.
 * @param {string} guildId -> DISCORD_GUILD_ID.
 * @returns {Promise<boolean>}
 */
async function isAdministratorOnGuild(accessToken, guildId) {
    try {
        const res = await discordFetch(`${DISCORD_API}/users/@me/guilds`, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (!res.ok) {
            console.error('Guild list for the admin check failed:', res.status);
            return false;
        }
        const guilds = await res.json();
        return Array.isArray(guilds) && isGuildAdministrator(guilds.find(guild => guild && guild.id === guildId));
    } catch (err) {
        console.error('Guild list for the admin check failed:', err.message);
        return false;
    }
}

/**
 * GET /auth/discord — Redirect to Discord OAuth2
 */
router.get('/discord', (req, res) => {
    const clientId = process.env.DISCORD_CLIENT_ID;
    const redirectUri = encodeURIComponent(`${process.env.BASE_URL}/auth/discord/callback`);
    const scopes = encodeURIComponent('identify guilds guilds.members.read');

    // The callback only accepts this state -> nobody can log a browser into a foreign account
    req.session.oauthState = crypto.randomBytes(32).toString('hex');

    const url = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scopes}&state=${req.session.oauthState}`;
    res.redirect(url);
});

/**
 * GET /auth/discord/callback — Handle OAuth2 callback
 */
router.get('/discord/callback', async (req, res) => {
    const { code, state } = req.query;
    const expectedState = req.session.oauthState;
    delete req.session.oauthState; // single use, also when the check fails
    if (!expectedState || state !== expectedState) {
        return res.redirect('/?error=invalid_state');
    }
    if (!code) {
        return res.redirect('/?error=no_code');
    }

    try {
        // Exchange code for token
        const tokenRes = await discordFetch(`${DISCORD_API}/oauth2/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: process.env.DISCORD_CLIENT_ID,
                client_secret: process.env.DISCORD_CLIENT_SECRET,
                grant_type: 'authorization_code',
                code,
                redirect_uri: `${process.env.BASE_URL}/auth/discord/callback`,
                scope: 'identify guilds guilds.members.read'
            })
        });

        const tokenData = await tokenRes.json();
        if (!tokenData.access_token) {
            console.error('Token exchange failed:', tokenData);
            return res.redirect('/?error=token_failed');
        }

        // Fetch user info
        const userRes = await discordFetch(`${DISCORD_API}/users/@me`, {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });
        const userData = await userRes.json();

        // Check guild membership
        const guildId = process.env.DISCORD_GUILD_ID;
        const memberRes = await discordFetch(`${DISCORD_API}/users/@me/guilds/${guildId}/member`, {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });

        if (!memberRes.ok) {
            console.error('Guild member check failed:', memberRes.status);
            return res.redirect('/?error=not_member');
        }

        const memberData = await memberRes.json();

        // Admin: the admin role or the Discord permission "Administrator" (the owner has every permission)
        const isAdmin = isDemsAdmin({
            roleIds: memberData.roles || [],
            isAdministrator: await isAdministratorOnGuild(tokenData.access_token, guildId)
        });

        // Maintenance mode: panic mode and "login disabled" block non-admin logins
        const blockReason = await getLoginBlockReason(isAdmin);
        if (blockReason) {
            return res.redirect(`/?error=${blockReason}`);
        }

        const avatarUrl = userData.avatar
            ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png`
            : `https://cdn.discordapp.com/embed/avatars/${parseInt(userData.discriminator || '0') % 5}.png`;

        // Save/update user in the users collection
        let isNewUser = false;
        try {
            isNewUser = await saveUserProfile({
                id: userData.id,
                username: userData.username,
                displayName: userData.global_name || userData.username,
                avatar: avatarUrl
            });
        } catch (err) {
            console.error('Failed to save user to the database:', err.message);
        }

        await startUserSession(req, {
            id: userData.id,
            username: userData.username,
            displayName: userData.global_name || userData.username,
            avatar: avatarUrl,
            roles: memberData.roles || [],
            isAdmin,
            isNewUser
        });

        debugLog('auth.login', { userId: req.session?.user?.id, username: req.session?.user?.username });
        res.redirect('/#events');
    } catch (err) {
        console.error('OAuth2 callback error:', err);
        res.redirect('/?error=server_error');
    }
});

/**
 * GET /auth/me — Get current user
 */
router.get('/me', async (req, res) => {
    try {
        if (!req.session || !req.session.user) {
            return res.status(200).json(null);
        }
        // Consent to the privacy policy (#138): the SPA shows only the dialog while required
        const privacy = await privacyStateOf(req);
        const { privacyAcceptedVersion, ...user } = req.session.user;
        void privacyAcceptedVersion;
        // Clear isNewUser flag after first read so it only shows once
        if (req.session.user.isNewUser) {
            req.session.user.isNewUser = false;
        }
        res.json({ ...user, privacyRequired: privacy.required, privacyVersion: privacy.version });
    } catch (err) {
        console.error('Auth me error:', err);
        res.status(500).json({ error: 'Anmeldestatus konnte nicht geladen werden.' });
    }
});

/**
 * POST /auth/logout — Destroy session. POST with CSRF token (server.js), so a
 * foreign page or an <img src> cannot log a user out.
 */
router.post('/logout', (req, res) => {
    debugLog('auth.logout', { userId: req.session?.user?.id });
    req.session.destroy(err => {
        if (err) {
            console.error('Logout error:', err);
            return res.status(500).json({ error: 'Abmelden fehlgeschlagen.' });
        }
        res.json({ success: true });
    });
});

module.exports = router;
