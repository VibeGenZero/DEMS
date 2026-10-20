/**
 * Registrations dialog: list, accept/reject, move slot.
 */
import { state } from '../core/state.js';
import { loadAdminEvents, loadAdminStats } from './dashboard.js';
import { registerActions } from '../core/actions.js';
import { escapeHtml, showToast } from '../core/ui.js';
import { formatSlotLabel } from '../events/slots.js';

export async function showRegistrations(eventId, eventTitle) {
    document.getElementById('reg-event-title').textContent = eventTitle;
    const tbody = document.getElementById('registrations-tbody');
    const empty = document.getElementById('registrations-empty');
    tbody.innerHTML = '<tr><td colspan="8" class="text-center py-4"><div class="spinner-border spinner-border-sm text-secondary"></div></td></tr>';
    empty.style.display = 'none';

    const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('registrationsModal'));
    modal.show();

    try {
        const res = await fetch(`/api/admin/events/${eventId}/registrations`);
        const result = await res.json();
        const regs = result.data || result;
        const slots = Array.isArray(result.slots) ? result.slots : [];

        if (!regs.length) {
            tbody.innerHTML = '';
            empty.style.display = 'block';
            return;
        }

        const statusTexts = { pending: '⏳ Ausstehend', accepted: '✅ Angenommen', rejected: '❌ Abgelehnt', waitlisted: '📋 Warteliste' };

        const sourceBadges = {
            discord: '<span class="badge bg-primary-subtle text-primary-emphasis"><i class="bi bi-discord me-1"></i>Discord</span>',
            web: '<span class="badge bg-secondary-subtle text-secondary-emphasis"><i class="bi bi-globe2 me-1"></i>Website</span>'
        };

        tbody.innerHTML = regs.map(reg => {
            const sourceBadge = sourceBadges[reg.source] || sourceBadges.web;
            const guestsText = Array.isArray(reg.guests) && reg.guests.length > 0
                ? `<span class="badge text-bg-secondary mb-1">${reg.guests.length} Gast/Gäste</span><br><small class="text-muted text-break reg-guests">${reg.guests.map(g => escapeHtml(g)).join(', ')}</small>`
                : '<span class="text-muted">—</span>';

            return `
      <tr>
        <td>
          <strong>${escapeHtml(reg.userName)}</strong>
          <br><small class="text-muted">${escapeHtml(reg.userId)}</small>
          <br>${sourceBadge}
        </td>
        <td>
          ${guestsText}
        </td>
        <td>
          <span class="badge-pill status-${reg.status}">
            ${statusTexts[reg.status] || reg.status}
          </span>
        </td>
        <td>
          ${renderRegistrationCheckinCell(reg, eventId, eventTitle)}
        </td>
        <td>
          ${renderRegistrationSlotCell(reg, slots, eventId, eventTitle)}
        </td>
        <td>
          ${Object.entries(reg.formAnswers || {}).map(([k, v]) =>
                `<small><strong>${escapeHtml(k)}:</strong> ${escapeHtml(String(v))}</small>`
            ).join('<br>') || '<small class="text-muted">—</small>'}
        </td>
        <td><small>${new Date(reg.createdAt).toLocaleDateString('de-DE')}</small></td>
        <td>
          ${reg.status === 'pending' || reg.status === 'waitlisted' ? `
            <button class="btn btn-sm btn-outline-success me-1" data-click="updateRegStatus" data-reg-id="${escapeHtml(reg.id)}" data-status="accepted" data-event-id="${escapeHtml(eventId)}" data-event-title="${escapeHtml(eventTitle)}">
              <i class="bi bi-check"></i>
            </button>
            <button class="btn btn-sm btn-outline-danger" data-click="updateRegStatus" data-reg-id="${escapeHtml(reg.id)}" data-status="rejected" data-event-id="${escapeHtml(eventId)}" data-event-title="${escapeHtml(eventTitle)}">
              <i class="bi bi-x"></i>
            </button>
          ` : '—'}
        </td>
      </tr>
    `;
        }).join('');
    } catch {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center text-danger">Fehler</td></tr>';
    }
}

export async function updateRegStatus(regId, status, eventId, eventTitle) {
    try {
        const res = await fetch(`/api/admin/registrations/${regId}/status`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-TOKEN': state.csrfToken
            },
            body: JSON.stringify({ status })
        });
        if (res.ok) {
            const result = await res.json();
            showToast(status === 'accepted' ? 'Angenommen!' : 'Abgelehnt.', status === 'accepted' ? 'success' : 'warning');
            if (result.warning) showToast(result.warning, 'warning');
            showRegistrations(eventId, eventTitle);
            // The table behind the dialog shows the open requests and places of this event
            loadAdminEvents();
            loadAdminStats();
        } else {
            const err = await res.json();
            showToast(err.error, 'danger');
        }
    } catch {
        showToast('Netzwerkfehler.', 'danger');
    }
}

/**
 * Check-in cell: one toggle for accepted registrations, nothing for the others.
 * @param {Object} reg -> Registration with `id`, `status`, `checkedIn`.
 * @returns {string} -> HTML of the cell content.
 */
export function renderRegistrationCheckinCell(reg, eventId, eventTitle) {
    if (reg.status !== 'accepted') return '<span class="text-muted">—</span>';
    const checkedIn = reg.checkedIn === true;
    const look = checkedIn
        ? { button: 'btn-success', icon: 'bi-check2-square', label: 'Eingecheckt' }
        : { button: 'btn-outline-secondary', icon: 'bi-square', label: 'Abhaken' };
    return `<button type="button" class="btn btn-sm ${look.button} text-nowrap" data-click="toggleRegCheckin"
        data-reg-id="${escapeHtml(reg.id)}" data-checked-in="${checkedIn}" data-event-id="${escapeHtml(eventId)}" data-event-title="${escapeHtml(eventTitle)}"
        aria-pressed="${checkedIn}"><i class="bi ${look.icon} me-1"></i>${look.label}</button>`;
}

/**
 * Sets or takes back the check-in of one registration, then reloads the dialog.
 * @param {Object} dataset -> `regId`, `checkedIn` ('true'|'false', the current state), `eventId`, `eventTitle`.
 */
export async function toggleRegCheckin({ regId, checkedIn, eventId, eventTitle }) {
    const target = checkedIn !== 'true';
    try {
        const res = await fetch(`/api/admin/registrations/${encodeURIComponent(regId)}/checkin`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': state.csrfToken },
            body: JSON.stringify({ checkedIn: target })
        });
        const result = await res.json();
        if (!res.ok) {
            showToast(result.error || 'Check-in konnte nicht gespeichert werden.', 'danger');
            return;
        }
        showToast(target ? 'Eingecheckt.' : 'Check-in zurückgenommen.', target ? 'success' : 'info');
    } catch {
        showToast('Netzwerkfehler.', 'danger');
        return;
    }
    showRegistrations(eventId, eventTitle);
}

export function renderRegistrationSlotCell(reg, slots, eventId, eventTitle) {
    if (slots.length === 0) return '<span class="text-muted">—</span>';
    const preferred = slots.find(slot => slot.id === reg.preferredSlotId);
    const wish = preferred && reg.preferredSlotId !== reg.slotId
        ? `<br><small class="text-muted">Wunsch: ${escapeHtml(formatSlotLabel(preferred))}</small>`
        : '';
    if (reg.status !== 'accepted' && reg.status !== 'pending') {
        return `<span class="text-muted">—</span>${wish}`;
    }
    const options = slots.map(slot =>
        `<option value="${escapeHtml(slot.id)}"${slot.id === reg.slotId ? ' selected' : ''}>${escapeHtml(formatSlotLabel(slot))}</option>`
    ).join('');
    return `<select class="form-select form-select-sm" aria-label="Slot"
        data-reg-id="${escapeHtml(reg.id)}" data-event-id="${escapeHtml(eventId)}" data-event-title="${escapeHtml(eventTitle)}"
        data-change="moveRegistrationSlot">${options}</select>${wish}`;
}

export async function moveRegistrationSlot(select) {
    const { regId, eventId, eventTitle } = select.dataset;
    try {
        const res = await fetch(`/api/admin/registrations/${regId}/slot`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': state.csrfToken },
            body: JSON.stringify({ slotId: select.value })
        });
        const result = await res.json();
        if (res.ok) {
            showToast(result.warning || 'Slot geändert.', result.warning ? 'warning' : 'success');
        } else {
            showToast(result.error || 'Slot konnte nicht geändert werden.', 'danger');
        }
    } catch {
        showToast('Netzwerkfehler.', 'danger');
    }
    showRegistrations(eventId, eventTitle);
}

registerActions({
    showRegistrations: (el) => showRegistrations(el.dataset.eventId, el.dataset.eventTitle),
    updateRegStatus: (el) => updateRegStatus(el.dataset.regId, el.dataset.status, el.dataset.eventId, el.dataset.eventTitle),
    moveRegistrationSlot: (el) => moveRegistrationSlot(el),
    toggleRegCheckin: (el) => toggleRegCheckin(el.dataset)
});
