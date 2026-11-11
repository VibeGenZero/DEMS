/**
 * Admin "System" view (#138), mounted by routes/admin.js below /api/admin
 * (requireAuth + requireAdmin already applied there): the database-backed
 * configuration, the bot invite link and the privacy policy.
 */
const express = require('express');
const { safeEqual } = require('../middleware/auth');
const { addAuditLog } = require('../utils/eventUtils');
const { buildBotInviteUrl } = require('../utils/botPermissions');
const systemConfig = require('../utils/systemConfig');
const { SNOWFLAKE, normalizeSystemValue, botLoginError } = require('../utils/systemValues');
const { savePrivacyPolicy } = require('../utils/privacyPolicy');
const { getUpdateStatus } = require('../utils/updateCheck');

const router = express.Router();

// Keys whose change makes the bot log in again
const BOT_KEYS = ['DISCORD_BOT_TOKEN', 'DISCORD_GUILD_ID'];

/**
 * GET /api/admin/system/settings — every stored key with source; secrets only as isSet
 */
router.get('/system/settings', (req, res) => {
    try {
        res.json({ settings: systemConfig.listSystemSettings() });
    } catch (err) {
        console.error('System settings read error:', err);
        res.status(500).json({ error: 'Systemeinstellungen konnten nicht geladen werden.' });
    }
});

/**
 * PUT /api/admin/system/settings — { password, values: { KEY: value } }
 * Needs the admin reset password. An empty secret keeps the stored one. A new
 * bot token or guild is tried before it is stored.
 */
router.put('/system/settings', async (req, res) => {
    try {
        const { password, values } = req.body;
        if (!safeEqual(password, process.env.ADMIN_RESET_PASSWORD)) {
            return res.status(401).json({ error: 'Ungültiges Admin-Reset-Passwort.' });
        }
        if (!values || typeof values !== 'object' || Array.isArray(values)) {
            return res.status(400).json({ error: 'Keine Werte zum Speichern übergeben.' });
        }

        const changes = {};
        for (const [key, raw] of Object.entries(values)) {
            if (!Object.hasOwn(systemConfig.MANAGED_KEYS, key)) {
                return res.status(400).json({ error: `Der Wert ${key} kann hier nicht geändert werden.` });
            }
            if (systemConfig.isLocked(key)) {
                return res.status(400).json({ error: `${key} steht in .env und kann nur dort geändert werden.` });
            }
            const result = normalizeSystemValue(key, raw);
            if (result.error) return res.status(400).json({ error: result.error });
            if (!result.skip) changes[key] = result.value;
        }

        // A new token or guild: log in with it first, keep the old values when Discord refuses
        let bot = null;
        const botChanged = BOT_KEYS.some(key => key in changes && changes[key] !== (process.env[key] || ''));
        if (botChanged) {
            const previous = Object.fromEntries(BOT_KEYS.map(key => [key, process.env[key]]));
            for (const key of BOT_KEYS) if (key in changes) process.env[key] = changes[key];
            const { restartBot } = require('../bot');
            bot = await restartBot(process.env.DISCORD_BOT_TOKEN);
            if (!bot.ok) {
                for (const [key, value] of Object.entries(previous)) {
                    if (value === undefined) delete process.env[key];
                    else process.env[key] = value;
                }
                if (previous.DISCORD_BOT_TOKEN) await restartBot(previous.DISCORD_BOT_TOKEN);
                const [status, error] = botLoginError(bot.error);
                return res.status(status).json({ error });
            }
        }

        const saved = await systemConfig.saveSystemValues(changes, { by: req.session.user.id });
        if (saved.changed.length > 0) {
            // Key names only: values of secrets never reach the audit log
            await addAuditLog('UPDATE_SYSTEM_SETTINGS', req.session.user.id, { keys: saved.changed });
        }
        res.json({ success: true, changed: saved.changed, restartRequired: saved.applies.has('restart'), bot });
    } catch (err) {
        console.error('System settings save error:', err);
        res.status(500).json({ error: 'Systemeinstellungen konnten nicht gespeichert werden.' });
    }
});

/**
 * GET /api/admin/system/invite-url — bot invite link of the stored client id
 */
router.get('/system/invite-url', (req, res) => {
    try {
        const clientId = process.env.DISCORD_CLIENT_ID || '';
        if (!SNOWFLAKE.test(clientId)) return res.status(400).json({ error: 'Es ist noch keine gültige Client ID gespeichert.' });
        res.json({ url: buildBotInviteUrl(clientId) });
    } catch (err) {
        console.error('System invite URL error:', err);
        res.status(500).json({ error: 'Der Einladungslink konnte nicht erstellt werden.' });
    }
});

/**
 * GET /api/admin/system/update-status — newest DEMS release vs. the running
 * version (utils/updateCheck.js); answers from memory, never waits for GitHub
 */
router.get('/system/update-status', (req, res) => {
    try {
        res.json(getUpdateStatus());
    } catch (err) {
        console.error('Update status error:', err);
        res.status(500).json({ error: 'Versionsinfo konnte nicht geladen werden.' });
    }
});

/**
 * PUT /api/admin/privacy — { markdown }: publish, change or (empty) remove the privacy policy
 */
router.put('/privacy', async (req, res) => {
    try {
        const { markdown } = req.body;
        if (markdown !== undefined && typeof markdown !== 'string') {
            return res.status(400).json({ error: 'Die Datenschutzerklärung muss Text sein.' });
        }
        const saved = await savePrivacyPolicy(markdown || '', req.session.user.id);
        if (saved.changed) await addAuditLog('UPDATE_PRIVACY_POLICY', req.session.user.id, { version: saved.version });
        res.json({ success: true, version: saved.version, changed: saved.changed });
    } catch (err) {
        if (err.code === 'too_long') return res.status(400).json({ error: 'Die Datenschutzerklärung darf höchstens 50000 Zeichen lang sein.' });
        console.error('Privacy policy save error:', err);
        res.status(500).json({ error: 'Die Datenschutzerklärung konnte nicht gespeichert werden.' });
    }
});

module.exports = router;
