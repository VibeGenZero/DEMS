/**
 * Admin actions on one event: status, delete, announce, start/end, export,
 * duplicate, Discord sync.
 */
import { state } from '../core/state.js';
import { loadAdminEvents, loadAdminStats } from './dashboard.js';
import { registerActions } from '../core/actions.js';
import { escapeHtml, showToast } from '../core/ui.js';
import { DISCORD_MODAL_MAX_FIELDS } from '../events/registration-form.js';

export async function duplicateEvent(eventId) {
    if (!confirm('Event duplizieren?')) return;
    try {
        const res = await fetch(`/api/admin/events/${eventId}/duplicate`, {
            method: 'POST',
            headers: { 'X-CSRF-TOKEN': state.csrfToken }
        });
        const data = await res.json();
        if (res.ok) {
            showToast(`Event dupliziert: ${data.title}`, 'success');
            loadAdminEvents();
        } else {
            showToast(data.error || 'Fehler beim Duplizieren.', 'danger');
        }
    } catch {
        showToast('Netzwerkfehler.', 'danger');
    }
}

export async function deleteEvent(eventId) {
    if (!confirm('Event wirklich löschen? Alle Anmeldungen werden ebenfalls gelöscht.')) return;
    try {
        await fetch(`/api/admin/events/${eventId}`, {
            method: 'DELETE',
            headers: { 'X-CSRF-TOKEN': state.csrfToken }
        });
        showToast('Event gelöscht.', 'success');
        loadAdminEvents();
        loadAdminStats();
    } catch {
        showToast('Fehler beim Löschen.', 'danger');
    }
}

export async function deleteEventSeries(seriesId) {
    if (!confirm('Ganze Serie wirklich löschen? Alle Termine und Anmeldungen werden gelöscht.')) return;
    try {
        const res = await fetch(`/api/admin/events/series/${seriesId}`, {
            method: 'DELETE',
            headers: { 'X-CSRF-TOKEN': state.csrfToken }
        });
        const data = await res.json();
        showToast(`Serie gelöscht (${data.deletedCount || 0} Events).`, 'success');
        loadAdminEvents();
        loadAdminStats();
    } catch {
        showToast('Fehler beim Löschen der Serie.', 'danger');
    }
}

export async function changeEventStatus(eventId, status) {
    try {
        const res = await fetch(`/api/admin/events/${eventId}/status`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-TOKEN': state.csrfToken
            },
            body: JSON.stringify({ status })
        });
        if (res.ok) {
            const statusNames = { active: 'Aktiv', draft: 'Entwurf', archived: 'Archiviert' };
            showToast(`Status geändert: ${statusNames[status]}`, 'success');
            loadAdminEvents();
            loadAdminStats();
        } else {
            const err = await res.json();
            showToast(err.error, 'danger');
        }
    } catch {
        showToast('Fehler.', 'danger');
    }
}

// Renders a preview of the buttons that will be attached to the announcement
export function renderAnnounceButtonsPreview(event) {
    const container = document.getElementById('announce-buttons-preview');
    if (!container) return;

    const linkLine = '<div><i class="bi bi-box-arrow-up-right me-1"></i><strong>Zum Event</strong> — Link zur Event-Seite (immer dabei)</div>';

    if (!event) {
        container.innerHTML = linkLine;
        return;
    }

    const formFields = Array.isArray(event.formFields) ? event.formFields.filter(f => f && f.label) : [];
    const isActive = !event.status || event.status === 'active';
    const fitsIntoModal = formFields.length <= DISCORD_MODAL_MAX_FIELDS;

    let registerLine;
    if (!isActive) {
        registerLine = '<div class="text-warning"><i class="bi bi-exclamation-triangle me-1"></i>Kein <strong>Anmelden</strong>-Button — das Event ist nicht aktiv.</div>';
    } else if (!fitsIntoModal) {
        registerLine = `<div class="text-warning"><i class="bi bi-exclamation-triangle me-1"></i>Kein <strong>Anmelden</strong>-Button — das Formular hat mehr als ${DISCORD_MODAL_MAX_FIELDS} Felder und passt nicht in einen Discord-Dialog.</div>`;
    } else if (formFields.length > 0) {
        registerLine = `<div><i class="bi bi-check-circle me-1"></i><strong>Anmelden</strong> — öffnet ein Discord-Formular mit ${formFields.length} Feld(ern) und meldet direkt an.</div>`;
    } else {
        registerLine = '<div><i class="bi bi-check-circle me-1"></i><strong>Anmelden</strong> — meldet direkt in Discord an (kein Formular nötig).</div>';
    }

    container.innerHTML = registerLine + linkLine;
}

export async function announceEvent(eventId) {
    // Open the announce modal instead of a simple confirm
    document.getElementById('announce-event-id').value = eventId;
    document.getElementById('announce-text').value = '';
    document.getElementById('announce-everyone').checked = false;

    // Show which buttons Discord will get for this event
    const previewContainer = document.getElementById('announce-buttons-preview');
    if (previewContainer) previewContainer.innerHTML = 'Wird geladen...';
    fetch(`/api/events/${eventId}`)
        .then(res => (res.ok ? res.json() : null))
        .then(renderAnnounceButtonsPreview)
        .catch(() => renderAnnounceButtonsPreview(null));

    // Load roles for checkboxes
    const container = document.getElementById('announce-role-checkboxes');
    container.innerHTML = '<span class="text-muted">Rollen werden geladen...</span>';

    try {
        const res = await fetch('/api/admin/roles', {
            headers: { 'X-CSRF-TOKEN': state.csrfToken }
        });
        if (res.ok) {
            const roles = await res.json();
            // Filter out @everyone (id === guildId) and managed/bot roles
            const selectableRoles = roles.filter(r => r.name !== '@everyone' && !r.managed);

            if (selectableRoles.length === 0) {
                container.innerHTML = '<span class="text-muted">Keine Rollen verfügbar.</span>';
            } else {
                container.innerHTML = selectableRoles.map(role => {
                    const color = role.color ? `#${role.color.toString(16).padStart(6, '0')}` : 'var(--text-secondary)';
                    return `
                        <div class="form-check">
                            <input type="checkbox" class="form-check-input announce-role-cb" 
                                id="announce-role-${role.id}" value="${role.id}">
                            <label class="form-check-label" for="announce-role-${role.id}" 
                                style="color: ${color}; font-weight: 500;">
                                ${escapeHtml(role.name)}
                            </label>
                        </div>
                    `;
                }).join('');
            }
        } else {
            container.innerHTML = '<span class="text-danger">Fehler beim Laden der Rollen.</span>';
        }
    } catch {
        container.innerHTML = '<span class="text-danger">Netzwerkfehler.</span>';
    }

    const modal = new bootstrap.Modal(document.getElementById('announceModal'));
    modal.show();
}

export async function sendAnnouncement() {
    const eventId = document.getElementById('announce-event-id').value;
    const text = document.getElementById('announce-text').value.trim();
    const pingEveryone = document.getElementById('announce-everyone').checked;

    // Collect selected role IDs
    const roleCheckboxes = document.querySelectorAll('.announce-role-cb:checked');
    const roleIds = Array.from(roleCheckboxes).map(cb => cb.value);

    const btn = document.getElementById('announce-send-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Wird gesendet...';

    try {
        const res = await fetch(`/api/admin/events/${eventId}/announce`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-TOKEN': state.csrfToken
            },
            body: JSON.stringify({ text, roleIds, pingEveryone })
        });
        const data = await res.json();
        if (res.ok) {
            showToast(data.message || 'Angekündigt!', 'success');
            bootstrap.Modal.getInstance(document.getElementById('announceModal')).hide();
        } else {
            showToast(data.error || 'Fehler beim Ankündigen.', 'danger');
        }
    } catch {
        showToast('Netzwerkfehler.', 'danger');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-megaphone me-1"></i>Ankündigen';
    }
}

export async function startEvent(eventId) {
    if (!confirm('Event jetzt starten? Status wird auf "Aktiv" gesetzt und Startzeit aktualisiert (falls leer).')) return;
    try {
        const res = await fetch(`/api/admin/events/${eventId}/start`, {
            method: 'POST',
            headers: { 'X-CSRF-TOKEN': state.csrfToken }
        });
        if (res.ok) {
            showToast('Event gestartet!', 'success');
            loadAdminEvents();
            loadAdminStats();
        } else {
            showToast('Fehler beim Starten.', 'danger');
        }
    } catch {
        showToast('Netzwerkfehler.', 'danger');
    }
}

export async function endEvent(eventId) {
    if (!confirm('Event jetzt beenden? Status wird auf "Archiviert" gesetzt und Endzeit aktualisiert.')) return;
    try {
        const res = await fetch(`/api/admin/events/${eventId}/end`, {
            method: 'POST',
            headers: { 'X-CSRF-TOKEN': state.csrfToken }
        });
        if (res.ok) {
            showToast('Event beendet!', 'success');
            loadAdminEvents();
            loadAdminStats();
        } else {
            showToast('Fehler beim Beenden.', 'danger');
        }
    } catch {
        showToast('Netzwerkfehler.', 'danger');
    }
}

export function exportRegistrations(eventId) {
    window.open(`/api/admin/events/${eventId}/registrations/export`, '_blank');
}

export async function syncDiscordEvent(eventId) {
    if (!confirm('Dieses Event jetzt als geplantes Event in Discord erstellen?')) return;

    try {
        const res = await fetch(`/api/admin/events/${eventId}/sync-discord`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-TOKEN': state.csrfToken
            }
        });

        if (res.ok) {
            showToast('Event erfolgreich in Discord erstellt!', 'success');
            loadAdminEvents(); // Refresh view
        } else {
            const err = await res.json();
            showToast(err.error || 'Fehler beim Synchronisieren.', 'danger');
        }
    } catch (err) {
        showToast('Netzwerkfehler.', 'danger');
    }
}

registerActions({
    deleteEvent: (el) => deleteEvent(el.dataset.eventId),
    deleteEventSeries: (el) => deleteEventSeries(el.dataset.seriesId),
    changeEventStatus: (el) => changeEventStatus(el.dataset.eventId, el.dataset.status),
    announceEvent: (el) => announceEvent(el.dataset.eventId),
    sendAnnouncement: () => sendAnnouncement(),
    startEvent: (el) => startEvent(el.dataset.eventId),
    endEvent: (el) => endEvent(el.dataset.eventId),
    exportRegistrations: (el) => exportRegistrations(el.dataset.eventId),
    duplicateEvent: (el) => duplicateEvent(el.dataset.eventId),
    syncDiscordEvent: (el) => syncDiscordEvent(el.dataset.eventId)
});
