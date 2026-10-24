/**
 * Bulk actions in the registrations dialog (W-08): tick rows, then accept,
 * waitlist or reject them together. The server plans the result
 * (utils/bulkRegistrations.js); accept never overbooks there.
 */
import { state } from '../core/state.js';
import { registerActions } from '../core/actions.js';
import { escapeHtml, showConfirmDialog, showToast, toggleElement } from '../core/ui.js';
import { loadAdminEvents, loadAdminStats } from './dashboard.js';
import { showRegistrations } from './registrations.js';

/** Statuses each action applies to; same map as BULK_ACTIONS in utils/bulkRegistrations.js. */
export const BULK_ACTIONS = {
    accept: ['pending', 'waitlisted'],
    waitlist: ['pending', 'accepted'],
    reject: ['pending', 'waitlisted', 'accepted']
};

/** Rows of the open dialog that can be ticked, and the ticked ones (id -> status). */
const bulk = { eventId: null, eventTitle: '', rows: [], selected: new Map(), busy: false };

/**
 * Whether a registration can be ticked.
 *
 * @param {string} status -> Registration status.
 * @returns {boolean}
 */
export function selectableStatus(status) {
    return BULK_ACTIONS.reject.includes(status);
}

/**
 * Checkbox cell of one row (empty for rejected registrations).
 *
 * @param {Object} reg -> Registration of the list.
 * @returns {string} -> `<td>` markup.
 */
export function renderBulkCheckboxCell(reg) {
    if (!selectableStatus(reg.status)) return '<td></td>';
    const checked = bulk.selected.has(reg.id) ? ' checked' : '';
    return `<td><input type="checkbox" class="form-check-input reg-select" aria-label="${escapeHtml(reg.userName)} auswählen"
      data-change="toggleRegSelection" data-reg-id="${escapeHtml(reg.id)}" data-status="${escapeHtml(reg.status)}"${checked}></td>`;
}

/**
 * Start over for a freshly drawn list: remember its tickable rows, drop the selection.
 *
 * @param {string} eventId -> Event of the dialog.
 * @param {string} eventTitle -> Its title (for the reload).
 * @param {Array<Object>} registrations -> Registrations of the list.
 */
export function resetBulkSelection(eventId, eventTitle, registrations) {
    Object.assign(bulk, {
        eventId,
        eventTitle,
        rows: registrations.filter(reg => selectableStatus(reg.status)).map(reg => ({ id: reg.id, status: reg.status }))
    });
    bulk.selected.clear();
    const all = document.getElementById('reg-select-all');
    if (all) all.checked = false;
    renderBulkBar();
}

/** Show the bar while something is ticked; disable actions no ticked row fits. */
export function renderBulkBar() {
    const count = bulk.selected.size;
    toggleElement(document.getElementById('reg-bulk-bar'), count > 0);
    document.getElementById('reg-bulk-count').textContent = `${count} ausgewählt`;
    const statuses = [...bulk.selected.values()];
    for (const [action, applies] of Object.entries(BULK_ACTIONS)) {
        const button = document.getElementById(`reg-bulk-${action}`);
        button.disabled = bulk.busy || !statuses.some(status => applies.includes(status));
    }
}

/**
 * German toast text for the answer of the bulk route.
 *
 * @param {Object} result -> `{ accepted, waitlisted, rejected, full, skipped }`.
 * @returns {string}
 */
export function bulkSummary({ accepted = 0, waitlisted = 0, rejected = 0, full = 0, skipped = 0 }) {
    const parts = [];
    if (accepted) parts.push(`${accepted} angenommen`);
    if (waitlisted) parts.push(full > 0 ? `${waitlisted} auf die Warteliste (keine freien Plätze)` : `${waitlisted} auf die Warteliste gesetzt`);
    const stayed = full - waitlisted;
    if (stayed > 0) parts.push(`${stayed} ohne freien Platz (bleiben auf der Warteliste)`);
    if (rejected) parts.push(`${rejected} abgelehnt`);
    if (parts.length === 0) parts.push('Nichts geändert');
    if (skipped) parts.push(`${skipped} übersprungen`);
    return `${parts.join(', ')}.`;
}

function toggleRegSelection(el) {
    const { regId, status } = el.dataset;
    if (el.checked) bulk.selected.set(regId, status);
    else bulk.selected.delete(regId);
    const all = document.getElementById('reg-select-all');
    if (all) all.checked = bulk.selected.size === bulk.rows.length && bulk.rows.length > 0;
    renderBulkBar();
}

function toggleAllRegSelection(el) {
    bulk.selected.clear();
    if (el.checked) bulk.rows.forEach(row => bulk.selected.set(row.id, row.status));
    document.querySelectorAll('#registrations-tbody .reg-select').forEach(box => { box.checked = el.checked; });
    renderBulkBar();
}

/**
 * Run one bulk action on the ticked rows; reject asks first.
 *
 * @param {string} action -> `accept`, `waitlist` or `reject`.
 * @returns {Promise<void>}
 */
export async function runBulkAction(action) {
    const ids = [...bulk.selected.keys()];
    if (ids.length === 0 || !BULK_ACTIONS[action] || bulk.busy) return;
    if (action === 'reject') {
        const question = ids.length === 1 ? '1 Anmeldung ablehnen?' : `${ids.length} Anmeldungen ablehnen?`;
        if (!(await showConfirmDialog(question, 'Ablehnen', { danger: true }))) return;
    }
    bulk.busy = true;
    renderBulkBar();
    try {
        const res = await fetch(`/api/admin/events/${encodeURIComponent(bulk.eventId)}/registrations/bulk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': state.csrfToken },
            body: JSON.stringify({ action, ids })
        });
        const result = await res.json().catch(() => ({}));
        if (!res.ok) {
            showToast(result.error || 'Fehler bei der Sammelaktion.', 'danger');
            return;
        }
        showToast(bulkSummary(result), result.full || result.skipped ? 'warning' : 'success');
        bulk.selected.clear();
        // The table behind the dialog shows the open requests and places of this event
        await showRegistrations(bulk.eventId, bulk.eventTitle);
        loadAdminEvents();
        loadAdminStats();
    } catch {
        showToast('Netzwerkfehler.', 'danger');
    } finally {
        bulk.busy = false;
        renderBulkBar();
    }
}

registerActions({
    toggleRegSelection: (el) => toggleRegSelection(el),
    toggleAllRegSelection: (el) => toggleAllRegSelection(el),
    runBulkAction: (el) => runBulkAction(el.dataset.action)
});
