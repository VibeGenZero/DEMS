const express = require('express');
const router = express.Router();
const { getLoginBlockReason } = require('../middleware/maintenance');
const { saveUserProfile } = require('../utils/userProfile');
const { debugLog } = require('../utils/debugLog');

const DISCORD_API = 'https://discord.com/api/v10';

// Transient network errors that are safe to retry
const RETRYABLE_CODES = new Set([
    'ERR_STREAM_PREMATURE_CLOSE',
    'ECONNRESET',
    'ETIMEDOUT',
    'EPIPE',
    'UND_ERR_SOCKET'
]);

/**
 * fetch with a small retry for transient connection errors
 * (e.g. Discord/Cloudflare closing the connection mid-response).
 */
async function discordFetch(url, options = {}, retries = 2) {
    for (let attempt = 0; ; attempt++) {
        try {
            return await fetch(url, options);
        } catch (err) {
            const code = err.code || err.errno || (err.cause && err.cause.code);
            if (attempt >= retries || !RETRYABLE_CODES.has(code)) {
                throw err;
            }
            console.warn(`Discord API request failed (${code}), retrying (${attempt + 1}/${retries})...`);
            await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
        }
    }
}

/**
 * GET /auth/discord — Redirect to Discord OAuth2
 */
router.get('/discord', (req, res) => {
    const clientId = process.env.DISCORD_CLIENT_ID;
    const redirectUri = encodeURIComponent(`${process.env.BASE_URL}/auth/discord/callback`);
    const scopes = encodeURIComponent('identify guilds guilds.members.read');

    const url = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scopes}`;
    res.redirect(url);
});

/**
 * GET /auth/discord/callback — Handle OAuth2 callback
 */
router.get('/discord/callback', async (req, res) => {
    const { code } = req.query;
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

        // Check if user has admin role
        const adminRoleId = process.env.DISCORD_ADMIN_ROLE_ID;
        const isAdmin = adminRoleId
            ? (memberData.roles || []).includes(adminRoleId)
            : false;

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
            console.error('Failed to save user to Firestore:', err.message);
        }

        // Store user in session
        req.session.user = {
            id: userData.id,
            username: userData.username,
            displayName: userData.global_name || userData.username,
            avatar: avatarUrl,
            roles: memberData.roles || [],
            isAdmin,
            isNewUser
        };

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
router.get('/me', (req, res) => {
    if (!req.session || !req.session.user) {
        return res.status(200).json(null);
    }
    const user = { ...req.session.user };
    // Clear isNewUser flag after first read so it only shows once
    if (req.session.user.isNewUser) {
        req.session.user.isNewUser = false;
    }
    res.json(user);
});

/**
 * GET /auth/logout — Destroy session
 */
router.get('/logout', (req, res) => {
    debugLog('auth.logout', { userId: req.session?.user?.id });
    req.session.destroy(() => {
        res.redirect('/');
    });
});

module.exports = router;
