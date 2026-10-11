/**
 * Admin area: stats, event table, audit log, system reset.
 */
import { state } from '../core/state.js';
import { registerActions } from '../core/actions.js';
import { escapeHtml, showToast } from '../core/ui.js';
import { ADMIN_SORT_KEYS, ADMIN_TABS, DEFAULT_ADMIN_SORT, adminTabCounts, buildAdminRows } from './event-rows.js';
import { renderAdminEmpty, renderAdminLoadError, renderAdminTable, renderAdminTableSkeleton, renderAdminTabs } from './event-table.js';

/**
 * What the admin looks at in the event table. It lives as long as the page:
 * reloading the list after an action keeps tab, search, sorting and the
 * opened series.
 */
export const adminView = {
    // null until GET /api/admin/all-events has answered once
    events: null,
    tab: 'active',
    search: '',
    // Sorting per tab; a tab without an entry uses DEFAULT_ADMIN_SORT
    sorts: {},
    // Ids of the opened series
    expanded: []
};

const sortOfTab = (tab) => adminView.sorts[tab] || DEFAULT_ADMIN_SORT[tab];

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

/**
 * Render tabs and table from adminView. Does nothing before the first answer.
 *
 * @param {Date} [now] -> Reference time for "Läuft gerade", "Vorbei" and the distance of a date.
 * @returns {void}
 */
export function renderAdminEvents(now = new Date()) {
    if (!adminView.events) return;
    const { events, tab, search, expanded } = adminView;
    const counts = adminTabCounts(events, search, now);
    const sort = sortOfTab(tab);
    const rows = buildAdminRows(events, { tab, search, sort, now });
    document.getElementById('admin-events-tabs').innerHTML = renderAdminTabs(counts, tab);
    document.getElementById('admin-events-table').innerHTML = rows.length
        ? renderAdminTable(rows, { sort, expanded, now })
        : renderAdminEmpty({ tab, search, counts });
}

export async function loadAdminEvents() {
    const table = document.getElementById('admin-events-table');
    // Placeholders only before the first answer: after an action the old table stays until the new one is there
    if (!adminView.events) {
        document.getElementById('admin-events-tabs').innerHTML = renderAdminTabs(null, adminView.tab);
        table.innerHTML = renderAdminTableSkeleton();
    }
    try {
        const res = await fetch('/api/admin/all-events');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const events = await res.json();
        adminView.events = Array.isArray(events) ? events : [];
        renderAdminEvents();
    } catch {
        adminView.events = null;
        table.innerHTML = renderAdminLoadError();
    }
}

export function switchAdminTab(tab) {
    if (!ADMIN_TABS.some(entry => entry.id === tab)) return;
    adminView.tab = tab;
    renderAdminEvents();
}

export function searchAdminEvents(text) {
    adminView.search = String(text ?? '');
    renderAdminEvents();
}

export function resetAdminSearch() {
    document.getElementById('admin-events-search').value = '';
    searchAdminEvents('');
}

/**
 * Sort the open tab by a column; the same column again turns the direction.
 *
 * @param {string} key -> One of ADMIN_SORT_KEYS; anything else is ignored.
 * @returns {void}
 */
export function sortAdminEvents(key) {
    if (!ADMIN_SORT_KEYS.includes(key)) return;
    const current = sortOfTab(adminView.tab);
    adminView.sorts[adminView.tab] = { key, direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc' };
    renderAdminEvents();
}

export function toggleAdminSeries(seriesId) {
    adminView.expanded = adminView.expanded.includes(seriesId)
        ? adminView.expanded.filter(id => id !== seriesId)
        : [...adminView.expanded, seriesId];
    renderAdminEvents();
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

registerActions({
    loadAuditLog: () => loadAuditLog(),
    showResetModal: () => showResetModal(),
    performSystemReset: () => performSystemReset(),
    reloadAdminEvents: () => loadAdminEvents(),
    switchAdminTab: (el) => switchAdminTab(el.dataset.tab),
    searchAdminEvents: (el) => searchAdminEvents(el.value),
    resetAdminSearch: () => resetAdminSearch(),
    sortAdminEvents: (el) => sortAdminEvents(el.dataset.sort),
    toggleAdminSeries: (el) => toggleAdminSeries(el.dataset.seriesId)
});
