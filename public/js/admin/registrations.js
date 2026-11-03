/**
 * Registrations dialog: list, accept/reject, move slot, check-in, add members (W-06),
 * bulk actions on ticked rows (W-08, registration-bulk.js).
 */
import { state } from '../core/state.js';
import { loadAdminEvents, loadAdminStats } from './dashboard.js';
import { registerActions } from '../core/actions.js';
import { escapeHtml, showToast, showElement, toggleElement } from '../core/ui.js';
import { avatar } from '../core/components.js';
import { formatSlotLabel } from '../events/slots.js';
import { formatOfferDeadline } from '../events/offer.js';
import { renderBulkCheckboxCell, resetBulkSelection } from './registration-bulk.js';

/** Event the dialog shows; the member entry posts to it. */
const regDialog = { eventId: null, eventTitle: '', slots: [] };
/** Event statuses that take an admin entry (drafts and cancelled events refuse it). */
const ENTRY_STATUSES = ['active', 'archived'];
let memberSearchTimer = null;

export async function showRegistrations(eventId, eventTitle) {
    if (regDialog.eventId !== eventId) clearMemberSearch();
    Object.assign(regDialog, { eventId, eventTitle, slots: [] });
    toggleElement(document.getElementById('reg-add'), false);
    document.getElementById('reg-event-title').textContent = eventTitle;
    // The message button opens the participant message for this event (W-09)
    Object.assign(document.getElementById('reg-message-btn').dataset, { eventId, eventTitle });
    const tbody = document.getElementById('registrations-tbody');
    const empty = document.getElementById('registrations-empty');
    tbody.innerHTML = '<tr><td colspan="9" class="text-center py-4"><div class="spinner-border spinner-border-sm text-secondary"></div></td></tr>';
    empty.style.display = 'none';
    resetBulkSelection(eventId, eventTitle, []);

    const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('registrationsModal'));
    modal.show();

    try {
        const res = await fetch(`/api/admin/events/${eventId}/registrations`);
        const result = await res.json();
        const regs = result.data || result;
        const slots = Array.isArray(result.slots) ? result.slots : [];
        setupMemberEntry(result.eventStatus, slots);
        resetBulkSelection(eventId, eventTitle, regs);

        if (!regs.length) {
            tbody.innerHTML = '';
            empty.style.display = 'block';
            return;
        }

        const statusTexts = { pending: '⏳ Ausstehend', accepted: '✅ Angenommen', rejected: '❌ Abgelehnt', waitlisted: '📋 Warteliste', offered: 'Angeboten', tentative: 'Vielleicht' };

        const sourceBadges = {
            admin: '<span class="badge bg-info-subtle text-info-emphasis"><i class="bi bi-person-gear me-1"></i>Admin</span>',
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
        ${renderBulkCheckboxCell(reg)}
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
            ${statusTexts[reg.status] || reg.status}${reg.status === 'waitlisted' && reg.waitlistPosition ? ` · Platz ${escapeHtml(String(reg.waitlistPosition.position))}` : ''}${reg.status === 'offered' && reg.offer?.expiresAt ? ` · bis ${escapeHtml(formatOfferDeadline(reg.offer.expiresAt))}` : ''}
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
        <td><small>${new Date(reg.createdAt).toLocaleDateString('de-DE')}</small>${reg.tentativeAt && reg.status !== 'tentative' ? `<br><small class="text-muted">Vielleicht seit ${escapeHtml(new Date(reg.tentativeAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }))}</small>` : ''}</td>
        <td>
          ${['pending', 'waitlisted', 'offered', 'tentative'].includes(reg.status) ? `
            <button class="btn btn-sm btn-outline-success me-1" data-click="updateRegStatus" data-reg-id="${escapeHtml(reg.id)}" data-status="accepted" data-event-id="${escapeHtml(eventId)}" data-event-title="${escapeHtml(eventTitle)}">
              <i class="bi bi-check"></i>
            </button>
            ${reg.status === 'tentative' ? `<button class="btn btn-sm btn-outline-secondary me-1" data-click="updateRegStatus" data-reg-id="${escapeHtml(reg.id)}" data-status="waitlisted" data-event-id="${escapeHtml(eventId)}" data-event-title="${escapeHtml(eventTitle)}" title="Auf die Warteliste">
              <i class="bi bi-list-ol"></i>
            </button>` : ''}
            <button class="btn btn-sm btn-outline-danger" data-click="updateRegStatus" data-reg-id="${escapeHtml(reg.id)}" data-status="rejected" data-event-id="${escapeHtml(eventId)}" data-event-title="${escapeHtml(eventTitle)}">
              <i class="bi bi-x"></i>
            </button>
          ` : '—'}
        </td>
      </tr>
    `;
        }).join('');
    } catch {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center text-danger">Fehler</td></tr>';
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
            const toasts = { accepted: ['Angenommen!', 'success'], waitlisted: ['Auf die Warteliste gesetzt.', 'info'], rejected: ['Abgelehnt.', 'warning'] };
            showToast(...(toasts[status] || toasts.rejected));
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
 * Shows the member entry for active and archived events and fills the slot choice of slot events.
 * @param {string|null} eventStatus -> Status the registrations list reports.
 * @param {Array<Object>} slots -> Slots of the event, empty without slots.
 */
function setupMemberEntry(eventStatus, slots) {
    regDialog.slots = slots;
    toggleElement(document.getElementById('reg-add'), ENTRY_STATUSES.includes(eventStatus));
    const select = document.getElementById('reg-add-slot');
    if (slots.length === 0) {
        toggleElement(select, false);
        return;
    }
    const previous = select.value;
    select.innerHTML = slots.map(slot =>
        `<option value="${escapeHtml(slot.id)}"${slot.id === previous ? ' selected' : ''}>${escapeHtml(formatSlotLabel(slot))}</option>`
    ).join('');
    showElement(select);
}

function clearMemberSearch() {
    clearTimeout(memberSearchTimer);
    document.getElementById('reg-add-search').value = '';
    document.getElementById('reg-add-results').innerHTML = '';
}

/** Search action of the input: waits for a typing pause. */
export function debounceRegistrationMemberSearch() {
    clearTimeout(memberSearchTimer);
    memberSearchTimer = setTimeout(runRegistrationMemberSearch, 300);
}

/**
 * Searches the server members for the shown event and lists them; members on the list are greyed out.
 */
export async function runRegistrationMemberSearch() {
    const input = document.getElementById('reg-add-search');
    const results = document.getElementById('reg-add-results');
    const query = input.value.trim();
    if (query.length < 2) {
        results.innerHTML = '';
        return;
    }
    try {
        const res = await fetch(`/api/admin/events/${encodeURIComponent(regDialog.eventId)}/member-search?q=${encodeURIComponent(query)}`);
        const hits = await res.json();
        // A slower answer to an older query must not overwrite the current one
        if (input.value.trim() !== query) return;
        if (!res.ok) {
            showToast(hits.error || 'Suche fehlgeschlagen.', 'danger');
            return;
        }
        results.innerHTML = hits.length
            ? hits.map(renderMemberHit).join('')
            : '<div class="list-group-item text-muted small">Keine Mitglieder gefunden</div>';
    } catch {
        showToast('Netzwerkfehler.', 'danger');
    }
}

function renderMemberHit(member) {
    const content = `${avatar({ url: member.avatar, name: member.displayName, size: 'sm' })}
        <span>${escapeHtml(member.displayName)}</span>
        <small class="text-muted">@${escapeHtml(member.username)}</small>`;
    if (member.alreadyRegistered) {
        return `<button type="button" class="list-group-item list-group-item-action d-flex align-items-center gap-2" disabled>${content}
            <small class="text-muted ms-auto">schon angemeldet</small></button>`;
    }
    return `<button type="button" class="list-group-item list-group-item-action d-flex align-items-center gap-2"
        data-click="addRegistrationMember" data-user-id="${escapeHtml(member.id)}" data-display-name="${escapeHtml(member.displayName)}">${content}
        <i class="bi bi-person-plus ms-auto"></i></button>`;
}

/**
 * Puts the chosen member on the list of the shown event, then reloads the dialog, the admin table and the stats.
 * @param {Object} dataset -> `userId`, `displayName` of the hit.
 */
export async function addRegistrationMember({ userId, displayName }) {
    const { eventId, eventTitle, slots } = regDialog;
    const body = { userId };
    if (slots.length > 0) body.slotId = document.getElementById('reg-add-slot').value;
    try {
        const res = await fetch(`/api/admin/events/${encodeURIComponent(eventId)}/registrations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': state.csrfToken },
            body: JSON.stringify(body)
        });
        const result = await res.json();
        if (!res.ok) {
            showToast(result.error || 'Eintragen fehlgeschlagen.', 'danger');
            return;
        }
        showToast(`${displayName} eingetragen.`, 'success');
        if (result.warning) showToast(result.warning, 'warning');
    } catch {
        showToast('Netzwerkfehler.', 'danger');
        return;
    }
    clearMemberSearch();
    showRegistrations(eventId, eventTitle);
    loadAdminEvents();
    loadAdminStats();
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
    toggleRegCheckin: (el) => toggleRegCheckin(el.dataset),
    searchRegistrationMembers: () => debounceRegistrationMemberSearch(),
    addRegistrationMember: (el) => addRegistrationMember(el.dataset)
});
