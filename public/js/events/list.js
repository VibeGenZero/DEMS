/**
 * Event overview (#events): loads the upcoming events once, filters them by
 * category and search in the browser and renders the cards of cards.js.
 * The calendar view lives in calendar.js.
 */
import { registerActions } from '../core/actions.js';
import { emptyState } from '../core/components.js';
import { escapeHtml } from '../core/ui.js';
import { forgetCalendarEvents, showCalendar } from './calendar.js';
import { renderEventCard, renderEventCardSkeletons } from './cards.js';

export const UPCOMING_EVENTS_URL = '/api/events?upcoming=1&limit=100';

const SKELETON_CARDS = 6;
const RETRY_BUTTON = '<button type="button" class="btn btn-secondary btn-sm" data-click="showEventsSection">Erneut versuchen</button>';
const RESET_BUTTON = '<button type="button" class="btn btn-secondary btn-sm" data-click="resetEventFilters">Filter zurücksetzen</button>';

export let upcomingEvents = [];

export let activeCategory = '';

export let currentView = 'grid';

/**
 * Events that match the chosen category and the search text.
 *
 * @param {Array<Object>} events -> Upcoming events.
 * @param {Object} [filter] -> `{ category, search }`; empty values match everything.
 * @returns {Array<Object>} -> Matching events in their order; the search looks at title, description and category, case-insensitive.
 */
export function filterEvents(events, { category = '', search = '' } = {}) {
    const needle = search.trim().toLowerCase();
    return events.filter(event => (!category || event.category === category)
        && (!needle || [event.title, event.description, event.category].some(text => String(text ?? '').toLowerCase().includes(needle))));
}

/**
 * Number of events per category.
 *
 * @param {Array<Object>} events -> Upcoming events.
 * @returns {Array<{ name: string, count: number }>} -> Categories that have events, sorted by name; events without a category are left out.
 */
export function categoryCounts(events) {
    const counts = new Map();
    for (const event of events) {
        if (event.category) counts.set(event.category, (counts.get(event.category) || 0) + 1);
    }
    return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

function searchText() {
    return document.getElementById('events-search')?.value?.trim() || '';
}

// Search and category for the calendar, which filters its own (all) events
function currentFilter() {
    const filter = { category: activeCategory, search: searchText() };
    return (events) => filterEvents(events, filter);
}

function renderCategoryBar() {
    const bar = document.getElementById('category-filter-bar');
    const counts = categoryCounts(upcomingEvents);
    // A category without upcoming events any more would leave an empty list without a chip to leave it
    if (activeCategory && !counts.some(entry => entry.name === activeCategory)) activeCategory = '';
    if (counts.length === 0) {
        bar.innerHTML = '';
        return;
    }
    const chip = (value, label, count) => `<button type="button" class="chip${activeCategory === value ? ' active' : ''}" data-click="filterByCategory" data-category="${escapeHtml(value)}">${escapeHtml(label)} <span class="chip-count">${count}</span></button>`;
    bar.innerHTML = [chip('', 'Alle', upcomingEvents.length), ...counts.map(entry => chip(entry.name, entry.name, entry.count))].join('');
}

/**
 * Set each card's own banner colour (data-banner-bg) as a CSS variable;
 * an inline style attribute would need the CSP's 'unsafe-inline'.
 *
 * @param {Element} grid -> #events-grid.
 * @returns {void}
 */
function applyBannerColors(grid) {
    grid.querySelectorAll('[data-banner-bg]').forEach(media => media.style.setProperty('--event-banner-bg', media.dataset.bannerBg));
}

/**
 * Render category bar and cards (or the calendar) from the loaded events.
 *
 * @param {Date} [now] -> Reference time for "Heute" and "Läuft gerade".
 * @returns {Promise<void>|void} -> In calendar view: resolves once the calendar is rendered.
 */
export function renderOverview(now = new Date()) {
    const grid = document.getElementById('events-grid');
    const empty = document.getElementById('events-empty');
    renderCategoryBar();
    if (currentView === 'calendar') {
        // The empty state belongs to the cards; the calendar shows an empty month instead
        empty.style.display = 'none';
        return showCalendar(currentFilter());
    }
    const visible = filterEvents(upcomingEvents, { category: activeCategory, search: searchText() });
    if (visible.length === 0) {
        grid.innerHTML = '';
        empty.innerHTML = upcomingEvents.length === 0
            ? emptyState({ icon: 'calendar-x', title: 'Keine anstehenden Events', text: 'Sobald ein Event geplant ist, erscheint es hier.' })
            : emptyState({ icon: 'search', title: 'Keine Treffer', text: 'Kein anstehendes Event passt zu Suche und Kategorie.', action: RESET_BUTTON });
        empty.style.display = 'block';
        return;
    }
    empty.style.display = 'none';
    grid.innerHTML = visible.map(event => renderEventCard(event, now)).join('');
    applyBannerColors(grid);
}

function showLoadError(status) {
    const empty = document.getElementById('events-empty');
    document.getElementById('events-grid').innerHTML = '';
    document.getElementById('category-filter-bar').innerHTML = '';
    empty.innerHTML = status === 429
        ? emptyState({ icon: 'clock-history', title: 'Zu viele Anfragen', text: 'Bitte warte einen Moment und versuche es dann erneut.', action: RETRY_BUTTON })
        : emptyState({ icon: 'exclamation-triangle', title: 'Events konnten nicht geladen werden', text: 'Bitte versuche es gleich noch einmal.', action: RETRY_BUTTON });
    empty.style.display = 'block';
}

/**
 * Open the overview: load the upcoming events once and render them.
 *
 * @returns {Promise<void>}
 */
export async function showEventsSection() {
    document.getElementById('events-section').style.display = 'block';
    forgetCalendarEvents();
    document.getElementById('events-empty').style.display = 'none';
    document.getElementById('events-grid').innerHTML = renderEventCardSkeletons(SKELETON_CARDS);

    try {
        const res = await fetch(UPCOMING_EVENTS_URL);
        if (!res.ok) {
            showLoadError(res.status);
            return;
        }
        const result = await res.json();
        if (!Array.isArray(result.data)) throw new Error('Ungültige API-Antwort');
        upcomingEvents = result.data;
    } catch (err) {
        console.error('Error loading events:', err);
        showLoadError(0);
        return;
    }

    await renderOverview();
    if (currentView === 'grid') gsap.fromTo('#events-grid .event-card', { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.25, stagger: 0.04, ease: 'power2.out' });
}

/**
 * Show only one category ('' = all).
 *
 * @param {string} category -> Category text.
 * @returns {Promise<void>|void} -> See renderOverview().
 */
export function filterByCategory(category) {
    activeCategory = category;
    return renderOverview();
}

/**
 * Clear search and category.
 *
 * @returns {Promise<void>|void} -> See renderOverview().
 */
export function resetEventFilters() {
    activeCategory = '';
    const search = document.getElementById('events-search');
    if (search) search.value = '';
    return renderOverview();
}

/**
 * Switch between cards and calendar.
 *
 * @param {string} view -> "grid" or "calendar".
 * @returns {Promise<void>} -> Resolves once the calendar is rendered.
 */
export async function switchView(view) {
    currentView = view;
    const gridBtn = document.getElementById('view-grid-btn');
    const calBtn = document.getElementById('view-calendar-btn');
    const grid = document.getElementById('events-grid');
    const calendar = document.getElementById('events-calendar');

    if (view === 'grid') {
        gridBtn.classList.add('active');
        calBtn.classList.remove('active');
        grid.style.display = '';
        calendar.style.display = 'none';
    } else {
        gridBtn.classList.remove('active');
        calBtn.classList.add('active');
        grid.style.display = 'none';
        calendar.style.display = '';
    }
    // Cards or calendar with the current search and category
    await renderOverview();
}

registerActions({
    showEventsSection: () => showEventsSection(),
    filterByCategory: (el) => filterByCategory(el.dataset.category),
    searchEvents: () => renderOverview(),
    resetEventFilters: () => resetEventFilters(),
    switchView: (el) => switchView(el.dataset.view)
});
