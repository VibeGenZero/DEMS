/**
 * Event wizard builders: registration form fields and role slots.
 */
import { registerActions } from '../core/actions.js';
import { escapeHtml, showToast } from '../core/ui.js';
import { FORM_FIELD_TYPE_LABELS } from '../events/registration-form.js';

export function addFormField(existing = null) {
    const builder = document.getElementById('form-fields-builder');
    const row = document.createElement('div');
    row.className = 'form-field-row';

    const label = existing ? existing.label : '';
    const type = existing && existing.type ? existing.type : 'text';
    const description = existing && existing.description ? existing.description : '';
    const options = existing && existing.options ? existing.options.join(', ') : '';
    const required = existing ? existing.required : false;

    const typeOptions = FORM_FIELD_TYPE_LABELS
        .map(({ value, text }) => `<option value="${value}" ${type === value ? 'selected' : ''}>${text}</option>`)
        .join('');

    row.innerHTML = `
    <input type="text" class="form-control ff-label" placeholder="Feldname" value="${escapeHtml(label)}" style="flex:2">
    <select class="form-select ff-type" style="flex:1.4" data-change="toggleOptionsInput">
      ${typeOptions}
    </select>
    <input type="text" class="form-control ff-description" placeholder="Hinweis (optional)" value="${escapeHtml(description)}" style="flex:2">
    <input type="text" class="form-control ff-options" placeholder="Optionen (kommagetrennt)" value="${escapeHtml(options)}" style="flex:2;${type === 'dropdown' ? '' : 'display:none'}">
    <label class="d-flex align-items-center gap-1" style="white-space:nowrap;font-size:0.8rem;color:var(--text-muted);">
      <input type="checkbox" class="form-check-input ff-required" ${required ? 'checked' : ''}> Pflicht
    </label>
    <button type="button" class="btn btn-sm btn-outline-danger" data-click="removeFormField">
      <i class="bi bi-x"></i>
    </button>
  `;

    builder.appendChild(row);
}

export function toggleOptionsInput(selectEl) {
    const row = selectEl.closest('.form-field-row');
    const optionsInput = row.querySelector('.ff-options');
    optionsInput.style.display = selectEl.value === 'dropdown' ? 'block' : 'none';
}

export function getFormFieldsFromBuilder() {
    const rows = document.querySelectorAll('.form-field-row');
    return Array.from(rows).map(row => {
        const type = row.querySelector('.ff-type').value;
        const description = row.querySelector('.ff-description').value.trim();
        const field = {
            label: row.querySelector('.ff-label').value,
            type,
            required: row.querySelector('.ff-required').checked
        };
        if (description) {
            field.description = description;
        }
        if (type === 'dropdown') {
            field.options = row.querySelector('.ff-options').value.split(',').map(s => s.trim()).filter(Boolean);
        }
        return field;
    }).filter(f => f.label);
}

export const MAX_SLOTS_PER_EVENT = 10;

export const SLOT_PRESETS = {
    'mmo-raid': [
        { emoji: '🛡️', name: 'Tank', capacity: 2 },
        { emoji: '💚', name: 'Heiler', capacity: 3 },
        { emoji: '⚔️', name: 'Schaden', capacity: 10 }
    ]
};

export function renderSlotEditor(slots) {
    const list = Array.isArray(slots) ? slots : [];
    document.getElementById('event-use-slots').checked = list.length > 0;
    document.getElementById('slot-editor-rows').innerHTML = '';
    list.forEach(slot => addSlotRow(slot));
    toggleSlotEditor();
}

export function toggleSlotEditor() {
    const enabled = document.getElementById('event-use-slots').checked;
    document.getElementById('slot-editor-area').style.display = enabled ? 'block' : 'none';
    if (enabled && document.querySelectorAll('#slot-editor-rows .slot-editor-row').length === 0) {
        addSlotRow();
    }
    updateSlotTotals();
}

export function addSlotRow(slot = {}) {
    const rows = document.getElementById('slot-editor-rows');
    if (rows.querySelectorAll('.slot-editor-row').length >= MAX_SLOTS_PER_EVENT) {
        showToast(`Es sind höchstens ${MAX_SLOTS_PER_EVENT} Slots möglich.`, 'warning');
        return;
    }
    const row = document.createElement('div');
    row.className = 'slot-editor-row';
    row.dataset.slotId = slot.id || '';
    row.innerHTML = `
        <input type="text" class="form-control slot-emoji-input" maxlength="8" placeholder="🎯" value="${escapeHtml(slot.emoji || '')}" aria-label="Emoji">
        <input type="text" class="form-control slot-name-input" maxlength="30" placeholder="Name, z. B. Tank" value="${escapeHtml(slot.name || '')}" aria-label="Slot-Name">
        <input type="number" class="form-control slot-capacity-input" min="1" max="100" value="${escapeHtml(String(slot.capacity || 1))}" aria-label="Plätze" data-input="updateSlotTotals">
        <button type="button" class="btn btn-sm btn-outline-danger" data-click="removeSlotRow" title="Slot entfernen"><i class="bi bi-trash"></i></button>`;
    rows.appendChild(row);
    updateSlotTotals();
}

export function removeSlotRow(button) {
    const row = button.closest('.slot-editor-row');
    if (row) row.remove();
    updateSlotTotals();
}

export function applySlotPreset(presetName) {
    const preset = SLOT_PRESETS[presetName];
    if (!preset) return;
    document.getElementById('slot-editor-rows').innerHTML = '';
    preset.forEach(slot => addSlotRow(slot));
}

export function getSlotsFromEditor() {
    if (!document.getElementById('event-use-slots').checked) return [];
    return [...document.querySelectorAll('#slot-editor-rows .slot-editor-row')].map(row => ({
        id: row.dataset.slotId || undefined,
        emoji: row.querySelector('.slot-emoji-input').value.trim(),
        name: row.querySelector('.slot-name-input').value.trim(),
        capacity: parseInt(row.querySelector('.slot-capacity-input').value, 10) || 0
    }));
}

export function updateSlotTotals() {
    const enabled = document.getElementById('event-use-slots').checked;
    const maxInput = document.getElementById('event-max');
    const guestToggle = document.getElementById('event-allow-guests');
    const guestHint = document.getElementById('event-guests-slot-hint');
    maxInput.disabled = enabled;
    guestToggle.disabled = enabled;
    if (guestHint) guestHint.style.display = enabled ? 'block' : 'none';
    if (enabled) {
        maxInput.value = getSlotsFromEditor().reduce((sum, slot) => sum + Math.max(0, slot.capacity), 0);
        guestToggle.checked = false;
    }
}

registerActions({
    addFormField: () => addFormField(),
    toggleOptionsInput: (el) => toggleOptionsInput(el),
    removeFormField: (el) => el.parentElement.remove(),
    toggleSlotEditor: () => toggleSlotEditor(),
    addSlotRow: () => addSlotRow(),
    applySlotPreset: (el) => applySlotPreset(el.dataset.preset),
    removeSlotRow: (el) => removeSlotRow(el),
    updateSlotTotals: () => updateSlotTotals()
});
