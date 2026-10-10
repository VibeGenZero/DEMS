/**
 * Event overview: cards, categories, search, grid/calendar switch, series
 * dates. The calendar lives in calendar.js, the countdown in detail.js.
 */
import { state } from '../core/state.js';
import { registerActions } from '../core/actions.js';
import { escapeHtml, isValidBannerUrl, markdownPreview, renderSkeletonEvents } from '../core/ui.js';
import { getEventGradient, startCountdown } from './detail.js';
import { forgetCalendarEvents, showCalendar } from './calendar.js';

export let activeCategory = '';

export let searchDebounceTimer = null;

export let currentView = 'grid';

export async function showEventsSection() {
    const section = document.getElementById('events-section');
    section.style.display = 'block';
    forgetCalendarEvents();

    // Load categories
    await loadCategories();

    const grid = document.getElementById('events-grid');
    const empty = document.getElementById('events-empty');

    // Skeleton Loading
    renderSkeletonEvents(grid, 6);
    empty.style.display = 'none';

    try {
        let url = '/api/events';
        const params = [];
        if (activeCategory) params.push(`category=${encodeURIComponent(activeCategory)}`);
        const searchTerm = document.getElementById('events-search')?.value?.trim();
        if (searchTerm) params.push(`search=${encodeURIComponent(searchTerm)}`);
        if (params.length) url += '?' + params.join('&');

        const res = await fetch(url);
        if (res.status === 429) {
            grid.innerHTML = '';
            empty.innerHTML = `
                <div class="text-center py-5">
                    <i class="bi bi-clock-history fs-1 text-warning mb-3 d-block"></i>
                    <h5 class="text-warning">Zu viele Anfragen</h5>
                    <p class="text-muted">Du hast zu viele Anfragen in kurzer Zeit gesendet.<br>Bitte warte einen Moment und lade die Seite neu.</p>
                    <button class="btn btn-outline-warning mt-2" data-click="showEventsSection">
                        <i class="bi bi-arrow-clockwise me-1"></i>Erneut versuchen
                    </button>
                </div>`;
            empty.style.display = 'block';
            return;
        }
        const result = await res.json();
        const events = result.data || result;

        if (!Array.isArray(events)) {
            console.error('API response is not an array:', events);
            throw new Error('Ungültige API-Antwort');
        }

        if (!events.length) {
            grid.innerHTML = '';
            empty.style.display = 'block';
            document.getElementById('events-calendar').style.display = 'none';
            return;
        }

        empty.style.display = 'none';
        grid.innerHTML = events.map(event => {
            const bannerHtml = isValidBannerUrl(event.bannerUrl)
                ? `<img src="${escapeHtml(event.bannerUrl)}" class="event-banner" alt="Banner">`
                : `<div class="event-banner-placeholder" style="background:${
                    event.accentColor
                        ? `linear-gradient(135deg,${escapeHtml(event.accentColor)}99 0%,${escapeHtml(event.accentColor)} 100%)`
                        : getEventGradient(event.id)
                  }"></div>`;

            const categoryHtml = event.category
                ? `<span class="event-category-tag">${escapeHtml(event.category)}</span>`
                : '';

            // Series event card
            if (event.seriesDates && event.seriesDates.length > 1) {
                const maxVisible = 4;
                const visibleDates = event.seriesDates.slice(0, maxVisible);
                const hiddenCount = event.seriesDates.length - maxVisible;
                const seriesCardId = `series-${event.seriesId}`;

                // Find the next upcoming date for countdown
                const now = new Date().toISOString();
                const nextDate = event.seriesDates.find(d => d.startDate >= now);
                const countdownDate = nextDate ? nextDate.startDate.replace(' ', 'T') : null;
                const countdownId = `cd-series-${event.seriesId}`;

                const datesHtml = visibleDates.map(d => {
                    const safeD = d.startDate ? d.startDate.replace(' ', 'T') : null;
                    const dateStr = safeD ? new Date(safeD).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
                    return `
                      <a class="series-date-item" href="#" data-click="navigateTo" data-route="event/${escapeHtml(d.id)}">
                        <span><i class="bi bi-calendar-event me-2"></i>${dateStr}</span>
                        <span class="series-date-participants"><i class="bi bi-people me-1"></i>${d.currentParticipants || 0}${event.maxParticipants > 0 ? '/' + event.maxParticipants : ''}</span>
                      </a>`;
                }).join('');

                const hiddenDatesHtml = hiddenCount > 0
                    ? event.seriesDates.slice(maxVisible).map(d => {
                        const safeD = d.startDate ? d.startDate.replace(' ', 'T') : null;
                        const dateStr = safeD ? new Date(safeD).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
                        return `
                          <a class="series-date-item" href="#" data-click="navigateTo" data-route="event/${escapeHtml(d.id)}">
                            <span><i class="bi bi-calendar-event me-2"></i>${dateStr}</span>
                            <span class="series-date-participants"><i class="bi bi-people me-1"></i>${d.currentParticipants || 0}${event.maxParticipants > 0 ? '/' + event.maxParticipants : ''}</span>
                          </a>`;
                    }).join('')
                    : '';

                return `
            <div class="col-md-6">
              <div class="glass-card event-card series-card">
                ${bannerHtml}
                <div class="card-body">
                  <div class="d-flex justify-content-between align-items-start mb-2">
                    <h5 class="mb-0">${escapeHtml(event.title)}</h5>
                    <div class="d-flex gap-2 align-items-center">
                      ${categoryHtml}
                      <span class="series-badge"><i class="bi bi-arrow-repeat me-1"></i>Serie</span>
                    </div>
                  </div>
                  <p>${escapeHtml(markdownPreview(event.description))}</p>
                  ${countdownDate ? `<div class="countdown" id="${countdownId}" data-date="${countdownDate}"></div>` : ''}
                  <div class="series-dates-list">
                    <div class="series-dates-header"><i class="bi bi-list-ul me-1"></i>Termine der Serie</div>
                    ${datesHtml}
                    ${hiddenCount > 0 ? `
                      <div class="series-dates-hidden" id="${seriesCardId}-hidden" style="display:none;">
                        ${hiddenDatesHtml}
                      </div>
                      <a class="series-dates-toggle" href="#" data-click="toggleSeriesDates" data-card-id="${escapeHtml(seriesCardId)}">
                        <i class="bi bi-chevron-down me-1" id="${seriesCardId}-icon"></i><span id="${seriesCardId}-text">${hiddenCount} weitere Termine anzeigen</span>
                      </a>
                    ` : ''}
                  </div>
                  <div class="d-flex flex-wrap gap-2 mt-3">
                    <span class="badge-pill">
                      <i class="bi bi-${event.accessMode === 'open' ? 'unlock' : 'lock'}"></i>
                      ${event.accessMode === 'open' ? 'Offen' : 'Rolle nötig'}
                    </span>
                    <span class="badge-pill">
                      <i class="bi bi-${event.approvalMode === 'instant' ? 'lightning' : 'hourglass-split'}"></i>
                      ${event.approvalMode === 'instant' ? 'Instant' : 'Manuell'}
                    </span>
                    ${event.maxParticipants > 0 ? `
                      <span class="badge-pill">
                        <i class="bi bi-people"></i>Max ${event.maxParticipants}
                      </span>
                    ` : ''}
                  </div>
                </div>
              </div>
            </div>
          `;
            }

            // Standard (non-series) event card
            const safeDate = event.startDate ? event.startDate.replace(' ', 'T') : null;
            let dateHtml = '';
            try {
                dateHtml = safeDate
                    ? `<div class="event-date-info"><i class="bi bi-calendar3"></i>${new Date(safeDate).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>`
                    : '';
            } catch (e) {
                console.warn('Date parse error:', e);
            }

            const countdownId = `cd-${event.id}`;

            // Build date string for card
            let cardDateStr = '';
            if (safeDate) {
                const d = new Date(safeDate);
                cardDateStr = d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: 'short' })
                    + ' · ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr';
            }

            // Mini capacity bar
            let miniCapacityHtml = '';
            if (event.maxParticipants > 0) {
                const current = event.currentParticipants || 0;
                const pct = Math.min(100, Math.round((current / event.maxParticipants) * 100));
                const isDanger = pct >= 90;
                miniCapacityHtml = `
                    <div class="event-card-mini-progress">
                        <div class="event-card-mini-progress-bar${isDanger ? ' danger' : ''}" style="width:${pct}%"></div>
                    </div>
                    <div class="event-card-capacity-label">${current} / ${event.maxParticipants} Plätze</div>`;
            }

            return `
        <div class="col-md-6">
          <div class="glass-card event-card" data-click="navigateTo" data-route="event/${escapeHtml(event.id)}">
            ${bannerHtml}
            <div class="card-body">
              <div class="event-card-header-row">
                ${categoryHtml}
                <span></span>
              </div>
              <h5 class="mb-1 fw-bold">${escapeHtml(event.title)}</h5>
              <p class="mb-2">${escapeHtml(markdownPreview(event.description))}</p>
              ${cardDateStr ? `<div class="event-card-date-row"><i class="bi bi-calendar3"></i>${escapeHtml(cardDateStr)}</div>` : ''}
              ${safeDate ? `<div class="countdown" id="${countdownId}" data-date="${safeDate}"></div>` : ''}
              ${miniCapacityHtml}
              <div class="d-flex flex-wrap gap-2 mt-2">
                <span class="badge-pill">
                  <i class="bi bi-${event.accessMode === 'open' ? 'unlock' : 'lock'}"></i>
                  ${event.accessMode === 'open' ? 'Offen' : 'Rolle nötig'}
                </span>
                <span class="badge-pill">
                  <i class="bi bi-${event.approvalMode === 'instant' ? 'lightning' : 'hourglass-split'}"></i>
                  ${event.approvalMode === 'instant' ? 'Instant' : 'Manuell'}
                </span>
                ${getParticipantWarningBadge(event)}
                ${renderSlotChips(event.slotSummary)}
              </div>
            </div>
          </div>
        </div>
      `;
        }).join('');

        // Handle image error fallbacks
        grid.querySelectorAll('.event-banner').forEach(img => {
            img.addEventListener('error', () => { img.style.display = 'none'; });
        });

        // Start countdowns for standard events
        events.forEach(event => {
            if (event.seriesDates) {
                // Series: countdown for the next upcoming date
                const now = new Date().toISOString();
                const nextDate = event.seriesDates.find(d => d.startDate >= now);
                if (nextDate) {
                    const el = document.getElementById(`cd-series-${event.seriesId}`);
                    if (el) startCountdown(el, nextDate.startDate.replace(' ', 'T'));
                }
            } else if (event.startDate) {
                const safeDate = event.startDate.replace(' ', 'T');
                const el = document.getElementById(`cd-${event.id}`);
                if (el) startCountdown(el, safeDate);
            }
        });

        gsap.fromTo('.event-card',
            { y: 30, opacity: 0 },
            { y: 0, opacity: 1, duration: 0.4, stagger: 0.08, ease: 'power3.out' }
        );

    } catch (err) {
        console.error('Error rendering events:', err);
        grid.innerHTML = '<div class="col-12"><div class="alert alert-danger">Fehler beim Laden der Events. Check Console.</div></div>';
    }
}

export async function loadCategories() {
    try {
        const res = await fetch('/api/events/categories');
        const categories = await res.json();

        const bar = document.getElementById('category-filter-bar');
        if (!categories.length) {
            bar.innerHTML = '';
            return;
        }

        bar.innerHTML = `
      <button class="category-pill ${!activeCategory ? 'active' : ''}" data-click="filterByCategory" data-category="">
        <i class="bi bi-grid-3x3-gap"></i>Alle
      </button>
      ${categories.map(cat => `
        <button class="category-pill ${activeCategory === cat ? 'active' : ''}" data-click="filterByCategory" data-category="${escapeHtml(cat)}">
          <i class="bi bi-tag"></i>${escapeHtml(cat)}
        </button>
      `).join('')}
    `;
    } catch {
        document.getElementById('category-filter-bar').innerHTML = '';
    }
}

export function filterByCategory(cat) {
    activeCategory = cat;
    showEventsSection();
}

export function getParticipantWarningBadge(event) {
    if (!event.maxParticipants || event.maxParticipants <= 0) return '';
    const current = event.currentParticipants || 0;
    const remaining = event.maxParticipants - current;
    const ratio = current / event.maxParticipants;

    if (remaining <= 0) {
        return `<span class="badge-pill spots-full"><i class="bi bi-x-circle"></i>Ausgebucht</span>`;
    } else if (ratio >= 0.8) {
        return `<span class="badge-pill spots-warning"><i class="bi bi-exclamation-triangle"></i>Nur noch ${remaining} ${remaining === 1 ? 'Platz' : 'Plätze'}!</span>`;
    }
    return '';
}

export function renderSlotChips(slotSummary) {
    if (!Array.isArray(slotSummary) || slotSummary.length === 0) return '';
    const chips = slotSummary.map(slot => {
        const free = slot.capacity - slot.taken;
        const text = free > 0 ? `${free} frei` : 'voll';
        return `<span class="slot-chip${free > 0 ? '' : ' full'}" title="${escapeHtml(slot.name)}: ${slot.taken}/${slot.capacity}">${escapeHtml(slot.emoji || slot.name)} ${text}</span>`;
    }).join('');
    return `<div class="slot-chips">${chips}</div>`;
}

export function toggleSeriesDates(seriesCardId) {
    const hidden = document.getElementById(`${seriesCardId}-hidden`);
    const icon = document.getElementById(`${seriesCardId}-icon`);
    const text = document.getElementById(`${seriesCardId}-text`);
    if (!hidden) return;

    const isVisible = hidden.style.display !== 'none';
    hidden.style.display = isVisible ? 'none' : 'block';
    if (icon) icon.className = `bi bi-chevron-${isVisible ? 'down' : 'up'} me-1`;
    if (text) text.textContent = isVisible ? text.dataset.showText || 'Weitere Termine anzeigen' : 'Weniger anzeigen';
    if (!text.dataset.showText) text.dataset.showText = text.textContent;
}

export function debouncedSearch() {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
        showEventsSection();
    }, 300);
}

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
        return;
    }
    gridBtn.classList.remove('active');
    calBtn.classList.add('active');
    grid.style.display = 'none';
    calendar.style.display = '';
    await showCalendar();
}

registerActions({
    showEventsSection: () => showEventsSection(),
    toggleSeriesDates: (el) => toggleSeriesDates(el.dataset.cardId),
    filterByCategory: (el) => filterByCategory(el.dataset.category),
    debouncedSearch: () => debouncedSearch(),
    switchView: (el) => switchView(el.dataset.view)
});
