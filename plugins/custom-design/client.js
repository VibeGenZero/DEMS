/**
 * Client side of the official plugin „Design anpassen“.
 *
 * Admins customise colours (per dark/light scheme), corners, font and free CSS
 * with live contrast warnings, tab-local draft preview and publish/reset flow.
 */
import { createDraftSaver } from './assets/saver.js';
import {
    DEFAULT_PALETTE,
    TOKEN_FIELDS,
    emptySource,
    renderDesignPage,
    renderStatusLine,
    renderWarningsList,
} from './assets/view.js';

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const TOKEN_KEYS = new Set(TOKEN_FIELDS.map(f => f.key));

function normalizeHex(value) {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (text === '') return '';
    const match = HEX.exec(text);
    if (!match) return null;
    const digits =
        match[1].length === 3
            ? [...match[1]].map(d => d + d).join('')
            : match[1];
    return `#${digits.toLowerCase()}`;
}

function isSchemeKey(scheme, key) {
    return (scheme === 'dark' || scheme === 'light') && TOKEN_KEYS.has(key);
}

function cloneSource(doc) {
    const base = emptySource();
    if (!doc || typeof doc !== 'object') return base;
    for (const scheme of ['dark', 'light']) {
        for (const key of TOKEN_KEYS) {
            const val = doc.tokens?.[scheme]?.[key];
            base.tokens[scheme][key] = typeof val === 'string' ? val : '';
        }
    }
    if (['square', 'standard', 'round'].includes(doc.corners)) {
        base.corners = doc.corners;
    }
    if (['inter', 'system'].includes(doc.font)) {
        base.font = doc.font;
    }
    if (typeof doc.css === 'string') {
        base.css = doc.css;
    }
    return base;
}

/**
 * @param {object} ui -> Plugin UI API of the host (`public/js/core/plugins.js`).
 */
export function register(ui) {
    if (!ui.user || !ui.user.isAdmin) return;

    const view = {
        shown: false,
        tab: 'tokens',
        source: emptySource(),
        published: null,
        defaults: DEFAULT_PALETTE,
        warnings: [],
        draftError: '',
        saveState: 'idle',
        previewOn: false,
        busy: false,
    };

    const toastError = (err) => {
        if (err && err.message && err.message !== 'Abgebrochen.') {
            ui.helpers.showToast(err.message, 'danger');
        }
    };

    function syncStatusDom() {
        if (!view.shown) return;
        const { escapeHtml, toggleElement } = ui.helpers;
        const statusArea = document.getElementById('cd-status-area');
        if (statusArea) {
            statusArea.innerHTML = renderStatusLine(
                { draftError: view.draftError, saveState: view.saveState },
                escapeHtml
            );
        }
        const warningsArea = document.getElementById('cd-warnings-area');
        if (warningsArea) {
            warningsArea.innerHTML = renderWarningsList(view.warnings, escapeHtml);
        }
        const errorEl = document.getElementById('cd-draft-error');
        if (errorEl) {
            if (view.draftError) {
                errorEl.innerHTML = `<i class="bi bi-exclamation-octagon me-1" aria-hidden="true"></i>${escapeHtml(view.draftError)}`;
                toggleElement(errorEl, true);
            } else {
                errorEl.innerHTML = '';
                toggleElement(errorEl, false);
            }
        }
        const publishBtn = document.getElementById('cd-publish-btn');
        if (publishBtn) {
            publishBtn.disabled = Boolean(view.draftError);
        }
    }

    async function saveDraft(sourceToSave) {
        view.saveState = 'saving';
        syncStatusDom();
        try {
            const res = await ui.api.put('/draft', sourceToSave);
            view.warnings = Array.isArray(res?.warnings) ? res.warnings : [];
            view.draftError = res?.draft?.error || '';
            view.saveState = 'saved';
            syncStatusDom();
            if (view.previewOn && !ui.theme.isStandardMode()) {
                ui.theme.showPreview();
            }
            return res;
        } catch (err) {
            view.saveState = 'failed';
            syncStatusDom();
            throw err;
        }
    }

    const saver = createDraftSaver({ save: saveDraft });

    function scheduleChange() {
        view.saveState = 'saving';
        syncStatusDom();
        saver.schedule(cloneSource(view.source));
    }

    function draw() {
        const page = view.shown ? document.getElementById('cd-page') : null;
        if (!page) return;
        page.innerHTML = renderDesignPage(
            {
                tab: view.tab,
                source: view.source,
                defaults: view.defaults,
                warnings: view.warnings,
                draftError: view.draftError,
                saveState: view.saveState,
                previewOn: view.previewOn,
                standardMode: ui.theme.isStandardMode(),
            },
            ui.helpers
        );
    }

    function applyLoaded(data) {
        view.published = data?.published ? cloneSource(data.published) : null;
        const active = data?.draft || data?.published || null;
        view.source = cloneSource(active);
        view.defaults = data?.defaults || DEFAULT_PALETTE;
        view.warnings = Array.isArray(data?.warnings) ? data.warnings : [];
        view.draftError = data?.draft?.error || '';
    }

    async function load() {
        try {
            const data = await ui.api.get('/');
            applyLoaded(data);
            draw();
        } catch (err) {
            toastError(err);
        }
    }

    async function once(work) {
        if (view.busy) return;
        view.busy = true;
        try {
            await work();
        } catch (err) {
            toastError(err);
        } finally {
            view.busy = false;
        }
    }

    function showTab(element) {
        const next = element?.dataset?.tab;
        if (next !== 'tokens' && next !== 'css') return;
        view.tab = next;
        draw();
    }

    function setColor(element) {
        const scheme = element?.dataset?.scheme;
        const key = element?.dataset?.key;
        const hex = normalizeHex(element?.value);
        if (!isSchemeKey(scheme, key) || !hex) return;
        view.source.tokens[scheme][key] = hex;
        const hexInput = document.getElementById(`cd-hex-${scheme}-${key}`);
        if (hexInput) hexInput.value = hex;
        const clearBtn = document.getElementById(`cd-clear-${scheme}-${key}`);
        if (clearBtn) clearBtn.disabled = false;
        scheduleChange();
    }

    function setHex(element) {
        const scheme = element?.dataset?.scheme;
        const key = element?.dataset?.key;
        if (!isSchemeKey(scheme, key)) return;
        const hex = normalizeHex(String(element?.value ?? ''));
        if (hex === null) return;
        view.source.tokens[scheme][key] = hex;
        const picker = document.getElementById(`cd-color-${scheme}-${key}`);
        const def = view.defaults?.[scheme]?.[key] || DEFAULT_PALETTE[scheme][key];
        if (picker) picker.value = hex || def;
        const clearBtn = document.getElementById(`cd-clear-${scheme}-${key}`);
        if (clearBtn) clearBtn.disabled = !hex;
        scheduleChange();
    }

    function clearColor(element) {
        const scheme = element?.dataset?.scheme;
        const key = element?.dataset?.key;
        if (!isSchemeKey(scheme, key)) return;
        view.source.tokens[scheme][key] = '';
        draw();
        scheduleChange();
    }

    function setCorners(element) {
        const val = element?.dataset?.corners || element?.value;
        if (!['square', 'standard', 'round'].includes(val)) return;
        view.source.corners = val;
        scheduleChange();
    }

    function setFont(element) {
        const val = element?.value;
        if (!['inter', 'system'].includes(val)) return;
        view.source.font = val;
        scheduleChange();
    }

    function editCss(element) {
        view.source.css = String(element?.value ?? '');
        scheduleChange();
    }

    async function preview() {
        if (ui.theme.isStandardMode()) return;
        try {
            await saver.flush();
            view.previewOn = true;
            ui.theme.showPreview();
        } catch (err) {
            toastError(err);
        }
    }

    function publish() {
        return once(async () => {
            await saver.flush();
            if (view.draftError) return;
            const freeCssChanged = (view.published?.css ?? '') !== (view.source.css ?? '');
            const res = freeCssChanged
                ? await ui.api.post('/publish-css', {}, { password: true })
                : await ui.api.post('/publish', {});
            view.published = res?.published
                ? cloneSource(res.published)
                : cloneSource(view.source);
            view.previewOn = false;
            view.saveState = 'idle';
            ui.theme.hidePreview();
            ui.theme.reload();
            ui.helpers.showToast('Design veröffentlicht.', 'success');
            draw();
        });
    }

    function discard() {
        return once(async () => {
            saver.cancel();
            await ui.api.delete('/draft');
            view.previewOn = false;
            view.saveState = 'idle';
            ui.theme.hidePreview();
            const data = await ui.api.get('/');
            applyLoaded(data);
            draw();
            ui.helpers.showToast('Entwurf verworfen.', 'success');
        });
    }

    function reset() {
        return once(async () => {
            const confirmed = await ui.helpers.showConfirmDialog(
                'Eigenes Design entfernen? Alle sehen wieder das DEMS-Standarddesign.',
                'Zurücksetzen'
            );
            if (!confirmed) return;
            saver.cancel();
            await ui.api.post('/reset', {});
            view.published = null;
            view.source = emptySource();
            view.warnings = [];
            view.draftError = '';
            view.saveState = 'idle';
            view.previewOn = false;
            ui.theme.hidePreview();
            ui.theme.reload();
            draw();
            ui.helpers.showToast('Design auf Standard zurückgesetzt.', 'success');
        });
    }

    ui.actions.register({
        showTab,
        setColor,
        setHex,
        clearColor,
        setCorners,
        setFont,
        editCss,
        preview,
        publish,
        discard,
        reset,
    });

    ui.addPage({
        access: 'admin',
        title: 'Design anpassen',
        tab: { label: 'Design', icon: 'bi-palette' },
        render(container) {
            container.innerHTML = '<div id="cd-page" class="cd-page"></div>';
            view.shown = true;
            return load();
        },
        leave() {
            view.shown = false;
            return saver.flush().catch(() => {});
        },
    });
}
