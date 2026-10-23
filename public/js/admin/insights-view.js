/**
 * Markup and table rules of the evaluations page (#insights, W-14). Pure
 * functions that turn GET /api/admin/insights into HTML; no DOM access. The
 * numbers are computed on the server (utils/insights.js); here they are only
 * formatted and sorted. Styles: DATA TABLE and CAPACITY in components.css,
 * STATS CARDS and INSIGHTS in style.css.
 */
import { emptyState } from '../core/components.js';
import { escapeHtml } from '../core/ui.js';

const DASH = '–';

/** Range buttons in display order; the key is the `range` of the API. */
export const INSIGHT_RANGES = [
    { key: '30', label: '30 Tage' },
    { key: '90', label: '90 Tage' },
    { key: '365', label: '12 Monate' },
    { key: 'all', label: 'Alles' }
];

const COLUMNS = [
    { key: 'date', label: 'Datum' },
    { key: 'title', label: 'Event' },
    { key: 'accepted', label: 'Angenommen' },
    { key: 'checkedIn', label: 'Check-ins' },
    { key: 'noShows', label: 'No-Shows' },
    { key: 'attendanceRate', label: 'Quote' },
    { key: 'occupancyRate', label: 'Auslastung' }
];

export const INSIGHT_SORT_KEYS = COLUMNS.map(column => column.key);
export const DEFAULT_INSIGHT_SORT = { key: 'date', direction: 'desc' };

/**
 * A rate for the page.
 *
 * @param {number|null} value -> Whole percent or null.
 * @returns {string} -> "67 %" or a dash.
 */
export function formatRate(value) {
    return typeof value === 'number' && Number.isFinite(value) ? `${value} %` : DASH;
}

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const decimal = (value) => Number(value || 0).toLocaleString('de-DE', { maximumFractionDigits: 1 });

function startTime(row) {
    const time = row.startDate ? new Date(row.startDate).getTime() : NaN;
    return Number.isNaN(time) ? -Infinity : time;
}

// Value of a sort column; null means "no value" and always goes last
function sortValue(row, key) {
    if (key === 'date') return startTime(row);
    if (key === 'title') return String(row.title || '');
    // Untracked events have no check-in number either
    if (key === 'checkedIn' && row.noShows === null) return null;
    const value = row[key];
    return typeof value === 'number' ? value : null;
}

/**
 * Event rows in the chosen order.
 *
 * @param {Array<Object>} rows -> `events` of the API; the array is not changed.
 * @param {{ key: string, direction: 'asc'|'desc' }} sort -> Column and direction.
 * @returns {Array<Object>} -> New array; empty values last in both directions, ties newest first.
 */
export function sortInsightEvents(rows, sort) {
    const key = INSIGHT_SORT_KEYS.includes(sort && sort.key) ? sort.key : DEFAULT_INSIGHT_SORT.key;
    const factor = sort && sort.direction === 'asc' ? 1 : -1;
    return rows.slice().sort((a, b) => {
        const valueA = sortValue(a, key);
        const valueB = sortValue(b, key);
        if (valueA === null || valueB === null) {
            if (valueA !== valueB) return valueA === null ? 1 : -1;
        } else {
            const order = key === 'title'
                ? valueA.localeCompare(valueB, 'de', { sensitivity: 'base' })
                : (valueA === valueB ? 0 : (valueA < valueB ? -1 : 1));
            if (order) return factor * order;
        }
        return startTime(b) - startTime(a);
    });
}

/**
 * Sorting after a click on a column head.
 *
 * @param {{ key: string, direction: string }} current -> Sorting shown now.
 * @param {string} key -> Clicked column.
 * @returns {{ key: string, direction: 'asc'|'desc' }} -> The same column flips; a new one starts A–Z for the title, highest/newest first otherwise.
 */
export function nextInsightSort(current, key) {
    if (current && current.key === key) return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
    return { key, direction: key === 'title' ? 'asc' : 'desc' };
}

/**
 * Range buttons.
 *
 * @param {string} active -> Chosen range key.
 * @returns {string} -> `<li>` elements for a .nav.nav-pills list.
 */
export function renderInsightRanges(active) {
    return INSIGHT_RANGES.map(({ key, label }) => {
        const isActive = key === active;
        return `<li class="nav-item" role="presentation"><button type="button" class="nav-link${isActive ? ' active' : ''}" role="tab" aria-selected="${isActive}" data-click="setInsightRange" data-range="${key}">${label}</button></li>`;
    }).join('');
}

function statCard(icon, value, label) {
    return `<div class="stat-card"><div class="stat-icon"><i class="bi bi-${icon}" aria-hidden="true"></i></div><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>`;
}

/**
 * The four key figures.
 *
 * @param {Object} totals -> `totals` of the API.
 * @returns {string} -> Stat cards, plus a hint when no attendance was recorded.
 */
export function renderInsightTotals(totals) {
    const cards = statCard('person-check', formatRate(totals.attendanceRate), 'Teilnahmequote')
        + statCard('person-x', formatRate(totals.noShowRate), 'No-Show-Quote')
        + statCard('calendar-check', Number(totals.events) || 0, 'Ausgewertete Events')
        + statCard('pie-chart', formatRate(totals.occupancyRate), 'Auslastung');
    const hint = Number(totals.events) > 0 && !Number(totals.trackedEvents)
        ? '<p class="insights-hint"><i class="bi bi-info-circle me-1" aria-hidden="true"></i>In diesem Zeitraum wurde keine Anwesenheit erfasst – ohne Check-ins gibt es keine Quoten.</p>'
        : '';
    return cards + hint;
}

/**
 * Ranking of the most active members.
 *
 * @param {Array<Object>} members -> `members` of the API.
 * @returns {string} -> Ordered list, or a short note.
 */
export function renderInsightMembers(members) {
    if (!Array.isArray(members) || !members.length) return '<p class="text-secondary mb-0">Noch keine Teilnahmen in diesem Zeitraum.</p>';
    const items = members.map((member, index) => {
        const name = escapeHtml(String(member.name ?? ''));
        const label = member.hasProfile ? `<a href="#member/${escapeHtml(String(member.id ?? ''))}">${name}</a>` : name;
        const meta = `${plural(Number(member.attended) || 0, 'Teilnahme', 'Teilnahmen')} · ${plural(Number(member.checkedIn) || 0, 'Check-in', 'Check-ins')}`;
        return `<li class="insights-rank-item"><span class="insights-rank-number">${index + 1}</span><span class="insights-rank-name">${label}</span><span class="insights-rank-meta">${meta}</span></li>`;
    }).join('');
    return `<ol class="insights-rank">${items}</ol>`;
}

/**
 * Categories with a bar relative to the largest one.
 *
 * @param {Array<Object>} categories -> `categories` of the API.
 * @returns {string} -> List, or a short note.
 */
export function renderInsightCategories(categories) {
    if (!Array.isArray(categories) || !categories.length) return '<p class="text-secondary mb-0">Keine Kategorien in diesem Zeitraum.</p>';
    const items = categories.map(category => {
        const label = escapeHtml(String(category.label ?? ''));
        const events = plural(Number(category.events) || 0, 'Event', 'Events');
        const meta = `${events} · ${plural(Number(category.registrations) || 0, 'Anmeldung', 'Anmeldungen')} · Ø ${decimal(category.averageAccepted)} Teilnehmer · Teilnahmequote ${formatRate(category.attendanceRate)}`;
        const share = Math.min(100, Math.max(0, Math.round(Number(category.share) || 0)));
        return `<li class="insights-category"><div class="insights-category-head"><span class="insights-category-label">${label}</span><span class="insights-category-count">${events}</span></div>`
            + `<progress class="capacity-meter" max="100" value="${share}" aria-label="${label}: ${events}" title="${label}: ${events}"></progress>`
            + `<div class="insights-category-meta">${meta}</div></li>`;
    }).join('');
    return `<ul class="insights-categories">${items}</ul>`;
}

function day(row) {
    const time = startTime(row);
    return time === -Infinity ? DASH : new Date(time).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function renderRow(row) {
    const tracked = row.noShows !== null && row.noShows !== undefined;
    const cell = (label, value) => `<td class="insights-number" data-label="${label}">${value}</td>`;
    const category = row.category ? `<div class="data-table-meta">${escapeHtml(String(row.category))}</div>` : '';
    return '<tr>'
        + `<td class="insights-date">${day(row)}</td>`
        + `<td><a class="data-table-title insights-title" href="#event/${escapeHtml(String(row.id ?? ''))}">${escapeHtml(String(row.title || '(ohne Titel)'))}</a>${category}</td>`
        + cell('Angenommen', Number(row.accepted) || 0)
        + cell('Check-ins', tracked ? Number(row.checkedIn) || 0 : DASH)
        + cell('No-Shows', tracked ? Number(row.noShows) || 0 : DASH)
        + cell('Quote', formatRate(row.attendanceRate))
        + cell('Auslastung', formatRate(row.occupancyRate))
        + '</tr>';
}

/**
 * Table of the evaluated events.
 *
 * @param {Array<Object>} rows -> Sorted rows; at least one.
 * @param {Object} options -> `{ sort }` shown in the heads.
 * @returns {string} -> HTML of a .data-table.
 */
export function renderInsightTable(rows, { sort }) {
    const heads = COLUMNS.map(({ key, label }) => {
        const active = sort && sort.key === key;
        const descending = active && sort.direction === 'desc';
        const ariaSort = active ? (descending ? 'descending' : 'ascending') : 'none';
        const icon = active ? (descending ? 'arrow-down' : 'arrow-up') : 'arrow-down-up';
        return `<th scope="col" aria-sort="${ariaSort}"><button type="button" class="data-table-sort" data-click="sortInsights" data-sort="${key}">${label}<i class="bi bi-${icon}" aria-hidden="true"></i></button></th>`;
    }).join('');
    return `<table class="data-table insights-table"><thead><tr>${heads}</tr></thead><tbody>${rows.map(renderRow).join('')}</tbody></table>`;
}

/**
 * Shown when no event of the range is evaluated.
 *
 * @returns {string} -> Empty state.
 */
export function renderInsightsEmpty() {
    return emptyState({
        icon: 'calendar-x',
        title: 'Keine vergangenen Events in diesem Zeitraum',
        text: 'Wähle einen längeren Zeitraum oder warte, bis die ersten Events vorbei sind.'
    });
}

/**
 * Placeholders while the evaluations load.
 *
 * @returns {string} -> Skeleton for the table area.
 */
export function renderInsightsSkeleton() {
    const line = '<div class="skeleton skeleton-text"></div>';
    return `<div aria-hidden="true">${line.repeat(5)}</div>`;
}

/**
 * Shown when the evaluations could not be loaded.
 *
 * @returns {string} -> Empty state with a retry button.
 */
export function renderInsightsError() {
    return emptyState({
        icon: 'exclamation-triangle',
        title: 'Auswertungen konnten nicht geladen werden',
        action: '<button type="button" class="btn btn-secondary btn-sm" data-click="reloadInsights">Erneut versuchen</button>'
    });
}
