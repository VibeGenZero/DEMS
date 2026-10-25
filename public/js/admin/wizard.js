/**
 * Event wizard: steps with their checks, create/edit/save, roles.
 * Location field: wizard-location.js; rules: wizard-checks.js; marks: wizard-marks.js;
 * switch "Teilnehmer benachrichtigen": wizard-notify.js; banner upload: wizard-banner.js;
 * series dates (scope choice, locked repeat fields, toast): wizard-series.js.
 */
import { state } from '../core/state.js';
import { glideTabs } from '../core/tab-glider.js';
import { loadAdminEvents, loadAdminStats } from './dashboard.js';
import { addFormField, getFormFieldsFromBuilder, getSlotsFromEditor, renderSlotEditor } from './wizard-builders.js';
import { checkWizardStep } from './wizard-checks.js';
import { clearAllMarks, showStepErrors } from './wizard-marks.js';
import { notifyRequested, rememberLoadedEvent, updateNotifySwitch } from './wizard-notify.js';
import { rememberSeries, savedEventToast, seriesScope, storedRecurringUntil, updateSeriesScope } from './wizard-series.js';
import { cancelWizardPreview, renderWizardPreview } from './wizard-preview.js';
import { updateBannerPreview } from './wizard-banner.js';
import { renderTemplateChooser, startTemplateChoice } from './wizard-templates.js';
import { navigateTo } from '../core/router.js';
import { registerActions } from '../core/actions.js';
import { applyStyleData, escapeHtml, hexColor, showElement, showToast, toggleElement } from '../core/ui.js';
import { showPollDetail } from '../polls/polls.js';

export let currentWizardStep = 1;

export const WIZARD_TOTAL_STEPS = 5;

// Preview area and the two switch buttons; leaving the preview drops a pending answer
function showPreviewArea(visible) {
    if (!visible) cancelWizardPreview();
    toggleElement(document.getElementById('wizard-preview'), visible);
    for (const mode of ['edit', 'preview']) {
        const button = document.getElementById(`wizard-mode-${mode}`);
        const active = (mode === 'preview') === visible;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', String(active));
    }
    glideTabs(document.getElementById('wizard-mode'));
}

/**
 * Switch between editing the current step and the preview of the whole input.
 *
 * @param {string} mode -> "edit" or "preview".
 * @returns {Promise<void>} -> Resolves when the preview is drawn (at once for "edit").
 */
export function setWizardMode(mode) {
    const preview = mode === 'preview';
    showPreviewArea(preview);
    toggleElement(document.getElementById(`wizard-page-${currentWizardStep}`), !preview);
    if (!preview) return Promise.resolve();
    return renderWizardPreview(collectEventDraft(), document.getElementById('event-edit-id').value);
}

export function wizardGoTo(step) {
    showPreviewArea(false);
    // Hide current page & deactivate indicator
    document.getElementById(`wizard-page-${currentWizardStep}`).style.display = 'none';

    currentWizardStep = step;

    // Show new page
    const page = document.getElementById(`wizard-page-${step}`);
    showElement(page);

    // Update step indicators
    for (let i = 1; i <= WIZARD_TOTAL_STEPS; i++) {
        const el = document.getElementById(`wstep-${i}`);
        el.classList.remove('active', 'completed');
        if (i === step) el.classList.add('active');
        else if (i < step) el.classList.add('completed');
    }

    // Navigation buttons
    toggleElement(document.getElementById('wizard-btn-back'), step > 1);
    toggleElement(document.getElementById('wizard-btn-next'), step < WIZARD_TOTAL_STEPS);
    toggleElement(document.getElementById('wizard-btn-save'), step === WIZARD_TOTAL_STEPS);
    updateNotifySwitch(step === WIZARD_TOTAL_STEPS ? collectEventDraft() : null);
    updateSeriesScope(step === WIZARD_TOTAL_STEPS);
    document.getElementById('wizard-step-counter').textContent = `Schritt ${step} von ${WIZARD_TOTAL_STEPS}`;

    // Refresh EasyMDE when returning to step 1
    if (step === 1 && state.descriptionEditor) {
        setTimeout(() => state.descriptionEditor.codemirror.refresh(), 50);
    }

    // Init Flatpickr on step 2 (needs visible DOM)
    if (step === 2) {
        if (!state.startDatePicker) {
            state.startDatePicker = flatpickr('#event-start-date', {
                enableTime: true, dateFormat: 'Y-m-d H:i', time_24hr: true, locale: 'de'
            });
        }
        if (!state.endDatePicker) {
            state.endDatePicker = flatpickr('#event-end-date', {
                enableTime: true, dateFormat: 'Y-m-d H:i', time_24hr: true, locale: 'de'
            });
        }
        DEADLINE_PICKERS.forEach(({ key, selector }) => ensureDeadlinePicker(key, selector));
    }
}

// Optional deadlines of step 2 (W-03): state key of the picker and its input
const DEADLINE_PICKERS = [
    { key: 'registrationDeadlinePicker', field: 'registrationDeadline', selector: '#event-registration-deadline' },
    { key: 'unregisterDeadlinePicker', field: 'unregisterDeadline', selector: '#event-unregister-deadline' }
];

/**
 * Create a deadline picker once.
 *
 * @param {string} key -> State key of the picker.
 * @param {string} selector -> Its input.
 * @returns {Object} -> The flatpickr instance.
 */
function ensureDeadlinePicker(key, selector) {
    if (!state[key]) {
        state[key] = flatpickr(selector, { enableTime: true, dateFormat: 'Y-m-d H:i', time_24hr: true, locale: 'de' });
    }
    return state[key];
}

/**
 * ISO value of a deadline picker.
 *
 * @param {string} key -> State key of the picker.
 * @returns {string} -> ISO date, '' when empty or not created yet.
 */
function deadlineValue(key) {
    const picker = state[key];
    return picker && picker.selectedDates[0] ? picker.selectedDates[0].toISOString() : '';
}

export function wizardNext() {
    const errors = checkWizardStep(currentWizardStep, collectEventDraft());
    const first = showStepErrors(currentWizardStep, errors);
    if (errors.length > 0) {
        // The marks need the step in view; from the preview it goes back to editing
        setWizardMode('edit');
        first?.focus();
        return;
    }
    if (currentWizardStep < WIZARD_TOTAL_STEPS) {
        wizardGoTo(currentWizardStep + 1);
    }
}

export function wizardBack() {
    if (currentWizardStep > 1) {
        wizardGoTo(currentWizardStep - 1);
    }
}

/**
 * Show the star at the start date while the status is "Aktiv": drafts may wait for a date.
 *
 * @returns {void}
 */
export function updateStartRequired() {
    toggleElement(document.getElementById('event-start-required'), document.getElementById('event-status').value === 'active');
}

// Mirrors normalizeReminderHours in utils/reminders.js: stored list, legacy number or the form text "24, 1"
export function reminderHoursOf(value) {
    const raw = Array.isArray(value) ? value.map(reminder => reminder?.hours) : String(value ?? '').split(/[\s,;]+/);
    return [...new Set(raw.map(hours => Number.parseFloat(hours)).filter(hours => Number.isFinite(hours) && hours > 0))];
}

export async function showCreateEventModal() {
    state.pendingPollDecision = null;
    rememberLoadedEvent(null);
    await rememberSeries(null);
    document.getElementById('eventModalTitle').textContent = 'Neues Event erstellen';
    document.getElementById('event-edit-id').value = '';
    document.getElementById('event-title').value = '';
    document.getElementById('event-description').value = '';
    document.getElementById('event-banner-url').value = '';
    document.getElementById('event-start-date').value = '';
    document.getElementById('event-end-date').value = '';
    document.getElementById('event-max').value = '0';
    document.getElementById('event-category').value = '';
    document.getElementById('event-access').value = 'open';
    document.getElementById('event-approval').value = 'manual';
    document.getElementById('event-status').value = 'active';
    document.getElementById('event-reminder').value = '';
    document.getElementById('event-assign-role').value = '';
    document.getElementById('event-auto-create-channels').checked = false;
    document.getElementById('channel-config-options').style.display = 'none';
    document.getElementById('event-channel-type').value = 'voice';
    document.getElementById('event-voice-name').value = '';
    document.getElementById('event-text-name').value = '';
    document.getElementById('event-allow-guests').checked = true;
    renderSlotEditor([]);
    document.getElementById('form-fields-builder').innerHTML = '';
    document.getElementById('role-requirement-area').style.display = 'none';

    // Reset Custom Messages
    document.getElementById('event-custom-msg-toggle').checked = false;
    document.getElementById('custom-msg-options').style.display = 'none';
    document.getElementById('event-msg-registration').value = '';
    document.getElementById('event-msg-accepted').value = '';
    document.getElementById('event-msg-rejected').value = '';

    ensureDescriptionEditor();
    state.descriptionEditor.value('');

    if (state.startDatePicker) state.startDatePicker.clear();
    if (state.endDatePicker) state.endDatePicker.clear();
    DEADLINE_PICKERS.forEach(({ key, selector }) => {
        if (state[key]) state[key].clear();
        else document.querySelector(selector).value = '';
    });

    // Banner preview (typing runs it through data-input)
    updateBannerPreview();

    await loadRoles();
    await startTemplateChoice();

    clearAllMarks();
    updateStartRequired();

    // Reset wizard to step 1
    wizardGoTo(1);

    const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('eventModal'));
    modal.show();

    // Fix for EasyMDE rendering in modal
    setTimeout(() => {
        state.descriptionEditor.codemirror.refresh();
    }, 200);

    document.getElementById('event-access').onchange = function () {
        document.getElementById('role-requirement-area').style.display = this.value === 'role-required' ? 'block' : 'none';
    };
}

/** EasyMDE of the description, created on first use. */
function ensureDescriptionEditor() {
    if (state.descriptionEditor) return;
    state.descriptionEditor = new EasyMDE({
        element: document.getElementById('event-description'),
        spellChecker: false,
        status: false,
        maxHeight: "200px",
        autoDownloadFontAwesome: false,
    });
}

/**
 * Put event settings into the wizard: editing an event and applying a template (W-10).
 * Dates, deadlines, status and series inputs stay as they are.
 *
 * @param {Object} fields -> Stored event or template settings.
 * @returns {Promise<void>}
 */
export async function fillWizard(fields) {
    const event = fields || {};
    document.getElementById('event-title').value = event.title || '';
    ensureDescriptionEditor();
    state.descriptionEditor.value(event.description || '');

    document.getElementById('event-banner-url').value = event.bannerUrl || '';
    const accentEl = document.getElementById('event-accent-color');
    if (accentEl) accentEl.value = event.accentColor || '#8b5cf6';

    const locationTextEl = document.getElementById('event-location-text');
    const locationChanId = document.getElementById('event-location-channel-id');
    const locationChanType = document.getElementById('event-location-channel-type');
    if (locationTextEl) locationTextEl.value = event.location?.text || '';
    if (locationChanId) locationChanId.value = event.location?.channelId || '';
    if (locationChanType) locationChanType.value = event.location?.channelType || '';

    // Banner preview (typing runs it through data-input)
    updateBannerPreview();
    document.getElementById('event-max').value = event.maxParticipants || 0;
    document.getElementById('event-category').value = event.category || '';
    document.getElementById('event-access').value = event.accessMode || 'open';
    document.getElementById('event-approval').value = event.approvalMode || 'manual';
    document.getElementById('event-reminder').value = reminderHoursOf(event.reminderHours).join(', ');
    document.getElementById('event-checkin-message').value = event.checkinMessage || '';
    document.getElementById('event-auto-create-channels').checked = !!event.autoCreateChannels;

    toggleElement(document.getElementById('channel-config-options'), event.autoCreateChannels);
    const cConfig = event.channelConfig || {};
    document.getElementById('event-channel-type').value = cConfig.type || 'voice';
    document.getElementById('event-voice-name').value = cConfig.voiceName || '';
    document.getElementById('event-text-name').value = cConfig.textName || '';

    document.getElementById('event-allow-guests').checked = event.allowGuests !== false;
    renderSlotEditor(event.slots || []);

    await loadRoles();
    document.getElementById('event-assign-role').value = event.assignRoleId || '';

    // Custom Messages
    const customMsgs = event.customBotMessages || {};
    const hasCustom = customMsgs.registration || customMsgs.accepted || customMsgs.rejected;
    document.getElementById('event-custom-msg-toggle').checked = !!hasCustom;
    document.getElementById('custom-msg-options').style.display = hasCustom ? 'block' : 'none';
    document.getElementById('event-msg-registration').value = customMsgs.registration || '';
    document.getElementById('event-msg-accepted').value = customMsgs.accepted || '';
    document.getElementById('event-msg-rejected').value = customMsgs.rejected || '';

    document.getElementById('role-requirement-area').style.display = event.accessMode === 'role-required' ? 'block' : 'none';
    const requiredRoles = new Set(event.requiredRoles || []);
    document.querySelectorAll('#role-checkboxes input').forEach(cb => { cb.checked = requiredRoles.has(cb.value); });

    const builder = document.getElementById('form-fields-builder');
    builder.innerHTML = '';
    (event.formFields || []).forEach(field => addFormField(field));
}

export async function editEvent(eventId) {
    state.pendingPollDecision = null;
    try {
        const res = await fetch(`/api/events/${eventId}?status=all`);
        const event = await res.json();

        document.getElementById('eventModalTitle').textContent = 'Event bearbeiten';
        rememberLoadedEvent(event);
        document.getElementById('event-edit-id').value = eventId;

        // Store dates to apply once Flatpickr is initialized (lazy init on step 2)
        const _startDate = event.startDate || null;
        const _endDate = event.endDate || null;
        // Init if already exists, otherwise they'll be created when user visits step 2
        if (state.startDatePicker) state.startDatePicker.setDate(_startDate);
        else { state.startDatePicker = flatpickr("#event-start-date", { enableTime: true, dateFormat: "Y-m-d H:i", time_24hr: true, locale: "de" }); state.startDatePicker.setDate(_startDate); }
        if (state.endDatePicker) state.endDatePicker.setDate(_endDate);
        else { state.endDatePicker = flatpickr("#event-end-date", { enableTime: true, dateFormat: "Y-m-d H:i", time_24hr: true, locale: "de" }); state.endDatePicker.setDate(_endDate); }
        DEADLINE_PICKERS.forEach(({ key, field, selector }) => ensureDeadlinePicker(key, selector).setDate(event[field] || null));

        document.getElementById('event-status').value = event.status || 'active';

        // Recurring fields
        const recurringCb = document.getElementById('event-recurring');
        recurringCb.checked = !!event.recurring;
        toggleElement(document.getElementById('recurring-options'), event.recurring);
        document.getElementById('event-recurring-interval').value = event.recurringInterval || 'weekly';
        document.getElementById('event-recurring-until').value = event.recurringUntil || '';
        await rememberSeries(event);

        await fillWizard(event);
        renderTemplateChooser({ editing: true });

        document.getElementById('event-access').onchange = function () {
            document.getElementById('role-requirement-area').style.display = this.value === 'role-required' ? 'block' : 'none';
        };

        clearAllMarks();
        updateStartRequired();

        // Reset wizard to step 1
        wizardGoTo(1);

        const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('eventModal'));
        modal.show();

        setTimeout(() => {
            state.descriptionEditor.codemirror.refresh();
        }, 200);
    } catch {
        showToast('Fehler beim Laden des Events.', 'danger');
    }
}

/**
 * Input of the wizard as POST/PUT /api/admin/events expects it; also the draft of the checks and the preview.
 *
 * @returns {Object} -> Event fields; form fields unfiltered, so empty labels can be reported.
 */
export function collectEventDraft() {
    return {
        title: document.getElementById('event-title').value,
        description: state.descriptionEditor ? state.descriptionEditor.value() : document.getElementById('event-description').value,
        bannerUrl: document.getElementById('event-banner-url').value,
        startDate: state.startDatePicker && state.startDatePicker.selectedDates[0] ? state.startDatePicker.selectedDates[0].toISOString() : '',
        endDate: state.endDatePicker && state.endDatePicker.selectedDates[0] ? state.endDatePicker.selectedDates[0].toISOString() : '',
        registrationDeadline: deadlineValue('registrationDeadlinePicker'),
        unregisterDeadline: deadlineValue('unregisterDeadlinePicker'),
        maxParticipants: document.getElementById('event-max').value,
        category: document.getElementById('event-category').value,
        accessMode: document.getElementById('event-access').value,
        approvalMode: document.getElementById('event-approval').value,
        status: document.getElementById('event-status').value,
        reminderHours: document.getElementById('event-reminder').value,
        assignRoleId: document.getElementById('event-assign-role').value,
        requiredRoles: getSelectedRoles(),
        formFields: getFormFieldsFromBuilder(),
        recurring: document.getElementById('event-recurring').checked,
        recurringInterval: document.getElementById('event-recurring-interval').value,
        recurringUntil: document.getElementById('event-recurring-until').value,
        // Only for the check: a series date cannot get an earlier end (W-11)
        storedRecurringUntil: storedRecurringUntil(),
        checkinMessage: document.getElementById('event-checkin-message').value,
        autoCreateChannels: document.getElementById('event-auto-create-channels').checked,
        channelConfig: {
            type: document.getElementById('event-channel-type').value,
            voiceName: document.getElementById('event-voice-name').value.trim(),
            textName: document.getElementById('event-text-name').value.trim()
        },
        allowGuests: document.getElementById('event-allow-guests').checked,
        slots: getSlotsFromEditor(),
        fromPoll: state.pendingPollDecision || undefined,
        customBotMessages: {
            registration: document.getElementById('event-msg-registration').value,
            accepted: document.getElementById('event-msg-accepted').value,
            rejected: document.getElementById('event-msg-rejected').value
        },
        accentColor: document.getElementById('event-accent-color')?.value || '',
        location: (() => {
            const text = document.getElementById('event-location-text')?.value?.trim() || '';
            if (!text) return null;
            return {
                text,
                channelId: document.getElementById('event-location-channel-id')?.value || '',
                channelType: document.getElementById('event-location-channel-type')?.value || ''
            };
        })(),
    };
}

/**
 * Body of PUT /api/admin/events/:id.
 *
 * @param {Object} draft -> Input of collectEventDraft().
 * @returns {Object} -> Draft with the notification flag and, for a series date, `applyTo`.
 */
function editBody(draft) {
    const scope = seriesScope();
    return { ...draft, notifyParticipants: notifyRequested(), ...(scope ? { applyTo: scope } : {}) };
}

export async function saveEvent() {
    const draft = collectEventDraft();
    // Every step is checked and marked; the first one with problems is shown, nothing is sent
    let firstStep = 0;
    let firstInput = null;
    for (let step = 1; step <= WIZARD_TOTAL_STEPS; step++) {
        const errors = checkWizardStep(step, draft);
        const input = showStepErrors(step, errors);
        if (errors.length > 0 && !firstStep) {
            firstStep = step;
            firstInput = input;
        }
    }
    if (firstStep) {
        wizardGoTo(firstStep);
        firstInput?.focus();
        return;
    }

    const editId = document.getElementById('event-edit-id').value;
    try {
        const url = editId ? `/api/admin/events/${editId}` : '/api/admin/events';
        const method = editId ? 'PUT' : 'POST';
        const res = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-TOKEN': state.csrfToken
            },
            // Change DMs only on request and only for edits (W-04); series dates send their scope (W-11)
            body: JSON.stringify(editId ? editBody(draft) : draft)
        });

        if (res.ok) {
            const answer = await res.json();
            bootstrap.Modal.getOrCreateInstance(document.getElementById('eventModal')).hide();
            showToast(editId ? savedEventToast(answer) : 'Event erstellt!', 'success');
            loadAdminEvents();
            loadAdminStats();
            if (!editId && state.pendingPollDecision) {
                const decidedPollId = state.pendingPollDecision.pollId;
                state.pendingPollDecision = null;
                showToast('Abstimmung entschieden – alle Abstimmenden bekommen eine DM.', 'success');
                // Usually started from the poll page -> the same hash does not fire hashchange
                if (window.location.hash === `#poll/${decidedPollId}`) {
                    showPollDetail(decidedPollId);
                } else {
                    navigateTo(`poll/${decidedPollId}`);
                }
            }
        } else {
            const err = await res.json();
            showToast(err.error || 'Fehler', 'danger');
        }
    } catch {
        showToast('Netzwerkfehler.', 'danger');
    }
}

export async function loadRoles() {
    if (state.cachedRoles.length) {
        populateRoles(state.cachedRoles);
        return;
    }
    try {
        const res = await fetch('/api/admin/roles');
        state.cachedRoles = await res.json();
        populateRoles(state.cachedRoles);
    } catch {
        console.warn('Could not load roles');
    }
}

export function populateRoles(roles) {
    const container = document.getElementById('role-checkboxes');
    container.innerHTML = roles.map(r => `
    <label class="badge-pill role-chip" data-style-border-color="${hexColor(r.color)}">
      <input type="checkbox" class="me-1" value="${r.id}"> ${escapeHtml(r.name)}
    </label>
  `).join('');
    applyStyleData(container);

    const select = document.getElementById('event-assign-role');
    const currentVal = select.value;
    select.innerHTML = '<option value="">Keine Rolle zuweisen</option>' +
        roles.map(r => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
    select.value = currentVal;
}

export function getSelectedRoles() {
    const checkboxes = document.querySelectorAll('#role-checkboxes input:checked');
    return Array.from(checkboxes).map(cb => cb.value);
}

registerActions({
    editEvent: (el) => editEvent(el.dataset.eventId),
    showCreateEventModal: () => showCreateEventModal(),
    wizardGoTo: (el) => wizardGoTo(Number(el.dataset.step)),
    wizardNext: () => wizardNext(),
    wizardBack: () => wizardBack(),
    saveEvent: () => saveEvent(),
    updateStartRequired: () => updateStartRequired(),
    setWizardMode: (el) => setWizardMode(el.dataset.mode)
});
