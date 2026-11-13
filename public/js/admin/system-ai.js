/**
 * Category "KI" of the admin page "System" (#system/ai): everything of the panel
 * except the managed connection keys, which system.js renders and saves with the
 * other groups (provider, base URL, key, models: password dialog).
 * Here: the connection test and the model list (they send the typed, unsaved
 * values), the behaviour settings (no password), the usage and the unsaved mark
 * of the behaviour block.
 */
import { registerActions } from '../core/actions.js';
import { state } from '../core/state.js';
import { escapeHtml, showToast } from '../core/ui.js';
import { addSystemCategory, markCategoryDirty } from './system-nav.js';

addSystemCategory({ id: 'ai', label: 'KI', subtitle: 'Anbieter, Assistenten', icon: 'bi-stars' }, 'security');

const SWITCHES = ['memberWeb', 'memberDiscord', 'teaserEnabled', 'adminAssistant'];
const TEXTS = ['assistantName', 'teaserText', 'extraInstructions'];
const NUMBERS = ['memberQuestionsPerHour', 'dailyQuestionLimit'];
const EXTRA_MAX = 1000;
const MARK_SOURCE = 'behaviour';
const LOAD_ERROR = 'KI-Einstellungen konnten nicht geladen werden.';

// providers: table of the server; settings: the stored behaviour values the form is compared with
const ai = { providers: [], settings: null };

const field = (key) => document.getElementById(`ai-${key}`);
const connectionField = (key) => document.getElementById(`system-${key}`);

/**
 * Options of the provider select: "Aus" first, then the providers; a stored id
 * that is not in the table (e.g. the mock provider) stays selectable.
 *
 * @param {string} [selected] -> Stored provider id.
 * @returns {string} -> HTML.
 */
export function providerOptions(selected = '') {
    const options = [{ id: '', label: 'Aus' }, ...ai.providers];
    if (selected && !options.some(option => option.id === selected)) options.push({ id: selected, label: selected });
    return options.map(option => `<option value="${escapeHtml(option.id)}"${option.id === selected ? ' selected' : ''}>${escapeHtml(option.label)}</option>`).join('');
}

/**
 * Placeholder of the base URL field: the default address of the provider.
 *
 * @param {string} provider -> Provider id.
 * @returns {string}
 */
export function baseUrlPlaceholder(provider) {
    return (ai.providers.find(entry => entry.id === provider) || {}).defaultBaseUrl || '';
}

function resetTestResult() {
    const result = document.getElementById('ai-test-result');
    if (result) result.innerHTML = '';
}

/**
 * A connection field changed: a new provider shows its default address and drops the old test result.
 *
 * @param {Element} element -> The changed field.
 * @returns {void}
 */
export function aiFieldChanged(element) {
    if (!element || !String(element.id || '').startsWith('system-AI_')) return;
    resetTestResult();
    if (element.id !== 'system-AI_PROVIDER') return;
    const base = connectionField('AI_BASE_URL');
    if (base) base.placeholder = baseUrlPlaceholder(element.value);
}

function formValues() {
    const values = {};
    SWITCHES.forEach(key => { values[key] = field(key).checked; });
    TEXTS.forEach(key => { values[key] = field(key).value; });
    NUMBERS.forEach(key => {
        const raw = String(field(key).value).trim();
        values[key] = raw === '' ? null : Number(raw);
    });
    return values;
}

function updateCounter() {
    document.getElementById('ai-extraInstructions-count').textContent = `${field('extraInstructions').value.length} / ${EXTRA_MAX}`;
}

function fillForm(settings) {
    SWITCHES.forEach(key => { field(key).checked = settings[key] === true; });
    TEXTS.forEach(key => { field(key).value = settings[key] ?? ''; });
    NUMBERS.forEach(key => { field(key).value = String(settings[key] ?? ''); });
    updateCounter();
}

function behaviourDirty() {
    if (!ai.settings) return false;
    const typed = formValues();
    return Object.keys(typed).some(key => typed[key] !== ai.settings[key]);
}

function aiSettingChanged() {
    updateCounter();
    markCategoryDirty('ai', behaviourDirty(), MARK_SOURCE);
}

/**
 * Drop typed, unsaved behaviour input (the page was left).
 *
 * @returns {void}
 */
export function resetAiBehaviour() {
    if (ai.settings) fillForm(ai.settings);
}

const formatNumber = (value) => Number(value || 0).toLocaleString('de-DE');

function usageRow(label, row) {
    return `<tr><th scope="row">${escapeHtml(label)}</th><td>${formatNumber(row.memberQuestions)}</td><td>${formatNumber(row.adminRequests)}</td><td>${formatNumber(row.inputTokens)}</td><td>${formatNumber(row.outputTokens)}</td></tr>`;
}

function renderUsage(usage) {
    const sum = (key) => (usage.days || []).reduce((total, day) => total + (Number(day[key]) || 0), 0);
    const total = { memberQuestions: sum('memberQuestions'), adminRequests: sum('adminRequests'), inputTokens: sum('inputTokens'), outputTokens: sum('outputTokens') };
    document.getElementById('ai-usage-body').innerHTML = usageRow('Heute', usage.today || {}) + usageRow('Letzte 30 Tage', total);
}

async function getJson(url) {
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Laden fehlgeschlagen');
    return data;
}

/**
 * Load the provider table, the behaviour settings and the usage of the panel.
 * A failure leaves the panel as it is (the provider select then only offers
 * "Aus") and never breaks the System page.
 *
 * @returns {Promise<void>}
 */
export async function loadAiPanel() {
    const note = document.getElementById('ai-load-note');
    const saveButton = document.getElementById('ai-save-settings');
    try {
        const data = await getJson('/api/admin/ai/settings');
        ai.providers = data.providers || [];
        ai.settings = data.settings;
        fillForm(ai.settings);
        markCategoryDirty('ai', false, MARK_SOURCE);
        note.textContent = '';
        saveButton.disabled = false;
        renderUsage(await getJson('/api/admin/ai/usage'));
    } catch {
        note.textContent = LOAD_ERROR;
        saveButton.disabled = !ai.settings;
    }
}

// The typed, unsaved connection values (an empty key keeps the stored one on the server)
function connectionValues() {
    const read = (key) => String(connectionField(key)?.value || '').trim();
    return { provider: read('AI_PROVIDER'), baseUrl: read('AI_BASE_URL'), apiKey: read('AI_API_KEY'), model: read('AI_MODEL') };
}

async function postJson(url, body) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': state.csrfToken },
        body: JSON.stringify(body)
    });
    return { ok: res.ok, data: await res.json() };
}

async function testAiConnection() {
    const result = document.getElementById('ai-test-result');
    const button = document.getElementById('ai-test-button');
    button.disabled = true;
    result.innerHTML = '<span class="chip chip-sm">Teste …</span>';
    try {
        const { data } = await postJson('/api/admin/ai/test', connectionValues());
        result.innerHTML = data.ok
            ? `<span class="chip chip-sm chip-success">Verbunden · ${escapeHtml(String(data.ms))} ms</span>`
            : `<span class="chip chip-sm chip-danger">${escapeHtml(data.error || 'Verbindung fehlgeschlagen.')}</span>`;
    } catch {
        result.innerHTML = '<span class="chip chip-sm chip-danger">Verbindung fehlgeschlagen.</span>';
    } finally {
        button.disabled = false;
    }
}

async function loadAiModels() {
    const button = document.getElementById('ai-models-button');
    button.disabled = true;
    try {
        const { ok, data } = await postJson('/api/admin/ai/models', connectionValues());
        if (!ok) return showToast(data.error || 'Modelle konnten nicht geladen werden.', 'danger');
        const models = Array.isArray(data.models) ? data.models : [];
        document.getElementById('system-ai-models').innerHTML = models.map(name => `<option value="${escapeHtml(name)}"></option>`).join('');
        showToast(models.length ? `${models.length} Modelle geladen.` : 'Der Anbieter nennt keine Modelle.', models.length ? 'success' : 'info');
    } catch {
        showToast('Modelle konnten nicht geladen werden.', 'danger');
    } finally {
        button.disabled = false;
    }
}

async function saveAiSettings() {
    // Without the stored values the form is blank: saving it would overwrite them
    if (!ai.settings) return showToast(LOAD_ERROR, 'danger');
    try {
        const res = await fetch('/api/admin/ai/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': state.csrfToken },
            body: JSON.stringify(formValues())
        });
        const data = await res.json();
        if (!res.ok) return showToast(data.error || 'Speichern fehlgeschlagen.', 'danger');
        ai.settings = data.settings;
        fillForm(ai.settings);
        markCategoryDirty('ai', false, MARK_SOURCE);
        showToast('KI-Einstellungen gespeichert.', 'success');
    } catch {
        showToast('Speichern fehlgeschlagen.', 'danger');
    }
}

registerActions({ aiSettingChanged, testAiConnection, loadAiModels, saveAiSettings });
