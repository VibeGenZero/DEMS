/**
 * Check-in section of the event page.
 */
import { state } from '../core/state.js';
import { registerActions } from '../core/actions.js';
import { escapeHtml, renderMarkdownSafe, showElement, showToast } from '../core/ui.js';
import { showEventDetail } from './detail.js';

export async function renderCheckinSection(eventId, event, registration) {
    let container = document.getElementById('checkin-section');
    if (!container) {
        container = document.createElement('div');
        container.id = 'checkin-section';
        container.className = 'mb-4 glass-card is-tinted p-4';
        document.getElementById('detail-status')?.appendChild(container);
    }
    showElement(container);

    // Admin view: show code generation + stats
    if (state.currentUser?.isAdmin) {
        try {
            const statsRes = await fetch(`/api/admin/events/${eventId}/checkin-stats`, {
                headers: { 'X-CSRF-TOKEN': state.csrfToken }
            });
            const stats = await statsRes.json();
            if (state.detailEventId !== eventId) return;

            container.innerHTML = `
                <h5><i class="bi bi-qr-code me-2"></i>Check-in (Admin)</h5>
                <div class="row g-3 align-items-center">
                    <div class="col-md-4">
                        <p class="mb-1 text-secondary">Aktueller Code:</p>
                        <h3 class="mb-0 font-monospace">${stats.code || '<span class="text-muted">Keiner</span>'}</h3>
                    </div>
                    <div class="col-md-4">
                        <p class="mb-1 text-secondary">Check-in Status:</p>
                        <div class="d-flex align-items-center gap-2">
                            <span class="badge-pill fs-6">${stats.checkedIn} / ${stats.total}</span>
                            <span class="text-muted">eingecheckt</span>
                        </div>
                    </div>
                    <div class="col-md-4 text-end">
                        <button class="btn btn-accent" data-click="generateCheckinCode" data-event-id="${escapeHtml(eventId)}">
                            <i class="bi bi-arrow-clockwise me-1"></i>Neuen Code generieren
                        </button>
                    </div>
                </div>
            `;
        } catch {
            container.innerHTML = '<p class="text-muted">Check-in konnte nicht geladen werden.</p>';
        }
        return;
    }

    // User view: show check-in code input if accepted
    if (registration?.status === 'accepted') {
        if (registration.checkedIn) {
            container.innerHTML = `
                <div class="text-center py-3">
                    <i class="bi bi-check-circle-fill text-success icon-xl"></i>
                    <p class="mt-2 mb-0">Du bist eingecheckt! ✅</p>
                </div>`;
        } else if (event.checkinEnabled) {
            container.innerHTML = `
                <h5><i class="bi bi-qr-code-scan me-2"></i>Check-in</h5>
                <p class="text-secondary small">Gib den Check-in Code ein, den du vom Veranstalter erhalten hast.</p>
                <div class="d-flex gap-2">
                    <input type="text" class="form-control font-monospace checkin-code-input" id="checkin-code-input"
                        placeholder="6-stelliger Code" maxlength="6">
                    <button class="btn btn-accent" data-click="submitCheckin" data-event-id="${escapeHtml(eventId)}">
                        <i class="bi bi-check-lg me-1"></i>Einchecken
                    </button>
                </div>`;
        } else {
            container.style.display = 'none';
        }
    } else {
        container.style.display = 'none';
    }
}

export async function generateCheckinCode(eventId) {
    try {
        const res = await fetch(`/api/admin/events/${eventId}/generate-checkin`, {
            method: 'POST',
            headers: { 'X-CSRF-TOKEN': state.csrfToken }
        });
        if (res.ok) {
            const data = await res.json();
            showToast(`Neuer Check-in Code: ${data.code}`, 'success');
            renderCheckinSection(eventId);
        } else {
            showToast('Fehler beim Generieren.', 'danger');
        }
    } catch {
        showToast('Netzwerkfehler.', 'danger');
    }
}

export async function submitCheckin(eventId) {
    const codeInput = document.getElementById('checkin-code-input');
    const code = codeInput?.value?.trim();
    if (!code || code.length !== 6) {
        showToast('Bitte einen 6-stelligen Code eingeben.', 'warning');
        return;
    }

    try {
        const res = await fetch(`/api/events/${eventId}/checkin`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-TOKEN': state.csrfToken
            },
            body: JSON.stringify({ code })
        });
        const data = await res.json();
        if (res.ok) {
            if (data.alreadyCheckedIn) {
                showToast('Du bist bereits eingecheckt!', 'info');
            } else {
                showToast('Erfolgreich eingecheckt! ✅', 'success');
            }

            // Display check-in message if present
            if (data.checkinMessage && data.checkinMessage.trim()) {
                // Create a modal to display the check-in message
                const messageModal = document.createElement('div');
                messageModal.className = 'modal fade';
                messageModal.setAttribute('tabindex', '-1');
                messageModal.innerHTML = `
                    <div class="modal-dialog modal-dialog-centered">
                        <div class="modal-content">
                            <div class="modal-header border-0">
                                <h5 class="modal-title"><i class="bi bi-info-circle me-2"></i>Event-Information</h5>
                                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                            </div>
                            <div class="modal-body markdown-body"></div>
                            <div class="modal-footer border-0">
                                <button type="button" class="btn btn-accent" data-bs-dismiss="modal">Verstanden</button>
                            </div>
                        </div>
                    </div>
                `;
                document.body.appendChild(messageModal);

                // Render Markdown safely
                const modalBody = messageModal.querySelector('.modal-body');
                modalBody.innerHTML = renderMarkdownSafe(data.checkinMessage);

                const modal = new bootstrap.Modal(messageModal);
                modal.show();

                // Remove modal from DOM after it's hidden
                messageModal.addEventListener('hidden.bs.modal', () => {
                    messageModal.remove();
                });
            }

            showEventDetail(eventId, data.alreadyCheckedIn ? {} : { celebrate: 'checkedin' });
        } else {
            showToast(data.error || 'Fehler beim Check-in.', 'danger');
        }
    } catch {
        showToast('Netzwerkfehler.', 'danger');
    }
}

registerActions({
    generateCheckinCode: (el) => generateCheckinCode(el.dataset.eventId),
    submitCheckin: (el) => submitCheckin(el.dataset.eventId)
});
