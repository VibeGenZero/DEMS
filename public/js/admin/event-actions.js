/**
 * Admin actions on one event: status, delete, announce, start/end, export,
 * duplicate, Discord entry. Actions that destroy something or show up in
 * Discord ask first, in the DEMS confirm dialog.
 */
import { state } from '../core/state.js';
import { loadAdminEvents, loadAdminStats, switchAdminTab } from './dashboard.js';
import { registerActions } from '../core/actions.js';
import { escapeHtml, showConfirmDialog, showToast } from '../core/ui.js';
import { DISCORD_MODAL_MAX_FIELDS } from '../events/registration-form.js';

// Toast after a status change, by the status the event has now
const STATUS_TOASTS = {
    active: 'Event ist jetzt aktiv.',
    draft: 'Event liegt jetzt in den Entwürfen.',
    archived: 'Event archiviert.'
};

/**
 * Send one admin request; an error ends in a toast with the server's reason.
 *
 * @param {string} method -> HTTP method.
 * @param {string} url -> API path.
 * @param {string} fallbackError -> Shown when the server names no reason.
 * @param {Object} [body] -> JSON body.
 * @returns {Promise<Object|null>} -> The answer, or null after an error.
 */
async function sendAdminAction(method, url, fallbackError, body) {
    try {
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': state.csrfToken },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) return data || {};
        showToast(data.error || fallbackError, 'danger');
    } catch {
        showToast('Netzwerkfehler.', 'danger');
    }
    return null;
}

function refreshAdminEvents() {
    loadAdminEvents();
    loadAdminStats();
}

const quoted = (title) => `„${title || 'Event'}“`;

export async function duplicateEvent(eventId) {
    const data = await sendAdminAction('POST', `/api/admin/events/${eventId}/duplicate`, 'Fehler beim Duplizieren.');
    if (!data) return;
    showToast(`Kopie liegt in den Entwürfen: ${data.title}`, 'success');
    // The copy is a draft, so the table shows that tab
    switchAdminTab('drafts');
    refreshAdminEvents();
}

export async function deleteEvent(eventId, title) {
    if (!await showConfirmDialog(`${quoted(title)} löschen? Alle Anmeldungen werden mitgelöscht.`, 'Löschen')) return;
    if (!await sendAdminAction('DELETE', `/api/admin/events/${eventId}`, 'Fehler beim Löschen.')) return;
    showToast('Event gelöscht.', 'success');
    refreshAdminEvents();
}

/**
 * Delete all dates of a series.
 *
 * @param {string} seriesId -> Id of the series.
 * @param {string} title -> Title of the series, for the question.
 * @param {string|number} count -> Number of its dates over all tabs; unknown values leave the number out.
 * @returns {Promise<void>}
 */
export async function deleteEventSeries(seriesId, title, count) {
    const total = Number(count) || 0;
    let scope = 'Alle Termine und ihre Anmeldungen werden gelöscht.';
    if (total === 1) scope = 'Ihr Termin und seine Anmeldungen werden gelöscht.';
    else if (total > 1) scope = `Alle ${total} Termine und ihre Anmeldungen werden gelöscht.`;
    if (!await showConfirmDialog(`Ganze Serie ${quoted(title)} löschen? ${scope}`, 'Serie löschen')) return;
    const data = await sendAdminAction('DELETE', `/api/admin/events/series/${seriesId}`, 'Fehler beim Löschen der Serie.');
    if (!data) return;
    const deleted = Number(data.deletedCount) || 0;
    showToast(`Serie gelöscht (${deleted} ${deleted === 1 ? 'Termin' : 'Termine'}).`, 'success');
    refreshAdminEvents();
}

export async function changeEventStatus(eventId, status) {
    if (!await sendAdminAction('PUT', `/api/admin/events/${eventId}/status`, 'Fehler beim Ändern des Status.', { status })) return;
    showToast(Object.hasOwn(STATUS_TOASTS, status) ? STATUS_TOASTS[status] : 'Status geändert.', 'success');
    refreshAdminEvents();
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

export async function startEvent(eventId, title) {
    const question = `${quoted(title)} jetzt starten? Das Event wird veröffentlicht, als Start wird jetzt eingetragen.`;
    if (!await showConfirmDialog(question, 'Starten', { danger: false })) return;
    if (!await sendAdminAction('POST', `/api/admin/events/${eventId}/start`, 'Fehler beim Starten.')) return;
    showToast('Event gestartet.', 'success');
    refreshAdminEvents();
}

/**
 * End a running event now.
 *
 * @param {string} eventId -> Event id.
 * @param {string} title -> Title, for the question.
 * @param {boolean} [hasChannels] -> The event has its own Discord channels, which ending deletes.
 * @returns {Promise<void>}
 */
export async function endEvent(eventId, title, hasChannels = false) {
    const channels = hasChannels ? ' Die Event-Channels werden gelöscht.' : '';
    const question = `${quoted(title)} jetzt beenden? Das Event wird archiviert, als Ende wird jetzt eingetragen.${channels}`;
    if (!await showConfirmDialog(question, 'Beenden')) return;
    if (!await sendAdminAction('POST', `/api/admin/events/${eventId}/end`, 'Fehler beim Beenden.')) return;
    showToast('Event beendet.', 'success');
    refreshAdminEvents();
}

export function exportRegistrations(eventId) {
    window.open(`/api/admin/events/${eventId}/registrations/export`, '_blank');
}

export async function syncDiscordEvent(eventId, title) {
    if (!await showConfirmDialog(`${quoted(title)} als geplantes Event in Discord eintragen?`, 'Eintragen', { danger: false })) return;
    if (!await sendAdminAction('POST', `/api/admin/events/${eventId}/sync-discord`, 'Fehler beim Eintragen in Discord.')) return;
    showToast('Event in Discord eingetragen.', 'success');
    loadAdminEvents();
}

registerActions({
    deleteEvent: (el) => deleteEvent(el.dataset.eventId, el.dataset.eventTitle),
    deleteEventSeries: (el) => deleteEventSeries(el.dataset.seriesId, el.dataset.eventTitle, el.dataset.count),
    changeEventStatus: (el) => changeEventStatus(el.dataset.eventId, el.dataset.status),
    announceEvent: (el) => announceEvent(el.dataset.eventId),
    sendAnnouncement: () => sendAnnouncement(),
    startEvent: (el) => startEvent(el.dataset.eventId, el.dataset.eventTitle),
    endEvent: (el) => endEvent(el.dataset.eventId, el.dataset.eventTitle, el.dataset.channels === '1'),
    exportRegistrations: (el) => exportRegistrations(el.dataset.eventId),
    duplicateEvent: (el) => duplicateEvent(el.dataset.eventId),
    syncDiscordEvent: (el) => syncDiscordEvent(el.dataset.eventId, el.dataset.eventTitle)
});
