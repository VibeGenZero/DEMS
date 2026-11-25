/**
 * Admin API of the plugins (System › Plugins), mounted by routes/admin.js
 * below /api/admin (requireAuth + requireAdmin already applied there).
 *
 * Switching on a custom plugin runs code that does not come from the DEMS
 * project, so it needs the admin's trust confirmation and the reset
 * password; so does changing a `secret` setting. Every change is
 * audit-logged, setting values never.
 *
 * Uploading `.dems` packages (`PLUGINS_UPLOAD=true` only, never in safe
 * mode) brings code onto the host through the web, so install and remove
 * need the reset password too: a hijacked admin session alone cannot do it.
 * The check keeps the bytes in memory (`pluginUploadStore.js`), install
 * re-checks exactly those bytes.
 */
const express = require('express');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { safeEqual } = require('../middleware/auth');
const { addAuditLog } = require('../utils/eventUtils');
const { pluginHost } = require('../plugin-sdk');
const { PluginHostError, PackageError } = require('../plugin-sdk/errors');
const { PERMISSIONS } = require('../plugin-sdk/manifest');
const { LIMITS } = require('../plugin-sdk/files');
const { checkPackage, installPackage, removePluginFolder } = require('../plugin-sdk/package');
const { createUploadStore } = require('./pluginUploadStore');

const MESSAGES = {
    badInput: 'Ungültige Eingabe.',
    notFound: 'Plugin nicht gefunden.',
    trust: 'Bitte bestätige, dass du dem Code dieses Plugins vertraust.',
    password: 'Ungültiges Admin-Reset-Passwort.',
    switchOffFirst: 'Schalte das Plugin zuerst aus.',
    uploadOff: 'Das Hochladen von Plugins ist ausgeschaltet (PLUGINS_UPLOAD).',
    uploadSafeMode: 'Im abgesicherten Modus können keine Plugins hochgeladen werden.',
    noFile: 'Keine Datei empfangen.',
    tooLarge: 'Die Datei ist größer als 5 MB.',
    tooManyChecks: 'Zu viele Prüfungen. Bitte warte ein paar Minuten.',
    uploadExpired: 'Der Upload ist abgelaufen. Bitte lade die Datei erneut hoch.',
    alreadyInstalled: 'Das Plugin ist schon installiert.',
    officialRemove: 'Offizielle Plugins können nicht entfernt werden.'
};

/** At most this many package checks per session and window (on top of the /api limiter). */
const CHECK_LIMIT = 10;
const CHECK_WINDOW_MS = 10 * 60 * 1000;

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const labelled = keys => keys.map(key => ({ key, label: PERMISSIONS[key] || key }));

/** Raw `.dems` body of the check route only; „too large“ and broken bodies get our own answer. */
const rawPackageParser = express.raw({ type: 'application/octet-stream', limit: LIMITS.packedBytes });
const parsePackageBody = (req, res, next) => {
    rawPackageParser(req, res, (err) => {
        if (!err) return next();
        if (err.type === 'entity.too.large') return res.status(413).json({ error: MESSAGES.tooLarge });
        console.error('Plugin upload body error:', err.message);
        return res.status(400).json({ error: MESSAGES.noFile });
    });
};

/** An unset ADMIN_RESET_PASSWORD makes every password wrong (safeEqual refuses an empty expected value). */
const isResetPassword = password => safeEqual(password, process.env.ADMIN_RESET_PASSWORD);

/**
 * Build the admin plugin router.
 *
 * @param {() => ReturnType<import('../plugin-sdk/host').createPluginHost>} getHost -> The plugin host (tests pass their own).
 * @param {object} [options]
 * @param {() => boolean} [options.uploadEnabled] -> `PLUGINS_UPLOAD=true`, read on every request.
 * @param {ReturnType<typeof createUploadStore>} [options.store] -> Checked uploads waiting for install.
 * @returns {import('express').Router}
 * @example
 * router.use(createAdminPluginsRouter(() => pluginHost()));
 */
function createAdminPluginsRouter(getHost, {
    uploadEnabled = () => process.env.PLUGINS_UPLOAD === 'true',
    store = createUploadStore()
} = {}) {
    const router = express.Router();

    /** @returns {import('../plugin-sdk/views').PluginView|null} -> The first view with the id (an official one wins over a duplicate folder). */
    const findView = (host, id) => host.list().find(view => view.id === id) || null;

    /** Upload routes need `PLUGINS_UPLOAD=true`; check and install also refuse safe mode (remove stays a way out). */
    const requireUpload = ({ refuseSafeMode }) => (req, res, next) => {
        try {
            if (!uploadEnabled()) return res.status(403).json({ error: MESSAGES.uploadOff });
            if (refuseSafeMode && getHost().safeMode) return res.status(409).json({ error: MESSAGES.uploadSafeMode });
            next();
        } catch (err) {
            console.error('Plugin upload gate error:', err);
            res.status(500).json({ error: 'Plugins konnten nicht geladen werden.' });
        }
    };

    const checkLimiter = rateLimit({
        windowMs: CHECK_WINDOW_MS,
        limit: CHECK_LIMIT,
        keyGenerator: req => (req.sessionID ? `session:${req.sessionID}` : `ip:${ipKeyGenerator(req.ip || '')}`),
        standardHeaders: true,
        legacyHeaders: false,
        handler: (req, res) => res.status(429).json({ error: MESSAGES.tooManyChecks })
    });

    /** The context `checkPackage`/`installPackage` need from the host. */
    const packageContext = host => ({ officialIds: host.officialIds(), customDir: host.customDir });

    /**
     * GET /api/admin/plugins — `{ safeMode, uploadEnabled, plugins }`; every plugin view with
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
            res.json({ safeMode: host.safeMode, uploadEnabled: uploadEnabled(), plugins });
        } catch (err) {
            console.error('Plugin list error:', err);
            res.status(500).json({ error: 'Plugins konnten nicht geladen werden.' });
        }
    });

    /**
     * POST /api/admin/plugins/upload/check — raw `application/octet-stream` (≤ 5 MB) →
     * `{ uploadId, report }`. Writes nothing; a package without errors is kept for install
     * under `uploadId` (null otherwise). `report.replaces` describes an installed plugin of the id.
     */
    router.post('/plugins/upload/check', requireUpload({ refuseSafeMode: true }), checkLimiter, parsePackageBody, (req, res) => {
        try {
            if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ error: MESSAGES.noFile });
            const host = getHost();
            const report = checkPackage(req.body, packageContext(host));
            const id = report.manifest && report.manifest.id;
            const replaces = report.exists
                ? { version: report.installedVersion, restart: host.wasLoaded(id), enabled: host.isEnabled(id) }
                : null;
            const uploadId = report.ok ? store.put(req.sessionID, req.body) : null;
            res.json({
                uploadId,
                report: {
                    ...report,
                    permissions: labelled(report.permissions),
                    missing: labelled(report.missing),
                    unused: labelled(report.unused),
                    replaces
                }
            });
        } catch (err) {
            console.error('Plugin upload check error:', err);
            res.status(500).json({ error: 'Das Plugin-Paket konnte nicht geprüft werden.' });
        }
    });

    /**
     * POST /api/admin/plugins/upload/install — `{ uploadId, password, replace }` → `{ plugin }`.
     * The password is checked before the upload is taken, so a typo does not use it up.
     */
    router.post('/plugins/upload/install', requireUpload({ refuseSafeMode: true }), async (req, res) => {
        try {
            const { uploadId, password, replace } = req.body || {};
            if (typeof uploadId !== 'string' || typeof replace !== 'boolean') return res.status(400).json({ error: MESSAGES.badInput });
            if (!isResetPassword(password)) return res.status(401).json({ error: MESSAGES.password });
            const buffer = store.take(req.sessionID, uploadId);
            if (!buffer) return res.status(410).json({ error: MESSAGES.uploadExpired });
            const host = getHost();
            const context = packageContext(host);
            const report = checkPackage(buffer, context);
            if (!report.ok) return res.status(400).json({ error: report.errors[0] });
            if (report.exists && !replace) return res.status(409).json({ error: MESSAGES.alreadyInstalled });
            const { id, name, version } = report.manifest;
            let replaced = false;
            // On the plugin's switch chain: refused while the plugin is on, a replaced one is stored off
            const plugin = await host.replacePlugin(id, async () => {
                ({ replaced } = await installPackage(buffer, { ...context, replace }));
            });
            await addAuditLog('PLUGIN_UPLOAD', req.session.user.id,
                `Plugin „${name}“ ${version} ${replaced ? 'ersetzt' : 'hochgeladen'}`, id);
            res.json({ plugin });
        } catch (err) {
            if (err instanceof PluginHostError) return res.status(409).json({ error: err.message });
            if (err instanceof PackageError) return res.status(400).json({ error: err.message });
            console.error('Plugin upload install error:', err);
            res.status(500).json({ error: 'Das Plugin konnte nicht installiert werden.' });
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

    /**
     * DELETE /api/admin/plugins/:id — `{ password }` → `{ removed: true }`; custom and off only.
     * Deletes the folder in `PLUGINS_DIR` (so it shares the upload switch); the state stays,
     * the plugin shows as „Verwaist“ until „Daten löschen“.
     */
    router.delete('/plugins/:id', requireUpload({ refuseSafeMode: false }), async (req, res) => {
        try {
            const host = getHost();
            const { id } = req.params;
            const current = findView(host, id);
            if (!current || current.status === 'orphaned') return res.status(404).json({ error: MESSAGES.notFound });
            if (current.official) return res.status(409).json({ error: MESSAGES.officialRemove });
            if (host.isEnabled(id)) return res.status(409).json({ error: MESSAGES.switchOffFirst });
            if (!isResetPassword((req.body || {}).password)) return res.status(401).json({ error: MESSAGES.password });
            await host.removePlugin(id, () => removePluginFolder(host.customDir, id));
            await addAuditLog('PLUGIN_REMOVE', req.session.user.id, `Plugin „${current.name}“ entfernt`, id);
            res.json({ removed: true });
        } catch (err) {
            if (err instanceof PluginHostError) {
                return res.status(err.message === MESSAGES.notFound ? 404 : 409).json({ error: err.message });
            }
            if (err instanceof PackageError) return res.status(400).json({ error: err.message });
            console.error('Plugin remove error:', err);
            res.status(500).json({ error: 'Das Plugin konnte nicht entfernt werden.' });
        }
    });

    return router;
}

const router = createAdminPluginsRouter(() => pluginHost());

module.exports = router;
module.exports.createAdminPluginsRouter = createAdminPluginsRouter;
