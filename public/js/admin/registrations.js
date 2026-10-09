/**
 * Registrations dialog: list, accept/reject, move slot.
 */
import { state } from '../core/state.js';
import { escapeHtml, inlineArg, showToast } from '../core/ui.js';
import { formatSlotLabel } from '../events/slots.js';

export async function showRegistrations(eventId, eventTitle) {
    document.getElementById('reg-event-title').textContent = eventTitle;
    const tbody = document.getElementById('registrations-tbody');
    const empty = document.getElementById('registrations-empty');
    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4"><div class="spinner-border spinner-border-sm text-secondary"></div></td></tr>';
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
                ? `<span class="badge bg-secondary mb-1">${reg.guests.length} Gast/Gäste</span><br><small class="text-muted text-break" style="max-width: 120px; display: inline-block;">${reg.guests.map(g => escapeHtml(g)).join(', ')}</small>`
                : '<span class="text-muted">—</span>';

            return `
      <tr>
        <td>
          <strong>${escapeHtml(reg.userName)}</strong>
          <br><small class="text-muted">${reg.userId}</small>
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
            <button class="btn btn-sm btn-outline-success me-1" onclick="updateRegStatus('${reg.id}', 'accepted', '${eventId}', ${inlineArg(eventTitle)})">
              <i class="bi bi-check"></i>
            </button>
            <button class="btn btn-sm btn-outline-danger" onclick="updateRegStatus('${reg.id}', 'rejected', '${eventId}', ${inlineArg(eventTitle)})">
              <i class="bi bi-x"></i>
            </button>
          ` : '—'}
        </td>
      </tr>
    `;
        }).join('');
    } catch {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-danger">Fehler</td></tr>';
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
        } else {
            const err = await res.json();
            showToast(err.error, 'danger');
        }
    } catch {
        showToast('Netzwerkfehler.', 'danger');
    }
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
        onchange="moveRegistrationSlot(this)">${options}</select>${wish}`;
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

// Temporary bridge for inline handlers; D-01 replaces them with data-click and removes it
Object.assign(window, { showRegistrations, updateRegStatus, moveRegistrationSlot });
