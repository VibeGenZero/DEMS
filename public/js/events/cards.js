/**
 * Cards of the event overview (#events): pure functions that turn an event
 * of GET /api/events into HTML. No DOM access, so the tests call them
 * directly and the styleguide shows the same markup. Styles: EVENT CARDS in
 * style.css, DATE TILE and CAPACITY in components.css.
 */
import { escapeHtml, isValidBannerUrl } from '../core/ui.js';
import { getEventGradient } from './detail.js';

const DAY_MS = 24 * 60 * 60 * 1000;
// Same rule as utils/eventListing.js on the server: without an end an event lasts two hours
const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000;
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}){1,2}$/;
// Share of taken places from which the card warns "Noch 2 Plätze"
const LOW_CAPACITY = 0.8;

/** Chip per own registration status (`myStatus` of GET /api/events). */
export const STATUS_CHIPS = {
    accepted: { label: 'Angemeldet', className: 'chip-success', icon: 'check-circle-fill' },
    pending: { label: 'Ausstehend', className: 'chip-warning', icon: 'hourglass-split' },
    waitlisted: { label: 'Warteliste', className: 'chip-info', icon: 'list-ol' },
    guest: { label: 'Als Gast', className: 'chip-accent', icon: 'person-plus' }
};

/**
 * Parse a stored date; older events use a space instead of the T.
 *
 * @param {string} value -> ISO date or empty.
 * @returns {Date|null} -> The date, or null.
 */
function parseDate(value) {
    if (!value) return null;
    const date = new Date(String(value).replace(' ', 'T'));
    return Number.isNaN(date.getTime()) ? null : date;
}

const formatTime = (date) => date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
// "Sa." / "Okt." -> "Sa" / "Okt"; the tile writes them in capitals via CSS
const shortName = (date, part) => date.toLocaleDateString('de-DE', { [part]: 'short' }).replace('.', '');

/**
 * End of an event.
 *
 * @param {Object} event -> Event with `startDate` and optional `endDate`.
 * @returns {Date|null} -> `endDate`, else start + 2 hours; null without a valid start.
 */
export function eventEnd(event) {
    const start = parseDate(event.startDate);
    if (!start) return null;
    return parseDate(event.endDate) || new Date(start.getTime() + DEFAULT_DURATION_MS);
}

/**
 * Whether an event is running at `now`.
 *
 * @param {Object} event -> Event.
 * @param {Date} now -> Reference time.
 * @returns {boolean} -> Start reached and end not yet passed.
 */
export function isRunning(event, now) {
    const start = parseDate(event.startDate);
    return !!start && start <= now && now <= eventEnd(event);
}

/**
 * Day of a date relative to today, counted in calendar days of the browser's time zone.
 *
 * @param {Date} date -> Start of the event.
 * @param {Date} now -> Reference time.
 * @returns {string} -> "Heute", "Morgen", "in 3 Tagen", "in 2 Wochen" (from 14 days), "Gestern", "vor 3 Tagen".
 */
export function relativeDay(date, now) {
    const startOfDay = (value) => new Date(value.getFullYear(), value.getMonth(), value.getDate());
    // Rounding absorbs the 23 or 25 hour days of the clock change
    const days = Math.round((startOfDay(date) - startOfDay(now)) / DAY_MS);
    if (days === 0) return 'Heute';
    if (days === 1) return 'Morgen';
    if (days === -1) return 'Gestern';
    if (days < 0) return `vor ${-days} Tagen`;
    if (days < 14) return `in ${days} Tagen`;
    return `in ${Math.floor(days / 7)} Wochen`;
}

/**
 * Date tile: weekday, day and month, or LIVE while the event runs.
 *
 * @param {Object} event -> Event.
 * @param {Date} now -> Reference time.
 * @returns {string} -> HTML of a .date-tile.
 */
export function renderDateTile(event, now) {
    const start = parseDate(event.startDate);
    if (!start) return '<div class="date-tile"><span class="date-tile-day">–</span></div>';
    const weekday = `<span class="date-tile-weekday">${shortName(start, 'weekday')}</span>`;
    if (isRunning(event, now)) return `<div class="date-tile is-live">${weekday}<span class="date-tile-day">LIVE</span></div>`;
    return `<div class="date-tile">${weekday}<span class="date-tile-day">${start.getDate()}</span><span class="date-tile-month">${shortName(start, 'month')}</span></div>`;
}

/**
 * Time line of a card.
 *
 * @param {Object} event -> Event.
 * @param {Date} now -> Reference time.
 * @returns {string} -> "Läuft gerade · seit 14:30", "Morgen · 19:00" … or "Termin folgt".
 */
export function renderEventWhen(event, now) {
    const start = parseDate(event.startDate);
    if (!start) return '<p class="event-card-when">Termin folgt</p>';
    if (isRunning(event, now)) return `<p class="event-card-when is-live"><strong>Läuft gerade</strong> · seit ${formatTime(start)}</p>`;
    return `<p class="event-card-when"><strong>${relativeDay(start, now)}</strong> · ${formatTime(start)}</p>`;
}

/**
 * Capacity bar with its label.
 *
 * @param {Object} event -> Event with `maxParticipants` and `places` of GET /api/events (numbers, `text`, `waitlistText`); without `places` the older `currentParticipants` counts.
 * @returns {string} -> HTML of a .capacity: short label ("5 von 20 belegt", "Noch 2 Plätze", "Ausgebucht · 3 warten"); the full places sentence is the tooltip and the bar's label. Without a limit "5 Plätze belegt" and no bar.
 */
export function renderCapacity(event) {
    const places = event.places || {};
    const max = Math.max(0, Math.floor(Number(event.maxParticipants) || 0));
    const taken = Math.max(0, Math.floor(Number(places.taken ?? event.currentParticipants) || 0));
    const waiting = Math.max(0, Math.floor(Number(places.waitlist) || 0));
    const sentence = typeof places.text === 'string' ? places.text : '';
    // Guests and open requests do not fit on a card; the tooltip tells the whole sentence
    const title = sentence ? ` title="${escapeHtml([sentence, places.waitlistText].filter(Boolean).join(' · '))}"` : '';

    if (max === 0) return `<div class="capacity"${title}><span class="capacity-text">${taken} ${taken === 1 ? 'Platz' : 'Plätze'} belegt</span></div>`;

    const free = max - taken;
    let state = '';
    let label = `${taken} von ${max} belegt`;
    if (free <= 0) {
        state = ' is-full';
        label = 'Ausgebucht';
    } else if (taken / max >= LOW_CAPACITY) {
        state = ' is-low';
        label = `Noch ${free} ${free === 1 ? 'Platz' : 'Plätze'}`;
    }
    if (waiting > 0) label += ` · ${waiting} ${waiting === 1 ? 'wartet' : 'warten'}`;
    const barLabel = escapeHtml(sentence || `${taken} von ${max} ${max === 1 ? 'Platz' : 'Plätzen'} belegt`);
    return `<div class="capacity${state}"${title}><progress class="capacity-meter" max="${max}" value="${Math.min(taken, max)}" aria-label="${barLabel}"></progress><span class="capacity-text">${label}</span></div>`;
}

/**
 * Chip for the member's own status.
 *
 * @param {string|null} myStatus -> `accepted`, `pending`, `waitlisted`, `guest` or anything else.
 * @returns {string} -> HTML of a chip, empty for every other value.
 */
export function renderStatusChip(myStatus) {
    if (typeof myStatus !== 'string' || !Object.hasOwn(STATUS_CHIPS, myStatus)) return '';
    const { label, className, icon } = STATUS_CHIPS[myStatus];
    return `<span class="chip chip-sm ${className}"><i class="bi bi-${icon}"></i>${label}</span>`;
}

/**
 * Background behind the banner: shown while it loads and when it fails.
 *
 * @param {Object} event -> Event with `id` and optional `accentColor`.
 * @returns {string} -> CSS gradient in the event colour, else the gradient of its id.
 */
export function bannerBackground(event) {
    const color = typeof event.accentColor === 'string' && HEX_COLOR.test(event.accentColor) ? event.accentColor : '';
    if (!color) return getEventGradient(event.id);
    const full = color.length === 4 ? `#${[...color.slice(1)].map(digit => digit + digit).join('')}` : color;
    return `linear-gradient(135deg, ${full}99 0%, ${full} 100%)`;
}

/**
 * One card of the overview: a link to the event page.
 *
 * @param {Object} event -> Event of GET /api/events (with `myStatus`, series with `seriesDates`).
 * @param {Date} now -> Reference time for "Heute" and "Läuft gerade".
 * @returns {string} -> HTML of an a.event-card; the media carries data-banner-bg for list.js.
 */
export function renderEventCard(event, now) {
    const banner = isValidBannerUrl(event.bannerUrl)
        ? `<img class="event-card-banner" src="${escapeHtml(event.bannerUrl)}" alt="" loading="lazy" data-fallback="hide">`
        : '';
    const category = event.category
        ? `<span class="chip chip-sm event-card-category"><span>${escapeHtml(String(event.category))}</span></span>`
        : '';
    const seriesSize = Array.isArray(event.seriesDates) ? event.seriesDates.length : 1;
    const facts = [
        renderStatusChip(event.myStatus),
        event.accessMode && event.accessMode !== 'open' ? '<span class="chip chip-sm"><i class="bi bi-lock"></i>Rolle nötig</span>' : '',
        event.seriesId ? `<span class="chip chip-sm"><i class="bi bi-arrow-repeat"></i>Serie · ${seriesSize} ${seriesSize === 1 ? 'Termin' : 'Termine'}</span>` : '',
        renderCapacity(event)
    ].join('');
    return `<a class="glass-card event-card" href="#event/${escapeHtml(String(event.id ?? ''))}">`
        + `<div class="event-card-media" data-banner-bg="${escapeHtml(bannerBackground(event))}">${banner}${category}</div>`
        + renderDateTile(event, now)
        + `<div class="event-card-body"><h3 class="event-card-title">${escapeHtml(String(event.title ?? ''))}</h3>${renderEventWhen(event, now)}<div class="event-card-facts">${facts}</div></div>`
        + '</a>';
}

/**
 * Placeholder cards while the overview loads.
 *
 * @param {number} count -> Number of cards.
 * @returns {string} -> HTML of `count` skeleton cards in the card layout.
 */
export function renderEventCardSkeletons(count) {
    const card = '<div class="glass-card event-card" aria-hidden="true">'
        + '<div class="skeleton event-card-skeleton-media"></div>'
        + '<div class="skeleton event-card-skeleton-date"></div>'
        + '<div class="event-card-body"><div class="skeleton skeleton-title"></div><div class="skeleton skeleton-text is-short"></div></div>'
        + '</div>';
    return card.repeat(count);
}
