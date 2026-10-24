/**
 * Dates of a series in the event wizard (W-11): the choice "Nur dieser
 * Termin" / "Dieser und alle folgenden Termine" next to "Speichern", the
 * locked repeat fields of a series date and the toast after saving. The
 * server decides which dates follow (followingDates in utils/eventSeries.js);
 * the count here only labels the choice. Split from wizard.js to keep it small.
 */
import { toggleElement } from '../core/ui.js';

// Without an end date an event lasts two hours (eventEndTime in utils/eventListing.js)
const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000;
const CHANGEABLE_STATUSES = ['draft', 'active'];

// `{ following, until }` of the edited series date; null for a new or single event
let series = null;
// Whether the choice is on screen at the moment
let scopeShown = false;

const timeOf = (value) => {
    const time = value ? new Date(value).getTime() : NaN;
    return Number.isNaN(time) ? null : time;
};

/**
 * Whether a date is over: its end, else start + 2 hours, has passed.
 *
 * @param {Object} event -> `{ startDate, endDate }`.
 * @param {Date} now -> Current time.
 * @returns {boolean} -> True when it is over; an event without start never is.
 */
function isOver(event, now) {
    const start = timeOf(event.startDate);
    if (start === null) return false;
    const end = timeOf(event.endDate);
    return now.getTime() >= (end !== null && end >= start ? end : start + DEFAULT_DURATION_MS);
}

/**
 * Number of later dates "Dieser und alle folgenden Termine" would change.
 *
 * @param {Array<Object>} dates -> Dates of the series.
 * @param {Object} event -> The edited date as loaded.
 * @param {Date} [now] -> Current time.
 * @returns {number} -> Later, not over, draft or active dates.
 */
export function followingDateCount(dates, event, now = new Date()) {
    const start = timeOf(event.startDate);
    if (start === null) return 0;
    return dates.filter(date => date.id !== event.id
        && (timeOf(date.startDate) ?? -Infinity) > start
        && CHANGEABLE_STATUSES.includes(date.status || 'active')
        && !isOver(date, now)).length;
}

const element = (id) => document.getElementById(id);

/**
 * Remember the series of the event the wizard opens and set up its fields; the choice starts on "Nur dieser Termin".
 *
 * @param {Object|null} event -> Loaded event, or null for a new one.
 * @returns {Promise<void>} -> Resolves when the dates of the series are counted.
 */
export async function rememberSeries(event) {
    series = null;
    element('event-scope-this').checked = true;
    element('event-scope-following').checked = false;
    const inSeries = !!event?.seriesId;
    element('event-recurring').disabled = inSeries;
    element('event-recurring-interval').disabled = inSeries;
    element('event-recurring-until').min = inSeries ? (event.recurringUntil || '') : '';
    toggleElement(element('event-recurring-until-hint'), inSeries);
    updateSeriesScope(false);
    if (!inSeries) return;

    let following = 0;
    try {
        const res = await fetch(`/api/events/series/${encodeURIComponent(event.seriesId)}`);
        const dates = res.ok ? await res.json() : [];
        following = Array.isArray(dates) ? followingDateCount(dates, event) : 0;
    } catch {
        following = 0;
    }
    series = { following, until: event.recurringUntil || '' };
    element('event-scope-following-label').textContent = `Dieser und alle folgenden Termine (${following})`;
}

/**
 * Show the choice on the last step when the edited series date has later dates.
 *
 * @param {boolean} onLastStep -> Whether the wizard shows the step with "Speichern".
 */
export function updateSeriesScope(onLastStep) {
    scopeShown = onLastStep && series !== null && series.following > 0;
    toggleElement(element('wizard-series-scope'), scopeShown);
}

/**
 * Scope of the save for PUT /api/admin/events/:id.
 *
 * @returns {string|null} -> 'following' or 'this' for a series date, null for any other event.
 */
export function seriesScope() {
    if (series === null) return null;
    return scopeShown && element('event-scope-following').checked === true ? 'following' : 'this';
}

/**
 * "Wiederholen bis" stored on the edited series date; the wizard refuses an earlier one.
 *
 * @returns {string} -> `YYYY-MM-DD`, '' for a new or single event.
 */
export function storedRecurringUntil() {
    return series ? series.until : '';
}

/**
 * Toast after an edit was saved.
 *
 * @param {Object} answer -> `{ notifiedCount, updatedDates, createdDates }` of the PUT.
 * @returns {string} -> German message.
 */
export function savedEventToast({ notifiedCount = 0, updatedDates = 0, createdDates = 0 } = {}) {
    const what = updatedDates > 0
        ? `Event und ${updatedDates} ${updatedDates === 1 ? 'folgender Termin' : 'folgende Termine'} aktualisiert`
        : 'Event aktualisiert';
    const told = notifiedCount > 0 ? `${what} – ${notifiedCount} Teilnehmer benachrichtigt.` : `${what}!`;
    if (createdDates <= 0) return told;
    return `${told} ${createdDates} ${createdDates === 1 ? 'neuer Termin' : 'neue Termine'} angelegt.`;
}
