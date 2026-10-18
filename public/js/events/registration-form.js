/**
 * Registration form widgets, sign-up and sign-off.
 */
import { state } from '../core/state.js';
import { registerActions } from '../core/actions.js';
import { escapeHtml, showToast } from '../core/ui.js';
import { showEventDetail } from './detail.js';
import { fadeOutRegistration, pressButton, sidebarTaken } from './detail-motion.js';
import { eventHasSlots } from './slots.js';


export async function submitRegistration(eventId, event, btnId, formContainerId) {
    const btn = document.getElementById(btnId);
    if (!btn) return;

    // Save original text to restore later
    const originalText = btn.innerHTML;

    // Validate required form fields before submission
    const formFields = event.formFields || [];
    const prefix = formContainerId === 'dynamic-form-fields' ? 'form-field' : 'wl-field';
    const missingFields = [];
    let firstMissing = null;
    formFields.forEach((field, i) => {
        if (!field.required) return;
        const el = document.getElementById(`${prefix}-${i}`);
        if (!el) return;
        const empty = normalizeFieldType(field.type) === 'checkbox' ? !el.checked : (!el.value || !el.value.trim());
        if (!empty) return;
        missingFields.push(field.label);
        firstMissing = firstMissing || el;
    });
    if (missingFields.length > 0) {
        showToast(`Bitte fülle alle Pflichtfelder aus: ${missingFields.join(', ')}`, 'danger');
        // The button may sit far from the form (sidebar, phone bar): bring the field to the user
        firstMissing.scrollIntoView({ behavior: 'smooth', block: 'center' });
        firstMissing.focus({ preventScroll: true });
        return;
    }

    const usesSlots = eventHasSlots(event) && formContainerId === 'dynamic-form-fields';
    if (usesSlots && !state.selectedSlotId) {
        showToast('Bitte wähle eine Rolle aus.', 'danger');
        document.getElementById('slot-picker-area')?.scrollIntoView({ behavior: 'smooth' });
        return;
    }

    pressButton(btn);
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Wird gesendet...';

    const formAnswers = collectFormAnswers(formFields, formContainerId);

    let guests = [];
    if (formContainerId === 'dynamic-form-fields' && !eventHasSlots(event)) {
        guests = state.selectedGuests.map(g => ({ id: g.id, displayName: g.displayName, avatar: g.avatar }));
    }

    // Create an abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    try {
        const submitRes = await fetch(`/api/events/${eventId}/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-TOKEN': state.csrfToken
            },
            body: JSON.stringify({
                formAnswers,
                guests,
                slotId: usesSlots ? state.selectedSlotId : undefined,
                altSlotIds: usesSlots ? state.selectedAltSlotIds : undefined
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        const result = await submitRes.json();

        if (submitRes.ok) {
            showToast(result.message || 'Erfolgreich!', 'success');
            // The page updates in place; the bar grows from the places shown so far
            showEventDetail(eventId, { celebrate: 'registered', fromTaken: sidebarTaken() });
        } else {
            showToast(result.error || 'Fehler bei der Anmeldung.', 'danger');
            // Allow retry by not reloading the whole page, just resetting button
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            showToast('Zeitüberschreitung bei der Anfrage. Bitte versuche es erneut.', 'danger');
        } else {
            console.error('Registration error:', error);
            showToast('Netzwerkfehler. Bitte versuche es später erneut.', 'danger');
        }
    } finally {
        // Always re-enable button and restore text if we didn't navigate away
        if (document.body.contains(btn)) {
            btn.disabled = false;
            // Restore original icon if it was lost, or just set safer default
            if (btnId === 'waitlist-btn') {
                btn.innerHTML = '<i class="bi bi-list-nested me-2"></i>Auf Warteliste setzen';
            } else {
                btn.innerHTML = '<i class="bi bi-check-circle me-2"></i>Teilnehmen';
            }
        }
    }
}

export async function unregisterFromEvent() {
    const hash = window.location.hash.replace('#', '');
    const parts = hash.split('/');
    const eventId = parts[1]; // Get event ID from URL hash

    if (!eventId) {
        showToast('Fehler: Event ID nicht gefunden.', 'danger');
        return;
    }

    if (!confirm('Möchtest du dich wirklich von diesem Event abmelden?')) {
        return;
    }

    const btn = document.getElementById('unregister-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Wird abgemeldet...';

    try {
        const res = await fetch(`/api/events/${eventId}/register`, {
            method: 'DELETE',
            headers: {
                'X-CSRF-TOKEN': state.csrfToken
            }
        });
        const result = await res.json();

        if (res.ok) {
            showToast(result.message || 'Erfolgreich abgemeldet!', 'success');
            // The status box fades away, then the form comes back
            await fadeOutRegistration();
            showEventDetail(eventId);
        } else {
            showToast(result.error || 'Fehler bei der Abmeldung.', 'danger');
            btn.disabled = false;
            btn.innerHTML = '<i class="bi bi-x-circle me-1"></i>Abmelden';
        }
    } catch {
        showToast('Netzwerkfehler.', 'danger');
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-x-circle me-1"></i>Abmelden';
    }
}

// Mirrors utils/formFields.js on the server. Every type maps onto a Discord
// modal component, so a form can be filled in on the website and in Discord.
export const FORM_FIELD_TYPE_LABELS = [
    { value: 'text', text: 'Text' },
    { value: 'textarea', text: 'Mehrzeiliger Text' },
    { value: 'dropdown', text: 'Dropdown' },
    { value: 'checkbox', text: 'Checkbox' },
    { value: 'user', text: 'Discord-Mitglied' },
    { value: 'role', text: 'Discord-Rolle' },
    { value: 'channel', text: 'Discord-Channel' },
    { value: 'mentionable', text: 'Mitglied oder Rolle' }
];

// Discord shows at most five fields in one dialog
export const DISCORD_MODAL_MAX_FIELDS = 5;

// Minimum characters before the member search starts
export const ENTITY_SEARCH_MIN_LENGTH = 2;

export const ENTITY_SEARCH_DEBOUNCE_MS = 250;

export let formOptionsPromise = null;

// Falls back to a plain text field for unknown types
export function normalizeFieldType(type) {
    return FORM_FIELD_TYPE_LABELS.some(entry => entry.value === type) ? type : 'text';
}

// Same answer format as formatEntityAnswer() in utils/formFields.js
export function formatEntityAnswer(type, name, id) {
    const prefix = type === 'channel' ? '#' : '@';
    return `${prefix}${name} (${id})`;
}

// Roles and channels for the picker fields, loaded once per page visit
export function loadFormOptions() {
    if (!formOptionsPromise) {
        formOptionsPromise = fetch('/api/events/form-options')
            .then(res => (res.ok ? res.json() : { roles: [], channels: [] }))
            .catch(() => ({ roles: [], channels: [] }));
    }
    return formOptionsPromise;
}

export function renderEntityPicker(id, type) {
    const placeholder = type === 'mentionable' ? 'Mitglied oder Rolle suchen...' : 'Mitglied suchen...';
    return `
    <div class="entity-picker">
      <input type="text" class="form-control" id="${id}-search" placeholder="${placeholder}" autocomplete="off">
      <div class="entity-picker-results" id="${id}-results"></div>
      <div class="entity-picker-selected" id="${id}-selected"></div>
      <input type="hidden" id="${id}">
    </div>`;
}

// Fills the role/channel selects and wires up the search pickers
export function initFormFieldWidgets(fields, prefix) {
    const needsOptions = fields.some(field => ['role', 'channel', 'mentionable'].includes(normalizeFieldType(field.type)));
    if (needsOptions) {
        loadFormOptions().then(options => fillEntitySelects(fields, prefix, options));
    }

    fields.forEach((field, i) => {
        const type = normalizeFieldType(field.type);
        if (type === 'user' || type === 'mentionable') {
            initEntityPicker(`${prefix}-${i}`, type);
        }
    });
}

export function fillEntitySelects(fields, prefix, options) {
    fields.forEach((field, i) => {
        const type = normalizeFieldType(field.type);
        if (type !== 'role' && type !== 'channel') return;

        const select = document.getElementById(`${prefix}-${i}`);
        if (!select) return;

        const entries = type === 'role' ? (options.roles || []) : (options.channels || []);
        const marker = type === 'role' ? '@' : '#';
        select.innerHTML = '<option value="">Bitte wählen...</option>' + entries.map(entry =>
            `<option value="${escapeHtml(formatEntityAnswer(type, entry.name, entry.id))}">${marker}${escapeHtml(entry.name)}</option>`
        ).join('');
    });
}

export function initEntityPicker(id, type) {
    const search = document.getElementById(`${id}-search`);
    const results = document.getElementById(`${id}-results`);
    const selected = document.getElementById(`${id}-selected`);
    const hidden = document.getElementById(id);
    if (!search || !results || !selected || !hidden) return;

    let debounceTimer = null;

    search.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        const term = search.value.trim();
        if (term.length < ENTITY_SEARCH_MIN_LENGTH) {
            results.innerHTML = '';
            return;
        }
        debounceTimer = setTimeout(async () => {
            const items = await searchEntities(type, term);
            renderEntityResults(items);
        }, ENTITY_SEARCH_DEBOUNCE_MS);
    });

    function renderEntityResults(items) {
        if (!items.length) {
            results.innerHTML = '<div class="entity-picker-empty">Keine Treffer</div>';
            return;
        }
        results.innerHTML = items.map(item => `
      <button type="button" class="entity-picker-item" data-value="${escapeHtml(item.value)}" data-name="${escapeHtml(item.name)}">
        ${item.icon} ${escapeHtml(item.name)}
      </button>`).join('');

        results.querySelectorAll('.entity-picker-item').forEach(button => {
            button.addEventListener('click', () => selectEntity(button.dataset.value, button.dataset.name));
        });
    }

    function selectEntity(value, name) {
        hidden.value = value;
        selected.innerHTML = `
      <span class="badge bg-primary-subtle text-primary-emphasis">${escapeHtml(name)}</span>
      <button type="button" class="btn btn-sm btn-link p-0 ms-1 entity-picker-clear">entfernen</button>`;
        selected.querySelector('.entity-picker-clear').addEventListener('click', () => {
            hidden.value = '';
            selected.innerHTML = '';
        });
        results.innerHTML = '';
        search.value = '';
    }
}

// Searches members (and roles for mentionable fields) for the picker
export async function searchEntities(type, term) {
    const items = [];

    try {
        const res = await fetch(`/api/user/search?q=${encodeURIComponent(term)}`);
        if (res.ok) {
            const users = await res.json();
            users.forEach(user => {
                const name = user.displayName || user.username;
                items.push({ name, icon: '👤', value: formatEntityAnswer('user', name, user.id) });
            });
        }
    } catch {
        // Search stays empty when the request fails
    }

    if (type === 'mentionable') {
        const options = await loadFormOptions();
        const lowerTerm = term.toLowerCase();
        (options.roles || [])
            .filter(role => role.name.toLowerCase().includes(lowerTerm))
            .slice(0, 10)
            .forEach(role => {
                items.push({ name: role.name, icon: '🏷️', value: formatEntityAnswer('role', role.name, role.id) });
            });
    }

    return items.slice(0, 15);
}

export function renderFormFields(fields, containerId = 'dynamic-form-fields') {
    const container = document.getElementById(containerId);
    if (!fields.length) {
        container.innerHTML = '';
        return;
    }
    const prefix = containerId === 'dynamic-form-fields' ? 'form-field' : 'wl-field';
    container.innerHTML = fields.map((field, i) => {
        const id = `${prefix}-${i}`;
        const type = normalizeFieldType(field.type);
        const hint = field.description
            ? `<small class="text-muted d-block mb-1">${escapeHtml(field.description)}</small>`
            : '';
        let input = '';

        switch (type) {
            case 'textarea':
                input = `<textarea class="form-control" id="${id}" rows="3" ${field.required ? 'required' : ''} placeholder="${escapeHtml(field.label)}"></textarea>`;
                break;
            case 'dropdown':
                input = `<select class="form-select" id="${id}" ${field.required ? 'required' : ''}>
          <option value="">Bitte wählen...</option>
          ${(field.options || []).map(opt => `<option value="${escapeHtml(opt)}">${escapeHtml(opt)}</option>`).join('')}
        </select>`;
                break;
            case 'checkbox':
                input = `<div class="form-check">
          <input type="checkbox" class="form-check-input" id="${id}" ${field.required ? 'required' : ''}>
          <label class="form-check-label" for="${id}">${escapeHtml(field.label)}${field.required ? ' *' : ''}</label>
        </div>`;
                return `<div class="mb-3">${hint}${input}</div>`;
            case 'role':
            case 'channel':
                input = `<select class="form-select entity-select" id="${id}" data-entity-type="${type}" ${field.required ? 'required' : ''}>
          <option value="">Wird geladen...</option>
        </select>`;
                break;
            case 'user':
            case 'mentionable':
                input = renderEntityPicker(id, type);
                break;
            default:
                input = `<input type="text" class="form-control" id="${id}" ${field.required ? 'required' : ''} placeholder="${escapeHtml(field.label)}">`;
        }

        return `<div class="mb-3">
      <label class="form-label" for="${id}">${escapeHtml(field.label)}${field.required ? ' *' : ''}</label>
      ${hint}
      ${input}
    </div>`;
    }).join('');

    initFormFieldWidgets(fields, prefix);
}

export function collectFormAnswers(fields, containerId = 'dynamic-form-fields') {
    const prefix = containerId === 'dynamic-form-fields' ? 'form-field' : 'wl-field';
    const answers = {};
    fields.forEach((field, i) => {
        const el = document.getElementById(`${prefix}-${i}`);
        if (!el) return;
        if (normalizeFieldType(field.type) === 'checkbox') {
            answers[field.label] = el.checked;
        } else {
            answers[field.label] = el.value;
        }
    });
    return answers;
}

registerActions({ unregisterFromEvent: () => unregisterFromEvent() });
