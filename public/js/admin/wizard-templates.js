/**
 * Event templates in the wizard (W-10): "Aus Vorlage starten" at the top of
 * step 1 for new events, "Als Vorlage speichern" in the footer with an inline
 * name field, and deleting a template after an inline confirmation.
 * Templates are shared by all admins (GET/POST/PUT/DELETE /api/admin/event-templates).
 */
import { state } from '../core/state.js';
import { registerActions } from '../core/actions.js';
import { escapeHtml, showToast, toggleElement } from '../core/ui.js';
import { collectEventDraft, fillWizard } from './wizard.js';

/** Mirror of TEMPLATE_FIELDS in utils/eventTemplates.js (a test keeps both equal). */
export const TEMPLATE_FIELDS = [
    'title', 'description', 'bannerUrl', 'accentColor', 'category', 'location',
    'maxParticipants', 'accessMode', 'requiredRoles', 'approvalMode', 'allowGuests',
    'slots', 'assignRoleId', 'formFields', 'reminderHours', 'checkinMessage',
    'autoCreateChannels', 'channelConfig', 'customBotMessages', 'announceChannelId'
];

const TEMPLATES_URL = '/api/admin/event-templates';

const byId = (id) => document.getElementById(id);
const quoted = (name) => `„${name}“`;
const sameName = (a, b) => String(a).toLocaleLowerCase('de') === String(b).toLocaleLowerCase('de');

let templates = [];
let editingEvent = false;
// Name of the template the wizard was filled from; prefills the save field
let appliedName = '';
// Template the next save click overwrites (set by the warning)
let overwriteId = null;

/**
 * Template settings of a wizard draft.
 *
 * @param {Object} draft -> collectEventDraft() result.
 * @returns {Object} -> Only TEMPLATE_FIELDS.
 */
export function pickTemplateDraft(draft) {
    return Object.fromEntries(TEMPLATE_FIELDS.map(field => [field, draft[field]]));
}

/** Load the shared templates; an error leaves the list empty (the chooser then stays hidden). */
export async function loadTemplates() {
    try {
        const res = await fetch(TEMPLATES_URL);
        const data = await res.json().catch(() => []);
        templates = res.ok && Array.isArray(data) ? data : [];
    } catch {
        templates = [];
    }
    return templates;
}

/**
 * Fill the chooser and show it for a new event with at least one template.
 *
 * @param {Object} options -> `{ editing }`: true while an existing event is open.
 */
export function renderTemplateChooser({ editing }) {
    editingEvent = editing;
    if (editing) appliedName = '';
    const select = byId('event-template-select');
    select.innerHTML = '<option value="">Vorlage wählen …</option>'
        + templates.map(template => `<option value="${escapeHtml(template.id)}">${escapeHtml(template.name)}</option>`).join('');
    select.value = '';
    byId('event-template-delete').disabled = true;
    toggleElement(byId('wizard-template-delete-confirm'), false);
    toggleElement(byId('wizard-template-area'), !editing && templates.length > 0);
    closeTemplateSave();
}

/** A new wizard: forget the last template, load the list and show the chooser. */
export async function startTemplateChoice() {
    appliedName = '';
    await loadTemplates();
    renderTemplateChooser({ editing: false });
}

const selectedTemplate = () => templates.find(template => template.id === byId('event-template-select').value) || null;

/**
 * Fill the wizard from the chosen template; dates and status stay.
 *
 * @param {HTMLSelectElement} select -> The chooser.
 */
export async function applyTemplate(select) {
    toggleElement(byId('wizard-template-delete-confirm'), false);
    const template = templates.find(item => item.id === select.value);
    byId('event-template-delete').disabled = !template;
    if (!template) return;
    await fillWizard(template.settings || {});
    appliedName = template.name;
    showToast(`Vorlage ${quoted(template.name)} übernommen.`, 'success');
}

/** Show the name field, prefilled with the applied template. */
export function openTemplateSave() {
    byId('event-template-name').value = appliedName;
    resetTemplateWarning();
    toggleElement(byId('wizard-template-save'), true);
    byId('event-template-name').focus();
}

export function closeTemplateSave() {
    resetTemplateWarning();
    toggleElement(byId('wizard-template-save'), false);
}

/** A changed name asks again before overwriting. */
export function resetTemplateWarning() {
    overwriteId = null;
    const warning = byId('wizard-template-warning');
    warning.textContent = '';
    toggleElement(warning, false);
}

/**
 * Send one template request.
 *
 * @returns {Promise<Object|null>} -> The answer, or null after an error (toast shown).
 */
async function sendTemplate(method, url, body, fallbackError) {
    try {
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': state.csrfToken },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) return data || {};
        showToast(data?.error || fallbackError, 'danger');
    } catch {
        showToast('Netzwerkfehler.', 'danger');
    }
    return null;
}

/** Save the wizard inputs as a template; an existing name needs a second click. */
export async function saveTemplate() {
    const name = byId('event-template-name').value.trim();
    if (!name) {
        showToast('Bitte einen Namen für die Vorlage eingeben.', 'warning');
        return;
    }
    const existing = templates.find(template => sameName(template.name, name));
    if (existing && overwriteId !== existing.id) {
        overwriteId = existing.id;
        const warning = byId('wizard-template-warning');
        warning.textContent = `Die Vorlage ${quoted(existing.name)} wird überschrieben.`;
        toggleElement(warning, true);
        return;
    }

    const body = { name, settings: pickTemplateDraft(collectEventDraft()) };
    const saved = existing
        ? await sendTemplate('PUT', `${TEMPLATES_URL}/${encodeURIComponent(existing.id)}`, body, 'Fehler beim Speichern der Vorlage.')
        : await sendTemplate('POST', TEMPLATES_URL, body, 'Fehler beim Speichern der Vorlage.');
    if (!saved) return;

    appliedName = name;
    showToast(`Vorlage ${quoted(name)} ${existing ? 'aktualisiert' : 'gespeichert'}.`, 'success');
    await loadTemplates();
    renderTemplateChooser({ editing: editingEvent });
}

/** Ask inline before deleting the chosen template. */
export function askDeleteTemplate() {
    const template = selectedTemplate();
    if (!template) return;
    byId('wizard-template-delete-text').textContent = `Vorlage ${quoted(template.name)} löschen?`;
    toggleElement(byId('wizard-template-delete-confirm'), true);
}

export function cancelDeleteTemplate() {
    toggleElement(byId('wizard-template-delete-confirm'), false);
}

/** Delete the chosen template; the wizard inputs stay as they are. */
export async function deleteTemplate() {
    const template = selectedTemplate();
    if (!template) return;
    const done = await sendTemplate('DELETE', `${TEMPLATES_URL}/${encodeURIComponent(template.id)}`, undefined, 'Fehler beim Löschen der Vorlage.');
    if (!done) return;
    templates = templates.filter(item => item.id !== template.id);
    if (sameName(appliedName, template.name)) appliedName = '';
    showToast(`Vorlage ${quoted(template.name)} gelöscht.`, 'success');
    renderTemplateChooser({ editing: editingEvent });
}

registerActions({
    applyTemplate: (el) => applyTemplate(el),
    askDeleteTemplate,
    cancelDeleteTemplate,
    deleteTemplate,
    openTemplateSave,
    closeTemplateSave,
    saveTemplate,
    resetTemplateWarning
});
