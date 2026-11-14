/**
 * Role choices of the event wizard: the role gate of step 3 and the role that
 * is assigned on acceptance.
 */
import { state } from '../core/state.js';
import { applyStyleData, escapeHtml, hexColor } from '../core/ui.js';

/**
 * Load the guild roles once and draw both role choices.
 *
 * @returns {Promise<void>}
 */
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
