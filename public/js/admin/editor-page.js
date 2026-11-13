/**
 * The event editor as a page (#event-editor/new, #event-editor/<eventId>):
 * opening and closing, the top bar, redrawing the preview while the admin
 * types, and not losing work: unsaved input is kept in the browser
 * (editor-draft.js), restored after a reload and asked about before leaving.
 * The wizard inside it (steps, checks, collect, save) is wizard.js.
 */
import { registerActions } from '../core/actions.js';
import { navigateTo, onRouteLeave, setLeaveGuard } from '../core/router.js';
import { state } from '../core/state.js';
import { showConfirmDialog, showElement, showToast } from '../core/ui.js';
import { clearDraft, formatSavedAt, isDraftStale, readDraft, storeDraft } from './editor-draft.js';
import { setDateChangeHandler } from './wizard-dates.js';
import { cancelWizardPreview, renderWizardPreview } from './wizard-preview.js';
import { WIZARD_TOTAL_STEPS, applyDraft, collectEventDraft, currentWizardStep, fillWizard, loadEventIntoWizard, resetWizard, saveEvent, setWizardMode, wizardGoTo } from './wizard.js';

const ROUTE = 'event-editor';
const NEW_KEY = 'new';
const DEFAULT_RETURN = 'admin';
// EasyMDE measures itself wrongly while its page is still being shown
const EDITOR_REFRESH_DELAY_MS = 200;
// Pause after the last change before the preview is drawn again
const PREVIEW_DELAY_MS = 600;
// Pause after the last change before the input is kept in the browser
const STORE_DELAY_MS = 800;

// From this width the preview has its own column and is always visible (same value in style.css)
export const EDITOR_WIDE_QUERY = '(min-width: 1200px)';

// run: the editor that is open (`{ key, promise }`); returnTo: route shown after closing; prefill: fields for a new event
// baseline: the collected input as loaded (JSON), everything else is unsaved; baseUpdatedAt: `updatedAt` of the loaded event;
// saved: the event was just saved, nothing is left to ask about
const page = { run: null, returnTo: DEFAULT_RETURN, prefill: null, previewTimer: null, storeTimer: null, wired: false, baseline: '', baseUpdatedAt: '', saved: false };

const currentRoute = () => window.location.hash.replace('#', '');
const keyOf = (param) => param || NEW_KEY;

/**
 * Whether the editor shows the preview in its own column.
 *
 * @returns {boolean}
 */
export function isWideEditor() {
    return window.matchMedia(EDITOR_WIDE_QUERY).matches;
}

/**
 * Whether the preview can be seen: always on a wide screen, else while the tab „Vorschau" is chosen.
 *
 * @returns {boolean}
 */
export function isPreviewVisible() {
    return isWideEditor() || document.getElementById('wizard-mode-preview').classList.contains('active');
}

const editId = () => document.getElementById('event-edit-id').value;
const hide = (id) => { document.getElementById(id).style.display = 'none'; };

// Whether the wizard holds input that differs from what was loaded
function isDirty() {
    return !!page.run && JSON.stringify(collectEventDraft()) !== page.baseline;
}

// Keep the unsaved input in the browser; input that is back at the loaded state needs no copy
function storeNow() {
    page.storeTimer = null;
    if (!page.run || page.saved) return;
    if (!isDirty()) {
        clearDraft(editId());
        hide('event-editor-saved');
        return;
    }
    const kept = storeDraft(editId(), { draft: collectEventDraft(), step: currentWizardStep, baseUpdatedAt: page.baseUpdatedAt });
    if (kept) showSavedNote(new Date().toISOString());
}

function showSavedNote(iso) {
    const note = document.getElementById('event-editor-saved');
    note.textContent = formatSavedAt(iso);
    if (note.textContent) showElement(note);
}

// Offer what the browser kept for this editor: restored over the loaded state, or dropped when the event changed since
async function restoreDraft(event) {
    const stored = readDraft(editId());
    if (!stored) return;
    if (isDraftStale(stored, event)) {
        clearDraft(editId());
        showToast('Der gespeicherte Entwurf war veraltet und wurde verworfen.', 'info');
        return;
    }
    await applyDraft(stored.draft);
    wizardGoTo(stored.step);
    showElement(document.getElementById('event-editor-restored'));
    showSavedNote(stored.savedAt);
}

// Leave guard of the router: answers at once unless there is unsaved input to ask about
function mayLeaveEditor(next) {
    if (!page.run || page.saved) return true;
    if (next.route === ROUTE && keyOf(next.param) === page.run.key) return true;
    if (!isDirty()) return true;
    return showConfirmDialog('Ungespeicherte Änderungen verwerfen?', 'Verwerfen');
}

// Closing the tab or reloading: keep the newest input, and let the browser ask
function beforeUnload(event) {
    if (!page.run || page.saved || !isDirty()) return;
    clearTimeout(page.storeTimer);
    storeNow();
    event.preventDefault();
    event.returnValue = '';
}

// Draw the preview of the current input, if anybody can see it
function drawPreview() {
    page.previewTimer = null;
    if (!page.run || !isPreviewVisible()) return undefined;
    return renderWizardPreview(collectEventDraft(), document.getElementById('event-edit-id').value);
}

/**
 * Something in the editor changed (typing, a choice, a date, a click on a builder button).
 * The preview follows after a short pause.
 *
 * @returns {void}
 */
export function editorChanged() {
    if (!page.run) return;
    clearTimeout(page.previewTimer);
    page.previewTimer = setTimeout(drawPreview, PREVIEW_DELAY_MS);
    clearTimeout(page.storeTimer);
    page.storeTimer = setTimeout(storeNow, STORE_DELAY_MS);
}

// Listen once to everything that changes the input; the description editor and the date pickers tell on their own
function wireEditor() {
    if (page.wired) return;
    page.wired = true;
    const form = document.getElementById('event-form');
    for (const type of ['input', 'change', 'click']) form.addEventListener(type, editorChanged);
    setDateChangeHandler(editorChanged);
    window.addEventListener('beforeunload', beforeUnload);
    state.descriptionEditor?.codemirror.on?.('change', editorChanged);
    // Crossing the breakpoint: back to the form, the column shows or hides the preview
    window.matchMedia(EDITOR_WIDE_QUERY).addEventListener('change', () => {
        if (!page.run) return;
        setWizardMode('edit');
        if (isWideEditor()) drawPreview();
    });
}

// Fill the wizard for one key; resolves when the editor is ready
async function startEditor(key) {
    const title = document.getElementById('event-editor-title');
    page.saved = false;
    hide('event-editor-restored');
    hide('event-editor-saved');
    let event = null;
    if (key === NEW_KEY) {
        title.textContent = 'Neues Event';
        await resetWizard();
    } else {
        event = await loadEventIntoWizard(key);
        if (!event) {
            page.run = null;
            showToast('Event nicht gefunden.', 'danger');
            navigateTo(DEFAULT_RETURN);
            return;
        }
        title.textContent = `Event bearbeiten: ${event.title || ''}`;
    }
    // What is loaded now is the saved state; a prefill, restored input and typing are unsaved
    page.baseline = JSON.stringify(collectEventDraft());
    page.baseUpdatedAt = (event && event.updatedAt) || '';
    if (page.prefill) {
        // A template, a poll or an import starts the event: an older kept input does not come back over it
        clearDraft(editId());
        await fillWizard(page.prefill);
        page.prefill = null;
    } else {
        await restoreDraft(event);
    }
    setTimeout(() => state.descriptionEditor?.codemirror.refresh(), EDITOR_REFRESH_DELAY_MS);
    wireEditor();
    // Still this editor (the admin may have left while it loaded): show the column's preview at once
    if (page.run && page.run.key === key && isWideEditor()) await drawPreview();
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
    clearTimeout(page.previewTimer);
    clearTimeout(page.storeTimer);
    page.previewTimer = null;
    page.storeTimer = null;
    cancelWizardPreview();
    // Saved, untouched or discarded on request: nothing to bring back next time.
    // (A reload or a closed tab never comes here, so its input stays kept.)
    if (page.run) clearDraft(page.run.key === NEW_KEY ? '' : page.run.key);
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
    // The router uses a guard up when it lets a navigation through
    setLeaveGuard(mayLeaveEditor);
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
export function closeEventEditor({ saved = false, to = '' } = {}) {
    if (saved) {
        page.saved = true;
        clearTimeout(page.storeTimer);
        page.storeTimer = null;
        clearDraft(editId());
    }
    navigateTo(to || page.returnTo || DEFAULT_RETURN);
}

// „Verwerfen" of the restore banner: forget the kept input and load the editor from scratch
function discardEditorDraft() {
    if (!page.run) return undefined;
    const { key } = page.run;
    clearTimeout(page.storeTimer);
    page.storeTimer = null;
    clearDraft(editId());
    page.run = null;
    return runEditor(key);
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
    discardEditorDraft,
    saveEventFromTopbar
});
