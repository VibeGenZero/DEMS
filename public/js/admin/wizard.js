/**
 * Event wizard: steps, create/edit/save, roles, location autocomplete.
 */
import { state } from '../core/state.js';
import { loadAdminEvents, loadAdminStats } from './dashboard.js';
import { addFormField, getFormFieldsFromBuilder, getSlotsFromEditor, renderSlotEditor } from './wizard-builders.js';
import { navigateTo } from '../core/router.js';
import { registerActions } from '../core/actions.js';
import { escapeHtml, inlineArg, showToast } from '../core/ui.js';
import { showPollDetail } from '../polls/polls.js';

export let _cachedChannels = null;

export async function loadChannelsForAutocomplete() {
    if (_cachedChannels !== null) return _cachedChannels;
    try {
        const res = await fetch('/api/admin/channels');
        _cachedChannels = await res.json();
        return _cachedChannels;
    } catch { return []; }
}

export async function handleLocationInput() {
    const input = document.getElementById('event-location-text');
    const suggestionsEl = document.getElementById('location-suggestions');
    if (!input || !suggestionsEl) return;

    const val = input.value.trim();

    const chanIdEl = document.getElementById('event-location-channel-id');
    const chanTypeEl = document.getElementById('event-location-channel-type');
    if (chanIdEl) chanIdEl.value = '';
    if (chanTypeEl) chanTypeEl.value = '';

    if (!val) {
        suggestionsEl.style.display = 'none';
        return;
    }

    const channels = await loadChannelsForAutocomplete();
    const q = val.replace(/^#/, '').toLowerCase();
    const filtered = channels.filter(c => c.name.toLowerCase().includes(q)).slice(0, 8);

    if (!filtered.length) {
        suggestionsEl.style.display = 'none';
        return;
    }

    suggestionsEl.innerHTML = filtered.map(c => `
        <div class="location-suggestion-item"
             onclick="selectLocationChannel(${inlineArg(c.id)}, ${inlineArg(c.name)}, ${inlineArg(c.type)})">
            <i class="bi bi-${c.type === 'voice' ? 'volume-up' : 'hash'} me-2"></i>${escapeHtml(c.name)}
        </div>`).join('');
    suggestionsEl.style.display = 'block';
}

export function selectLocationChannel(channelId, channelName, channelType) {
    const input = document.getElementById('event-location-text');
    if (input) input.value = '#' + channelName;
    const chanIdEl = document.getElementById('event-location-channel-id');
    if (chanIdEl) chanIdEl.value = channelId;
    const chanTypeEl = document.getElementById('event-location-channel-type');
    if (chanTypeEl) chanTypeEl.value = channelType;
    const suggestionsEl = document.getElementById('location-suggestions');
    if (suggestionsEl) suggestionsEl.style.display = 'none';
}

export let currentWizardStep = 1;

export const WIZARD_TOTAL_STEPS = 5;

export function wizardGoTo(step) {
    // Hide current page & deactivate indicator
    document.getElementById(`wizard-page-${currentWizardStep}`).style.display = 'none';

    currentWizardStep = step;

    // Show new page
    const page = document.getElementById(`wizard-page-${step}`);
    page.style.display = '';

    // Update step indicators
    for (let i = 1; i <= WIZARD_TOTAL_STEPS; i++) {
        const el = document.getElementById(`wstep-${i}`);
        el.classList.remove('active', 'completed');
        if (i === step) el.classList.add('active');
        else if (i < step) el.classList.add('completed');
    }

    // Navigation buttons
    document.getElementById('wizard-btn-back').style.display = step > 1 ? '' : 'none';
    document.getElementById('wizard-btn-next').style.display = step < WIZARD_TOTAL_STEPS ? '' : 'none';
    document.getElementById('wizard-btn-save').style.display = step === WIZARD_TOTAL_STEPS ? '' : 'none';
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
    }
}

export function wizardNext() {
    if (currentWizardStep === 1) {
        const titleEl = document.getElementById('event-title');
        if (!titleEl.value.trim()) {
            titleEl.classList.add('is-invalid');
            titleEl.focus();
            return;
        }
        titleEl.classList.remove('is-invalid');
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

// Mirrors normalizeReminderHours in utils/reminders.js: stored list, legacy number or the form text "24, 1"
export function reminderHoursOf(value) {
    const raw = Array.isArray(value) ? value.map(reminder => reminder?.hours) : String(value ?? '').split(/[\s,;]+/);
    return [...new Set(raw.map(hours => Number.parseFloat(hours)).filter(hours => Number.isFinite(hours) && hours > 0))];
}

export async function showCreateEventModal() {
    state.pendingPollDecision = null;
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

    // Initialize EasyMDE if not exists
    if (!state.descriptionEditor) {
        state.descriptionEditor = new EasyMDE({
            element: document.getElementById('event-description'),
            spellChecker: false,
            status: false,
            maxHeight: "200px",
            autoDownloadFontAwesome: false,
        });
    }
    state.descriptionEditor.value('');

    if (state.startDatePicker) state.startDatePicker.clear();
    if (state.endDatePicker) state.endDatePicker.clear();

    // Banner Preview Setup
    const bannerInput = document.getElementById('event-banner-url');
    bannerInput.removeEventListener('input', updateBannerPreview);
    bannerInput.addEventListener('input', updateBannerPreview);
    updateBannerPreview();

    await loadRoles();

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

export function updateBannerPreview() {
    const url = document.getElementById('event-banner-url').value;
    const container = document.getElementById('banner-preview-container');
    const img = document.getElementById('banner-preview');

    if (url) {
        container.style.display = 'block';
        img.src = url;
    } else {
        container.style.display = 'none';
        img.src = '';
    }
}

export async function editEvent(eventId) {
    state.pendingPollDecision = null;
    try {
        const res = await fetch(`/api/events/${eventId}?status=all`);
        const event = await res.json();

        document.getElementById('eventModalTitle').textContent = 'Event bearbeiten';
        document.getElementById('event-edit-id').value = eventId;
        document.getElementById('event-title').value = event.title || '';

        // Update EasyMDE
        if (!state.descriptionEditor) {
            state.descriptionEditor = new EasyMDE({
                element: document.getElementById('event-description'),
                spellChecker: false,
                status: false,
                maxHeight: "200px",
                autoDownloadFontAwesome: false,
            });
        }
        state.descriptionEditor.value(event.description || '');

        document.getElementById('event-banner-url').value = event.bannerUrl || '';

        // Accent color
        const accentEl = document.getElementById('event-accent-color');
        if (accentEl) accentEl.value = event.accentColor || '#8b5cf6';

        // Location
        const locationTextEl = document.getElementById('event-location-text');
        const locationChanId = document.getElementById('event-location-channel-id');
        const locationChanType = document.getElementById('event-location-channel-type');
        if (locationTextEl) locationTextEl.value = event.location?.text || '';
        if (locationChanId) locationChanId.value = event.location?.channelId || '';
        if (locationChanType) locationChanType.value = event.location?.channelType || '';

        // Store dates to apply once Flatpickr is initialized (lazy init on step 2)
        const _startDate = event.startDate || null;
        const _endDate = event.endDate || null;
        // Init if already exists, otherwise they'll be created when user visits step 2
        if (state.startDatePicker) state.startDatePicker.setDate(_startDate);
        else { state.startDatePicker = flatpickr("#event-start-date", { enableTime: true, dateFormat: "Y-m-d H:i", time_24hr: true, locale: "de" }); state.startDatePicker.setDate(_startDate); }
        if (state.endDatePicker) state.endDatePicker.setDate(_endDate);
        else { state.endDatePicker = flatpickr("#event-end-date", { enableTime: true, dateFormat: "Y-m-d H:i", time_24hr: true, locale: "de" }); state.endDatePicker.setDate(_endDate); }

        // Banner Preview
        const bannerInput = document.getElementById('event-banner-url');
        bannerInput.removeEventListener('input', updateBannerPreview);
        bannerInput.addEventListener('input', updateBannerPreview);
        updateBannerPreview();
        document.getElementById('event-max').value = event.maxParticipants || 0;
        document.getElementById('event-category').value = event.category || '';
        document.getElementById('event-access').value = event.accessMode || 'open';
        document.getElementById('event-approval').value = event.approvalMode || 'manual';
        document.getElementById('event-status').value = event.status || 'active';
        document.getElementById('event-reminder').value = reminderHoursOf(event.reminderHours).join(', ');
        document.getElementById('event-checkin-message').value = event.checkinMessage || '';
        document.getElementById('event-auto-create-channels').checked = !!event.autoCreateChannels;

        document.getElementById('channel-config-options').style.display = event.autoCreateChannels ? '' : 'none';
        const cConfig = event.channelConfig || {};
        document.getElementById('event-channel-type').value = cConfig.type || 'voice';
        document.getElementById('event-voice-name').value = cConfig.voiceName || '';
        document.getElementById('event-text-name').value = cConfig.textName || '';

        // Allow Guests Toggle
        document.getElementById('event-allow-guests').checked = event.allowGuests !== false;
        renderSlotEditor(event.slots || []);

        // Recurring fields
        const recurringCb = document.getElementById('event-recurring');
        recurringCb.checked = !!event.recurring;
        document.getElementById('recurring-options').style.display = event.recurring ? '' : 'none';
        document.getElementById('event-recurring-interval').value = event.recurringInterval || 'weekly';
        document.getElementById('event-recurring-until').value = event.recurringUntil || '';

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
        if (event.requiredRoles) {
            event.requiredRoles.forEach(roleId => {
                const cb = document.querySelector(`#role-checkboxes input[value="${roleId}"]`);
                if (cb) cb.checked = true;
            });
        }

        const builder = document.getElementById('form-fields-builder');
        builder.innerHTML = '';
        (event.formFields || []).forEach(field => addFormField(field));

        document.getElementById('event-access').onchange = function () {
            document.getElementById('role-requirement-area').style.display = this.value === 'role-required' ? 'block' : 'none';
        };

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

export async function saveEvent() {
    const editId = document.getElementById('event-edit-id').value;
    const data = {
        title: document.getElementById('event-title').value,
        description: state.descriptionEditor ? state.descriptionEditor.value() : document.getElementById('event-description').value,
        bannerUrl: document.getElementById('event-banner-url').value,
        startDate: state.startDatePicker && state.startDatePicker.selectedDates[0] ? state.startDatePicker.selectedDates[0].toISOString() : '',
        endDate: state.endDatePicker && state.endDatePicker.selectedDates[0] ? state.endDatePicker.selectedDates[0].toISOString() : '',
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

    try {
        const url = editId ? `/api/admin/events/${editId}` : '/api/admin/events';
        const method = editId ? 'PUT' : 'POST';
        const res = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-TOKEN': state.csrfToken
            },
            body: JSON.stringify(data)
        });

        if (res.ok) {
            bootstrap.Modal.getInstance(document.getElementById('eventModal')).hide();
            showToast(editId ? 'Event aktualisiert!' : 'Event erstellt!', 'success');
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
    <label class="badge-pill" style="cursor:pointer;border-color:${r.color}">
      <input type="checkbox" value="${r.id}" style="margin-right:4px;"> ${escapeHtml(r.name)}
    </label>
  `).join('');

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

registerActions({ editEvent: (el) => editEvent(el.dataset.eventId), showCreateEventModal: () => showCreateEventModal() });

// Temporary bridge for inline handlers; D-01 replaces them with data-click and removes it
Object.assign(window, { handleLocationInput, selectLocationChannel, wizardGoTo, wizardNext, wizardBack, saveEvent });
