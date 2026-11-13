/**
 * Date pickers of the event wizard (step 2): start, end and the two optional
 * deadlines (W-03). They are created once, when their step is first shown or an
 * event is loaded, and live in `state`.
 */
import { state } from '../core/state.js';

const PICKER_OPTIONS = { enableTime: true, dateFormat: 'Y-m-d H:i', time_24hr: true, locale: 'de' };

// Start and end: state key of the picker and its input
const RANGE_PICKERS = [
    { key: 'startDatePicker', selector: '#event-start-date' },
    { key: 'endDatePicker', selector: '#event-end-date' }
];

// Optional deadlines: state key of the picker, event field and input
export const DEADLINE_PICKERS = [
    { key: 'registrationDeadlinePicker', field: 'registrationDeadline', selector: '#event-registration-deadline' },
    { key: 'unregisterDeadlinePicker', field: 'unregisterDeadline', selector: '#event-unregister-deadline' }
];

/**
 * Create every date picker of the wizard that does not exist yet.
 *
 * @returns {void}
 */
export function ensureDatePickers() {
    [...RANGE_PICKERS, ...DEADLINE_PICKERS].forEach((picker) => {
        if (!state[picker.key]) state[picker.key] = flatpickr(picker.selector, { ...PICKER_OPTIONS });
    });
}

/**
 * ISO value of a deadline picker.
 *
 * @param {string} key -> State key of the picker.
 * @returns {string} -> ISO date, '' when empty or not created yet.
 */
export function deadlineValue(key) {
    const picker = state[key];
    return picker && picker.selectedDates[0] ? picker.selectedDates[0].toISOString() : '';
}
