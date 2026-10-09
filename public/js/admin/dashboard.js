/**
 * Admin area: stats, event cards, audit log, system reset.
 */
import { state } from '../core/state.js';
import { reminderHoursOf } from './wizard.js';
import { escapeHtml, inlineArg, isValidBannerUrl, markdownPreview, renderSkeletonEvents, showToast } from '../core/ui.js';

export async function showAdminSection() {
    const section = document.getElementById('admin-section');
    section.style.display = 'block';
    await Promise.all([loadAdminStats(), loadAdminEvents()]);
}

export async function loadAdminStats() {
    const container = document.getElementById('admin-stats');
    try {
        const res = await fetch('/api/admin/stats');
        const stats = await res.json();

        container.innerHTML = `
      <div class="stat-card">
        <div class="stat-icon"><i class="bi bi-calendar-event"></i></div>
        <div class="stat-value">${stats.events.total}</div>
        <div class="stat-label">Events Gesamt</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon"><i class="bi bi-play-circle"></i></div>
        <div class="stat-value">${stats.events.active}</div>
        <div class="stat-label">Aktive Events</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon"><i class="bi bi-people"></i></div>
        <div class="stat-value">${stats.registrations.total}</div>
        <div class="stat-label">Registrierungen</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon"><i class="bi bi-hourglass-split"></i></div>
        <div class="stat-value">${stats.registrations.pending}</div>
        <div class="stat-label">Ausstehend</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon"><i class="bi bi-check-circle"></i></div>
        <div class="stat-value">${stats.registrations.accepted}</div>
        <div class="stat-label">Angenommen</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon"><i class="bi bi-list-nested"></i></div>
        <div class="stat-value">${stats.registrations.waitlisted}</div>
        <div class="stat-label">Warteliste</div>
      </div>
    `;

        gsap.fromTo('.stat-card',
            { y: 20, opacity: 0 },
            { y: 0, opacity: 1, duration: 0.3, stagger: 0.05, ease: 'power3.out' }
        );
    } catch {
        container.innerHTML = '<div class="text-muted text-center py-3">Statistiken konnten nicht geladen werden.</div>';
    }
}

export async function loadAdminEvents() {
    const grid = document.getElementById('admin-events-grid');
    renderSkeletonEvents(grid, 4, true);

    try {
        const res = await fetch('/api/admin/all-events');
        const events = await res.json();

        if (!events.length) {
            grid.innerHTML = '<div class="col-12 text-center py-5"><p class="text-muted">Noch keine Events erstellt.</p></div>';
            return;
        }

        const statusMap = { active: 'Aktiv', draft: 'Entwurf', archived: 'Archiviert' };

        // Group events by seriesId for admin view
        const seriesGroups = {};
        const standaloneEvents = [];
        for (const event of events) {
            if (event.seriesId) {
                if (!seriesGroups[event.seriesId]) seriesGroups[event.seriesId] = [];
                seriesGroups[event.seriesId].push(event);
            } else {
                standaloneEvents.push(event);
            }
        }

        // Convert series groups to grouped entries
        const groupedEvents = [...standaloneEvents];
        for (const [seriesId, seriesEvents] of Object.entries(seriesGroups)) {
            seriesEvents.sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
            // Use first event as representative, attach all events
            const rep = { ...seriesEvents[0], _seriesEvents: seriesEvents, _seriesId: seriesId };
            groupedEvents.push(rep);
        }
        // Sort by createdAt desc (admin view)
        groupedEvents.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

        grid.innerHTML = groupedEvents.map(event => {
            const status = event.status || 'active';
            const bannerHtml = isValidBannerUrl(event.bannerUrl)
                ? `<img src="${escapeHtml(event.bannerUrl)}" class="event-banner" alt="Banner" style="border-radius: var(--radius-lg) var(--radius-lg) 0 0;">`
                : '';

            // Series group card
            if (event._seriesEvents) {
                const seriesEvents = event._seriesEvents;
                const datesHtml = seriesEvents.map(se => {
                    const dateStr = se.startDate ? new Date(se.startDate).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
                    const seStatus = se.status || 'active';
                    return `
                      <div class="series-admin-date-item d-flex justify-content-between align-items-center">
                        <span><i class="bi bi-calendar-event me-2"></i>${dateStr}</span>
                        <div class="d-flex gap-1">
                          <span class="event-status-badge event-status-${seStatus}" style="font-size:0.7rem;">${statusMap[seStatus] || seStatus}</span>
                          <button class="btn btn-sm btn-outline-light py-0 px-1" onclick="editEvent('${se.id}')" title="Bearbeiten"><i class="bi bi-pencil"></i></button>
                          <button class="btn btn-sm btn-outline-light py-0 px-1" onclick="showRegistrations('${se.id}', ${inlineArg(se.title)})"><i class="bi bi-list-check"></i></button>
                        </div>
                      </div>`;
                }).join('');

                return `
            <div class="col-md-6">
              <div class="glass-card admin-event-card series-admin-card">
                ${bannerHtml}
                <div class="p-4">
                  <div class="d-flex justify-content-between align-items-start mb-2">
                    <h5 class="mb-0">${escapeHtml(event.title)}</h5>
                    <div class="d-flex gap-2 align-items-center">
                      <span class="series-badge"><i class="bi bi-arrow-repeat me-1"></i>Serie (${seriesEvents.length})</span>
                    </div>
                  </div>
                  <p class="text-secondary small mb-2">${escapeHtml(markdownPreview(event.description))}</p>
                  ${event.category ? `<span class="event-category-tag mb-2 d-inline-block">${escapeHtml(event.category)}</span>` : ''}
                  <div class="series-dates-list mt-2 mb-3">
                    <div class="series-dates-header"><i class="bi bi-list-ul me-1"></i>Termine</div>
                    ${datesHtml}
                  </div>
                  <div class="admin-actions">
                    <button class="btn btn-sm btn-outline-danger" onclick="deleteEventSeries('${event._seriesId}')">
                      <i class="bi bi-trash me-1"></i>Ganze Serie löschen
                    </button>
                  </div>
                </div>
              </div>
            </div>`;
            }

            return `
        <div class="col-md-6">
          <div class="glass-card admin-event-card">
            ${bannerHtml}
            <div class="p-4">
              <div class="d-flex justify-content-between align-items-start mb-2">
                <h5 class="mb-0">${escapeHtml(event.title)}</h5>
                <span class="event-status-badge event-status-${status}">${statusMap[status] || status}</span>
              </div>
              <p class="text-secondary small mb-2">${escapeHtml(markdownPreview(event.description))}</p>
              ${event.category ? `<span class="event-category-tag mb-2 d-inline-block">${escapeHtml(event.category)}</span>` : ''}
              ${event.startDate ? `<div class="event-date-info mb-2"><i class="bi bi-calendar3"></i>${new Date(event.startDate).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>` : ''}
              <div class="d-flex flex-wrap gap-2 mb-3">
                <span class="badge-pill"><i class="bi bi-${event.accessMode === 'open' ? 'unlock' : 'lock'}"></i>${event.accessMode === 'open' ? 'Offen' : 'Rollen'}</span>
                <span class="badge-pill"><i class="bi bi-${event.approvalMode === 'instant' ? 'lightning' : 'hourglass-split'}"></i>${event.approvalMode === 'instant' ? 'Instant' : 'Manuell'}</span>
                ${event.maxParticipants > 0 ? `<span class="badge-pill"><i class="bi bi-people"></i>Max ${event.maxParticipants}</span>` : ''}
                <span class="badge-pill"><i class="bi bi-ui-checks"></i>${(event.formFields || []).length} Felder</span>
                ${reminderHoursOf(event.reminderHours).length ? `<span class="badge-pill"><i class="bi bi-bell"></i>${reminderHoursOf(event.reminderHours).map(hours => `${hours}h`).join(' · ')}</span>` : ''}
              </div>
              <div class="admin-actions">
                <button class="btn btn-sm btn-outline-light" onclick="showRegistrations('${event.id}', ${inlineArg(event.title)})">
                  <i class="bi bi-list-check me-1"></i>Anmeldungen
                </button>
                <button class="btn btn-sm btn-outline-light" onclick="exportRegistrations('${event.id}')">
                  <i class="bi bi-download me-1"></i>CSV
                </button>
                <button class="btn btn-sm btn-outline-light" onclick="announceEvent('${event.id}')">
                  <i class="bi bi-megaphone me-1"></i>Ankündigen
                </button>
                <button class="btn btn-sm btn-outline-light" onclick="duplicateEvent('${event.id}')">
                  <i class="bi bi-copy me-1"></i>Duplizieren
                </button>
                <button class="btn btn-sm btn-outline-light" onclick="editEvent('${event.id}')">
                  <i class="bi bi-pencil me-1"></i>Bearbeiten
                </button>
                ${!event.discordScheduledEventId ? `
                <button class="btn btn-sm btn-outline-primary" onclick="syncDiscordEvent('${event.id}')" title="Als geplantes Event in Discord erstellen">
                  <i class="bi bi-discord me-1"></i>Sync
                </button>
                ` : ''}
                <div class="dropdown d-inline-block status-dropdown">
                  <button class="btn btn-sm btn-outline-light dropdown-toggle" data-bs-toggle="dropdown">
                    <i class="bi bi-toggle-on me-1"></i>Status
                  </button>
                  <ul class="dropdown-menu">
                    <li><a class="dropdown-item" href="#" onclick="changeEventStatus('${event.id}', 'active'); return false;">✅ Aktiv</a></li>
                    <li><a class="dropdown-item" href="#" onclick="changeEventStatus('${event.id}', 'draft'); return false;">📝 Entwurf</a></li>
                    <li><a class="dropdown-item" href="#" onclick="changeEventStatus('${event.id}', 'archived'); return false;">📦 Archiviert</a></li>
                  </ul>
                </div>
                ${event.status === 'draft' ? `
                <button class="btn btn-sm btn-outline-success" onclick="startEvent('${event.id}')" title="Event starten (Status Aktiv + Startzeit jetzt)">
                  <i class="bi bi-play-fill"></i>
                </button>
                ` : ''}
                ${event.status === 'active' ? `
                <button class="btn btn-sm btn-outline-warning" onclick="endEvent('${event.id}')" title="Event beenden (Status Archiviert + Endzeit jetzt)">
                  <i class="bi bi-stop-fill"></i>
                </button>
                ` : ''}
                <button class="btn btn-sm btn-outline-danger" onclick="deleteEvent('${event.id}')">
                  <i class="bi bi-trash me-1"></i>Löschen
                </button>
              </div>
            </div>
          </div>
        </div>
      `;
        }).join('');

        // Handle image error fallbacks for admin cards
        grid.querySelectorAll('.event-banner').forEach(img => {
            img.addEventListener('error', () => { img.style.display = 'none'; });
        });

        gsap.fromTo('.admin-event-card',
            { y: 20, opacity: 0 },
            { y: 0, opacity: 1, duration: 0.3, stagger: 0.06, ease: 'power3.out' }
        );
    } catch {
        grid.innerHTML = '<div class="col-12"><div class="alert alert-danger">Fehler beim Laden.</div></div>';
    }
}

export async function loadAuditLog() {
    const container = document.getElementById('audit-log-container');
    const entries = document.getElementById('audit-log-entries');
    container.style.display = 'block';
    entries.innerHTML = '<div class="text-center py-3"><span class="spinner-border spinner-border-sm"></span> Laden...</div>';

    try {
        const res = await fetch('/api/admin/audit-log?limit=100');
        const data = await res.json();

        if (!data.data || data.data.length === 0) {
            entries.innerHTML = '<p class="text-muted text-center">Keine Log-Einträge vorhanden.</p>';
            return;
        }

        const actionColors = {
            CREATE_EVENT: '#22c55e', UPDATE_EVENT: '#3b82f6', DELETE_EVENT: '#ef4444',
            CANCEL_EVENT: '#f59e0b', DUPLICATE_EVENT: '#8b5cf6', GENERATE_CHECKIN: '#06b6d4',
            UPDATE_REGISTRATION_STATUS: '#6366f1', ANNOUNCE_EVENT: '#ec4899',
            UPDATE_EVENT_STATUS: '#f97316', UPDATE_TEMPLATES: '#14b8a6',
            EXPORT_REGISTRATIONS: '#6b7280'
        };

        let html = `<div class="table-responsive"><table class="table table-sm table-dark table-hover" style="background:transparent;">
            <thead><tr>
                <th>Zeitpunkt</th>
                <th>Aktion</th>
                <th>Details</th>
                <th>Admin</th>
            </tr></thead><tbody>`;

        data.data.forEach(log => {
            const date = new Date(log.timestamp).toLocaleString('de-DE', {
                day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
            });
            const color = actionColors[log.action] || '#9ca3af';
            html += `<tr>
                <td class="text-muted small">${date}</td>
                <td><span class="badge" style="background:${color};font-size:0.7rem;">${log.action}</span></td>
                <td class="small">${escapeHtml(log.details || '')}</td>
                <td class="text-muted small font-monospace">${(log.adminId || '').substring(0, 8)}…</td>
            </tr>`;
        });

        html += '</tbody></table></div>';
        if (data.meta.totalPages > 1) {
            html += `<p class="text-muted small text-center">Zeige ${data.data.length} von ${data.meta.total} Einträgen</p>`;
        }
        entries.innerHTML = html;

        // Scroll to audit log
        container.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch {
        entries.innerHTML = '<p class="text-danger">Fehler beim Laden der Logs.</p>';
    }
}

export function showResetModal() {
    document.getElementById('reset-password').value = '';
    const modal = new bootstrap.Modal(document.getElementById('resetModal'));
    modal.show();
}

export async function performSystemReset() {
    const password = document.getElementById('reset-password').value;
    if (!password) {
        showToast('Bitte Passwort eingeben.', 'warning');
        return;
    }

    const targets = [];
    if (document.getElementById('reset-events').checked) targets.push('events');
    if (document.getElementById('reset-registrations').checked) targets.push('registrations');
    if (document.getElementById('reset-comments').checked) targets.push('comments');
    if (document.getElementById('reset-auditLogs').checked) targets.push('auditLogs');
    if (document.getElementById('reset-polls').checked) targets.push('polls', 'pollVotes');
    if (document.getElementById('reset-users').checked) targets.push('users');

    if (targets.length === 0) {
        showToast('Keine Bereiche ausgewählt.', 'warning');
        return;
    }

    if (!confirm(`Bist du sicher? Dies löscht ${targets.length} Bereiche UNWIDERRUFLICH!`)) return;

    try {
        const res = await fetch('/api/admin/reset', {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-TOKEN': state.csrfToken
            },
            body: JSON.stringify({ password, targets })
        });
        const data = await res.json();

        if (res.ok) {
            showToast(`Reset erfolgreich! ${data.count} Dokumente gelöscht.`, 'success');
            setTimeout(() => window.location.reload(), 2000);
        } else {
            showToast(data.error || 'Reset fehlgeschlagen.', 'danger');
        }
    } catch (err) {
        showToast('Netzwerkfehler beim Reset.', 'danger');
    }
}

// Temporary bridge for inline handlers; D-01 replaces them with data-click and removes it
Object.assign(window, { loadAuditLog, showResetModal, performSystemReset });
