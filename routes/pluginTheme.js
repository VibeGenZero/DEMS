/**
 * Serves the combined theme stylesheets of enabled plugins with the `theme`
 * permission:
 * - `GET /theme.css` (public, no session created, ETag + `Cache-Control: no-cache`)
 * - `GET /theme-preview.css` (admin only, includes drafts, `Cache-Control: no-store`)
 *
 * Mounted before the setup and privacy gates so the custom design applies
 * from the first paint on the login screen and during maintenance.
 */
const crypto = require('crypto');
const express = require('express');
const { readThemeSheets } = require('../plugin-sdk/theme');

function computeEtag(css) {
    const buf = Buffer.from(css, 'utf8');
    const hash = crypto.createHash('sha1').update(buf).digest('base64').slice(0, 27);
    return `W/"${buf.length.toString(16)}-${hash}"`;
}

function matchesIfNoneMatch(header, etag) {
    if (!header || !etag) return false;
    const raw = etag.replace(/^W\//, '');
    return String(header)
        .split(',')
        .map(token => token.trim())
        .some(token => token === '*' || token === etag || token.replace(/^W\//, '') === raw);
}

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

    function sendPublicCss(req, res, css) {
        const etag = computeEtag(css);
        res.set('X-Content-Type-Options', 'nosniff');
        res.set('Cache-Control', 'no-cache');
        res.set('ETag', etag);
        if (matchesIfNoneMatch(req.headers['if-none-match'], etag)) {
            res.status(304).end();
            return;
        }
        res.set('Content-Type', 'text/css; charset=utf-8');
        res.status(200).send(css);
    }

    function sendPreviewCss(res, css) {
        res.set('Content-Type', 'text/css; charset=utf-8');
        res.set('X-Content-Type-Options', 'nosniff');
        res.set('Cache-Control', 'no-store');
        res.status(200).send(css);
    }

    router.get('/theme.css', async (req, res) => {
        try {
            const css = await readThemeSheets(currentSources(), { preview: false });
            sendPublicCss(req, res, css);
        } catch (err) {
            console.error('Theme stylesheet error:', err && err.message ? err.message : err);
            sendPublicCss(req, res, '');
        }
    });

    router.get('/theme-preview.css', async (req, res) => {
        if (!req.session || !req.session.user || !req.session.user.isAdmin) {
            res.status(404).end();
            return;
        }
        try {
            const css = await readThemeSheets(currentSources(), { preview: true });
            sendPreviewCss(res, css);
        } catch (err) {
            console.error('Theme preview stylesheet error:', err && err.message ? err.message : err);
            sendPreviewCss(res, '');
        }
    });

    return router;
}

module.exports = { createThemeRouter };
