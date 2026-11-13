/**
 * Admin API of the AI integration, mounted by routes/admin.js below /api/admin
 * (requireAuth + requireAdmin already applied there): behaviour settings, the
 * connection test, the model list and the usage counters. The connection
 * itself (provider, key, model) is saved through PUT /system/settings.
 * No answer ever contains the stored API key.
 */
const express = require('express');
const { addAuditLog } = require('../utils/eventUtils');
const { AiError, AI_ERROR_MESSAGES } = require('../ai/errors');
const { PROVIDERS, isAiConfigured, getAiClient, testConnection } = require('../ai/client');
const { loadAiSettings, saveAiSettings } = require('../ai/settings');
const { readUsage } = require('../ai/usage');

const router = express.Router();

const text = (value) => (typeof value === 'string' ? value : '');

/** The unsaved connection values of a test/models request; anything but strings is dropped. */
function overridesOf(body) {
    const input = body && typeof body === 'object' ? body : {};
    return { provider: text(input.provider), baseUrl: text(input.baseUrl), apiKey: text(input.apiKey), model: text(input.model) };
}

/** GET /api/admin/ai/settings — behaviour settings, provider table and whether the AI is usable */
router.get('/ai/settings', async (req, res) => {
    try {
        const providers = Object.entries(PROVIDERS).map(([id, p]) => ({
            id, label: p.label, defaultBaseUrl: p.defaultBaseUrl, keyRequired: p.keyRequired
        }));
        res.json({ settings: await loadAiSettings(), providers, configured: isAiConfigured() });
    } catch (err) {
        console.error('AI settings read error:', err.message);
        res.status(500).json({ error: 'KI-Einstellungen konnten nicht geladen werden.' });
    }
});

/** PUT /api/admin/ai/settings — partial behaviour settings; answers the stored settings */
router.put('/ai/settings', async (req, res) => {
    try {
        const before = await loadAiSettings();
        const { settings } = await saveAiSettings(req.body);
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const keys = Object.keys(settings).filter(key => key in body && body[key] !== before[key]);
        await addAuditLog('UPDATE_AI_SETTINGS', req.session.user.id, { keys });
        if (keys.includes('memberDiscord')) {
            // Required here: bot.js loads modules that load the routes; the export arrives with the Discord command
            const bot = require('../bot');
            if (typeof bot.refreshAskFeature === 'function') await bot.refreshAskFeature();
        }
        res.json({ success: true, settings });
    } catch (err) {
        if (err && err.status === 400) return res.status(400).json({ error: err.error });
        console.error('AI settings save error:', err.message);
        res.status(500).json({ error: 'KI-Einstellungen konnten nicht gespeichert werden.' });
    }
});

/** POST /api/admin/ai/test — try the typed, unsaved connection values; always 200 */
router.post('/ai/test', async (req, res) => {
    try {
        const result = await testConnection(overridesOf(req.body));
        res.json(result.ok ? { ok: true, ms: result.ms } : { ok: false, error: result.error });
    } catch (err) {
        console.error('AI test error:', err.message);
        res.json({ ok: false, error: AI_ERROR_MESSAGES.unreachable });
    }
});

/** POST /api/admin/ai/models — model names of the typed, unsaved connection values */
router.post('/ai/models', async (req, res) => {
    try {
        const overrides = overridesOf(req.body);
        // Listing needs no model; a placeholder keeps the client usable before one is chosen
        if (!overrides.model) overrides.model = '-';
        const models = await getAiClient({ overrides }).listModels();
        res.json({ models });
    } catch (err) {
        const code = err instanceof AiError ? err.code : 'unreachable';
        res.status(502).json({ error: AI_ERROR_MESSAGES[code] });
    }
});

/** GET /api/admin/ai/usage — today's counters and the last 30 days (newest first) */
router.get('/ai/usage', async (req, res) => {
    try {
        const [days, [today]] = await Promise.all([readUsage(30), readUsage(1)]);
        res.json({ today: { memberQuestions: today ? today.memberQuestions : 0, adminRequests: today ? today.adminRequests : 0, inputTokens: today ? today.inputTokens : 0, outputTokens: today ? today.outputTokens : 0 }, days });
    } catch (err) {
        console.error('AI usage read error:', err.message);
        res.status(500).json({ error: 'Nutzung konnte nicht geladen werden.' });
    }
});

module.exports = router;
