const express = require('express');
const fetch = require('node-fetch');
const router = express.Router();
const { db, collection, doc, getDoc, setDoc } = require('../firebaseAdmin');
const { debugLog } = require('../utils/debugLog');

const DISCORD_API = 'https://discord.com/api/v10';

/**
 * Helper: Check maintenance settings from Firestore
 */
async function getMaintenanceStatus() {
    try {
        const snap = await getDoc(doc(db, 'maintenanceSettings', 'config'));
        return snap.exists() ? snap.data() : null;
    } catch {
        return null;
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
        const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
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
        const userRes = await fetch(`${DISCORD_API}/users/@me`, {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });
        const userData = await userRes.json();

        // Check guild membership
        const guildId = process.env.DISCORD_GUILD_ID;
        const memberRes = await fetch(`${DISCORD_API}/users/@me/guilds/${guildId}/member`, {
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

        // Maintenance mode: block non-admin logins
        const maintenance = await getMaintenanceStatus();
        if (maintenance) {
            if (maintenance.panicMode && !isAdmin) {
                // Panic mode: only admins can log in (to deactivate panic)
                return res.redirect('/?error=panic_mode');
            }
            if (maintenance.loginDisabled && !isAdmin) {
                // Login disabled: only admins can log in
                return res.redirect('/?error=maintenance_login_disabled');
            }
        }

        const avatarUrl = userData.avatar
            ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png`
            : `https://cdn.discordapp.com/embed/avatars/${parseInt(userData.discriminator || '0') % 5}.png`;

        // Save/update user in Firestore users collection
        let isNewUser = false;
        try {
            const userRef = doc(db, 'users', userData.id);
            const userSnap = await getDoc(userRef);
            if (!userSnap.exists()) {
                isNewUser = true;
                await setDoc(userRef, {
                    id: userData.id,
                    username: userData.username,
                    displayName: userData.global_name || userData.username,
                    avatar: avatarUrl,
                    acceptInvitations: true,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                });
            } else {
                // Update mutable fields
                await setDoc(userRef, {
                    ...userSnap.data(),
                    username: userData.username,
                    displayName: userData.global_name || userData.username,
                    avatar: avatarUrl,
                    updatedAt: new Date().toISOString()
                });
            }
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
