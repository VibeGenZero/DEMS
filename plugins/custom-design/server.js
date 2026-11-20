'use strict';

/**
 * Server side of the official „Design anpassen“ plugin.
 *
 * Uses only the `ctx` it is given and its own `rules.js`. All routes live
 * below `/api/plugins/custom-design` with `access: 'admin'`.
 */

const {
    DEFAULTS,
    EMPTY_SOURCE,
    validateSource,
    compileCss,
    contrastWarnings,
    changedLabels,
    cssChanged,
} = require('./rules');

const COLLECTION = 'designs';
const DRAFT_ID = 'draft';
const PUBLISHED_ID = 'published';
const FREE_CSS_MARKER = '/* Eigenes CSS */\n';

const nowIso = () => new Date().toISOString();

function adjustFreeCssLineError(message, compiledCss) {
    const markerIndex = compiledCss.indexOf(FREE_CSS_MARKER);
    if (markerIndex === -1) return message;
    const prefix = compiledCss.slice(0, markerIndex + FREE_CSS_MARKER.length);
    const prefixLines = prefix.split('\n').length - 1;
    return String(message).replace(/^Zeile (\d+):/, (_, n) => {
        const line = Math.max(1, Number(n) - prefixLines);
        return `Zeile ${line}:`;
    });
}

/**
 * @param {object} ctx -> The plugin context of the SDK.
 */
function register(ctx) {
    async function publishDraft(user, { allowCssChange }) {
        const [draft, prevPublished] = await Promise.all([
            ctx.data.get(COLLECTION, DRAFT_ID),
            ctx.data.get(COLLECTION, PUBLISHED_ID),
        ]);
        if (!draft) {
            throw ctx.httpError(409, 'Es gibt keinen Entwurf.');
        }
        if (draft.error) {
            throw ctx.httpError(
                409,
                `Das eigene CSS hat einen Fehler: ${draft.error}`
            );
        }
        if (!allowCssChange && cssChanged(prevPublished, draft)) {
            throw ctx.httpError(
                403,
                'Eigenes CSS wurde geändert – zum Veröffentlichen ist das Reset-Passwort nötig.'
            );
        }

        const source = {
            tokens: draft.tokens,
            corners: draft.corners,
            font: draft.font,
            css: draft.css,
        };
        await ctx.theme.publish(compileCss(source));
        const published = await ctx.data.set(COLLECTION, PUBLISHED_ID, {
            ...source,
            updatedAt: nowIso(),
            updatedBy: user.id,
        });
        await ctx.data.delete(COLLECTION, DRAFT_ID);

        const labels = changedLabels(prevPublished, source);
        await ctx.audit(
            'publish',
            user.id,
            `Design veröffentlicht: ${labels.join(', ') || 'keine Änderungen'}`
        );

        return { published };
    }

    ctx.routes.get('/', { access: 'admin' }, async () => {
        const [published, draft] = await Promise.all([
            ctx.data.get(COLLECTION, PUBLISHED_ID),
            ctx.data.get(COLLECTION, DRAFT_ID),
        ]);
        const active = draft || published || EMPTY_SOURCE;
        return {
            published: published || null,
            draft: draft || null,
            defaults: DEFAULTS,
            warnings: contrastWarnings(active),
        };
    });

    ctx.routes.put('/draft', { access: 'admin' }, async ({ user, body }) => {
        const check = validateSource(body);
        if (!check.ok) {
            throw ctx.httpError(400, check.message);
        }
        const source = check.source;
        const css = compileCss(source);
        let error = '';
        try {
            await ctx.theme.saveDraft(css);
        } catch (err) {
            if (err && err.status === 400) {
                error = adjustFreeCssLineError(err.message, css);
            } else {
                throw err;
            }
        }
        const draft = await ctx.data.set(COLLECTION, DRAFT_ID, {
            ...source,
            error,
            updatedAt: nowIso(),
            updatedBy: user.id,
        });
        return {
            draft,
            warnings: contrastWarnings(source),
        };
    });

    ctx.routes.delete('/draft', { access: 'admin' }, async () => {
        await ctx.theme.discardDraft();
        await ctx.data.delete(COLLECTION, DRAFT_ID);
        return { success: true };
    });

    ctx.routes.post('/publish', { access: 'admin' }, async ({ user }) =>
        publishDraft(user, { allowCssChange: false })
    );

    ctx.routes.post(
        '/publish-css',
        { access: 'admin', password: true },
        async ({ user }) => publishDraft(user, { allowCssChange: true })
    );

    ctx.routes.post('/reset', { access: 'admin' }, async ({ user }) => {
        await ctx.theme.clear();
        await Promise.all([
            ctx.data.delete(COLLECTION, DRAFT_ID),
            ctx.data.delete(COLLECTION, PUBLISHED_ID),
        ]);
        await ctx.audit('reset', user.id, 'Design auf Standard zurückgesetzt');
        return { success: true };
    });
}

module.exports = { register };
