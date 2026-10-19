/**
 * Rules of the event wizard, step by step. Pure: gets the draft of
 * collectEventDraft() (admin/wizard.js) and returns the problems as
 * [{ field, message }]; admin/wizard-marks.js shows them at the fields.
 * Slot limits and sentences mirror normalizeSlots in utils/slotService.js.
 */

export const SLOT_NAME_MAX_LENGTH = 30;
export const SLOT_CAPACITY_MIN = 1;
export const SLOT_CAPACITY_MAX = 100;

// Field keys per step; "slots" and "formFields" stand for all rows of their builder
export const STEP_FIELDS = {
    1: ['title', 'bannerUrl'],
    2: ['startDate', 'endDate', 'registrationDeadline', 'unregisterDeadline', 'recurringUntil'],
    3: ['maxParticipants', 'reminderHours', 'requiredRoles', 'slots'],
    4: ['formFields'],
    5: []
};

export const WIZARD_MESSAGES = {
    title: 'Bitte einen Titel eingeben.',
    bannerUrl: 'Die Banner-URL muss mit http:// oder https:// beginnen.',
    startRequired: 'Aktive Events brauchen ein Startdatum.',
    endBeforeStart: 'Das Ende liegt vor dem Start.',
    registrationDeadlineAfterEnd: 'Der Anmeldeschluss liegt nach dem Ende des Events.',
    unregisterDeadlineAfterEnd: 'Der Abmeldeschluss liegt nach dem Ende des Events.',
    recurringUntil: 'Bis wann soll sich das Event wiederholen?',
    recurringStart: 'Eine Serie braucht ein Startdatum.',
    recurringUntilBeforeStart: '„Wiederholen bis“ liegt vor dem Start.',
    maxParticipants: 'Bitte eine ganze Zahl ab 0 eingeben.',
    reminder: (entry) => `„${entry}“ ist keine Stundenzahl.`,
    requiredRoles: 'Wähle mindestens eine Rolle.',
    slotName: `Jeder Slot braucht einen Namen mit 1–${SLOT_NAME_MAX_LENGTH} Zeichen.`,
    slotNameTaken: (name) => `Slot-Name „${name}“ ist doppelt vergeben.`,
    slotCapacity: (name) => `Slot „${name}“ braucht ${SLOT_CAPACITY_MIN}–${SLOT_CAPACITY_MAX} Plätze.`,
    fieldLabel: 'Jedes Feld braucht ein Label.',
    fieldLabelTaken: (label) => `Das Label „${label}“ gibt es schon. Antworten werden nach dem Label gespeichert.`,
    fieldOptions: 'Ein Auswahlfeld braucht mindestens eine Option.'
};

// Without an end date an event lasts two hours (eventEndTime in utils/eventListing.js)
const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000;
const HTTP_URL = /^https?:\/\//i;
const WHOLE_NUMBER = /^\d+$/;

/**
 * Date of an ISO string.
 *
 * @param {string} value -> ISO date or ''.
 * @returns {Date|null} -> The date, null when there is none.
 */
function dateOf(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function checkBasics(draft, add) {
    if (!String(draft.title ?? '').trim()) add('title', WIZARD_MESSAGES.title);
    const banner = String(draft.bannerUrl ?? '').trim();
    if (banner && !HTTP_URL.test(banner)) add('bannerUrl', WIZARD_MESSAGES.bannerUrl);
}

function checkDates(draft, add) {
    const start = dateOf(draft.startDate);
    const end = dateOf(draft.endDate);
    if (draft.status === 'active' && !start) add('startDate', WIZARD_MESSAGES.startRequired);
    if (start && end && end < start) add('endDate', WIZARD_MESSAGES.endBeforeStart);
    // Deadlines must lie before the end, like validateEvent on the server (W-03)
    if (start) {
        const eventEnd = end && end >= start ? end : new Date(start.getTime() + DEFAULT_DURATION_MS);
        const registrationDeadline = dateOf(draft.registrationDeadline);
        const unregisterDeadline = dateOf(draft.unregisterDeadline);
        if (registrationDeadline && registrationDeadline > eventEnd) add('registrationDeadline', WIZARD_MESSAGES.registrationDeadlineAfterEnd);
        if (unregisterDeadline && unregisterDeadline > eventEnd) add('unregisterDeadline', WIZARD_MESSAGES.unregisterDeadlineAfterEnd);
    }
    if (!draft.recurring) return;
    if (!start && draft.status !== 'active') add('startDate', WIZARD_MESSAGES.recurringStart);
    const until = String(draft.recurringUntil ?? '');
    if (!until) add('recurringUntil', WIZARD_MESSAGES.recurringUntil);
    // The server compares the UTC day of each start with this date
    else if (start && until < start.toISOString().slice(0, 10)) add('recurringUntil', WIZARD_MESSAGES.recurringUntilBeforeStart);
}

function checkSlots(slots, add) {
    const names = new Set();
    slots.forEach((slot, index) => {
        const name = String(slot?.name ?? '').trim();
        if (!name || name.length > SLOT_NAME_MAX_LENGTH) {
            add(`slots.${index}.name`, WIZARD_MESSAGES.slotName);
            return;
        }
        if (names.has(name.toLowerCase())) {
            add(`slots.${index}.name`, WIZARD_MESSAGES.slotNameTaken(name));
            return;
        }
        names.add(name.toLowerCase());
        const capacity = Number(slot.capacity);
        if (!Number.isInteger(capacity) || capacity < SLOT_CAPACITY_MIN || capacity > SLOT_CAPACITY_MAX) {
            add(`slots.${index}.capacity`, WIZARD_MESSAGES.slotCapacity(name));
        }
    });
}

function checkParticipants(draft, add) {
    const slots = Array.isArray(draft.slots) ? draft.slots : [];
    const max = String(draft.maxParticipants ?? '').trim();
    // With slots the places are the sum of the slots; the field is locked then
    if (slots.length === 0 && max && !WHOLE_NUMBER.test(max)) add('maxParticipants', WIZARD_MESSAGES.maxParticipants);
    const unreadable = String(draft.reminderHours ?? '').split(/[\s,;]+/).filter(Boolean)
        .find(entry => !(Number(entry) > 0));
    if (unreadable !== undefined) add('reminderHours', WIZARD_MESSAGES.reminder(unreadable));
    if (draft.accessMode === 'role-required' && !(Array.isArray(draft.requiredRoles) && draft.requiredRoles.length > 0)) {
        add('requiredRoles', WIZARD_MESSAGES.requiredRoles);
    }
    checkSlots(slots, add);
}

function checkFormFields(draft, add) {
    const labels = new Set();
    (Array.isArray(draft.formFields) ? draft.formFields : []).forEach((field, index) => {
        const label = String(field?.label ?? '').trim();
        if (!label) {
            add(`formFields.${index}.label`, WIZARD_MESSAGES.fieldLabel);
            return;
        }
        // Answers are stored by label -> two fields with one label overwrite each other
        if (labels.has(label.toLowerCase())) add(`formFields.${index}.label`, WIZARD_MESSAGES.fieldLabelTaken(label));
        labels.add(label.toLowerCase());
        if (field.type === 'dropdown' && !(Array.isArray(field.options) && field.options.length > 0)) {
            add(`formFields.${index}.options`, WIZARD_MESSAGES.fieldOptions);
        }
    });
}

const STEP_CHECKS = { 1: checkBasics, 2: checkDates, 3: checkParticipants, 4: checkFormFields };

/**
 * Problems of one wizard step.
 *
 * @param {number} step -> 1–5.
 * @param {Object} draft -> Input of collectEventDraft().
 * @returns {Array<{field: string, message: string}>} -> One entry per problem in the order of the form; empty when the step is fine.
 */
export function checkWizardStep(step, draft) {
    const errors = [];
    const check = STEP_CHECKS[step];
    if (check) check(draft || {}, (field, message) => errors.push({ field, message }));
    return errors;
}
