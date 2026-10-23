/**
 * Switch "Teilnehmer benachrichtigen" of the event wizard (W-04): shown when
 * an edit moves the start or the end or changes the location of an active
 * event. The server checks the same again (utils/eventChangeNotice.js) and
 * decides who gets the DM. Split from wizard.js to keep it small.
 */
import { toggleElement } from '../core/ui.js';

// Start, end and location of the event being edited; null while creating one
let loadedEvent = null;
// Whether the switch is on screen at the moment
let switchShown = false;

/**
 * Point in time of a date value.
 *
 * @param {*} value -> ISO string, '' or anything else.
 * @returns {number|null} -> Milliseconds, or null without a valid date.
 */
function timeOf(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? null : time;
}

/**
 * Location as it is compared: text and linked channel.
 *
 * @param {*} location -> `{ text, channelId }` or null.
 * @returns {string|null} -> Comparable key, null without a text.
 */
function placeOf(location) {
    const text = location && typeof location.text === 'string' ? location.text.trim() : '';
    return text ? `${text}\n${location.channelId || ''}` : null;
}

/**
 * Whether the input moves the start or the end or changes the location.
 *
 * @param {Object} loaded -> Stored event values.
 * @param {Object} draft -> Wizard input (collectEventDraft()).
 * @returns {boolean} -> True when participants have to know about it.
 */
export function scheduleChanged(loaded, draft) {
    return timeOf(loaded.startDate) !== timeOf(draft.startDate)
        || timeOf(loaded.endDate) !== timeOf(draft.endDate)
        || placeOf(loaded.location) !== placeOf(draft.location);
}

const notifyCheckbox = () => document.getElementById('event-notify-participants');

function showSwitch(visible) {
    switchShown = visible;
    toggleElement(document.getElementById('wizard-notify'), visible);
}

/**
 * Remember the stored values of the event the wizard edits; the switch starts on again.
 *
 * @param {Object|null} event -> Loaded event, or null for a new one.
 */
export function rememberLoadedEvent(event) {
    loadedEvent = event ? { startDate: event.startDate, endDate: event.endDate, location: event.location } : null;
    notifyCheckbox().checked = true;
    showSwitch(false);
}

/**
 * Show the switch on the last step when an active, edited event changes its schedule or place.
 *
 * @param {Object|null} draft -> Wizard input on the last step (with "Speichern"), null on every other step.
 */
export function updateNotifySwitch(draft) {
    showSwitch(draft !== null && loadedEvent !== null && draft.status === 'active' && scheduleChanged(loadedEvent, draft));
}

/**
 * Whether the save asks the server for change DMs.
 *
 * @returns {boolean} -> True when the switch is shown and on.
 */
export function notifyRequested() {
    return switchShown && notifyCheckbox().checked === true;
}
