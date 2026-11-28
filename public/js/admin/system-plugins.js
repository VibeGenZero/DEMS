/**
 * Category "Plugins" of the admin page "System" (#system/plugins): one card per
 * plugin with origin, permissions, status and switch, the settings of its
 * manifest and „Daten löschen“. Switching on a plugin that does not come from
 * the DEMS project goes through the trust dialog (#pluginTrustModal: checkbox +
 * reset password). API: routes/adminPlugins.js.
 */
import { registerActions } from '../core/actions.js';
import { emptyState } from '../core/components.js';
import { state } from '../core/state.js';
import { escapeHtml, showConfirmDialog, showToast, toggleElement } from '../core/ui.js';
import { permissionCheckLines } from './plugin-upload.js';
import { textChannelOptions } from './bot-control.js';
import { addSystemCategory } from './system-nav.js';

addSystemCategory({ id: 'plugins', label: 'Plugins', subtitle: 'Erweiterungen ein- und ausschalten', icon: 'bi-puzzle' }, 'ai');

const LOAD_ERROR = 'Plugins konnten nicht geladen werden.';
const NO_CHOICE = 'Keine Auswahl';
const STATUS_TONES = { on: 'success', error: 'danger', invalid: 'danger', incompatible: 'danger', confirm: 'warning', restart: 'warning' };
// Statuses whose switch cannot act (the server would refuse, nothing could load or DEMS must restart first)
const LOCKED_STATUSES = ['invalid', 'incompatible', 'safe', 'restart'];

// views: answer of GET /api/admin/plugins in its order; trustId: plugin of the open trust dialog
const panel = { safeMode: false, uploadEnabled: false, views: [], channels: [], roles: [], trustId: null };

const settingFieldId = (pluginId, key) => `plugin-${pluginId}-setting-${key}`;
const passwordFieldId = (pluginId) => `plugin-${pluginId}-password`;
const quoted = (name) => `„${name}“`;

// The first view of an id owns it; a later one is a custom folder that reuses an official id
const viewIndex = (id) => panel.views.findIndex(entry => entry.id === id);
const viewOf = (id) => panel.views[viewIndex(id)] || null;

function chip(text, tone = '', icon = '') {
    const iconHtml = icon ? `<i class="bi ${icon} me-1" aria-hidden="true"></i>` : '';
    return `<span class="chip chip-sm${tone ? ` chip-${tone}` : ''}">${iconHtml}${escapeHtml(text)}</span>`;
}

function originChip(view) {
    return view.official
        ? chip('Offiziell', 'success', 'bi-patch-check')
        : chip('Nicht offiziell', 'warning', 'bi-exclamation-triangle');
}

/**
 * Permission labels as list items.
 *
 * @param {Array<{ key: string, label: string }>} permissions
 * @returns {string} -> HTML of the items, or a sentence when there are none.
 */
function permissionItems(permissions) {
    if (!permissions || permissions.length === 0) return '<li>Keine besonderen Berechtigungen</li>';
    return permissions.map(permission => `<li><i class="bi bi-key me-2" aria-hidden="true"></i>${escapeHtml(permission.label || permission.key)}</li>`).join('');
}

function warningLine(text) {
    return `<p class="plugin-warning mb-0"><i class="bi bi-exclamation-triangle me-2" aria-hidden="true"></i>${escapeHtml(text)}</p>`;
}

function warningLines(view) {
    const lines = [];
    // An error status already names the load error in its chip
    if (view.lastError && view.status !== 'error') {
        const at = view.lastErrorAt ? ` (${new Date(view.lastErrorAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })})` : '';
        lines.push(warningLine(`Letzter Fehler${at}: ${view.lastError}`));
    }
    if (view.limitWarning) lines.push(warningLine(view.limitWarning));
    for (const text of permissionCheckLines(view.permissionCheck)) lines.push(warningLine(text));
    return lines.join('');
}

function switchHtml(view, safeMode) {
    const id = escapeHtml(view.id);
    // Safe mode runs no plugin: the stored switch shows, and only switching off is possible
    const on = safeMode ? view.enabled === true : view.status === 'on';
    const checked = on ? ' checked' : '';
    const locked = safeMode ? !on : LOCKED_STATUSES.includes(view.status);
    const disabled = locked ? ' disabled' : '';
    return `<div class="form-check form-switch plugin-switch">
        <input class="form-check-input" type="checkbox" role="switch" id="plugin-${id}-enabled" data-change="togglePlugin" data-plugin-id="${id}" aria-label="Plugin ${escapeHtml(quoted(view.name))} einschalten"${checked}${disabled}>
    </div>`;
}

function choiceOptions(choices, selected, missingLabel) {
    const options = [`<option value="">${NO_CHOICE}</option>`]
        .concat(choices.map(choice => `<option value="${escapeHtml(choice.value)}">${escapeHtml(choice.label)}</option>`));
    if (selected && !choices.some(choice => choice.value === selected)) {
        options.push(`<option value="${escapeHtml(selected)}">${escapeHtml(missingLabel)} (${escapeHtml(selected)})</option>`);
    }
    return options.join('');
}

/**
 * One settings field of a plugin; its value is set after drawing (fillSettings).
 *
 * @param {Object} view -> Plugin view.
 * @param {Object} setting -> Manifest setting `{ key, type, label, help, options? }`.
 * @param {{ channels: Array<Object>, roles: Array<Object> }} lists -> Choices of `channel` and `role`.
 * @returns {string} -> HTML.
 */
function settingHtml(view, setting, lists) {
    const id = escapeHtml(settingFieldId(view.id, setting.key));
    const attrs = `id="${id}" data-group="plugin:${escapeHtml(view.id)}"`;
    const help = setting.help ? `<div class="setup-hint">${escapeHtml(setting.help)}</div>` : '';
    const label = (extra = '') => `<label class="form-label" for="${id}">${escapeHtml(setting.label)}${extra}</label>`;
    const stored = (view.settingsValues || {})[setting.key];
    switch (setting.type) {
    case 'boolean':
        return `<div class="form-check setup-field">
            <input class="form-check-input" type="checkbox" ${attrs}>
            <label class="form-check-label" for="${id}">${escapeHtml(setting.label)}</label>
            ${help}
        </div>`;
    case 'textarea':
        return `<div class="setup-field">${label()}<textarea class="form-control" rows="3" ${attrs}></textarea>${help}</div>`;
    case 'number':
        return `<div class="setup-field">${label()}<input class="form-control" type="number" ${attrs}>${help}</div>`;
    case 'select': {
        const choices = (setting.options || []).map(option => (typeof option === 'string' ? { value: option, label: option } : option));
        return `<div class="setup-field">${label()}<select class="form-select" ${attrs}>${choiceOptions(choices, String(stored ?? ''), 'Gespeicherter Wert')}</select>${help}</div>`;
    }
    case 'channel':
        return `<div class="setup-field">${label()}<select class="form-select" ${attrs}>${textChannelOptions(lists.channels, String(stored ?? ''), NO_CHOICE)}</select>${help}</div>`;
    case 'role': {
        const choices = (Array.isArray(lists.roles) ? lists.roles : []).map(role => ({ value: role.id, label: role.name }));
        return `<div class="setup-field">${label()}<select class="form-select" ${attrs}>${choiceOptions(choices, String(stored ?? ''), 'Gespeicherte Rolle')}</select>${help}</div>`;
    }
    case 'secret': {
        const isSet = Boolean(stored && stored.set);
        const placeholder = isSet ? 'gesetzt – leer lassen zum Behalten' : 'nicht gesetzt';
        return `<div class="setup-field">${label(` ${isSet ? chip('gesetzt', 'success') : chip('nicht gesetzt')}`)}
            <input class="form-control" type="password" ${attrs} placeholder="${placeholder}" autocomplete="new-password">${help}</div>`;
    }
    default:
        return `<div class="setup-field">${label()}<input class="form-control" type="text" ${attrs} autocomplete="off">${help}</div>`;
    }
}

function settingsHtml(view, lists) {
    const settings = view.settings || [];
    if (settings.length === 0) return '';
    const id = escapeHtml(view.id);
    const password = settings.some(setting => setting.type === 'secret')
        ? `<div class="setup-field">
            <label class="form-label" for="${escapeHtml(passwordFieldId(view.id))}">Admin-Reset-Passwort</label>
            <input class="form-control" type="password" id="${escapeHtml(passwordFieldId(view.id))}" autocomplete="current-password">
            <div class="setup-hint">Nur nötig, um geheime Werte zu ändern.</div>
        </div>`
        : '';
    return `<div class="plugin-settings">
        <h5 class="plugin-section-title">Einstellungen</h5>
        <div class="setup-fields">${settings.map(setting => settingHtml(view, setting, lists)).join('')}${password}</div>
        <div class="setup-actions">
            <button type="button" class="btn btn-primary" data-click="savePluginSettings" data-plugin-id="${id}">
                <i class="bi bi-check2 me-1" aria-hidden="true"></i>Einstellungen speichern
            </button>
        </div>
    </div>`;
}

/**
 * Card of one plugin.
 *
 * @param {Object} view -> Plugin view of GET /api/admin/plugins (plugin-sdk/views.js + `settingsValues`).
 * @param {Object} [context]
 * @param {boolean} [context.safeMode] -> Safe mode: only the switch of a plugin stored on is enabled (to switch it off).
 * @param {Array<Object>} [context.channels] -> `GET /api/admin/channels` for `channel` settings.
 * @param {Array<Object>} [context.roles] -> `GET /api/admin/roles` for `role` settings.
 * @param {boolean} [context.uploadEnabled] -> Uploads allowed (PLUGINS_UPLOAD): a custom plugin that is off gets „Entfernen“.
 * @param {boolean} [context.readOnly] -> A custom folder that reuses an official id: facts only, no actions.
 * @returns {string} -> HTML.
 */
export function renderPluginCard(view, { safeMode = false, channels = [], roles = [], uploadEnabled = false, readOnly = false } = {}) {
    const id = escapeHtml(view.id);
    const orphaned = view.status === 'orphaned';
    const meta = [view.version ? `Version ${view.version}` : '', view.author].filter(Boolean).join(' · ');
    const canDelete = !readOnly && view.status !== 'on' && view.status !== 'safe';
    const canRemove = !readOnly && uploadEnabled && !view.official && !view.enabled && view.status !== 'on' && view.status !== 'orphaned';
    const removeButton = canRemove
        ? `<button type="button" class="btn btn-outline-danger btn-sm" data-click="openPluginRemove" data-plugin-id="${id}" data-plugin-name="${escapeHtml(view.name)}">
                <i class="bi bi-x-circle me-1" aria-hidden="true"></i>Entfernen
            </button>`
        : '';
    const deleteButton = canDelete || canRemove
        ? `<div class="setup-actions">
            ${canDelete ? `<button type="button" class="btn btn-outline-danger btn-sm" data-click="deletePluginData" data-plugin-id="${id}">
                <i class="bi bi-trash me-1" aria-hidden="true"></i>Daten löschen
            </button>` : ''}${removeButton}
        </div>`
        : '';
    return `<article class="glass-card system-card plugin-card">
        <div class="system-card-head">
            <div>
                <h4 class="system-card-title">${escapeHtml(view.name)}</h4>
                ${meta ? `<p class="setup-hint mb-0">${escapeHtml(meta)}</p>` : ''}
            </div>
            ${readOnly || orphaned ? '' : switchHtml(view, safeMode)}
        </div>
        <div class="plugin-chips">${originChip(view)}${chip(view.statusText || view.status, STATUS_TONES[view.status] || '')}</div>
        ${view.description ? `<p class="text-secondary mb-0">${escapeHtml(view.description)}</p>` : ''}
        ${orphaned ? '' : `<div>
            <h5 class="plugin-section-title">Berechtigungen</h5>
            <ul class="plugin-permissions">${permissionItems(view.permissions)}</ul>
        </div>`}
        ${warningLines(view)}
        ${readOnly ? '' : settingsHtml(view, { channels, roles })}
        ${deleteButton}
    </article>`;
}

// Put the stored values into the drawn fields (a select only takes its value once its options exist)
function fillSettings(view) {
    const values = view.settingsValues || {};
    for (const setting of view.settings || []) {
        const element = document.getElementById(settingFieldId(view.id, setting.key));
        if (!element) continue;
        const stored = values[setting.key];
        if (setting.type === 'boolean') element.checked = stored === true;
        else if (setting.type === 'secret') element.value = '';
        else element.value = stored === undefined || stored === null ? '' : String(stored);
    }
}

function cardOf(index) {
    const view = panel.views[index];
    return renderPluginCard(view, {
        safeMode: panel.safeMode,
        channels: panel.channels,
        roles: panel.roles,
        uploadEnabled: panel.uploadEnabled,
        readOnly: viewIndex(view.id) !== index
    });
}

// Redraw one card only: typed, unsaved settings of the other cards stay
function drawCard(index) {
    const slot = document.getElementById(`plugin-slot-${index}`);
    const view = panel.views[index];
    if (!slot || !view) return;
    slot.innerHTML = cardOf(index);
    fillSettings(view);
}

function drawList() {
    const list = document.getElementById('plugins-list');
    const safe = panel.safeMode
        ? `<div class="glass-card system-card">${warningLine('Abgesicherter Modus aktiv: PLUGINS_SAFE_MODE=true lädt keinen Plugin-Code. Eingeschaltete Plugins lassen sich nur ausschalten.')}</div>`
        : '';
    const cards = panel.views.length === 0
        ? emptyState({ icon: 'puzzle', title: 'Keine Plugins gefunden', text: 'Offizielle Plugins liegen im Ordner plugins/, eigene in PLUGINS_DIR.' })
        : panel.views.map((view, index) => `<div id="plugin-slot-${index}">${cardOf(index)}</div>`).join('');
    list.innerHTML = safe + cards;
    // A read-only duplicate draws no fields, so filling by id only reaches the owner's
    panel.views.forEach((view, index) => { if (viewIndex(view.id) === index) fillSettings(view); });
}

async function getList(url) {
    try {
        const res = await fetch(url);
        const data = res.ok ? await res.json() : [];
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}

/**
 * Load the plugins (and the channels/roles their settings need) and draw the list.
 * A failure shows its message in the list and never breaks the System page.
 *
 * @returns {Promise<void>}
 */
export async function loadPluginsPanel() {
    const list = document.getElementById('plugins-list');
    try {
        const res = await fetch('/api/admin/plugins');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || LOAD_ERROR);
        panel.safeMode = data.safeMode === true;
        panel.uploadEnabled = data.uploadEnabled === true;
        toggleElement(document.getElementById('plugin-upload-open'), panel.uploadEnabled && !panel.safeMode);
        panel.views = Array.isArray(data.plugins) ? data.plugins : [];
        const types = new Set(panel.views.flatMap(view => (view.settings || []).map(setting => setting.type)));
        [panel.channels, panel.roles] = await Promise.all([
            types.has('channel') ? getList('/api/admin/channels') : [],
            types.has('role') ? getList('/api/admin/roles') : []
        ]);
        drawList();
    } catch (err) {
        list.innerHTML = `<p class="text-secondary">${escapeHtml(err.message || LOAD_ERROR)}</p>`;
    }
}

async function send(url, method, body) {
    const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': state.csrfToken },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const data = await res.json();
    return { ok: res.ok, data };
}

const pluginUrl = (id, part) => `/api/admin/plugins/${encodeURIComponent(id)}/${part}`;

/**
 * Switch a plugin and redraw its card from the answer.
 *
 * @param {string} id -> Plugin id.
 * @param {Object} body -> `{ enabled, trust?, password? }`.
 * @returns {Promise<boolean>} -> Whether the server took the switch.
 */
async function sendEnabled(id, body) {
    const index = viewIndex(id);
    const current = panel.views[index];
    try {
        const { ok, data } = await send(pluginUrl(id, 'enabled'), 'PUT', body);
        if (!ok) {
            showToast(data.error || 'Das Plugin konnte nicht umgeschaltet werden.', 'danger');
            drawCard(index);
            return false;
        }
        const plugin = { ...data.plugin, settingsValues: current.settingsValues };
        panel.views[index] = plugin;
        drawCard(index);
        if (plugin.status === 'error') showToast(`Plugin ${quoted(plugin.name)} konnte nicht gestartet werden: ${plugin.lastError}`, 'warning');
        else showToast(`Plugin ${quoted(plugin.name)} ${body.enabled ? 'eingeschaltet' : 'ausgeschaltet'}.`, 'success');
        return true;
    } catch {
        showToast('Das Plugin konnte nicht umgeschaltet werden.', 'danger');
        drawCard(index);
        return false;
    }
}

function trustDialog() {
    return bootstrap.Modal.getOrCreateInstance(document.getElementById('pluginTrustModal'));
}

function resetTrustInput() {
    document.getElementById('plugin-trust-check').checked = false;
    document.getElementById('plugin-trust-password').value = '';
    document.getElementById('plugin-trust-confirm').disabled = true;
}

function openTrustDialog(view) {
    panel.trustId = view.id;
    document.getElementById('plugin-trust-name').textContent = quoted(view.name);
    document.getElementById('plugin-trust-permissions').innerHTML = permissionItems(view.permissions);
    document.getElementById('plugin-trust-check-result').innerHTML = permissionCheckLines(view.permissionCheck).map(warningLine).join('');
    resetTrustInput();
    const modal = document.getElementById('pluginTrustModal');
    modal.addEventListener('hidden.bs.modal', () => {
        panel.trustId = null;
        resetTrustInput();
    }, { once: true });
    trustDialog().show();
}

async function togglePlugin(element) {
    const id = element?.dataset?.pluginId;
    const view = viewOf(id);
    if (!view) return;
    const enabled = element.checked === true;
    if (enabled && LOCKED_STATUSES.includes(view.status)) {
        element.checked = false;
        return;
    }
    if (enabled && !view.official) {
        // The switch moves only once the server took the confirmed request
        element.checked = false;
        openTrustDialog(view);
        return;
    }
    await sendEnabled(id, { enabled });
}

// The confirm button needs the ticked checkbox and a typed password
function pluginTrustInput() {
    const ticked = document.getElementById('plugin-trust-check').checked === true;
    const typed = String(document.getElementById('plugin-trust-password').value || '') !== '';
    document.getElementById('plugin-trust-confirm').disabled = !(ticked && typed);
}

async function confirmPluginTrust() {
    const id = panel.trustId;
    const passwordInput = document.getElementById('plugin-trust-password');
    const password = String(passwordInput.value || '');
    if (!id || document.getElementById('plugin-trust-check').checked !== true || password === '') return;
    passwordInput.value = '';
    pluginTrustInput();
    if (await sendEnabled(id, { enabled: true, trust: true, password })) trustDialog().hide();
}

/**
 * Changed settings of a plugin, typed like the manifest says.
 *
 * @param {Object} view -> Plugin view.
 * @returns {{ values: Object, secretTyped: boolean }} -> Only keys that differ from the stored value.
 */
function collectSettingChanges(view) {
    const values = {};
    let secretTyped = false;
    const stored = view.settingsValues || {};
    for (const setting of view.settings || []) {
        const element = document.getElementById(settingFieldId(view.id, setting.key));
        if (!element) continue;
        const before = stored[setting.key];
        if (setting.type === 'secret') {
            const typed = String(element.value || '');
            if (typed !== '') {
                values[setting.key] = typed;
                secretTyped = true;
            }
        } else if (setting.type === 'boolean') {
            const checked = element.checked === true;
            if (checked !== (before === true)) values[setting.key] = checked;
        } else if (setting.type === 'number') {
            const raw = String(element.value ?? '').trim();
            if (raw !== '' && Number(raw) !== before) values[setting.key] = Number(raw);
        } else {
            const text = String(element.value ?? '');
            if (text !== String(before ?? '')) values[setting.key] = text;
        }
    }
    return { values, secretTyped };
}

async function savePluginSettings(element) {
    const id = element?.dataset?.pluginId;
    const index = viewIndex(id);
    const view = panel.views[index];
    if (!view) return;
    const { values, secretTyped } = collectSettingChanges(view);
    if (Object.keys(values).length === 0) return showToast('Keine Änderungen zum Speichern.', 'info');
    const body = { values };
    if (secretTyped) {
        const passwordInput = document.getElementById(passwordFieldId(id));
        const password = String(passwordInput?.value || '');
        if (password === '') {
            passwordInput?.focus?.();
            return showToast('Gib das Admin-Reset-Passwort ein, um geheime Werte zu ändern.', 'warning');
        }
        body.password = password;
    }
    try {
        const { ok, data } = await send(pluginUrl(id, 'settings'), 'PUT', body);
        if (!ok) return showToast(data.error || 'Die Einstellungen konnten nicht gespeichert werden.', 'danger');
        panel.views[index] = { ...view, settingsValues: data.settings || {} };
        drawCard(index);
        showToast(`Einstellungen von ${quoted(view.name)} gespeichert.`, 'success');
    } catch {
        showToast('Die Einstellungen konnten nicht gespeichert werden.', 'danger');
    }
}

async function deletePluginData(element) {
    const id = element?.dataset?.pluginId;
    const view = viewOf(id);
    if (!view) return;
    const question = `Alle Daten von Plugin ${quoted(view.name)} löschen? Gespeicherte Einträge und Einstellungen gehen verloren.`;
    if (!await showConfirmDialog(question, 'Daten löschen')) return;
    try {
        const { ok, data } = await send(pluginUrl(id, 'data'), 'DELETE');
        if (!ok) return showToast(data.error || 'Die Plugin-Daten konnten nicht gelöscht werden.', 'danger');
        showToast(`Daten von Plugin ${quoted(view.name)} gelöscht.`, 'success');
        // An orphaned plugin is gone afterwards, the others lose their settings
        await loadPluginsPanel();
    } catch {
        showToast('Die Plugin-Daten konnten nicht gelöscht werden.', 'danger');
    }
}

registerActions({ togglePlugin, pluginTrustInput, confirmPluginTrust, savePluginSettings, deletePluginData });
