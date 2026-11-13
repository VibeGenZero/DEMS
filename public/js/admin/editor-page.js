/**
 * The event editor as a page (#event-editor/new, #event-editor/<eventId>):
 * opening and closing, the top bar. The wizard inside it (steps, checks,
 * collect, save) is wizard.js.
 */
import { registerActions } from '../core/actions.js';
import { navigateTo, onRouteLeave } from '../core/router.js';
import { state } from '../core/state.js';
import { showToast } from '../core/ui.js';
import { WIZARD_TOTAL_STEPS, currentWizardStep, fillWizard, loadEventIntoWizard, resetWizard, saveEvent, wizardGoTo } from './wizard.js';

const ROUTE = 'event-editor';
const NEW_KEY = 'new';
const DEFAULT_RETURN = 'admin';
// EasyMDE measures itself wrongly while its page is still being shown
const EDITOR_REFRESH_DELAY_MS = 200;

// run: the editor that is open (`{ key, promise }`); returnTo: route shown after closing; prefill: fields for a new event
const page = { run: null, returnTo: DEFAULT_RETURN, prefill: null };

const currentRoute = () => window.location.hash.replace('#', '');
const keyOf = (param) => param || NEW_KEY;

// Fill the wizard for one key; resolves when the editor is ready
async function startEditor(key) {
    const title = document.getElementById('event-editor-title');
    if (key === NEW_KEY) {
        title.textContent = 'Neues Event';
        await resetWizard();
        if (page.prefill) await fillWizard(page.prefill);
        page.prefill = null;
    } else {
        const event = await loadEventIntoWizard(key);
        if (!event) {
            page.run = null;
            showToast('Event nicht gefunden.', 'danger');
            navigateTo(DEFAULT_RETURN);
            return;
        }
        title.textContent = `Event bearbeiten: ${event.title || ''}`;
    }
    setTimeout(() => state.descriptionEditor?.codemirror.refresh(), EDITOR_REFRESH_DELAY_MS);
}

// The editor of a key: the one that is open, else a fresh one
function runEditor(key) {
    document.getElementById('event-editor-section').style.display = 'block';
    if (page.run && page.run.key === key) return page.run.promise;
    const run = { key, promise: null };
    page.run = run;
    run.promise = startEditor(key);
    return run.promise;
}

// Another route is shown: the next visit starts fresh
function leftEditor() {
    page.run = null;
    page.prefill = null;
    page.returnTo = DEFAULT_RETURN;
}

/**
 * Show the editor for the route parameter (called by the router).
 *
 * An editor that openEventEditor() just started for the same key is kept, so
 * what the caller filled in survives the hash change.
 *
 * @param {string} [param] -> "new" or an event id.
 * @returns {Promise<void>} -> Resolves when the wizard is filled.
 */
export function showEventEditor(param) {
    onRouteLeave(leftEditor);
    return runEditor(keyOf(param));
}

/**
 * Open the editor from another page.
 *
 * @param {Object} [options]
 * @param {string} [options.eventId] -> Event to edit; empty = new event.
 * @param {Object} [options.prefill] -> Fields for a new event (shape of fillWizard).
 * @param {string} [options.returnTo] -> Route shown after closing; default: the page the admin is on.
 * @returns {Promise<void>} -> Resolves when the wizard is filled; callers may set further fields then.
 */
export function openEventEditor({ eventId = '', prefill = null, returnTo = '' } = {}) {
    const from = currentRoute();
    const key = keyOf(eventId);
    page.run = null;
    page.prefill = eventId ? null : prefill;
    page.returnTo = returnTo || (from && from.split('/')[0] !== ROUTE ? from : DEFAULT_RETURN);
    navigateTo(`${ROUTE}/${key}`);
    return runEditor(key);
}

/**
 * Leave the editor.
 *
 * @param {Object} [options]
 * @param {boolean} [options.saved] -> The event was saved (nothing unsaved is left behind).
 * @param {string} [options.to] -> Route to show instead of the page the admin came from.
 * @returns {void}
 */
export function closeEventEditor({ to = '' } = {}) {
    navigateTo(to || page.returnTo || DEFAULT_RETURN);
}

// "Speichern" of the top bar. The notify switch and the series scope of an existing
// event live on the last step and must be seen before saving.
function saveEventFromTopbar() {
    const editing = document.getElementById('event-edit-id').value !== '';
    if (editing && currentWizardStep !== WIZARD_TOTAL_STEPS) {
        wizardGoTo(WIZARD_TOTAL_STEPS);
        showToast('Bitte prüfe die Optionen für das Speichern.', 'info');
        return undefined;
    }
    return saveEvent();
}

registerActions({
    showCreateEvent: () => openEventEditor(),
    editEvent: (el) => openEventEditor({ eventId: el.dataset.eventId }),
    closeEventEditor: () => closeEventEditor(),
    saveEventFromTopbar
});
