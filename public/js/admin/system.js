/**
 * Admin page "System" (#system/<category>, #138): the database-backed configuration
 * (Discord, Server, Sicherheit, KI), one category at a time (list: system-nav.js). A value from .env is read-only; secrets show
 * only whether they are set. Saving asks for the admin reset password.
 * First card "Version": the update status (GET /api/admin/system/update-status).
 * Below: the editor of the privacy policy (no reset password, every change
 * is a new version everybody accepts again).
 */
import { registerActions } from '../core/actions.js';
import { onRouteLeave, setLeaveGuard } from '../core/router.js';
import { state } from '../core/state.js';
import { escapeHtml, renderMarkdownSafe, showConfirmDialog, showToast } from '../core/ui.js';
import { mountDiscordGuide, resetDiscordGuide } from '../pages/discord-guide.js';
import { aiFieldChanged, baseUrlPlaceholder, loadAiPanel, providerOptions, resetAiBehaviour } from './system-ai.js';
import { categoryOf, clearDirtyCategories, dirtyCategories, markCategoryDirty, showSystemCategory } from './system-nav.js';

// Label and hint of each key, in the order of the page
const SYSTEM_FIELDS = {
    DISCORD_CLIENT_ID: ['Client ID', 'Developer Portal > „OAuth2“.'],
    DISCORD_CLIENT_SECRET: ['Client Secret', 'Developer Portal > „OAuth2“ > „Reset Secret“.'],
    DISCORD_BOT_TOKEN: ['Bot-Token', 'Developer Portal > „Bot“ > „Reset Token“. Der Bot meldet sich mit dem neuen Token sofort neu an.'],
    DISCORD_GUILD_ID: ['Server-ID', 'Rechtsklick auf den Server > „Server-ID kopieren“. Der Bot meldet sich danach neu an.'],
    DISCORD_ADMIN_ROLE_ID: ['Admin-Rolle (ID)', 'Mitglieder mit dieser Rolle sind Admins. Wer auf dem Server „Administrator“ ist, bleibt immer Admin.'],
    DISCORD_ANNOUNCE_CHANNEL_ID: ['Ankündigungskanal (ID)', 'Gilt, solange in der Bot-Zentrale kein Ankündigungskanal gewählt ist.'],
    DISCORD_EVENT_CATEGORY_ID: ['Kategorie für Event-Kanäle (ID)', 'Hier legt der Bot private Event-Kanäle an.'],
    DISCORD_THREAD_SYNC: ['Kommentare mit Discord-Threads spiegeln', 'Braucht den „Message Content Intent“ im Developer Portal.'],
    SERVER_NAME: ['Anzeigename', 'Leer lassen = Name des Discord-Servers.'],
    BASE_URL: ['Adresse (BASE_URL)', 'Mit https://. Die Redirect-URL im Developer Portal muss <Adresse>/auth/discord/callback sein.'],
    TIMEZONE: ['Zeitzone', 'IANA-Zeitzone, z. B. Europe/Berlin. Leer = Europe/Berlin.'],
    ADMIN_RESET_PASSWORD: ['Neues Admin-Reset-Passwort', 'Mindestens 12 Zeichen. Leer lassen = das bisherige behalten.'],
    AI_PROVIDER: ['Anbieter', '„Aus“ schaltet alle KI-Funktionen ab.'],
    AI_BASE_URL: ['Adresse', 'Nur für Ollama oder eigene Endpunkte nötig.'],
    AI_API_KEY: ['API-Schlüssel', 'Leer lassen = den bisherigen behalten.'],
    AI_MODEL: ['Modell', 'Das Modell für Fragen von Mitgliedern. „Modelle laden“ zeigt die Auswahl des Anbieters.'],
    AI_MODEL_ADMIN: ['Modell für Admins', 'Optional: stärkeres Modell für das Erstellen von Events. Leer = wie oben.']
};

const SOURCE_CHIPS = {
    env: '<span class="chip chip-sm chip-info">aus .env</span>',
    db: '',
    none: ''
};

// Groups of settings that are saved together; each is a category of the page
const GROUPS = ['discord', 'server', 'security', 'ai'];

// open: the page is shown and holds the loaded values (a category switch must not reload them)
const page = { settings: [], pending: null, pendingGroup: null, category: 'overview', open: false, privacyText: '' };

const fieldId = (key) => `system-${key}`;

const valueOf = (key) => (page.settings.find(entry => entry.key === key) || {}).value || '';

function fieldHtml(entry) {
    const [label, hint] = SYSTEM_FIELDS[entry.key] || [entry.key, ''];
    const id = fieldId(entry.key);
    const chip = SOURCE_CHIPS[entry.source] || '';
    const applies = entry.applies === 'restart' ? ' Wirkt erst nach einem Neustart von DEMS.' : '';
    const hintHtml = `<div class="setup-hint">${escapeHtml(hint + applies)}</div>`;

    if (entry.key === 'DISCORD_THREAD_SYNC') {
        return `<div class="form-check setup-field">
            <input class="form-check-input" type="checkbox" id="${id}" data-change="systemFieldChanged" data-group="${entry.group}"${entry.value === 'true' ? ' checked' : ''}${entry.locked ? ' disabled' : ''}>
            <label class="form-check-label" for="${id}">${escapeHtml(label)} ${chip}</label>
            ${hintHtml}
        </div>`;
    }
    if (entry.key === 'AI_PROVIDER') {
        return `<div class="setup-field">
            <label class="form-label" for="${id}">${escapeHtml(label)} ${chip}</label>
            <select class="form-select" id="${id}" data-change="systemFieldChanged" data-group="${entry.group}"${entry.locked ? ' disabled' : ''}>${providerOptions(entry.value || '')}</select>
            ${hintHtml}
        </div>`;
    }
    if (entry.secret) {
        const setChip = entry.isSet ? '<span class="chip chip-sm chip-success">gesetzt</span>' : '<span class="chip chip-sm">nicht gesetzt</span>';
        const placeholder = entry.locked ? 'gesetzt (aus .env)' : (entry.isSet ? 'gesetzt – leer lassen zum Behalten' : 'nicht gesetzt');
        return `<div class="setup-field">
            <label class="form-label" for="${id}">${escapeHtml(label)} ${chip || setChip}</label>
            <input class="form-control" id="${id}" type="password" value="" placeholder="${escapeHtml(placeholder)}" autocomplete="new-password" data-input="systemFieldChanged" data-group="${entry.group}"${entry.locked ? ' readonly' : ''}>
            ${hintHtml}
        </div>`;
    }
    // Base URL: the default of the provider as placeholder; models: suggestions of "Modelle laden"
    const extra = entry.key === 'AI_BASE_URL'
        ? ` placeholder="${escapeHtml(baseUrlPlaceholder(valueOf('AI_PROVIDER')))}"`
        : (entry.key === 'AI_MODEL' || entry.key === 'AI_MODEL_ADMIN' ? ' list="system-ai-models"' : '');
    return `<div class="setup-field">
        <label class="form-label" for="${id}">${escapeHtml(label)} ${chip}</label>
        <input class="form-control" id="${id}" type="text"${extra} value="${escapeHtml(entry.value || '')}" autocomplete="off" spellcheck="false" data-input="systemFieldChanged" data-group="${entry.group}"${entry.locked ? ' readonly' : ''}>
        ${hintHtml}
    </div>`;
}

// Draw the fields of the given groups from page.settings; the other groups keep what was typed
function render(groups = GROUPS) {
    const order = Object.keys(SYSTEM_FIELDS);
    const sorted = [...page.settings].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)).filter(entry => groups.includes(entry.group));
    for (const group of groups) {
        const entries = sorted.filter(entry => entry.group === group);
        document.getElementById(`system-${group}-fields`).innerHTML = entries.map(fieldHtml).join('');
        // Nothing to save where .env sets every value
        const button = document.getElementById(`system-save-${group}`);
        if (button) button.disabled = entries.every(entry => entry.locked);
        markCategoryDirty(group, false);
    }
    // The loaded values as properties too: collectChanges() compares against them
    for (const entry of sorted) {
        const element = document.getElementById(fieldId(entry.key));
        if (!element) continue;
        if (entry.key === 'DISCORD_THREAD_SYNC') element.checked = entry.value === 'true';
        else if (element.tagName === 'SELECT') element.value = entry.value || '';
        else element.value = entry.secret ? '' : (entry.value || '');
    }
}

/**
 * Show the page with one category and load the settings.
 *
 * @param {string} [param] -> Category from the hash (`#system/<category>`); unknown or missing = overview.
 * @returns {Promise<void>}
 */
export async function showSystemSection(param) {
    document.getElementById('system-section').style.display = 'block';
    const category = categoryOf(param);
    // Only a click in the list moves the focus, not opening the page
    showSystemCategory(category, { focus: page.open && category !== page.category });
    page.category = category;
    // The router uses a guard up when it lets a navigation through
    setLeaveGuard(mayLeaveSystem);
    onRouteLeave(leftSystem);
    // A category switch keeps the loaded values and whatever was typed
    if (page.open) return;
    page.open = true;
    clearDirtyCategories();
    // The provider list comes first: the connection fields of the group "ai" need it
    await loadAiPanel();
    // A failed load is tried again with the next category
    if (!(await loadSettings())) page.open = false;
    await Promise.all([loadUpdateStatus(), loadPrivacyEditor()]);
}

const DATABASE_NAMES = { postgresql: 'PostgreSQL', sqlite: 'SQLite (eingebaut)' };

// Rows of the overview from the status of the settings answer; none without one
function statusRows(status) {
    if (!status) return [];
    const bot = status.bot || {};
    return [
        bot.online
            ? { label: 'Bot', text: bot.guildName ? `online · ${bot.guildName}` : 'online', tone: 'success' }
            : { label: 'Bot', text: 'offline', tone: 'danger' },
        { label: 'Datenbank', text: DATABASE_NAMES[status.database] || String(status.database || 'unbekannt'), tone: '' },
        status.ai?.on
            ? { label: 'KI', text: status.ai.provider || 'an', tone: 'success' }
            : { label: 'KI', text: 'aus', tone: '' }
    ];
}

/**
 * Draw the status list of the overview.
 *
 * @param {Array<Object>} rows -> `{ label, text, tone }` per fact; tone is a chip tone (success, danger, info, warning) or ''.
 * @returns {void}
 */
export function renderStatusRows(rows) {
    document.getElementById('system-status-list').innerHTML = rows.map(row => `<div class="system-status-row">
        <span>${escapeHtml(row.label)}</span>
        <span class="chip chip-sm${row.tone ? ` chip-${escapeHtml(row.tone)}` : ''}">${escapeHtml(row.text)}</span>
    </div>`).join('');
}

// Load the settings and draw the given groups (all when the page opens)
async function loadSettings(groups = GROUPS) {
    try {
        const res = await fetch('/api/admin/system/settings');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Laden fehlgeschlagen');
        page.settings = data.settings || [];
        render(groups);
        renderStatusRows(statusRows(data.status));
        return true;
    } catch (err) {
        showToast(err.message || 'Systemeinstellungen konnten nicht geladen werden.', 'danger');
        return false;
    }
}

// Leave guard of the router: a category switch and a page without unsaved input answer at once
// (the browser history stays untouched), unsaved input asks first
function mayLeaveSystem(next) {
    if (next.route === 'system' || dirtyCategories().length === 0) return true;
    return showConfirmDialog('Ungespeicherte Änderungen verwerfen?', 'Verwerfen');
}

// Another route is shown: the next visit loads again, and nothing typed or pending survives
function leftSystem() {
    page.open = false;
    page.pending = null;
    page.pendingGroup = null;
    passwordDialog().hide();
    // Discarded input must not sit in the fields if the next load fails
    render();
    resetAiBehaviour();
    document.getElementById('system-privacy-text').value = page.privacyText;
    clearDirtyCategories();
}

const UPDATE_COMMAND = 'docker compose pull && docker compose up -d';

function releaseLink(url) {
    if (!url) return '';
    return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Was ist neu?<i class="bi bi-box-arrow-up-right ms-1" aria-hidden="true"></i></a>`;
}

const commandLine = () => `<p class="setup-hint">Aktualisieren: <code>${escapeHtml(UPDATE_COMMAND)}</code></p>`;

/**
 * Body of the "Version" card for a status of GET /api/admin/system/update-status.
 *
 * @param {Object} status -> UpdateStatus of utils/updateCheck.js.
 * @returns {string} -> HTML.
 */
function updateStatusHtml(status) {
    const current = escapeHtml(status.current || '');
    const latest = escapeHtml(status.latest || '');
    if (status.switchToLatest) {
        return `<p><span class="chip chip-sm chip-info">Update verfügbar</span></p>
            <p>Version <strong>${latest}</strong> ist das fertige Release. Diese Installation nutzt eine Vorabversion (${current}) aus dem Kanal „beta“.</p>
            <p class="setup-hint">Stelle das Image von beta auf latest um: <code>DEMS_TAG=latest</code> in der .env oder, wenn deine compose-Datei den Tag fest nennt, <code>image: moritakahashi/dems:latest</code>. Führe dann <code>${escapeHtml(UPDATE_COMMAND)}</code> aus.</p>
            ${releaseLink(status.releaseUrl)}`;
    }
    if (status.updateAvailable) {
        return `<p><span class="chip chip-sm chip-info">Update verfügbar</span></p>
            <p>Neue Version <strong>${latest}</strong> verfügbar (installiert: ${current}).</p>
            ${commandLine()}
            ${releaseLink(status.releaseUrl)}`;
    }
    const neutral = {
        disabled: `DEMS ${current}. Die Update-Prüfung ist ausgeschaltet (UPDATE_CHECK=false).`,
        edge: `Entwicklungsstand (edge, Commit ${escapeHtml(status.commit || '?')}). Keine Update-Prüfung.`,
        mock: `DEMS ${current} im Dev-Mock-Modus. Keine Update-Prüfung.`,
        'invalid-repo': `DEMS ${current}. UPDATE_CHECK_REPO ist ungültig, die Update-Prüfung ist aus.`
    };
    if (neutral[status.reason]) return `<p class="text-secondary mb-0">${neutral[status.reason]}</p>`;
    if (!status.checkedAt) return `<p class="text-secondary mb-0">DEMS ${current}. Noch keine Antwort von GitHub.</p>`;
    const checked = new Date(status.checkedAt).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
    return `<p class="mb-0">DEMS ${current} ist aktuell. Zuletzt geprüft: ${escapeHtml(checked)}.</p>`;
}

async function loadUpdateStatus() {
    const body = document.getElementById('system-update-body');
    try {
        const res = await fetch('/api/admin/system/update-status');
        if (!res.ok) throw new Error('Laden fehlgeschlagen');
        body.innerHTML = updateStatusHtml(await res.json());
    } catch {
        body.innerHTML = '<p class="text-secondary mb-0">Versionsinfo konnte nicht geladen werden.</p>';
    }
}

async function loadPrivacyEditor() {
    let policy = null;
    try {
        const res = await fetch('/api/privacy');
        if (res.ok) policy = await res.json();
    } catch {
        policy = null;
    }
    page.privacyText = policy ? policy.markdown : '';
    document.getElementById('system-privacy-text').value = page.privacyText;
    document.getElementById('system-privacy-version').textContent = policy
        ? `Aktuell: Fassung ${policy.version} vom ${new Date(policy.updatedAt).toLocaleDateString('de-DE')}.`
        : 'Noch keine Datenschutzerklärung veröffentlicht.';
    previewSystemPrivacy();
}

function previewSystemPrivacy() {
    const typed = String(document.getElementById('system-privacy-text').value || '');
    markCategoryDirty('privacy', typed !== page.privacyText);
    const text = typed.trim();
    document.getElementById('system-privacy-preview').innerHTML = text
        ? renderMarkdownSafe(text)
        : '<p class="text-secondary">Ohne Text gibt es keine Datenschutzseite, und niemand muss etwas akzeptieren.</p>';
}

async function saveSystemPrivacy() {
    const markdown = String(document.getElementById('system-privacy-text').value || '');
    try {
        const res = await fetch('/api/admin/privacy', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': state.csrfToken },
            body: JSON.stringify({ markdown })
        });
        const data = await res.json();
        if (!res.ok) return showToast(data.error || 'Speichern fehlgeschlagen.', 'danger');
        if (!data.changed) return showToast('Keine Änderung an der Datenschutzerklärung.', 'info');
        showToast(data.version > 0
            ? `Datenschutzerklärung gespeichert (Fassung ${data.version}). Alle Mitglieder stimmen beim nächsten Besuch neu zu.`
            : 'Datenschutzerklärung entfernt. Niemand muss mehr etwas akzeptieren.', 'success');
        await loadPrivacyEditor();
    } catch {
        showToast('Speichern fehlgeschlagen.', 'danger');
    }
}

// Changed, unlocked values of one group (all groups without one); a secret only when something was typed in
function collectChanges(group) {
    const changes = {};
    for (const entry of page.settings) {
        if (entry.locked || (group && entry.group !== group)) continue;
        const element = document.getElementById(fieldId(entry.key));
        if (!element) continue;
        if (entry.key === 'DISCORD_THREAD_SYNC') {
            const value = element.checked ? 'true' : '';
            if (value !== (entry.value || '')) changes[entry.key] = value;
            continue;
        }
        const value = String(element.value || '').trim();
        if (entry.secret ? value !== '' : value !== (entry.value || '')) changes[entry.key] = value;
    }
    return changes;
}

function passwordDialog() {
    return bootstrap.Modal.getOrCreateInstance(document.getElementById('systemPasswordModal'));
}

// A field changed: the mark of its category follows what collectChanges() would send
function systemFieldChanged(element) {
    const group = element?.dataset?.group;
    if (!GROUPS.includes(group)) return;
    aiFieldChanged(element);
    markCategoryDirty(group, Object.keys(collectChanges(group)).length > 0);
}

// The save button of a category carries its group; without one every group is saved
function saveSystemSettings(element) {
    const group = GROUPS.includes(element?.dataset?.group) ? element.dataset.group : null;
    const changes = collectChanges(group);
    if (Object.keys(changes).length === 0) return showToast('Keine Änderungen zum Speichern.', 'info');
    page.pending = changes;
    page.pendingGroup = group;
    document.getElementById('system-reset-password').value = '';
    passwordDialog().show();
}

async function confirmSystemSave() {
    // The page was left while the dialog was open
    if (!page.pending) return;
    const passwordInput = document.getElementById('system-reset-password');
    const password = passwordInput.value;
    passwordInput.value = '';
    try {
        const res = await fetch('/api/admin/system/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': state.csrfToken },
            body: JSON.stringify({ password, values: page.pending || {} })
        });
        const data = await res.json();
        if (!res.ok) return showToast(data.error || 'Speichern fehlgeschlagen.', 'danger');
        passwordDialog().hide();
        page.pending = null;
        const botNote = data.bot && data.bot.ok ? ' Der Bot ist neu angemeldet.' : '';
        showToast(`Systemeinstellungen gespeichert.${botNote}`, 'success');
        if (data.restartRequired) showToast('Der Kommentar-Sync ändert sich erst nach einem Neustart von DEMS.', 'warning');
        // Only the saved fields are drawn again: input of the other categories stays
        await loadSettings(page.pendingGroup ? [page.pendingGroup] : GROUPS);
    } catch {
        showToast('Speichern fehlgeschlagen.', 'danger');
    }
}

async function showDiscordGuideDialog() {
    const baseUrl = (page.settings.find(entry => entry.key === 'BASE_URL') || {}).value || window.location.origin || '';
    let inviteUrl = '';
    try {
        const res = await fetch('/api/admin/system/invite-url');
        if (res.ok) inviteUrl = (await res.json()).url || '';
    } catch {
        inviteUrl = '';
    }
    resetDiscordGuide();
    mountDiscordGuide('system-guide', { baseUrl, inviteUrl });
    bootstrap.Modal.getOrCreateInstance(document.getElementById('discordGuideModal')).show();
}

registerActions({
    systemFieldChanged,
    saveSystemSettings,
    confirmSystemSave,
    showDiscordGuideDialog,
    previewSystemPrivacy,
    saveSystemPrivacy
});
