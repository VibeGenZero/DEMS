/**
 * Error marks of the event wizard: the field turns red (.is-invalid), its
 * sentence shows in the matching .invalid-feedback (.d-block) and the step
 * dot turns red (.has-error). The rules live in wizard-checks.js.
 */
import { STEP_FIELDS } from './wizard-checks.js';

// Field key of checkWizardStep -> id of its input; the sentence goes into "<id>-feedback"
const FIELD_INPUTS = {
    title: 'event-title',
    bannerUrl: 'event-banner-url',
    aiNotes: 'event-ai-notes',
    startDate: 'event-start-date',
    endDate: 'event-end-date',
    registrationDeadline: 'event-registration-deadline',
    unregisterDeadline: 'event-unregister-deadline',
    recurringUntil: 'event-recurring-until',
    maxParticipants: 'event-max',
    reminderHours: 'event-reminder',
    requiredRoles: 'role-checkboxes'
};

// The rows of the two builders share one sentence below their list
const GROUPS = {
    slots: { list: 'slot-editor-rows', row: '.slot-editor-row', inputs: { name: '.slot-name-input', capacity: '.slot-capacity-input' }, feedback: 'slot-editor-feedback' },
    formFields: { list: 'form-fields-builder', row: '.form-field-row', inputs: { label: '.ff-label', options: '.ff-options' }, feedback: 'form-fields-feedback' }
};

function hideFeedback(feedback) {
    if (!feedback) return;
    feedback.textContent = '';
    feedback.classList.remove('d-block');
}

function targetOf(field) {
    const [key, index, part] = field.split('.');
    const group = GROUPS[key];
    if (!group) {
        return { input: document.getElementById(FIELD_INPUTS[key]), feedback: document.getElementById(`${FIELD_INPUTS[key]}-feedback`) };
    }
    const row = document.querySelectorAll(`#${group.list} ${group.row}`)[Number(index)];
    return { input: row ? row.querySelector(group.inputs[part]) : null, feedback: document.getElementById(group.feedback) };
}

function clearField(key) {
    const group = GROUPS[key];
    if (!group) {
        document.getElementById(FIELD_INPUTS[key])?.classList.remove('is-invalid');
        hideFeedback(document.getElementById(`${FIELD_INPUTS[key]}-feedback`));
        return;
    }
    document.querySelectorAll(`#${group.list} .is-invalid`).forEach(input => input.classList.remove('is-invalid'));
    hideFeedback(document.getElementById(group.feedback));
}

/**
 * Show the problems of one step; marks of that step from an earlier check go away.
 *
 * @param {number} step -> 1–5.
 * @param {Array<{field: string, message: string}>} errors -> Result of checkWizardStep().
 * @returns {Element|null} -> First marked input, for the focus.
 */
export function showStepErrors(step, errors) {
    (STEP_FIELDS[step] || []).forEach(clearField);
    let first = null;
    for (const { field, message } of errors) {
        const { input, feedback } = targetOf(field);
        if (input) input.classList.add('is-invalid');
        // One sentence per feedback: the first problem wins
        if (feedback && !feedback.textContent) {
            feedback.textContent = message;
            feedback.classList.add('d-block');
        }
        first = first || input;
    }
    document.getElementById(`wstep-${step}`)?.classList.toggle('has-error', errors.length > 0);
    return first;
}

// A changed field loses its mark at once; the step dot waits for the next check
function clearMarkOf(target) {
    const marked = typeof target?.closest === 'function' ? target.closest('.is-invalid') : null;
    if (!marked) return;
    marked.classList.remove('is-invalid');
    const group = Object.values(GROUPS).find(entry => marked.closest(`#${entry.list}`));
    if (!group) hideFeedback(document.getElementById(`${marked.id}-feedback`));
    else if (!document.getElementById(group.list)?.querySelector('.is-invalid')) hideFeedback(document.getElementById(group.feedback));
}

// Modules run no code on import (test/frontendModules.test.js) -> the form starts listening when the wizard first opens
let listening = false;

function listenForChanges() {
    if (listening) return;
    listening = true;
    const form = document.getElementById('event-form');
    form.addEventListener('input', (event) => clearMarkOf(event.target));
    form.addEventListener('change', (event) => clearMarkOf(event.target));
}

/**
 * Remove every mark; called when the wizard opens.
 *
 * @returns {void}
 */
export function clearAllMarks() {
    listenForChanges();
    for (const step of Object.keys(STEP_FIELDS)) showStepErrors(Number(step), []);
}
