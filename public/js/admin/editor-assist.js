/**
 * The AI assistant of the event editor: a side panel where the admin
 * describes the event in free text and the AI fills the form, plus two field
 * helpers (rewrite the description, suggest the notes for the assistant).
 * Nothing is saved here: a patch only changes the form, marks the changed
 * fields with „von KI" and can be undone once. The server checks every patch
 * (routes/adminAi.js, ai/eventDraft.js); the editor page mounts this module
 * (editor-page.js).
 */
import { registerActions } from '../core/actions.js';
import { state } from '../core/state.js';
import { escapeHtml, showElement, showToast, toggleElement } from '../core/ui.js';
import { applyDraft, collectEventDraft } from './wizard.js';

const DRAFT_URL = '/api/admin/ai/event-draft';
const TEXT_URL = '/api/admin/ai/text';
// Same limits as the server (ai/eventDraft.js)
const MESSAGE_MAX = 2000;
const HISTORY_TURNS = 6;
const SEND_FAILED = 'Die KI ist gerade nicht erreichbar. Bitte versuche es später noch einmal.';
const UNDO_HINT = 'Rückgängig über den KI-Assistenten möglich.';
const TYPING = '<span class="assistant-typing" aria-hidden="true"><span></span><span></span><span></span></span><span class="visually-hidden">Der KI-Assistent denkt nach …</span>';

/**
 * Field of a draft the AI may set -> id of the element that gets the mark.
 * Covers every field of ALLOWED_DRAFT_FIELDS (ai/draftFields.js); a test keeps them equal.
 */
export const AI_FIELD_INPUTS = Object.freeze({
    title: 'event-title',
    // EasyMDE hides the textarea; its group holds the visible editor
    description: 'event-description-group',
    aiNotes: 'event-ai-notes',
    accentColor: 'event-accent-color',
    category: 'event-category',
    location: 'event-location-text',
    maxParticipants: 'event-max',
    accessMode: 'event-access',
    requiredRoles: 'role-checkboxes',
    approvalMode: 'event-approval',
    allowGuests: 'event-allow-guests',
    allowTentative: 'event-allow-tentative',
    slots: 'slot-editor-area',
    assignRoleId: 'event-assign-role',
    formFields: 'form-fields-builder',
    reminderHours: 'event-reminder',
    checkinMessage: 'event-checkin-message',
    autoCreateChannels: 'event-auto-create-channels',
    channelConfig: 'channel-config-options',
    customBotMessages: 'custom-msg-options',
    announceChannelId: 'event-announce-channel',
    startDate: 'event-start-date',
    endDate: 'event-end-date',
    registrationDeadline: 'event-registration-deadline',
    unregisterDeadline: 'event-unregister-deadline'
});

// mounted: the editor run this panel belongs to (`{ changed }`, changed = editorChanged of the page);
// conversation: turns `{ role, text }` of this run; running: a request is on its way;
// undo: form before the last patch and the button that offers it; marks: field -> { element, chip, clear }
let mounted = null;
let conversation = [];
let running = false;
let undo = null;
let messages = [];
let messageCount = 0;
const marks = new Map();

const byId = (id) => document.getElementById(id);
const isOn = () => !!(state.aiInfo && state.aiInfo.adminAssistant);
const isPanelOpen = () => !byId('event-editor-assist').classList.contains('is-hidden') && byId('event-editor-assist').style.display !== 'none';

// Same value for the form: '20' and 20, an empty list and a missing one are no change
function sameValue(a, b) {
    if (a === null || b === null || typeof a === 'object' || typeof b === 'object') return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    return String(a ?? '') === String(b ?? '');
}

function unmarkField(field) {
    const mark = marks.get(field);
    if (!mark) return;
    marks.delete(field);
    mark.element.classList.remove('is-ai-filled');
    for (const type of ['input', 'change']) mark.element.removeEventListener(type, mark.clear);
    mark.chip.remove();
}

function clearMarks() {
    for (const field of [...marks.keys()]) unmarkField(field);
}

// Accent ring and a „von KI" chip below the field, until the admin edits it
function markField(field) {
    const element = byId(AI_FIELD_INPUTS[field]);
    if (!element) return;
    unmarkField(field);
    const chip = document.createElement('span');
    chip.id = `ai-mark-${field}`;
    chip.className = 'chip chip-sm chip-accent ai-mark';
    chip.innerHTML = '<i class="bi bi-stars" aria-hidden="true"></i>von KI';
    element.classList.add('is-ai-filled');
    element.insertAdjacentElement('afterend', chip);
    const clear = () => unmarkField(field);
    for (const type of ['input', 'change']) element.addEventListener(type, clear);
    marks.set(field, { element, chip, clear });
}

function dropUndo() {
    if (undo && undo.button) undo.button.remove();
    undo = null;
}

// Append one message bubble; returns its element
function appendMessage(kind, html) {
    const list = byId('editor-assist-messages');
    const element = document.createElement('div');
    element.id = `editor-assist-msg-${++messageCount}`;
    element.className = `assistant-message ${kind}`;
    element.innerHTML = html;
    list.appendChild(element);
    messages.push(element);
    list.scrollTop = list.scrollHeight;
    return element;
}

// One level of undo: the button for the last patch, at its message
function offerUndo(element) {
    if (!undo) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'editor-assist-undo';
    button.className = 'btn btn-ghost btn-sm editor-assist-undo';
    button.dataset.click = 'undoEditorAssist';
    button.innerHTML = '<i class="bi bi-arrow-counterclockwise me-1" aria-hidden="true"></i>Rückgängig';
    element.appendChild(button);
    undo.button = button;
}

/**
 * Put AI values into the form: remembers the form for „Rückgängig", fills the
 * changed fields, marks them and tells the editor about the change. The step stays.
 *
 * @param {Object} patch -> Fields of a draft (shape of collectEventDraft()); unknown fields are ignored.
 * @returns {Promise<string[]>} -> The fields that changed.
 */
export async function applyAiPatch(patch) {
    const snapshot = collectEventDraft();
    const changed = Object.keys(patch || {})
        .filter(field => Object.hasOwn(AI_FIELD_INPUTS, field) && !sameValue(patch[field], snapshot[field]));
    if (changed.length === 0) return [];
    const values = Object.fromEntries(changed.map(field => [field, patch[field]]));
    dropUndo();
    undo = { snapshot, button: null };
    await applyDraft({ ...snapshot, ...values });
    changed.forEach(markField);
    if (mounted) mounted.changed();
    syncEditorAssist();
    return changed;
}

function setBusy(busy) {
    byId('editor-assist-input').disabled = busy;
    byId('editor-assist-send').disabled = busy;
}

// The sentence of a refused request, or the general one
async function errorOf(res) {
    const data = await res.json().catch(() => ({}));
    return (data && typeof data.error === 'string' && data.error) || SEND_FAILED;
}

function postJson(url, body) {
    return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': state.csrfToken },
        body: JSON.stringify(body)
    });
}

function replyHtml(reply, questions) {
    const text = reply ? `<p>${escapeHtml(reply)}</p>` : '';
    const list = questions.length ? `<ul class="editor-assist-questions">${questions.map(question => `<li>${escapeHtml(question)}</li>`).join('')}</ul>` : '';
    return text + list;
}

/**
 * Send the text of the panel to the AI and apply the patch it returns.
 * Does nothing while a request runs, for an empty text or while the assistant is off.
 *
 * @returns {Promise<void>}
 */
export async function sendEditorAssist() {
    const input = byId('editor-assist-input');
    const text = String(input.value || '').trim().slice(0, MESSAGE_MAX);
    if (!mounted || !isOn() || running || !text) return;
    const run = mounted;
    const history = conversation.slice(-HISTORY_TURNS);
    input.value = '';
    appendMessage('is-user', escapeHtml(text));
    const element = appendMessage('is-bot', TYPING);
    element.setAttribute('aria-busy', 'true');
    running = true;
    setBusy(true);
    try {
        const res = await postJson(DRAFT_URL, { message: text, draft: collectEventDraft(), history });
        if (mounted !== run) return;
        if (!res.ok) {
            element.className = 'assistant-message is-bot is-warning';
            element.innerHTML = escapeHtml(await errorOf(res));
            return;
        }
        const data = await res.json();
        if (mounted !== run) return;
        const reply = typeof data.reply === 'string' ? data.reply : '';
        const questions = Array.isArray(data.questions) ? data.questions.filter(question => typeof question === 'string') : [];
        element.innerHTML = replyHtml(reply, questions);
        conversation.push({ role: 'user', text }, { role: 'assistant', text: [reply, ...questions].filter(Boolean).join('\n') });
        const changed = await applyAiPatch(data.patch);
        if (changed.length > 0) offerUndo(element);
    } catch {
        if (mounted === run) {
            element.className = 'assistant-message is-bot is-warning';
            element.innerHTML = escapeHtml(SEND_FAILED);
        }
    } finally {
        if (mounted === run) {
            running = false;
            element.setAttribute('aria-busy', 'false');
            setBusy(false);
            if (isPanelOpen()) input.focus();
        }
    }
}

/**
 * „Rückgängig": the form as it was before the last patch; offered once.
 *
 * @returns {Promise<void>}
 */
export async function undoEditorAssist() {
    if (!mounted || !undo) return;
    const { snapshot } = undo;
    dropUndo();
    await applyDraft(snapshot);
    clearMarks();
    mounted.changed();
    syncEditorAssist();
}

// Field helper: one text from the AI into one field, with mark and undo
async function rewriteField({ kind, field, buttonId, done }) {
    const button = byId(buttonId);
    if (!mounted || !isOn() || running || button.disabled) return;
    const run = mounted;
    running = true;
    button.disabled = true;
    try {
        const res = await postJson(TEXT_URL, { kind, draft: collectEventDraft() });
        if (mounted !== run) return;
        if (!res.ok) {
            showToast(await errorOf(res), 'warning');
            return;
        }
        const data = await res.json();
        if (mounted !== run || typeof data.text !== 'string') return;
        const changed = await applyAiPatch({ [field]: data.text });
        if (changed.length === 0) return;
        offerUndo(appendMessage('is-bot', `<p>${escapeHtml(done)}</p>`));
        showToast(UNDO_HINT, 'info');
    } catch {
        if (mounted === run) showToast(SEND_FAILED, 'warning');
    } finally {
        if (mounted === run) {
            running = false;
            button.disabled = false;
            syncEditorAssist();
        }
    }
}

function improveDescription() {
    return rewriteField({ kind: 'improve-description', field: 'description', buttonId: 'event-description-improve', done: 'Beschreibung überarbeitet.' });
}

function suggestAiNotes() {
    return rewriteField({ kind: 'suggest-ai-notes', field: 'aiNotes', buttonId: 'event-ai-notes-suggest', done: 'Zusatzinfos vorgeschlagen.' });
}

function setPanelOpen(open) {
    toggleElement(byId('event-editor-assist'), open);
    byId('event-editor-assist-toggle').setAttribute('aria-expanded', String(open));
    if (open) byId('editor-assist-input').focus();
}

function toggleEditorAssist() {
    if (!mounted || !isOn()) return;
    setPanelOpen(!isPanelOpen());
}

/**
 * Open the panel of the mounted editor (the dashboard's „Mit KI erstellen“).
 * Does nothing while the admin assistant is off or no editor is ready.
 *
 * @returns {void}
 */
export function openEditorAssist() {
    if (!mounted || !isOn()) return;
    setPanelOpen(true);
}

/**
 * Bring the helper buttons up to date with the form („Mit KI verbessern" needs a description).
 * Called by the editor on every change.
 *
 * @returns {void}
 */
export function syncEditorAssist() {
    if (!mounted) return;
    const description = state.descriptionEditor ? state.descriptionEditor.value() : byId('event-description').value;
    if (!running) byId('event-description-improve').disabled = !String(description || '').trim();
}

// Enter sends, Shift+Enter is a new line
function handleKeydown(keyEvent) {
    if (keyEvent.key !== 'Enter' || keyEvent.shiftKey || keyEvent.isComposing) return;
    keyEvent.preventDefault();
    sendEditorAssist();
}

/**
 * Show the assistant for a ready editor: toggle and helpers while the admin
 * assistant is on, a fresh conversation, no marks. Stays hidden while it is off.
 *
 * @param {Object} options
 * @param {Function} options.changed -> Tells the editor that the form changed (editorChanged of editor-page.js).
 * @returns {void}
 */
export function mountEditorAssist({ changed }) {
    unmountEditorAssist();
    const on = isOn();
    toggleElement(byId('event-editor-assist-toggle'), on);
    toggleElement(byId('event-description-improve'), on);
    toggleElement(byId('event-ai-notes-suggest'), on);
    if (!on) return;
    mounted = { changed };
    const input = byId('editor-assist-input');
    input.disabled = false;
    byId('editor-assist-send').disabled = false;
    input.addEventListener('keydown', handleKeydown);
    syncEditorAssist();
}

/**
 * Close the assistant: panel hidden, conversation, undo and marks gone.
 *
 * @returns {void}
 */
export function unmountEditorAssist() {
    if (mounted) byId('editor-assist-input').removeEventListener('keydown', handleKeydown);
    mounted = null;
    running = false;
    clearMarks();
    dropUndo();
    conversation = [];
    for (const element of messages) element.remove();
    messages = [];
    toggleElement(byId('event-editor-assist'), false);
    byId('event-editor-assist-toggle').setAttribute('aria-expanded', 'false');
    byId('editor-assist-input').value = '';
}

/**
 * Saving keeps the form as it is: the „von KI" marks and the undo are done.
 *
 * @returns {void}
 */
export function clearEditorAssistMarks() {
    clearMarks();
    dropUndo();
}

registerActions({
    toggleEditorAssist,
    sendEditorAssist: () => sendEditorAssist(),
    undoEditorAssist: () => undoEditorAssist(),
    improveDescription,
    suggestAiNotes
});
