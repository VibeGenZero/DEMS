/**
 * Chat bubble of the event page: a round button bottom right, a hint that
 * pops up once per browser, and the chat panel that asks the event assistant
 * (POST /api/events/:id/ask, streamed). The markup is static in index.html
 * (#event-assistant); detail.js mounts it for an event and the router's
 * leave callback unmounts it. The conversation lives here, for one visit.
 */
import { state } from '../core/state.js';
import { registerActions } from '../core/actions.js';
import { escapeHtml, renderMarkdownSafe, showElement, showToast } from '../core/ui.js';
import { INTERRUPTED_MESSAGE, readEventStream } from './assistant-stream.js';

const TEASER_KEY = 'dems_ai_teaser_seen';
const TEASER_DELAY_MS = 4000;
const HISTORY_TURNS = 6;
const DEFAULT_NAME = 'Event-Assistent';
const GREETING = 'Hi! Ich beantworte Fragen zu diesem Event. Was möchtest du wissen?';
const SEND_FAILED = 'Die Frage konnte nicht gesendet werden. Bitte versuche es noch einmal.';
// Below this width the panel fills the screen (components.css, block ASSISTANT)
const PHONE_QUERY = '(max-width: 575.98px)';

// The event the bubble belongs to: { eventId, title }; null while unmounted
let mounted = null;
// Finished turns as shown: [{ role: 'user' | 'assistant', text }]
let conversation = [];
// The answer that is streaming: { controller, element }
let running = null;
let teaserTimer = null;
let messageCount = 0;
let greeted = false;

const byId = (id) => document.getElementById(id);

function teaserSeen() {
    try {
        return localStorage.getItem(TEASER_KEY) !== null;
    } catch {
        return false;
    }
}

function markTeaserSeen() {
    try {
        localStorage.setItem(TEASER_KEY, new Date().toISOString());
    } catch {
        // Blocked storage: the hint may come back on the next visit
    }
}

function hideTeaser() {
    clearTimeout(teaserTimer);
    teaserTimer = null;
    const teaser = byId('assistant-teaser');
    if (teaser) teaser.style.display = 'none';
}

function isPanelOpen() {
    const panel = byId('assistant-panel');
    return !!panel && panel.style.display !== 'none' && !panel.classList.contains('is-hidden');
}

const isPhone = () => typeof window.matchMedia === 'function' && window.matchMedia(PHONE_QUERY).matches;

/**
 * Show the bubble on an event page.
 *
 * Only while the member assistant is on, a user is logged in and the event is
 * active. Drawing the same event again (after a registration) keeps the
 * conversation; another event starts a new one.
 *
 * @param {Object} event -> Event as GET /api/events/:id answers it.
 * @returns {void}
 */
export function mountEventAssistant(event) {
    const container = byId('event-assistant');
    const section = byId('event-detail-section');
    const info = state.aiInfo || {};
    const allowed = !!(container && event && info.memberAssistant && state.currentUser && event.status === 'active')
        // A late answer for a page that was left already draws nothing
        && !(section && section.style.display === 'none');
    if (!allowed) return unmountEventAssistant();
    const title = String(event.title || '');
    if (mounted && mounted.eventId === event.id) {
        mounted.title = title;
        byId('assistant-event-title').textContent = `Antwortet zu: ${title}`;
        return;
    }
    unmountEventAssistant();
    mounted = { eventId: event.id, title };

    const name = info.assistantName || DEFAULT_NAME;
    byId('assistant-name').textContent = name;
    byId('assistant-teaser-name').textContent = name;
    byId('assistant-teaser-text').textContent = info.teaserText || '';
    byId('assistant-event-title').textContent = `Antwortet zu: ${title}`;
    // Enter in the input submits the form: send instead of loading the page
    byId('assistant-form').onsubmit = (submitEvent) => {
        submitEvent.preventDefault();
        sendAssistantQuestion();
    };
    container.onkeydown = handleKeydown;
    container.style.display = 'block';

    if (info.teaserText && !teaserSeen()) {
        teaserTimer = setTimeout(() => {
            teaserTimer = null;
            if (mounted && !isPanelOpen()) showElement(byId('assistant-teaser'));
        }, TEASER_DELAY_MS);
    }
}

/**
 * Remove the bubble: stops a running answer and forgets the conversation.
 *
 * @returns {void}
 */
export function unmountEventAssistant() {
    hideTeaser();
    stopRunningAnswer();
    mounted = null;
    conversation = [];
    messageCount = 0;
    greeted = false;
    const container = byId('event-assistant');
    if (!container) return;
    container.style.display = 'none';
    container.classList.remove('is-open');
    byId('assistant-panel').style.display = 'none';
    byId('assistant-toggle').setAttribute('aria-expanded', 'false');
    byId('assistant-messages').innerHTML = '';
    byId('assistant-input').value = '';
    setBusy(false);
}

function openPanel() {
    if (!mounted) return;
    markTeaserSeen();
    hideTeaser();
    showElement(byId('assistant-panel'));
    byId('event-assistant').classList.add('is-open');
    byId('assistant-toggle').setAttribute('aria-expanded', 'true');
    if (!greeted) {
        greeted = true;
        appendMessage('is-bot', escapeHtml(GREETING));
    }
    // On a phone the panel covers the page: the focus goes along
    if (isPhone()) byId('assistant-input').focus();
}

function closePanel() {
    stopRunningAnswer();
    byId('assistant-panel').style.display = 'none';
    byId('event-assistant').classList.remove('is-open');
    const toggle = byId('assistant-toggle');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.focus();
}

/**
 * Open or close the chat panel (the round button and the close button).
 *
 * @returns {void}
 */
export function toggleAssistant() {
    if (isPanelOpen()) closePanel();
    else openPanel();
}

/**
 * Close the hint for good in this browser.
 *
 * @returns {void}
 */
export function closeAssistantTeaser() {
    markTeaserSeen();
    hideTeaser();
}

function handleKeydown(keyEvent) {
    if (keyEvent.key !== 'Escape' || !isPanelOpen()) return;
    // The card flight would close the whole event page on the same key
    keyEvent.stopPropagation();
    closePanel();
}

// Append one message bubble; returns its element
function appendMessage(kind, html) {
    const list = byId('assistant-messages');
    const element = document.createElement('div');
    element.id = `assistant-msg-${++messageCount}`;
    element.className = `assistant-message ${kind}`;
    element.innerHTML = html;
    list.appendChild(element);
    list.scrollTop = list.scrollHeight;
    return element;
}

function setBusy(busy) {
    byId('assistant-input').disabled = busy;
    byId('assistant-send').disabled = busy;
    byId('assistant-suggestions').disabled = busy;
}

function stopRunningAnswer() {
    if (!running) return;
    const { controller, element } = running;
    running = null;
    controller.abort();
    // An answer that was stopped on purpose leaves nothing behind
    if (typeof element.remove === 'function') element.remove();
    if (byId('assistant-input')) setBusy(false);
}

const TYPING = '<span class="assistant-typing" aria-hidden="true"><span></span><span></span><span></span></span><span class="visually-hidden">Antwort wird geschrieben …</span>';

function sourceChip(source) {
    if (!source) return '';
    return `<span class="chip chip-sm chip-accent assistant-source"><i class="bi bi-journal-text" aria-hidden="true"></i>Quelle: ${escapeHtml(source)}</span>`;
}

/**
 * Ask the assistant one question and stream the answer into the panel.
 *
 * Does nothing while another answer runs, for an empty question or without
 * a mounted bubble.
 *
 * @param {string} [text] -> The question; without one the text of #assistant-input.
 * @returns {Promise<void>} -> Resolves when the answer is complete, failed or stopped.
 */
export async function sendAssistantQuestion(text) {
    const input = byId('assistant-input');
    const question = String(text ?? input.value ?? '').trim().slice(0, 500);
    if (!mounted || running || !question) return;
    if (!isPanelOpen()) openPanel();
    const { eventId } = mounted;
    const history = conversation.slice(-HISTORY_TURNS);
    // The disabled input loses the focus; it gets it back when the answer is there
    const typing = document.activeElement === input;
    input.value = '';
    appendMessage('is-user', escapeHtml(question));
    const element = appendMessage('is-bot', TYPING);
    element.setAttribute('aria-busy', 'true');
    const controller = new AbortController();
    const run = { controller, element };
    running = run;
    setBusy(true);

    let answer = '';
    const isCurrent = () => running === run;
    const fail = (message) => {
        if (!isCurrent()) return;
        element.className = 'assistant-message is-bot is-warning';
        element.innerHTML = escapeHtml(message);
    };
    try {
        const res = await fetch(`/api/events/${encodeURIComponent(eventId)}/ask`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': state.csrfToken },
            body: JSON.stringify({ question, history }),
            signal: controller.signal
        });
        if (!isCurrent()) return;
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            if (!isCurrent()) return;
            const message = (data && typeof data.error === 'string' && data.error) || SEND_FAILED;
            if (res.status === 404) {
                // The event or the assistant is gone: so is the bubble
                running = null;
                unmountEventAssistant();
                showToast(message, 'warning');
                return;
            }
            fail(message);
            return;
        }
        await readEventStream(res, {
            onToken: (token) => {
                if (!isCurrent()) return;
                answer += token;
                element.innerHTML = escapeHtml(answer).replace(/\n/g, '<br>');
            },
            onDone: ({ source }) => {
                if (!isCurrent()) return;
                if (!answer.trim()) return fail(INTERRUPTED_MESSAGE);
                element.innerHTML = renderMarkdownSafe(answer) + sourceChip(source);
                conversation.push({ role: 'user', text: question }, { role: 'assistant', text: answer });
            },
            onError: fail
        });
    } catch {
        // An aborted request (closed panel, left page) shows nothing
        if (!controller.signal.aborted) fail(INTERRUPTED_MESSAGE);
    } finally {
        if (isCurrent()) {
            running = null;
            element.setAttribute('aria-busy', 'false');
            setBusy(false);
            if (typing && isPanelOpen()) input.focus();
        }
    }
}

registerActions({
    toggleAssistant: () => toggleAssistant(),
    closeAssistantTeaser: () => closeAssistantTeaser(),
    sendAssistantQuestion: () => sendAssistantQuestion(),
    askSuggestedQuestion: (el) => sendAssistantQuestion(el.dataset.question)
});
