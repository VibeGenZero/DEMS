/**
 * Rules of the admin event table (#admin): which tab an event belongs to,
 * how the dates of a series become one row, search, sorting and the actions
 * a row offers. Pure functions without HTML and DOM; admin/event-table.js
 * turns their result into markup.
 */
import { eventEnd, eventStart, isRunning } from '../events/cards.js';

/** Tabs of the table in display order. */
export const ADMIN_TABS = [
    { id: 'drafts', label: 'Entwürfe' },
    { id: 'active', label: 'Aktiv' },
    { id: 'archive', label: 'Archiv' }
];

/** Sorting of each tab until the admin picks another one. */
export const DEFAULT_ADMIN_SORT = {
    drafts: { key: 'date', direction: 'asc' },
    active: { key: 'date', direction: 'asc' },
    archive: { key: 'date', direction: 'desc' }
};

/** Columns the table can be sorted by. */
export const ADMIN_SORT_KEYS = ['title', 'date', 'places'];

/**
 * Tab of an event.
 *
 * @param {Object} event -> Event with `status`.
 * @returns {string} -> `drafts`, `active` (also without a status) or `archive` (archived, cancelled and anything else).
 */
export function adminTabOf(event) {
    const status = event.status || 'active';
    if (status === 'draft') return 'drafts';
    return status === 'active' ? 'active' : 'archive';
}

const isOver = (event, now) => {
    const end = eventEnd(event);
    return !!end && end < now;
};

/**
 * State of an event, which decides its actions.
 *
 * @param {Object} event -> Event.
 * @param {Date} now -> Reference time.
 * @returns {string} -> `draft`, `upcoming` (also without a date), `running`, `past` (active but over) or `archived`.
 */
export function adminStateOf(event, now) {
    const tab = adminTabOf(event);
    if (tab === 'drafts') return 'draft';
    if (tab === 'archive') return 'archived';
    if (isRunning(event, now)) return 'running';
    return isOver(event, now) ? 'past' : 'upcoming';
}

const timeOf = (event) => {
    const start = eventStart(event);
    return start ? start.getTime() : null;
};
const titleOf = (event) => String(event.title ?? '');
const takenOf = (event) => Number(event.places?.taken) || 0;
const pendingOf = (event) => Number(event.places?.pending) || 0;
const byTitle = (a, b) => titleOf(a).localeCompare(titleOf(b), 'de', { sensitivity: 'base' });

// Dates ascending; an event without a date comes last
function byDate(a, b) {
    const left = timeOf(a);
    const right = timeOf(b);
    if (left === null || right === null) return (left === null) - (right === null);
    return left - right;
}

function compareRows(a, b, sort) {
    const sign = sort.direction === 'desc' ? -1 : 1;
    let order;
    if (sort.key === 'title') order = sign * byTitle(a.event, b.event);
    else if (sort.key === 'places') order = sign * (takenOf(a.event) - takenOf(b.event));
    // Rows without a date stay at the end in both directions
    else if (timeOf(a.event) === null || timeOf(b.event) === null) order = byDate(a.event, b.event);
    else order = sign * byDate(a.event, b.event);
    return order || byDate(a.event, b.event) || byTitle(a.event, b.event);
}

/**
 * Rows of one tab.
 *
 * @param {Array<Object>} events -> All events of GET /api/admin/all-events.
 * @param {Object} options -> `{ tab, search, sort, now }`; `sort` is `{ key: 'title'|'date'|'places', direction: 'asc'|'desc' }`, anything else means the default of the tab.
 * @returns {Array<Object>} -> `{ key, event, state, series }` per row. A series is one row for the dates of this tab: `event` is its first date that is not over (else the last), `series` is `{ id, total, pendingElsewhere, dates: [{ event, state, position }] }` with `total` and `position` counted over the whole series.
 */
export function buildAdminRows(events, { tab, search = '', sort, now }) {
    const list = Array.isArray(events) ? events : [];
    const order = sort && ADMIN_SORT_KEYS.includes(sort.key) ? sort : DEFAULT_ADMIN_SORT[tab] || DEFAULT_ADMIN_SORT.active;
    const needle = String(search ?? '').trim().toLowerCase();
    const matches = (event) => !needle || [event.title, event.category].some(text => String(text ?? '').toLowerCase().includes(needle));

    const seriesDates = new Map();
    for (const event of list) {
        if (!event.seriesId) continue;
        if (!seriesDates.has(event.seriesId)) seriesDates.set(event.seriesId, []);
        seriesDates.get(event.seriesId).push(event);
    }
    for (const dates of seriesDates.values()) dates.sort(byDate);

    const rows = [];
    const seen = new Set();
    for (const event of list) {
        if (adminTabOf(event) !== tab) continue;
        if (!event.seriesId) {
            if (matches(event)) rows.push({ key: event.id, event, state: adminStateOf(event, now), series: null });
            continue;
        }
        if (seen.has(event.seriesId)) continue;
        seen.add(event.seriesId);
        const all = seriesDates.get(event.seriesId);
        const dates = all.filter(date => adminTabOf(date) === tab);
        if (!dates.some(matches)) continue;
        const representative = dates.find(date => !isOver(date, now)) || dates[dates.length - 1];
        rows.push({
            key: `series:${event.seriesId}`,
            event: representative,
            state: adminStateOf(representative, now),
            series: {
                id: event.seriesId,
                total: all.length,
                pendingElsewhere: dates.filter(date => date !== representative).reduce((sum, date) => sum + pendingOf(date), 0),
                dates: dates.map(date => ({ event: date, state: adminStateOf(date, now), position: all.indexOf(date) + 1 }))
            }
        });
    }
    rows.sort((a, b) => compareRows(a, b, order));
    // Past events of the active tab form a second group below the others
    return tab === 'active' ? [...rows.filter(row => row.state !== 'past'), ...rows.filter(row => row.state === 'past')] : rows;
}

/**
 * Number of rows per tab, after the search.
 *
 * @param {Array<Object>} events -> All events.
 * @param {string} search -> Search text.
 * @param {Date} now -> Reference time.
 * @returns {Object} -> `{ drafts, active, archive }`.
 */
export function adminTabCounts(events, search, now) {
    const counts = {};
    for (const { id } of ADMIN_TABS) counts[id] = buildAdminRows(events, { tab: id, search, now }).length;
    return counts;
}

/**
 * Actions of one event: the main action and the three groups of its menu.
 *
 * @param {Object} event -> Event.
 * @param {string} state -> Result of adminStateOf().
 * @param {Object} [options] -> `{ inSeries, seriesRow }`: the event is a date of a series / the row stands for the series.
 * @returns {Object} -> `{ main, general, status, danger }` with action keys; admin/event-table.js knows label, icon and markup of each key.
 */
export function adminEventActions(event, state, { inSeries = false, seriesRow = false } = {}) {
    let main = 'registrations';
    if (state === 'draft') main = 'publish';
    else if (state === 'past') main = 'archive';

    let status = [];
    // "Start now" writes the start date, so only a draft without one offers it
    if (state === 'draft') status = eventStart(event) ? ['archive'] : ['archive', 'start'];
    else if (state === 'upcoming') status = ['toDraft', 'archive'];
    else if (state === 'running') status = ['end', 'toDraft'];
    else if (state === 'past') status = ['toDraft'];
    else if (state === 'archived') status = ['reactivate', 'toDraft'];

    return {
        main,
        general: [
            ...(main === 'registrations' ? [] : ['registrations']),
            // A message needs participants, so a draft does not offer one (W-09)
            'edit', 'announce', ...(state === 'draft' ? [] : ['message']), 'duplicate', 'export',
            ...(event.discordScheduledEventId ? [] : ['syncDiscord'])
        ],
        status,
        danger: [inSeries ? 'deleteDate' : 'delete', ...(seriesRow ? ['deleteSeries'] : [])]
    };
}
