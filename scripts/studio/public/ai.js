// „KI“ column of the studio: chat with the studio AI about the open plugin, its proposals (summary, diff view)
// and their apply/undo. The chat history lives in this column's memory only; opening a plugin starts afresh.
import { openDiffView, renderApplyDialog, renderProposalNotes } from './ai-diff.js';
import { isConfiguredView, openAiSettings } from './ai-settings.js';
import { escapeHtml, showDialog, showToast } from './ui.js';

const MAX_HISTORY = 10; // the request sends the last 10 messages (author and AI together)
const THINKING = 'Denkt nach …';
const ERROR_PROMPT = 'Erkläre und behebe diesen Fehler.';
const STOPPED = 'Der Chat wurde abgebrochen.';
const BROKEN = 'Die Verbindung zur KI wurde unterbrochen.';
const STALE = 'Nicht mehr aktuell.';
const APPLIED = 'Übernommen.';

/**
 * Reads server-sent events from the text received so far (`rest` of the last call + the new chunk).
 * Frames without valid JSON data are skipped; an unfinished frame comes back as `rest`.
 * @returns {{ events: Array<{ event: string, data: any }>, rest: string }}
 */
export function parseSse(text) {
  // A chunk may end between \r and \n: the lone \r stays in `rest` and joins its \n next time
  const frames = String(text).replace(/\r\n/g, '\n').split('\n\n');
  const rest = frames.pop();
  const events = [];
  for (const frame of frames) {
    let event = 'message';
    const data = [];
    for (const line of frame.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      let value = colon < 0 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    if (!data.length) continue;
    try {
      events.push({ event, data: JSON.parse(data.join('\n')) });
    } catch { /* not a frame of the studio */ }
  }
  return { events, rest };
}

/** Escaped text with `code` spans as the only markup. */
function renderInline(text) {
  const parts = String(text || '').split('`');
  if (parts.length % 2 === 0) { // an unmatched backtick stays text
    const last = parts.pop();
    parts[parts.length - 1] += `\`${last}`;
  }
  return parts.map((part, i) => {
    if (i % 2 === 0) return escapeHtml(part);
    return part ? `<code>${escapeHtml(part)}</code>` : '';
  }).join('');
}

/**
 * @param {object} proposal -> The `proposal` event of the chat stream.
 * @param {{ index?: number, applied?: boolean, closed?: string }} [state] -> `applied`: the last apply (offers undo);
 *   `closed`: why the proposal no longer offers anything (e.g. „Verworfen.“).
 * @returns {string} HTML of the proposal under the AI's message.
 */
export function renderProposalSummary(proposal, { index = 0, applied = false, closed = '' } = {}) {
  const files = proposal.files || [];
  const button = (action, label, icon, className = '') => `<button type="button" class="studio-btn${className}" data-action="${action}" data-index="${escapeHtml(index)}"><i class="bi ${icon}"></i> ${label}</button>`;
  const view = button('ai-view', 'Ansehen', 'bi-file-diff');
  let actions;
  if (!files.length) actions = '<span class="studio-muted">Nichts zu übernehmen.</span>'; // every file was dropped
  else if (applied) actions = `<span class="studio-muted">${APPLIED}</span>${view}${button('ai-undo', 'Rückgängig', 'bi-arrow-counterclockwise')}`;
  else if (closed) actions = `<span class="studio-muted">${escapeHtml(closed)}</span>${view}`;
  else actions = `${view}${button('ai-apply', 'Übernehmen', 'bi-check2', ' is-primary')}${button('ai-discard', 'Verwerfen', 'bi-x-lg')}`;
  return `
    <div class="ai-proposal">
      <div class="ai-proposal-title"><i class="bi bi-files"></i> ${files.length} ${files.length === 1 ? 'Datei' : 'Dateien'} geändert</div>
      ${files.length ? `<ul class="ai-file-list">${files.map((f) => `<li><code>${escapeHtml(f.path)}</code>${f.isNew ? ' <span class="ai-badge">neu</span>' : ''}</li>`).join('')}</ul>` : ''}
      ${renderProposalNotes(proposal)}
      <div class="ai-proposal-actions">${actions}</div>
    </div>`;
}

/** @returns {string} escaped HTML of one chat message. */
export function renderMessage({ role, text, status, notices = [], error, proposal, applied, closed, index = 0 }) {
  const mine = role === 'user';
  return `
    <div class="ai-msg ${mine ? 'is-user' : 'is-assistant'}" data-turn="${escapeHtml(index)}">
      <div class="ai-msg-who">${mine ? 'Du' : 'KI'}</div>
      ${notices.map((n) => `<div class="ai-msg-notice studio-muted"><i class="bi bi-info-circle"></i> ${escapeHtml(n)}</div>`).join('')}
      ${text ? `<div class="ai-msg-text">${renderInline(text)}</div>` : ''}
      ${status ? `<div class="ai-msg-status studio-muted"><i class="bi bi-hourglass-split"></i> ${escapeHtml(status)}</div>` : ''}
      ${error ? `<div class="ai-msg-error is-error"><i class="bi bi-exclamation-octagon"></i> ${escapeHtml(error)}</div>` : ''}
      ${proposal ? renderProposalSummary(proposal, { index, applied, closed }) : ''}
    </div>`;
}

/** @returns {string} HTML of the column while no AI connection is set up. */
export function emptyStateHtml() {
  return `
    <div class="ai-empty">
      <i class="bi bi-stars"></i>
      <p>Die KI schreibt und ändert dein Plugin im Gespräch. Richte dafür zuerst eine Verbindung ein (Ollama oder ein Cloud-Anbieter).</p>
      <button type="button" class="studio-btn is-primary" data-action="ai-setup"><i class="bi bi-gear"></i> KI einrichten</button>
    </div>`;
}

/**
 * The history the chat request sends: the last 10 messages; the AI's messages carry their explanation and, instead of
 * the file blocks, „[Dateien: …]“ (the current files go along in full anyway). The running exchange and a request that
 * got no answer are left out; a stopped or broken answer goes along with the text that arrived.
 */
export function chatHistory(messages) {
  const turns = [];
  for (const m of messages) {
    if (m.pending || m.failed) continue;
    let text = String(m.text || '').trim();
    const files = m.role === 'assistant' && m.proposal && Array.isArray(m.proposal.files) ? m.proposal.files : [];
    if (files.length) text = `${text}\n\n[Dateien: ${files.map((f) => f.path).join(', ')}]`.trim();
    if (text) turns.push({ role: m.role, text });
  }
  return turns.slice(-MAX_HISTORY);
}

/**
 * Fills `container` with the chat column.
 * @param {HTMLElement} container
 * @param {{ api: object, signal: AbortSignal, buffers(): Array<{ path: string, content: string, hash?: string }>,
 *   openPaths(): string[], reloadFiles(paths: string[]): Promise<void> }} options -> `buffers`: the unsaved editor
 *   tabs; `reloadFiles`: open tabs take the disk state of these files (written by apply or undo).
 * @returns {{ pluginError(): void, openSettings(): Promise<void> }}
 */
export function mountAi(container, { api, signal, buffers, openPaths, reloadFiles }) {
  container.innerHTML = `
    <div class="ai-head"><strong><i class="bi bi-stars"></i> KI</strong></div>
    <div class="ai-list" role="log"></div>
    <div class="ai-compose is-hidden">
      <div class="ai-chips is-hidden"><button type="button" class="ai-chip" data-action="ai-send-error"><i class="bi bi-bug"></i> Fehler an KI schicken</button></div>
      <textarea class="studio-input ai-input" rows="3" aria-label="Nachricht an die KI" placeholder="Was soll dein Plugin tun? (Enter sendet, Umschalt+Enter: neue Zeile)"></textarea>
      <div class="ai-compose-actions">
        <button type="button" class="studio-btn is-hidden" data-action="ai-stop"><i class="bi bi-stop-fill"></i> Stopp</button>
        <button type="button" class="studio-btn is-primary" data-action="ai-send"><i class="bi bi-send"></i> Senden</button>
      </div>
    </div>`;
  const listEl = container.querySelector('.ai-list');
  const composeEl = container.querySelector('.ai-compose');
  const chipsEl = container.querySelector('.ai-chips');
  const inputEl = container.querySelector('.ai-input');
  const stopEl = container.querySelector('[data-action="ai-stop"]');
  const sendEl = container.querySelector('[data-action="ai-send"]');
  const messages = [];
  let configured = null; // null while the settings load
  let running = null; // AbortController of the chat in progress
  let errorSeen = false;
  let scheduled = false;
  let liveIndex = -1; // index of the streaming AI message in `messages`

  function render() {
    scheduled = false;
    if (signal.aborted) return;
    const stick = listEl.scrollTop + listEl.clientHeight >= listEl.scrollHeight - 8;
    if (configured === null) listEl.innerHTML = '<p class="studio-muted ai-intro">Lade die KI-Einstellungen …</p>';
    else if (!configured) listEl.innerHTML = emptyStateHtml();
    else if (!messages.length) listEl.innerHTML = '<p class="studio-muted ai-intro">Beschreibe, was dein Plugin tun soll, zum Beispiel „Schick nach dem Check-in eine Danke-DM“. Die KI sieht deine Dateien, auch ungespeicherte, und schlägt Änderungen vor – geschrieben wird erst nach „Übernehmen“.</p>';
    else listEl.innerHTML = messages.map((m, index) => renderMessage({ ...m, index })).join('');
    composeEl.classList.toggle('is-hidden', !configured);
    chipsEl.classList.toggle('is-hidden', !errorSeen || Boolean(running));
    stopEl.classList.toggle('is-hidden', !running);
    sendEl.disabled = Boolean(running);
    if (stick) listEl.scrollTop = listEl.scrollHeight;
  }

  // While a chat streams only its message is redrawn: clicks on older buttons and text selections survive
  function renderLive() {
    scheduled = false;
    if (signal.aborted) return;
    const node = running && liveIndex >= 0 ? listEl.querySelector(`[data-turn="${liveIndex}"]`) : null;
    if (!node) { render(); return; }
    const stick = listEl.scrollTop + listEl.clientHeight >= listEl.scrollHeight - 8;
    node.outerHTML = renderMessage({ ...messages[liveIndex], index: liveIndex });
    if (stick) listEl.scrollTop = listEl.scrollHeight;
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(renderLive);
    else queueMicrotask(renderLive);
  }

  async function refreshSettings() {
    try {
      configured = isConfiguredView(await api.aiSettings());
    } catch (err) {
      configured = false;
      if (!signal.aborted) showToast(err.message, 'danger');
    }
    render();
  }

  async function openSettings() {
    try {
      if (await openAiSettings({ api, signal })) await refreshSettings();
    } catch (err) {
      if (!signal.aborted) showToast(err.message, 'danger');
    }
  }

  function handleEvent(live, { event, data }) {
    if (event === 'token') {
      if (live.status === THINKING) live.status = '';
      live.text += String(data.text || '');
    } else if (event === 'status') {
      live.status = String(data.text || '');
      if (data.phase === 'repair') live.text = ''; // the repair round streams a whole new answer
    } else if (event === 'notice') { // what was left out: stays on the message
      live.notices = [...(live.notices || []), String(data.text || '')];
    } else if (event === 'proposal') {
      for (const m of messages) if (m.proposal && !m.applied && !m.closed) m.closed = STALE; // the studio keeps the last one only
      live.proposal = data;
      live.text = String(data.reply || '');
      live.finished = true;
    } else if (event === 'done') {
      live.text = String(data.reply || live.text);
      live.finished = true;
    } else if (event === 'error') {
      live.error = String(data.error || BROKEN);
      live.finished = true;
    }
  }

  async function readStream(response, live) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let rest = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const out = parseSse(rest + decoder.decode(value, { stream: true }));
      rest = out.rest;
      for (const event of out.events) handleEvent(live, event);
      schedule();
    }
  }

  async function send(text, { includeErrors = false } = {}) {
    const message = String(text || '').trim();
    if (!message || running || signal.aborted) return;
    const sent = buffers();
    const user = { role: 'user', text: message };
    const live = { role: 'assistant', text: '', status: THINKING, pending: true, sent: new Map(sent.map((b) => [b.path, b.content])) };
    const history = chatHistory(messages);
    messages.push(user, live);
    liveIndex = messages.length - 1;
    const controller = new AbortController();
    running = controller;
    const stop = () => controller.abort();
    signal.addEventListener('abort', stop, { once: true });
    if (includeErrors) errorSeen = false;
    render();
    let response = null;
    try {
      response = await api.aiChat({ message, history, buffers: sent, open: openPaths(), includeErrors }, { signal: controller.signal });
      await readStream(response, live);
    } catch (err) {
      if (err && err.name === 'AbortError') live.error = STOPPED;
      else if (response) live.error = BROKEN; // the stream broke off (e.g. a TypeError of reader.read())
      else { // the studio refused the request: its German message
        live.error = err.message;
        if (err.status === 409) refreshSettings(); // not configured (any more)?
      }
    } finally {
      liveIndex = -1;
      signal.removeEventListener('abort', stop);
      running = null;
      live.pending = false;
      live.status = '';
      if (!live.finished && !live.error) live.error = BROKEN;
      if (live.error && !live.text && !live.proposal) user.failed = true;
      render();
    }
  }

  async function apply(index) {
    const msg = messages[index];
    if (!msg || !msg.proposal || !(msg.proposal.files || []).length || msg.applied || msg.closed || msg.busy) return;
    const proposal = msg.proposal;
    const unsavedAll = proposal.unsaved || [];
    // Typed in the editor after the message was sent: writing over these files would lose those edits
    const now = new Map(buffers().map((b) => [b.path, b.content]));
    let conflicts = [...proposal.files.map((f) => f.path), ...unsavedAll].filter((p) => now.has(p) && now.get(p) !== msg.sent.get(p));
    msg.busy = true;
    try {
      for (;;) {
        const unsaved = unsavedAll.filter((p) => !conflicts.includes(p));
        let save = unsaved;
        if (unsaved.length || conflicts.length) {
          const answer = await showDialog({
            signal,
            title: 'Vorschlag übernehmen',
            html: renderApplyDialog({ unsaved, conflicts }),
            buttons: [
              { label: 'Abbrechen', value: false },
              { label: conflicts.length ? 'Ohne diese übernehmen' : 'Übernehmen', value: true, className: 'is-primary', primary: true },
            ],
          });
          if (!answer || !answer.value || signal.aborted) return;
          save = answer.checked || [];
        }
        let result;
        try {
          result = await api.aiApply({ id: proposal.id, save, skip: conflicts });
        } catch (err) {
          if (!signal.aborted && Array.isArray(err.conflicts) && err.conflicts.length) {
            conflicts = [...new Set([...conflicts, ...err.conflicts])];
            continue;
          }
          throw err;
        }
        if (signal.aborted) return;
        const written = Array.isArray(result.written) ? result.written : [];
        if (!written.length) { // everything skipped: the studio keeps the previous undo
          msg.closed = 'Nichts übernommen.';
          showToast('Nichts übernommen.', 'info');
          return;
        }
        for (const m of messages) if (m.applied) { m.applied = false; m.closed = APPLIED; } // undo is for the last apply only
        msg.applied = true;
        render();
        await reloadFiles(written);
        showToast(`Übernommen: ${written.join(', ')}`, 'success');
        return;
      }
    } catch (err) {
      if (!signal.aborted) showToast(err.message, 'danger');
    } finally {
      msg.busy = false;
      render();
    }
  }

  async function undo(index) {
    const msg = messages[index];
    if (!msg || !msg.applied || msg.busy) return;
    msg.busy = true;
    try {
      const edited = new Set(buffers().map((b) => b.path)); // typed after the apply: those tabs keep their edits
      const result = await api.aiUndo();
      if (signal.aborted) return;
      msg.applied = false;
      msg.closed = 'Rückgängig gemacht.';
      render();
      await reloadFiles((result.restored || []).filter((p) => !edited.has(p)));
      const conflicts = result.conflicts || [];
      if (conflicts.length) showToast(`Nicht zurückgesetzt, Datei wurde inzwischen geändert: ${conflicts.join(', ')}`, 'warning');
      else showToast('Rückgängig gemacht.', 'success');
    } catch (err) {
      if (signal.aborted) return;
      if (err.status === 409) { msg.applied = false; msg.closed = APPLIED; }
      showToast(err.message, 'danger');
    } finally {
      msg.busy = false;
      render();
    }
  }

  async function view(index) {
    const msg = messages[index];
    if (!msg || !msg.proposal || !(msg.proposal.files || []).length) return;
    const choice = await openDiffView({ proposal: msg.proposal, signal, actions: !msg.applied && !msg.closed });
    if (choice === 'apply') await apply(index);
    else if (choice === 'discard') discard(index);
  }

  function discard(index) {
    const msg = messages[index];
    if (!msg || !msg.proposal || msg.applied || msg.closed) return;
    msg.closed = 'Verworfen.';
    render();
  }

  function sendInput() {
    if (running || !inputEl.value.trim()) return;
    const text = inputEl.value;
    inputEl.value = '';
    send(text);
  }

  const actions = {
    'ai-setup': () => openSettings(),
    'ai-send': () => sendInput(),
    'ai-stop': () => { if (running) running.abort(); },
    'ai-send-error': () => send(ERROR_PROMPT, { includeErrors: true }),
    'ai-view': (index) => view(index),
    'ai-apply': (index) => apply(index),
    'ai-discard': (index) => discard(index),
    'ai-undo': (index) => undo(index),
  };
  container.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    const action = button && !button.disabled && actions[button.dataset.action];
    if (action) action(Number(button.dataset.index));
  }, { signal });
  inputEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      sendInput();
    }
  }, { signal });

  render();
  refreshSettings();

  return {
    /** A plugin `error` event arrived in the debug panel: offer „Fehler an KI schicken“. */
    pluginError() {
      if (signal.aborted) return;
      errorSeen = true;
      render();
    },
    openSettings,
  };
}
