/**
 * Core-owned theme stylesheet store for plugins with the `theme` permission.
 *
 * Documents live in `pluginThemes/<pluginId>` (`{ css, publishedAt, draft, draftAt }`),
 * unreachable through `ctx.data`. Every sheet is checked by `checkThemeCss`
 * on save AND re-checked when served by `readThemeSheets`.
 */
const { db, doc, getDoc, setDoc, deleteDoc } = require('../firebaseAdmin');
const { checkThemeCss } = require('./themeCss');
const { PluginPermissionError, PluginHttpError } = require('./errors');

const THEME_COLLECTION = 'pluginThemes';

const nowIso = () => new Date().toISOString();

function normalizeDoc(raw) {
    const data = raw && typeof raw === 'object' ? raw : {};
    return {
        css: typeof data.css === 'string' ? data.css : '',
        publishedAt: typeof data.publishedAt === 'string' ? data.publishedAt : '',
        draft: typeof data.draft === 'string' ? data.draft : '',
        draftAt: typeof data.draftAt === 'string' ? data.draftAt : ''
    };
}

function validateSheet(css) {
    const result = checkThemeCss(css);
    if (!result.ok) throw new PluginHttpError(400, result.message);
}

/**
 * Build `ctx.theme` for one plugin.
 *
 * @param {string} pluginId
 * @param {{ granted: Set<string> }} options
 * @returns {Readonly<{ saveDraft(css: string): Promise<void>, discardDraft(): Promise<void>, publish(css: string): Promise<void>, clear(): Promise<void> }>}
 */
function createThemeApi(pluginId, { granted }) {
    function requireThemePermission() {
        if (!granted || !granted.has('theme')) throw new PluginPermissionError('theme');
    }

    const ref = () => doc(db, THEME_COLLECTION, pluginId);

    async function readCurrent() {
        const snap = await getDoc(ref());
        return snap.exists() ? normalizeDoc(snap.data()) : normalizeDoc({});
    }

    return Object.freeze({
        async saveDraft(css) {
            requireThemePermission();
            validateSheet(css);
            const current = await readCurrent();
            await setDoc(ref(), {
                ...current,
                draft: css,
                draftAt: nowIso()
            });
        },
        async discardDraft() {
            requireThemePermission();
            const snap = await getDoc(ref());
            if (!snap.exists()) return;
            const current = normalizeDoc(snap.data());
            if (!current.css) {
                await deleteDoc(ref());
            } else {
                await setDoc(ref(), { ...current, draft: '', draftAt: '' });
            }
        },
        async publish(css) {
            requireThemePermission();
            validateSheet(css);
            await setDoc(ref(), {
                css,
                publishedAt: nowIso(),
                draft: '',
                draftAt: ''
            });
        },
        async clear() {
            requireThemePermission();
            await deleteDoc(ref());
        }
    });
}

/**
 * Delete the stored theme document of a plugin (`deleteData`, `wipeAllData`).
 *
 * @param {string} pluginId
 * @returns {Promise<void>}
 */
async function deleteTheme(pluginId) {
    await deleteDoc(doc(db, THEME_COLLECTION, pluginId));
}

/**
 * Read and re-check the combined theme stylesheets of `pluginIds` in order.
 *
 * @param {string[]} pluginIds -> Enabled theme plugin ids in deterministic order.
 * @param {{ preview?: boolean }} [options]
 * @returns {Promise<string>} -> Combined CSS or `''`.
 */
async function readThemeSheets(pluginIds, { preview = false } = {}) {
    if (!Array.isArray(pluginIds) || pluginIds.length === 0) return '';
    const parts = [];
    for (const pluginId of pluginIds) {
        const snap = await getDoc(doc(db, THEME_COLLECTION, pluginId));
        if (!snap.exists()) continue;
        const stored = normalizeDoc(snap.data());
        const sheet = preview && stored.draft ? stored.draft : stored.css;
        if (!sheet) continue;
        const checked = checkThemeCss(sheet);
        if (!checked.ok) {
            console.warn(`[plugin:${pluginId}] Stored theme refused: ${checked.message}`);
            continue;
        }
        parts.push(`/* plugin: ${pluginId} */\n${sheet}\n`);
    }
    return parts.join('');
}

module.exports = {
    THEME_COLLECTION,
    createThemeApi,
    readThemeSheets,
    deleteTheme
};
