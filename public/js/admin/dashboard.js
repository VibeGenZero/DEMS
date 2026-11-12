/**
 * Admin area: stats, event table, audit log, system reset.
 */
import { state } from '../core/state.js';
import { registerActions } from '../core/actions.js';
import { animateFromTo, countUpAll } from '../core/motion.js';
import { glideTabs } from '../core/tab-glider.js';
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

// Chip of an audit log action: created green, changed blue, removed red; any other action stays plain
const AUDIT_CHIPS = {
    CREATE_EVENT: 'chip-success', UPDATE_EVENT: 'chip-info', DELETE_EVENT: 'chip-danger',
    CANCEL_EVENT: 'chip-warning', DUPLICATE_EVENT: 'chip-accent', GENERATE_CHECKIN: 'chip-info',
    UPDATE_REGISTRATION_STATUS: 'chip-accent', ANNOUNCE_EVENT: 'chip-accent',
    CHECKIN_REGISTRATION: 'chip-success', ADD_REGISTRATION: 'chip-success', UNDO_CHECKIN_REGISTRATION: 'chip-warning',
    UPDATE_EVENT_STATUS: 'chip-warning', UPDATE_TEMPLATES: 'chip-info', NOTIFY_EVENT_CHANGE: 'chip-info'
};

export async function showAdminSection() {
    const section = document.getElementById('admin-section');
    section.style.display = 'block';
    await Promise.all([loadAdminStats(), loadAdminEvents()]);
}

/**
 * Tiles of the admin stats, in display order. `tone` colours the icon of a
 * registration status like its badges (empty = accent).
 *
 * @param {Object} stats -> Answer of GET /api/admin/stats.
 * @returns {{ icon: string, value: number, label: string, tone: string }[]}
 */
export function adminStatTiles(stats) {
    const events = stats.events || {};
    const registrations = stats.registrations || {};
    return [
        { icon: 'calendar-event', value: events.total, label: 'Events gesamt', tone: '' },
        { icon: 'play-circle', value: events.active, label: 'Aktive Events', tone: '' },
        { icon: 'people', value: registrations.total, label: 'Registrierungen', tone: '' },
        { icon: 'hourglass-split', value: registrations.pending, label: 'Ausstehend', tone: 'warning' },
        { icon: 'check-circle', value: registrations.accepted, label: 'Angenommen', tone: 'success' },
        { icon: 'list-nested', value: registrations.waitlisted, label: 'Warteliste', tone: 'info' },
        { icon: 'question-circle', value: registrations.tentative, label: 'Ersatzbank', tone: 'muted' }
    ].map(tile => ({ ...tile, value: Number(tile.value) || 0 }));
}

/**
 * One compact stat tile: icon on the left, value and label next to it.
 *
 * @param {{ icon: string, value: number, label: string, tone: string }} tile
 * @returns {string} -> Markup.
 */
function statTile({ icon, value, label, tone }) {
    const toneClass = tone ? ` is-${tone}` : '';
    return `
      <div class="stat-card${toneClass}">
        <div class="stat-icon"><i class="bi bi-${icon}" aria-hidden="true"></i></div>
        <div class="stat-body">
          <div class="stat-value">${value}</div>
          <div class="stat-label">${escapeHtml(label)}</div>
        </div>
      </div>`;
}

export async function loadAdminStats() {
    const container = document.getElementById('admin-stats');
    try {
        const res = await fetch('/api/admin/stats');
        const stats = await res.json();

        container.innerHTML = adminStatTiles(stats).map(statTile).join('');

        animateFromTo('.stat-card', { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, stagger: 0.05, ease: 'power3.out' });
        countUpAll(container.querySelectorAll('.stat-value'));
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
    glideTabs(document.getElementById('admin-events-tabs'));
    document.getElementById('admin-events-table').innerHTML = rows.length
        ? renderAdminTable(rows, { sort, expanded, now })
        : renderAdminEmpty({ tab, search, counts });
}

export async function loadAdminEvents() {
    const table = document.getElementById('admin-events-table');
    // Placeholders only before the first answer: after an action the old table stays until the new one is there
    if (!adminView.events) {
        document.getElementById('admin-events-tabs').innerHTML = renderAdminTabs(null, adminView.tab);
        glideTabs(document.getElementById('admin-events-tabs'));
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

        let html = `<div class="table-responsive"><table class="table table-sm table-hover">
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
            const chip = Object.hasOwn(AUDIT_CHIPS, log.action) ? ` ${AUDIT_CHIPS[log.action]}` : '';
            html += `<tr>
                <td class="text-muted small">${date}</td>
                <td><span class="chip chip-sm${chip}">${escapeHtml(String(log.action ?? ''))}</span></td>
                <td class="small">${escapeHtml(log.details || '')}</td>
                <td class="text-muted small font-monospace">${log.adminId === 'system' ? 'System' : `${(log.adminId || '').substring(0, 8)}…`}</td>
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
