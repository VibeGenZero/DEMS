/**
 * System › Plugins: upload of a `.dems` package (#pluginUploadModal: file → check report →
 * reset password → install) and removal of a custom plugin (#pluginRemoveModal). Also the
 * pure texts for the permission mismatch of a plugin (card and trust dialog).
 * API: routes/adminPlugins.js (`upload/check`, `upload/install`, `DELETE :id`).
 */
import { registerActions } from '../core/actions.js';
import { state } from '../core/state.js';
import { escapeHtml, showToast } from '../core/ui.js';
import { loadPluginsPanel } from './system-plugins.js';

const MAX_WARNINGS = 5;
const MISMATCH = 'Berechtigungen passen nicht zum Code';
const NOT_DECLARED = 'im Code, aber nicht angegeben:';
const NOT_FOUND = 'angegeben, aber nicht im Code:';
const SWITCH_OFF = 'Schalte das Plugin zuerst aus.';

// uploadId: kept check of the open dialog; replaces/ok: from its report; remove: plugin of the open remove dialog
// checkId counts the checks so an answer for an older file (or a closed dialog) is ignored; busy: a request runs
const upload = { uploadId: null, ok: false, replaces: null, remove: null, checkId: 0, busy: false };

const labels = (entries) => (entries || []).map(entry => entry.label || entry.key).join(', ');

/**
 * Texts for the warning lines of a plugin whose code does not match its manifest.
 *
 * @param {?{ missing: Array<{key: string, label: string}>, unused: Array<Object>, warnings: string[], tooBig: boolean }} check -> `view.permissionCheck`.
 * @returns {string[]} -> Plain texts (empty without a check).
 */
export function permissionCheckLines(check) {
    if (!check) return [];
    const lines = [];
    if (check.missing && check.missing.length) lines.push(`${MISMATCH}: ${NOT_DECLARED} ${labels(check.missing)}`);
    if (check.unused && check.unused.length) lines.push(`${MISMATCH}: ${NOT_FOUND} ${labels(check.unused)}`);
    if (check.tooBig) lines.push('Code zu groß für die Prüfung');
    const warnings = check.warnings || [];
    lines.push(...warnings.slice(0, MAX_WARNINGS));
    if (warnings.length > MAX_WARNINGS) lines.push(`und ${warnings.length - MAX_WARNINGS} weitere Hinweise`);
    return lines;
}

const line = (tone, icon, text) => `<p class="${tone} mb-0"><i class="bi ${icon} me-2" aria-hidden="true"></i>${escapeHtml(text)}</p>`;

/**
 * Report of the upload check as HTML.
 *
 * @param {Object} report -> `report` of POST upload/check.
 * @param {?{ version: string, restart: boolean, enabled: boolean }} replaces -> `report.replaces`.
 * @returns {string} -> HTML (every value escaped).
 */
export function renderUploadReport(report, replaces) {
    const parts = [];
    const manifest = report.manifest;
    if (manifest) {
        const kb = Math.max(1, Math.round((report.unpackedBytes || 0) / 1024));
        const author = manifest.author ? ` · von ${manifest.author}` : '';
        parts.push(`<p class="mb-1"><strong>${escapeHtml(`${manifest.name} ${manifest.version} · SDK ${manifest.sdk}${author}`)}</strong></p>`);
        parts.push(`<p class="setup-hint">${escapeHtml(`${report.fileCount} Dateien · ${kb} KB`)}</p>`);
    }
    for (const error of report.errors || []) parts.push(line('plugin-error', 'bi-x-circle', error));
    const missing = report.missing || [];
    const unused = report.unused || [];
    if (missing.length || unused.length) {
        parts.push(line('plugin-warning', 'bi-exclamation-triangle', MISMATCH));
        if (missing.length) parts.push(`<p class="setup-hint mb-1">${escapeHtml(NOT_DECLARED)} ${escapeHtml(labels(missing))}</p>`);
        if (unused.length) parts.push(`<p class="setup-hint mb-1">${escapeHtml(NOT_FOUND)} ${escapeHtml(labels(unused))}</p>`);
    }
    const warnings = report.warnings || [];
    if (warnings.length) {
        parts.push(`<ul class="plugin-permissions">${warnings.map(text => `<li><i class="bi bi-info-circle me-2" aria-hidden="true"></i>${escapeHtml(text)}</li>`).join('')}</ul>`);
    }
    if (replaces) {
        parts.push(line('plugin-warning', 'bi-arrow-repeat', `Ersetzt die installierte Version ${replaces.version}${replaces.restart ? ' (Neustart nötig)' : ''}`));
        if (replaces.enabled) parts.push(line('plugin-error', 'bi-x-circle', SWITCH_OFF));
    }
    return parts.join('');
}

const byId = (id) => document.getElementById(id);
const modalOf = (id) => bootstrap.Modal.getOrCreateInstance(byId(id));
const quoted = (name) => `„${name}“`;

async function request(url, method, body, contentType) {
    const res = await fetch(url, {
        method,
        headers: { 'Content-Type': contentType, 'X-CSRF-TOKEN': state.csrfToken },
        body
    });
    const data = await res.json();
    return { ok: res.ok, data };
}

// The install button needs a checked package, nothing running under its id and a typed password
function refreshInstallButton() {
    const typed = String(byId('plugin-upload-password').value || '') !== '';
    byId('plugin-upload-confirm').disabled = !(upload.uploadId && upload.ok && !(upload.replaces && upload.replaces.enabled) && typed);
}

function resetUploadDialog() {
    upload.checkId += 1;
    upload.busy = false;
    upload.uploadId = null;
    upload.ok = false;
    upload.replaces = null;
    byId('plugin-upload-file').value = '';
    byId('plugin-upload-password').value = '';
    byId('plugin-upload-report').innerHTML = '';
    refreshInstallButton();
}

function openPluginUpload() {
    resetUploadDialog();
    byId('pluginUploadModal').addEventListener('hidden.bs.modal', resetUploadDialog, { once: true });
    modalOf('pluginUploadModal').show();
}

async function pluginUploadFile(element) {
    const file = element && element.files && element.files[0];
    const checkId = upload.checkId + 1;
    upload.checkId = checkId;
    upload.uploadId = null;
    upload.ok = false;
    upload.replaces = null;
    byId('plugin-upload-report').innerHTML = '';
    refreshInstallButton();
    if (!file) return;
    try {
        const bytes = await file.arrayBuffer();
        const { ok, data } = await request('/api/admin/plugins/upload/check', 'POST', bytes, 'application/octet-stream');
        if (checkId !== upload.checkId) return;
        if (!ok) return showToast(data.error || 'Das Plugin-Paket konnte nicht geprüft werden.', 'danger');
        upload.uploadId = data.uploadId || null;
        upload.ok = Boolean(data.report && data.report.ok);
        upload.replaces = data.report.replaces || null;
        byId('plugin-upload-report').innerHTML = renderUploadReport(data.report, upload.replaces);
        refreshInstallButton();
    } catch {
        if (checkId !== upload.checkId) return;
        showToast('Das Plugin-Paket konnte nicht geprüft werden.', 'danger');
    }
}

async function installPluginUpload() {
    const password = String(byId('plugin-upload-password').value || '');
    if (upload.busy || !upload.uploadId || !upload.ok || password === '') return;
    upload.busy = true;
    byId('plugin-upload-confirm').disabled = true;
    const body = JSON.stringify({ uploadId: upload.uploadId, password, replace: Boolean(upload.replaces) });
    try {
        const { ok, data } = await request('/api/admin/plugins/upload/install', 'POST', body, 'application/json');
        if (!ok) {
            upload.busy = false;
            refreshInstallButton();
            return showToast(data.error || 'Das Plugin konnte nicht installiert werden.', 'danger');
        }
        modalOf('pluginUploadModal').hide();
        resetUploadDialog();
        await loadPluginsPanel();
        const needsRestart = data.plugin && data.plugin.status === 'restart';
        showToast(`Plugin ${quoted(data.plugin && data.plugin.name)} installiert.${needsRestart ? ' Neustart nötig.' : ''}`, 'success');
    } catch {
        upload.busy = false;
        refreshInstallButton();
        showToast('Das Plugin konnte nicht installiert werden.', 'danger');
    }
}

function resetRemoveDialog() {
    upload.remove = null;
    upload.busy = false;
    byId('plugin-remove-password').value = '';
    byId('plugin-remove-confirm').disabled = true;
}

function openPluginRemove(element) {
    const id = element && element.dataset && element.dataset.pluginId;
    if (!id) return;
    upload.remove = { id, name: element.dataset.pluginName || id };
    byId('plugin-remove-name').textContent = quoted(upload.remove.name);
    byId('plugin-remove-password').value = '';
    byId('plugin-remove-confirm').disabled = true;
    byId('pluginRemoveModal').addEventListener('hidden.bs.modal', resetRemoveDialog, { once: true });
    modalOf('pluginRemoveModal').show();
}

function pluginRemoveInput() {
    byId('plugin-remove-confirm').disabled = String(byId('plugin-remove-password').value || '') === '';
}

async function confirmPluginRemove() {
    const target = upload.remove;
    const password = String(byId('plugin-remove-password').value || '');
    if (upload.busy || !target || password === '') return;
    upload.busy = true;
    byId('plugin-remove-confirm').disabled = true;
    try {
        const { ok, data } = await request(`/api/admin/plugins/${encodeURIComponent(target.id)}`, 'DELETE', JSON.stringify({ password }), 'application/json');
        if (!ok) {
            upload.busy = false;
            pluginRemoveInput();
            return showToast(data.error || 'Das Plugin konnte nicht entfernt werden.', 'danger');
        }
        modalOf('pluginRemoveModal').hide();
        resetRemoveDialog();
        await loadPluginsPanel();
        showToast(`Plugin ${quoted(target.name)} entfernt.`, 'success');
    } catch {
        upload.busy = false;
        pluginRemoveInput();
        showToast('Das Plugin konnte nicht entfernt werden.', 'danger');
    }
}

registerActions({ openPluginUpload, pluginUploadFile, pluginUploadInput: refreshInstallButton, installPluginUpload, openPluginRemove, pluginRemoveInput, confirmPluginRemove });
