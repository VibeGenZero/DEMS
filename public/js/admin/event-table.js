/**
 * Markup of the admin event table (#admin): tabs, table, row menu,
 * placeholders and empty states. Pure functions that turn the rows of
 * admin/event-rows.js into HTML; no DOM access. Styles: DATA TABLE and MENU
 * in components.css, ADMIN EVENTS in style.css.
 */
import { emptyState } from '../core/components.js';
import { escapeHtml } from '../core/ui.js';
import { eventStart, relativeDay } from '../events/cards.js';
import { ADMIN_TABS, adminEventActions } from './event-rows.js';

const SKELETON_ROWS = 5;
const UNTITLED = '(ohne Titel)';

const COLUMNS = [
    { key: 'title', label: 'Event' },
    { key: 'date', label: 'Termin' },
    { key: 'places', label: 'Plätze' }
];

const EMPTY_TABS = {
    drafts: { icon: 'file-earmark', title: 'Keine Entwürfe' },
    active: { icon: 'calendar-x', title: 'Keine aktiven Events' },
    archive: { icon: 'archive', title: 'Das Archiv ist leer' }
};

// One entry per action key of adminEventActions(). The action names stand
// literally in the markup, so the guard in frontendCsp.test.js finds them.
// `t` is the escaped target built by actionTarget().
const ACTIONS = {
    registrations: { icon: 'list-check', label: 'Anmeldungen', attributes: (t) => `data-click="showRegistrations" data-event-id="${t.id}" data-event-title="${t.label}"` },
    edit: { icon: 'pencil', label: 'Bearbeiten', attributes: (t) => `data-click="editEvent" data-event-id="${t.id}"` },
    announce: { icon: 'megaphone', label: 'Ankündigen', attributes: (t) => `data-click="announceEvent" data-event-id="${t.id}"` },
    message: { icon: 'chat-text', label: 'Nachricht an Teilnehmer …', attributes: (t) => `data-click="showParticipantMessage" data-event-id="${t.id}" data-event-title="${t.label}"` },
    duplicate: { icon: 'copy', label: 'Duplizieren', attributes: (t) => `data-click="duplicateEvent" data-event-id="${t.id}"` },
    export: { icon: 'download', label: 'CSV-Export', attributes: (t) => `data-click="exportRegistrations" data-event-id="${t.id}"` },
    syncDiscord: { icon: 'discord', label: 'In Discord eintragen …', attributes: (t) => `data-click="syncDiscordEvent" data-event-id="${t.id}" data-event-title="${t.label}"` },
    publish: { icon: 'send', label: 'Veröffentlichen', attributes: (t) => `data-click="changeEventStatus" data-event-id="${t.id}" data-status="active"` },
    reactivate: { icon: 'arrow-counterclockwise', label: 'Wieder aktivieren', attributes: (t) => `data-click="changeEventStatus" data-event-id="${t.id}" data-status="active"` },
    toDraft: { icon: 'file-earmark', label: 'Zurück in Entwürfe', attributes: (t) => `data-click="changeEventStatus" data-event-id="${t.id}" data-status="draft"` },
    archive: { icon: 'archive', label: 'Archivieren', attributes: (t) => `data-click="changeEventStatus" data-event-id="${t.id}" data-status="archived"` },
    start: { icon: 'play-fill', label: 'Jetzt starten …', attributes: (t) => `data-click="startEvent" data-event-id="${t.id}" data-event-title="${t.label}"` },
    end: { icon: 'stop-fill', label: 'Jetzt beenden …', attributes: (t) => `data-click="endEvent" data-event-id="${t.id}" data-event-title="${t.label}" data-channels="${t.channels}"` },
    delete: { icon: 'trash', label: 'Löschen …', attributes: (t) => `data-click="deleteEvent" data-event-id="${t.id}" data-event-title="${t.label}"` },
    deleteDate: { icon: 'trash', label: 'Termin löschen …', attributes: (t) => `data-click="deleteEvent" data-event-id="${t.id}" data-event-title="${t.label}"` },
    deleteSeries: { icon: 'trash', label: 'Ganze Serie löschen …', attributes: (t) => `data-click="deleteEventSeries" data-series-id="${t.seriesId}" data-event-title="${t.title}" data-count="${t.seriesTotal}"` }
};

const formatTime = (date) => date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

// "Mo., 12. Okt."; with the year when it is not the current one
function formatDay(date, now) {
    const options = { weekday: 'short', day: 'numeric', month: 'short' };
    if (date.getFullYear() !== now.getFullYear()) options.year = 'numeric';
    return date.toLocaleDateString('de-DE', options);
}

/**
 * Escaped values of one event for the attributes of its actions.
 *
 * @param {Object} event -> Event.
 * @param {Object|null} series -> `series` of the row when the event is a date of a series.
 * @param {Date} now -> Reference time.
 * @returns {Object} -> `{ id, title, label, channels, seriesId, seriesTotal }`; `label` names the day for a date of a series, because its dates share the title.
 */
function actionTarget(event, series, now) {
    const title = String(event.title ?? '').trim() || UNTITLED;
    const start = eventStart(event);
    const label = series && start ? `${title} · ${formatDay(start, now)}` : title;
    return {
        id: escapeHtml(String(event.id ?? '')),
        title: escapeHtml(title),
        label: escapeHtml(label),
        channels: event.autoCreateChannels ? '1' : '',
        seriesId: series ? escapeHtml(String(series.id)) : '',
        seriesTotal: series ? Number(series.total) || 0 : 0
    };
}

function renderStateChips(event, state) {
    const chips = [];
    if (state === 'past') chips.push('<span class="chip chip-sm">Vorbei</span>');
    if (event.status === 'cancelled') chips.push('<span class="chip chip-sm chip-danger">Abgesagt</span>');
    return chips.join('');
}

function renderEventCell(row, target, isOpen) {
    const { event, state, series } = row;
    const count = series ? series.dates.length : 0;
    const toggle = count > 1
        ? `<button type="button" class="btn btn-sm btn-ghost btn-icon" data-click="toggleAdminSeries" data-series-id="${target.seriesId}" aria-expanded="${isOpen}" aria-label="Termine von „${target.title}“ ${isOpen ? 'zuklappen' : 'aufklappen'}"><i class="bi bi-chevron-${isOpen ? 'down' : 'right'}" aria-hidden="true"></i></button>`
        : '';
    const seriesChip = series
        ? `<span class="chip chip-sm"><i class="bi bi-arrow-repeat" aria-hidden="true"></i>Serie · ${count} ${count === 1 ? 'Termin' : 'Termine'}</span>`
        : '';
    const meta = [
        event.category,
        event.accessMode === 'open' ? 'Offen' : 'Rolle nötig',
        event.approvalMode === 'instant' ? 'Sofort bestätigt' : 'Freigabe durch Admin'
    ].filter(Boolean).map(text => escapeHtml(String(text))).join(' · ');
    return `<td><div class="admin-events-event">${toggle}<div><div class="admin-events-heading"><button type="button" class="data-table-title" data-click="editEvent" data-event-id="${target.id}">${target.title}</button>${seriesChip}${renderStateChips(event, state)}</div><div class="data-table-meta">${meta}</div></div></div></td>`;
}

function renderDateCell(event, state, now) {
    const start = eventStart(event);
    if (!start) return '<td><span class="data-table-meta">Kein Termin</span></td>';
    if (state === 'running') {
        return `<td><span class="chip chip-sm chip-danger"><i class="bi bi-broadcast" aria-hidden="true"></i>Läuft gerade</span><div class="data-table-meta">seit ${formatTime(start)}</div></td>`;
    }
    return `<td><div>${formatDay(start, now)} · ${formatTime(start)}</div><div class="data-table-meta">${relativeDay(start, now)}</div></td>`;
}

function renderPlacesCell(event, pendingElsewhere = 0) {
    const places = event.places;
    // An answer of an older server or a broken event must not take the table down
    if (!places || typeof places.text !== 'string') return '<td><span class="data-table-meta">–</span></td>';
    const capacity = Math.max(0, Math.floor(Number(places.capacity) || 0));
    const taken = Math.max(0, Math.floor(Number(places.taken) || 0));
    const sentence = escapeHtml(places.text);
    const bar = capacity > 0
        ? `<div class="capacity${taken >= capacity ? ' is-full' : ''}"><progress class="capacity-meter" max="${capacity}" value="${Math.min(taken, capacity)}" aria-label="${sentence}"></progress></div>`
        : '';
    const waitlist = places.waitlistText ? `<div class="data-table-meta">${escapeHtml(String(places.waitlistText))}</div>` : '';
    const elsewhere = pendingElsewhere > 0
        ? `<div class="admin-events-pending">${pendingElsewhere} ${pendingElsewhere === 1 ? 'Anfrage' : 'Anfragen'} offen in weiteren Terminen</div>`
        : '';
    return `<td><div class="admin-events-places">${bar}<div>${sentence}</div>${waitlist}${elsewhere}</div></td>`;
}

function renderActionButton(key, target, className, iconSpace, suffix = '') {
    const action = ACTIONS[key];
    return `<button type="button" class="${className}" ${action.attributes(target)}><i class="bi bi-${action.icon} ${iconSpace}" aria-hidden="true"></i>${action.label}${suffix}</button>`;
}

function renderActionsCell(event, state, target, options) {
    const actions = adminEventActions(event, state, options);
    const pending = actions.main === 'registrations' ? Math.max(0, Math.floor(Number(event.places?.pending) || 0)) : 0;
    const main = renderActionButton(actions.main, target, `btn btn-sm ${pending > 0 ? 'btn-primary' : 'btn-secondary'}`, 'me-1', pending > 0 ? ` · ${pending} offen` : '');
    const item = (key, tone = '') => `<li>${renderActionButton(key, target, `dropdown-item${tone}`, 'me-2')}</li>`;
    const menu = [
        ...actions.general.map(key => item(key)),
        '<li><hr class="dropdown-divider"></li>',
        '<li><h6 class="dropdown-header">Status</h6></li>',
        ...actions.status.map(key => item(key)),
        '<li><hr class="dropdown-divider"></li>',
        ...actions.danger.map(key => item(key, ' is-danger'))
    ].join('');
    return `<td class="data-table-actions"><div class="data-table-buttons">${main}<div class="dropdown"><button type="button" class="btn btn-sm btn-ghost btn-icon" data-bs-toggle="dropdown" aria-expanded="false" aria-label="Weitere Aktionen für „${target.label}“"><i class="bi bi-three-dots" aria-hidden="true"></i></button><ul class="dropdown-menu dropdown-menu-end">${menu}</ul></div></div></td>`;
}

function renderSubRow(date, series, now) {
    const { event, state, position } = date;
    const target = actionTarget(event, series, now);
    return `<tr class="is-sub${state === 'past' ? ' is-muted' : ''}"><td><div class="admin-events-heading"><span>Termin ${position} von ${series.total}</span>${renderStateChips(event, state)}</div></td>${renderDateCell(event, state, now)}${renderPlacesCell(event)}${renderActionsCell(event, state, target, { inSeries: true })}</tr>`;
}

function renderRow(row, { expanded, now }) {
    const { event, state, series } = row;
    const target = actionTarget(event, series, now);
    const isOpen = !!series && series.dates.length > 1 && expanded.includes(series.id);
    const main = `<tr${state === 'past' ? ' class="is-muted"' : ''}>${renderEventCell(row, target, isOpen)}${renderDateCell(event, state, now)}${renderPlacesCell(event, series ? series.pendingElsewhere : 0)}${renderActionsCell(event, state, target, { inSeries: !!series, seriesRow: !!series })}</tr>`;
    return isOpen ? main + series.dates.map(date => renderSubRow(date, series, now)).join('') : main;
}

/**
 * Tabs above the table.
 *
 * @param {Object|null} counts -> Rows per tab (`{ drafts, active, archive }`); null while the list loads, then the tabs show no number.
 * @param {string} activeTab -> Id of the open tab.
 * @returns {string} -> `<li>` elements for a .nav.nav-pills list.
 */
export function renderAdminTabs(counts, activeTab) {
    return ADMIN_TABS.map(({ id, label }) => {
        const active = id === activeTab;
        const counter = counts ? ` <span class="chip chip-sm">${Number(counts[id]) || 0}</span>` : '';
        return `<li class="nav-item" role="presentation"><button type="button" class="nav-link${active ? ' active' : ''}" role="tab" aria-selected="${active}" data-click="switchAdminTab" data-tab="${id}">${label}${counter}</button></li>`;
    }).join('');
}

/**
 * The event table of one tab.
 *
 * @param {Array<Object>} rows -> Result of buildAdminRows(); at least one row.
 * @param {Object} options -> `{ sort, expanded, now }`: sorting shown in the heads, ids of the opened series, reference time.
 * @returns {string} -> HTML of a .data-table.
 */
export function renderAdminTable(rows, { sort, expanded = [], now }) {
    const heads = COLUMNS.map(({ key, label }) => {
        const descending = sort.direction === 'desc';
        const active = sort.key === key;
        const ariaSort = active ? (descending ? 'descending' : 'ascending') : 'none';
        const icon = active ? (descending ? 'arrow-down' : 'arrow-up') : 'arrow-down-up';
        return `<th scope="col" aria-sort="${ariaSort}"><button type="button" class="data-table-sort" data-click="sortAdminEvents" data-sort="${key}">${label}<i class="bi bi-${icon}" aria-hidden="true"></i></button></th>`;
    }).join('');
    return `<table class="data-table admin-events-table"><thead><tr>${heads}<th scope="col" class="data-table-actions">Aktionen</th></tr></thead><tbody>${rows.map(row => renderRow(row, { expanded, now })).join('')}</tbody></table>`;
}

/**
 * Placeholder rows while the list loads for the first time.
 *
 * @returns {string} -> HTML of a table without content.
 */
export function renderAdminTableSkeleton() {
    const cell = '<td><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text is-short"></div></td>';
    const row = `<tr>${cell}${cell}${cell}<td class="data-table-actions"><div class="skeleton skeleton-chip"></div></td></tr>`;
    return `<table class="data-table admin-events-table" aria-hidden="true"><tbody>${row.repeat(SKELETON_ROWS)}</tbody></table>`;
}

/**
 * What a tab shows without rows.
 *
 * @param {Object} options -> `{ tab, search, counts }`; `counts` are the rows per tab after the search.
 * @returns {string} -> Empty state; after a search it tells where the hits are and offers to reset it.
 */
export function renderAdminEmpty({ tab, search = '', counts = {} }) {
    const needle = String(search ?? '').trim();
    if (!needle) return emptyState(Object.hasOwn(EMPTY_TABS, tab) ? EMPTY_TABS[tab] : EMPTY_TABS.active);
    const elsewhere = ADMIN_TABS.filter(({ id }) => id !== tab && counts[id] > 0).map(({ id, label }) => `${label} ${counts[id]}`);
    const text = elsewhere.length
        ? `Für „${needle}“ gibt es hier nichts. Treffer in anderen Tabs: ${elsewhere.join(' · ')}`
        : `Für „${needle}“ gibt es in keinem Tab ein Event.`;
    return emptyState({
        icon: 'search',
        title: 'Keine Treffer',
        text,
        action: '<button type="button" class="btn btn-secondary btn-sm" data-click="resetAdminSearch">Suche zurücksetzen</button>'
    });
}

/**
 * Shown when the list could not be loaded.
 *
 * @returns {string} -> Empty state with a retry button.
 */
export function renderAdminLoadError() {
    return emptyState({
        icon: 'exclamation-triangle',
        title: 'Events konnten nicht geladen werden',
        action: '<button type="button" class="btn btn-secondary btn-sm" data-click="reloadAdminEvents">Erneut versuchen</button>'
    });
}
