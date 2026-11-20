/**
 * Serves the combined theme stylesheets of enabled plugins with the `theme`
 * permission:
 * - `GET /theme.css` (public, no session created, ETag + `Cache-Control: no-cache`)
 * - `GET /theme-preview.css` (admin only, includes drafts, `Cache-Control: no-store`)
 *
 * Mounted before the setup and privacy gates so the custom design applies
 * from the first paint on the login screen and during maintenance.
 */
const express = require('express');
const { readThemeSheets } = require('../plugin-sdk/theme');

/**
 * @param {() => object} getHost -> Returns `pluginHost()`; may throw before init.
 * @returns {express.Router}
 */
function createThemeRouter(getHost) {
    const router = express.Router();

    function currentSources() {
        try {
            const host = getHost();
            return host && typeof host.themeSources === 'function' ? host.themeSources() : [];
        } catch {
            return [];
        }
    }

    function sendCss(res, css, cacheControl) {
        res.set('Content-Type', 'text/css; charset=utf-8');
        res.set('X-Content-Type-Options', 'nosniff');
        res.set('Cache-Control', cacheControl);
        res.status(200).send(css);
    }

    router.get('/theme.css', async (_req, res) => {
        try {
            const css = await readThemeSheets(currentSources(), { preview: false });
            sendCss(res, css, 'no-cache');
        } catch (err) {
            console.error('Theme stylesheet error:', err && err.message ? err.message : err);
            sendCss(res, '', 'no-cache');
        }
    });

    router.get('/theme-preview.css', async (req, res) => {
        if (!req.session || !req.session.user || !req.session.user.isAdmin) {
            res.status(404).end();
            return;
        }
        try {
            const css = await readThemeSheets(currentSources(), { preview: true });
            sendCss(res, css, 'no-store');
        } catch (err) {
            console.error('Theme preview stylesheet error:', err && err.message ? err.message : err);
            sendCss(res, '', 'no-store');
        }
    });

    return router;
}

module.exports = { createThemeRouter };
