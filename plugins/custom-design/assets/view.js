/**
 * Pure markup of the official „Design anpassen“ plugin.
 *
 * Uses only `helpers` from `ui.helpers`; no DOM access and no external imports.
 */

export const TOKEN_FIELDS = Object.freeze([
    { key: 'accent', label: 'Akzentfarbe' },
    { key: 'bgPrimary', label: 'Seitenhintergrund' },
    { key: 'bgSecondary', label: 'Zweiter Hintergrund' },
    { key: 'bgCard', label: 'Karten' },
    { key: 'textPrimary', label: 'Text' },
    { key: 'textSecondary', label: 'Text (zweitrangig)' },
    { key: 'textMuted', label: 'Text (gedämpft)' },
]);

export const DEFAULT_PALETTE = Object.freeze({
    dark: Object.freeze({
        accent: '#8b5cf6',
        bgPrimary: '#0a0a0f',
        bgSecondary: '#12121a',
        bgCard: '#16161f',
        textPrimary: '#e4e4e7',
        textSecondary: '#a1a1aa',
        textMuted: '#8f8f9a',
    }),
    light: Object.freeze({
        accent: '#7c3aed',
        bgPrimary: '#f2f3f5',
        bgSecondary: '#ebedef',
        bgCard: '#ffffff',
        textPrimary: '#313338',
        textSecondary: '#4e5058',
        textMuted: '#5c5e66',
    }),
});

export const CORNER_OPTIONS = Object.freeze([
    { key: 'square', label: 'Eckig' },
    { key: 'standard', label: 'Standard' },
    { key: 'round', label: 'Rund' },
]);

export const FONT_OPTIONS = Object.freeze([
    { key: 'inter', label: 'Inter' },
    { key: 'system', label: 'Systemschrift' },
]);

export function emptySource() {
    return {
        tokens: {
            dark: {
                accent: '',
                bgPrimary: '',
                bgSecondary: '',
                bgCard: '',
                textPrimary: '',
                textSecondary: '',
                textMuted: '',
            },
            light: {
                accent: '',
                bgPrimary: '',
                bgSecondary: '',
                bgCard: '',
                textPrimary: '',
                textSecondary: '',
                textMuted: '',
            },
        },
        corners: 'standard',
        font: 'inter',
        css: '',
    };
}

function renderColorCell(scheme, field, source, defaults, escapeHtml) {
    const schemeLabel = scheme === 'dark' ? 'Dunkel' : 'Hell';
    const rawValue = source?.tokens?.[scheme]?.[field.key] || '';
    const defaultValue =
        defaults?.[scheme]?.[field.key] || DEFAULT_PALETTE[scheme][field.key];
    const pickerValue = rawValue || defaultValue;
    const clearDisabled = rawValue ? '' : ' disabled';

    return `<div class="cd-color-cell">
        <input type="color" class="form-control form-control-color cd-color-picker" id="cd-color-${scheme}-${field.key}" value="${escapeHtml(pickerValue)}" data-input="p:custom-design:setColor" data-scheme="${scheme}" data-key="${field.key}" aria-label="${escapeHtml(field.label)} (${schemeLabel})">
        <input type="text" class="form-control form-control-sm cd-hex-input" id="cd-hex-${scheme}-${field.key}" value="${escapeHtml(rawValue)}" placeholder="${escapeHtml(defaultValue)}" maxlength="7" data-input="p:custom-design:setHex" data-scheme="${scheme}" data-key="${field.key}" aria-label="${escapeHtml(field.label)} Hex (${schemeLabel})">
        <button type="button" class="btn btn-ghost btn-sm cd-clear-btn" id="cd-clear-${scheme}-${field.key}" data-click="p:custom-design:clearColor" data-scheme="${scheme}" data-key="${field.key}" title="Auf Standard (${escapeHtml(defaultValue)}) zurücksetzen" aria-label="${escapeHtml(field.label)} (${schemeLabel}) auf Standard zurücksetzen"${clearDisabled}>
            <i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i>
        </button>
    </div>`;
}

export function renderStatusLine({ draftError = '', saveState = 'idle' } = {}, escapeHtml) {
    if (draftError) {
        return `<span class="cd-status is-error" id="cd-status"><i class="bi bi-exclamation-octagon me-1" aria-hidden="true"></i>${escapeHtml(draftError)}</span>`;
    }
    if (saveState === 'saving') {
        return `<span class="cd-status text-secondary" id="cd-status">Speichert …</span>`;
    }
    if (saveState === 'saved') {
        return `<span class="cd-status text-secondary" id="cd-status"><i class="bi bi-check2 me-1" aria-hidden="true"></i>Entwurf gespeichert</span>`;
    }
    if (saveState === 'failed') {
        return `<span class="cd-status is-error" id="cd-status"><i class="bi bi-exclamation-triangle me-1" aria-hidden="true"></i>Speichern fehlgeschlagen</span>`;
    }
    return `<span class="cd-status text-secondary" id="cd-status"></span>`;
}

export function renderWarningsList(warnings, escapeHtml) {
    const list = Array.isArray(warnings) ? warnings : [];
    if (list.length === 0) return '';
    const items = list
        .map(item => {
            const msg = typeof item === 'string' ? item : item?.message || '';
            return `<li class="cd-warning-item"><i class="bi bi-exclamation-triangle me-2" aria-hidden="true"></i><span>${escapeHtml(msg)}</span></li>`;
        })
        .join('');
    return `<ul class="cd-warnings" id="cd-warnings">${items}</ul>`;
}

/**
 * Render the „Design anpassen“ page.
 *
 * @param {object} model
 * @param {object} helpers -> `ui.helpers`.
 * @returns {string} -> HTML.
 */
export function renderDesignPage(model = {}, helpers) {
    const { escapeHtml } = helpers;
    const tab = model.tab === 'css' ? 'css' : 'tokens';
    const source = model.source || emptySource();
    const defaults = model.defaults || DEFAULT_PALETTE;
    const warnings = model.warnings || [];
    const draftError = model.draftError || '';
    const saveState = model.saveState || 'idle';
    const standardMode = Boolean(model.standardMode);
    const corners = source.corners || 'standard';
    const font = source.font || 'inter';

    const isTokensTab = tab === 'tokens';
    const isCssTab = tab === 'css';

    const standardNotice = standardMode
        ? `<div class="cd-standard-notice" role="status">
            <i class="bi bi-info-circle me-2" aria-hidden="true"></i>
            <span>Eigenes Design ist in diesem Tab ausgeschaltet.</span>
        </div>`
        : '';

    const rowsHtml = TOKEN_FIELDS.map(
        field => `<div class="cd-token-row">
            <div class="cd-token-label">${escapeHtml(field.label)}</div>
            ${renderColorCell('dark', field, source, defaults, escapeHtml)}
            ${renderColorCell('light', field, source, defaults, escapeHtml)}
        </div>`
    ).join('');

    const cornersHtml = CORNER_OPTIONS.map(opt => {
        const checked = corners === opt.key ? ' checked' : '';
        return `<div class="form-check form-check-inline">
            <input class="form-check-input" type="radio" name="cd-corners" id="cd-corners-${opt.key}" value="${opt.key}" data-change="p:custom-design:setCorners" data-corners="${opt.key}"${checked}>
            <label class="form-check-label" for="cd-corners-${opt.key}">${escapeHtml(opt.label)}</label>
        </div>`;
    }).join('');

    const fontOptionsHtml = FONT_OPTIONS.map(opt => {
        const selected = font === opt.key ? ' selected' : '';
        return `<option value="${opt.key}"${selected}>${escapeHtml(opt.label)}</option>`;
    }).join('');

    const cssErrorHtml = draftError
        ? `<p class="cd-error mb-0" id="cd-draft-error"><i class="bi bi-exclamation-octagon me-1" aria-hidden="true"></i>${escapeHtml(draftError)}</p>`
        : `<p class="cd-error mb-0 is-hidden" id="cd-draft-error"></p>`;

    return `<div class="cd-layout">
        ${standardNotice}
        <div class="cd-top-row">
            <ul class="nav nav-pills cd-tabs" role="tablist">
                <li class="nav-item" role="presentation">
                    <button type="button" class="nav-link${isTokensTab ? ' active' : ''}" role="tab" aria-selected="${isTokensTab}" data-click="p:custom-design:showTab" data-tab="tokens">
                        <i class="bi bi-sliders me-1" aria-hidden="true"></i>Farben &amp; Formen
                    </button>
                </li>
                <li class="nav-item" role="presentation">
                    <button type="button" class="nav-link${isCssTab ? ' active' : ''}" role="tab" aria-selected="${isCssTab}" data-click="p:custom-design:showTab" data-tab="css">
                        <i class="bi bi-code-slash me-1" aria-hidden="true"></i>Eigenes CSS
                    </button>
                </li>
            </ul>
            <div id="cd-status-area">${renderStatusLine({ draftError, saveState }, escapeHtml)}</div>
        </div>

        <section class="glass-card cd-card${isTokensTab ? '' : ' is-hidden'}" id="cd-panel-tokens">
            <div class="cd-token-grid">
                <div class="cd-token-head">
                    <span>Farbe</span>
                    <span>Dunkel</span>
                    <span>Hell</span>
                </div>
                ${rowsHtml}
            </div>

            <div class="cd-shape-row">
                <div class="cd-shape-field">
                    <span class="form-label d-block">Ecken</span>
                    <div class="cd-corners-group">${cornersHtml}</div>
                </div>
                <div class="cd-shape-field">
                    <label class="form-label" for="cd-font">Schrift</label>
                    <select class="form-select" id="cd-font" data-change="p:custom-design:setFont">${fontOptionsHtml}</select>
                </div>
            </div>
        </section>

        <section class="glass-card cd-card${isCssTab ? '' : ' is-hidden'}" id="cd-panel-css">
            <p class="cd-css-hint text-secondary">
                Eigenes CSS gilt auf der ganzen Seite. Aus Sicherheitsgründen sind <code>url()</code>, <code>@import</code>, <code>@font-face</code> und Backslashes (<code>\\</code>) nicht erlaubt. Design-Tokens (<code>--accent</code>, <code>--bg-card</code>, …) sind der stabile Weg – Klassennamen können sich bei DEMS-Updates ändern.
            </p>
            <label class="form-label" for="cd-css">Eigenes CSS</label>
            <textarea class="form-control cd-css-textarea" id="cd-css" rows="12" maxlength="50000" placeholder="/* Eigenes CSS, z. B. .glass-card { ... } */" data-input="p:custom-design:editCss">${escapeHtml(source.css || '')}</textarea>
            ${cssErrorHtml}
        </section>

        <div id="cd-warnings-area">${renderWarningsList(warnings, escapeHtml)}</div>

        <section class="glass-card cd-card cd-footer-card">
            <div class="cd-actions-row">
                <div class="cd-actions-primary">
                    <button type="button" class="btn btn-secondary" id="cd-preview-btn" data-click="p:custom-design:preview"${standardMode ? ' disabled' : ''}>
                        <i class="bi bi-eye me-1" aria-hidden="true"></i>Vorschau
                    </button>
                    <button type="button" class="btn btn-primary" id="cd-publish-btn" data-click="p:custom-design:publish"${draftError ? ' disabled' : ''}>
                        <i class="bi bi-check2-circle me-1" aria-hidden="true"></i>Veröffentlichen
                    </button>
                    <button type="button" class="btn btn-ghost" id="cd-discard-btn" data-click="p:custom-design:discard">
                        <i class="bi bi-x-lg me-1" aria-hidden="true"></i>Entwurf verwerfen
                    </button>
                </div>
                <button type="button" class="btn btn-danger-soft btn-sm" id="cd-reset-btn" data-click="p:custom-design:reset">
                    <i class="bi bi-arrow-counterclockwise me-1" aria-hidden="true"></i>Auf Standard zurücksetzen
                </button>
            </div>
            <p class="cd-escape-hint text-secondary mb-0">
                <i class="bi bi-life-preserver me-1" aria-hidden="true"></i>Notausgang: Mit ?design=standard in der Adresse lädt DEMS ohne eigenes Design.
            </p>
        </section>
    </div>`;
}
