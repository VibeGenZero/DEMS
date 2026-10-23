/**
 * Evaluations for admins (W-14): page #insights. Loads
 * GET /api/admin/insights?range=…; markup and table order in
 * admin/insights-view.js.
 */
import { registerActions } from '../core/actions.js';
import { toggleElement } from '../core/ui.js';
import {
    DEFAULT_INSIGHT_SORT, INSIGHT_RANGES, INSIGHT_SORT_KEYS, nextInsightSort, renderInsightCategories,
    renderInsightMembers, renderInsightRanges, renderInsightTable, renderInsightTotals, renderInsightsEmpty,
    renderInsightsError, renderInsightsSkeleton, sortInsightEvents
} from './insights-view.js';

/**
 * What the admin looks at. It lives as long as the page: coming back keeps
 * range and sorting.
 */
export const insightsView = {
    range: '90',
    // Answer of the API for `range`; null until it arrived
    data: null,
    sort: { ...DEFAULT_INSIGHT_SORT }
};

const byId = (id) => document.getElementById(id);

/**
 * Draw the page from insightsView. Does nothing before the first answer.
 *
 * @returns {void}
 */
export function renderInsights() {
    byId('insights-ranges').innerHTML = renderInsightRanges(insightsView.range);
    const data = insightsView.data;
    if (!data) return;
    byId('insights-totals').innerHTML = renderInsightTotals(data.totals || {});
    const events = Array.isArray(data.events) ? data.events : [];
    const empty = events.length === 0;
    toggleElement(byId('insights-lists'), !empty);
    byId('insights-members').innerHTML = renderInsightMembers(data.members);
    byId('insights-categories').innerHTML = renderInsightCategories(data.categories);
    byId('insights-table').innerHTML = empty
        ? renderInsightsEmpty()
        : renderInsightTable(sortInsightEvents(events, insightsView.sort), { sort: insightsView.sort });
}

/**
 * Load the evaluations of the chosen range; an answer for an older range is dropped.
 *
 * @returns {Promise<void>}
 */
export async function loadInsights() {
    const range = insightsView.range;
    insightsView.data = null;
    renderInsights();
    byId('insights-table').innerHTML = renderInsightsSkeleton();
    try {
        const res = await fetch(`/api/admin/insights?range=${encodeURIComponent(range)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (insightsView.range !== range) return;
        insightsView.data = data;
        renderInsights();
    } catch {
        if (insightsView.range === range) byId('insights-table').innerHTML = renderInsightsError();
    }
}

/**
 * Open the evaluations page.
 *
 * @returns {Promise<void>}
 */
export async function showInsightsSection() {
    byId('insights-section').style.display = 'block';
    await loadInsights();
}

/**
 * Switch the time range.
 *
 * @param {string} range -> Key of INSIGHT_RANGES; anything else is ignored.
 * @returns {Promise<void>}
 */
export async function setInsightRange(range) {
    if (!INSIGHT_RANGES.some(entry => entry.key === range)) return;
    insightsView.range = range;
    await loadInsights();
}

/**
 * Sort the event table; the same column again turns the direction.
 *
 * @param {string} key -> One of INSIGHT_SORT_KEYS.
 * @returns {void}
 */
export function sortInsights(key) {
    if (!INSIGHT_SORT_KEYS.includes(key)) return;
    insightsView.sort = nextInsightSort(insightsView.sort, key);
    renderInsights();
}

registerActions({
    setInsightRange: (el) => setInsightRange(el.dataset.range),
    sortInsights: (el) => sortInsights(el.dataset.sort),
    reloadInsights: () => loadInsights()
});
