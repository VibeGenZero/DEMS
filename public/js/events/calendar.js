/**
 * Calendar view of the event overview: loads every active event once (past
 * ones too, unlike the cards) and shows one month. A series shows each of
 * its dates on its own day.
 */
import { registerActions } from '../core/actions.js';
import { escapeHtml } from '../core/ui.js';

export const CALENDAR_EVENTS_URL = '/api/events?limit=500';

const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const DAY_NAMES = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const MAX_EVENTS_PER_DAY = 3;

// null = not loaded since the overview was last opened
export let calendarEvents = null;

// Search and category of the overview, as a function over the events (list.js sets it)
export let calendarFilter = (events) => events;

export let calendarMonth = new Date().getMonth();

export let calendarYear = new Date().getFullYear();

/**
 * Drop the loaded events, so the next showCalendar() asks the server again.
 * The overview calls it whenever it opens.
 *
 * @returns {void}
 */
export function forgetCalendarEvents() {
    calendarEvents = null;
}

/**
 * Load the events once and render the current month.
 *
 * @param {Function} [filter] -> `(events) => events` that pass search and category; kept for the month arrows.
 * @returns {Promise<void>}
 */
export async function showCalendar(filter = calendarFilter) {
    calendarFilter = filter;
    if (calendarEvents === null) {
        try {
            const res = await fetch(CALENDAR_EVENTS_URL);
            const result = await res.json();
            if (!res.ok || !Array.isArray(result.data)) throw new Error(result.error || 'Ungültige API-Antwort');
            calendarEvents = result.data;
        } catch (err) {
            console.error('Error loading calendar events:', err);
            renderCalendar([]);
            return;
        }
    }
    renderCalendar(calendarFilter(calendarEvents));
}

/**
 * Show the previous or next month.
 *
 * @param {number} delta -> -1 or 1.
 * @returns {void}
 */
export function shiftCalendarMonth(delta) {
    calendarMonth += delta;
    if (calendarMonth < 0) { calendarMonth = 11; calendarYear--; }
    if (calendarMonth > 11) { calendarMonth = 0; calendarYear++; }
    renderCalendar(calendarFilter(calendarEvents || []));
}

/**
 * One calendar entry per date: a series stands for all of its dates.
 *
 * @param {Array<Object>} events -> Events of GET /api/events.
 * @returns {Array<Object>} -> `{ id, title, startDate }` per date.
 */
export function calendarEntries(events) {
    return events.flatMap(event => (Array.isArray(event.seriesDates) && event.seriesDates.length > 0
        ? event.seriesDates.map(date => ({ id: date.id, title: event.title, startDate: date.startDate }))
        : [{ id: event.id, title: event.title, startDate: event.startDate }]));
}

/**
 * Render the month calendarMonth/calendarYear into #events-calendar.
 *
 * @param {Array<Object>} events -> Events of GET /api/events.
 * @returns {void}
 */
export function renderCalendar(events) {
    const container = document.getElementById('events-calendar');
    const today = new Date();
    const dayKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const todayStr = dayKey(today);

    const eventsByDate = {};
    for (const entry of calendarEntries(events)) {
        if (!entry.startDate) continue;
        const key = dayKey(new Date(entry.startDate));
        (eventsByDate[key] ||= []).push(entry);
    }

    const firstDay = new Date(calendarYear, calendarMonth, 1);
    const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
    // getDay() counts from Sunday; the calendar starts on Monday
    const startDayOfWeek = (firstDay.getDay() + 6) % 7;
    const prevMonthDays = new Date(calendarYear, calendarMonth, 0).getDate();

    let html = `
    <div class="calendar-container">
      <div class="calendar-header">
        <button class="btn btn-sm btn-outline-light" data-click="shiftCalendarMonth" data-delta="-1">
          <i class="bi bi-chevron-left"></i>
        </button>
        <h4>${MONTH_NAMES[calendarMonth]} ${calendarYear}</h4>
        <button class="btn btn-sm btn-outline-light" data-click="shiftCalendarMonth" data-delta="1">
          <i class="bi bi-chevron-right"></i>
        </button>
      </div>
      <div class="calendar-grid">
    `;
    html += DAY_NAMES.map(name => `<div class="calendar-day-name">${name}</div>`).join('');

    for (let i = startDayOfWeek - 1; i >= 0; i--) {
        html += `<div class="calendar-day other-month"><span class="day-number">${prevMonthDays - i}</span></div>`;
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const dateKey = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dayEvents = eventsByDate[dateKey] || [];
        let eventsHtml = '';
        if (dayEvents.length > 0) {
            eventsHtml = '<div class="calendar-day-events">'
                + dayEvents.slice(0, MAX_EVENTS_PER_DAY).map(entry => `<div class="calendar-day-event" data-click="navigateTo" data-route="event/${escapeHtml(String(entry.id))}">${escapeHtml(String(entry.title ?? ''))}</div>`).join('')
                + (dayEvents.length > MAX_EVENTS_PER_DAY ? `<div class="calendar-day-event calendar-day-more">+${dayEvents.length - MAX_EVENTS_PER_DAY} mehr</div>` : '')
                + '</div>';
        }
        html += `<div class="calendar-day ${dateKey === todayStr ? 'today' : ''}">
            <span class="day-number">${day}</span>
            ${eventsHtml}
        </div>`;
    }

    const totalCells = startDayOfWeek + daysInMonth;
    const remainingCells = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let i = 1; i <= remainingCells; i++) {
        html += `<div class="calendar-day other-month"><span class="day-number">${i}</span></div>`;
    }

    html += '</div></div>';
    container.innerHTML = html;
}

registerActions({
    shiftCalendarMonth: (el) => shiftCalendarMonth(Number(el.dataset.delta))
});
