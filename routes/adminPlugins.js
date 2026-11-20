/**
 * Admin API of the plugins (System › Plugins), mounted by routes/admin.js
 * below /api/admin (requireAuth + requireAdmin already applied there).
 *
 * Switching on a custom plugin runs code that does not come from the DEMS
 * project, so it needs the admin's trust confirmation and the reset
 * password; so does changing a `secret` setting. Every change is
 * audit-logged, setting values never.
 */
const express = require('express');
const { safeEqual } = require('../middleware/auth');
const { addAuditLog } = require('../utils/eventUtils');
const { pluginHost } = require('../plugin-sdk');
const { PluginHostError } = require('../plugin-sdk/errors');

const MESSAGES = {
    badInput: 'Ungültige Eingabe.',
    notFound: 'Plugin nicht gefunden.',
    trust: 'Bitte bestätige, dass du dem Code dieses Plugins vertraust.',
    password: 'Ungültiges Admin-Reset-Passwort.',
    switchOffFirst: 'Schalte das Plugin zuerst aus.'
};

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** An unset ADMIN_RESET_PASSWORD makes every password wrong (safeEqual refuses an empty expected value). */
const isResetPassword = password => safeEqual(password, process.env.ADMIN_RESET_PASSWORD);

/**
 * Build the admin plugin router.
 *
 * @param {() => ReturnType<import('../plugin-sdk/host').createPluginHost>} getHost -> The plugin host (tests pass their own).
 * @returns {import('express').Router}
 * @example
 * router.use(createAdminPluginsRouter(() => pluginHost()));
 */
function createAdminPluginsRouter(getHost) {
    const router = express.Router();

    /** @returns {import('../plugin-sdk/views').PluginView|null} -> The first view with the id (an official one wins over a duplicate folder). */
    const findView = (host, id) => host.list().find(view => view.id === id) || null;

    /**
     * GET /api/admin/plugins — `{ safeMode, plugins }`; every plugin view with
     * `settingsValues` (secrets only as `{ set }`)
     */
    router.get('/plugins', async (req, res) => {
        try {
            const host = getHost();
            const plugins = await Promise.all(host.list().map(async view => ({
                ...view,
                // A view without a settings schema (orphaned, broken folder) has no values of its own
                settingsValues: view.settings.length > 0 ? await host.readPublicSettings(view.id) : {}
            })));
            res.json({ safeMode: host.safeMode, plugins });
        } catch (err) {
            console.error('Plugin list error:', err);
            res.status(500).json({ error: 'Plugins konnten nicht geladen werden.' });
        }
    });

    /**
     * PUT /api/admin/plugins/:id/enabled — `{ enabled, trust?, password? }` → `{ plugin }`.
     * A failed register still answers 200: the view's status says „Fehler“.
     */
    router.put('/plugins/:id/enabled', async (req, res) => {
        try {
            const host = getHost();
            const { id } = req.params;
            const { enabled, trust, password } = req.body;
            if (typeof enabled !== 'boolean') return res.status(400).json({ error: MESSAGES.badInput });
            const current = findView(host, id);
            if (!current) return res.status(404).json({ error: MESSAGES.notFound });
            // Only switching ON code from outside the DEMS project needs the confirmation
            if (enabled && current.official === false) {
                if (trust !== true) return res.status(400).json({ error: MESSAGES.trust });
                if (!isResetPassword(password)) return res.status(401).json({ error: MESSAGES.password });
            }
            const adminId = req.session.user.id;
            const plugin = await host.setEnabled(id, enabled, { adminId });
            await addAuditLog(enabled ? 'PLUGIN_ENABLE' : 'PLUGIN_DISABLE', adminId,
                `Plugin „${plugin.name}“ ${enabled ? 'eingeschaltet' : 'ausgeschaltet'}`, id);
            res.json({ plugin });
        } catch (err) {
            if (err instanceof PluginHostError) return res.status(409).json({ error: err.message });
            console.error('Plugin switch error:', err);
            res.status(500).json({ error: 'Das Plugin konnte nicht umgeschaltet werden.' });
        }
    });

    /**
     * PUT /api/admin/plugins/:id/settings — `{ values, password? }` → `{ settings }`.
     * A secret key in `values` (also `''`/`null` to clear it) needs the reset password.
     */
    router.put('/plugins/:id/settings', async (req, res) => {
        try {
            const host = getHost();
            const { id } = req.params;
            const { values, password } = req.body;
            if (!isPlainObject(values)) return res.status(400).json({ error: MESSAGES.badInput });
            const current = findView(host, id);
            if (!current) return res.status(404).json({ error: MESSAGES.notFound });
            const secretChanged = current.settings.some(setting =>
                setting.type === 'secret' && Object.hasOwn(values, setting.key) && values[setting.key] !== undefined);
            if (secretChanged && !isResetPassword(password)) return res.status(401).json({ error: MESSAGES.password });
            await host.saveSettings(id, values);
            // The plugin name only: setting values (secrets!) never reach the audit log
            await addAuditLog('PLUGIN_SETTINGS', req.session.user.id, `Einstellungen von Plugin „${current.name}“ gespeichert`, id);
            res.json({ settings: await host.readPublicSettings(id) });
        } catch (err) {
            if (err instanceof PluginHostError) return res.status(400).json({ error: err.message });
            console.error('Plugin settings error:', err);
            res.status(500).json({ error: 'Die Einstellungen konnten nicht gespeichert werden.' });
        }
    });

    /**
     * DELETE /api/admin/plugins/:id/data — `{ deleted }`; only while the plugin is off.
     * Deletes its collections and settings (an orphaned plugin loses its state entry too).
     */
    router.delete('/plugins/:id/data', async (req, res) => {
        try {
            const host = getHost();
            const { id } = req.params;
            const current = findView(host, id);
            if (!current) return res.status(404).json({ error: MESSAGES.notFound });
            if (host.isEnabled(id)) return res.status(409).json({ error: MESSAGES.switchOffFirst });
            const deleted = await host.deleteData(id);
            await addAuditLog('PLUGIN_DELETE_DATA', req.session.user.id, `Daten von Plugin „${current.name}“ gelöscht`, id);
            res.json({ deleted });
        } catch (err) {
            if (err instanceof PluginHostError) return res.status(409).json({ error: err.message });
            console.error('Plugin data delete error:', err);
            res.status(500).json({ error: 'Die Plugin-Daten konnten nicht gelöscht werden.' });
        }
    });

    return router;
}

const router = createAdminPluginsRouter(() => pluginHost());

module.exports = router;
module.exports.createAdminPluginsRouter = createAdminPluginsRouter;
