// Debug panel of the studio: the plugin's own Discord output, requests, hooks and logs from the event stream.
import { escapeHtml } from './ui.js';

const MAX_EVENTS = 500; // same as the studio keeps
const DISCORD = new Set(['dm', 'channel', 'role']);
const KINDS = [
  ['alle', 'Alle'],
  ['discord', 'Discord'],
  ['anfragen', 'Anfragen'],
  ['hooks', 'Hooks'],
  ['logs', 'Logs'],
  ['fehler', 'Fehler'],
];

const NO_LINE = new Set(['lifecycle', 'files']); // studio-internal notices

/** Events of one filter kind; `lifecycle` and `files` events are no debug lines. */
export function filterEvents(events, kind) {
  const list = events.filter((e) => e && !NO_LINE.has(e.type));
  switch (kind) {
    case 'discord': return list.filter((e) => DISCORD.has(e.type));
    case 'anfragen': return list.filter((e) => e.type === 'request');
    case 'hooks': return list.filter((e) => e.type === 'hook');
    case 'logs': return list.filter((e) => e.type === 'log');
    case 'fehler': return list.filter((e) => e.type === 'error');
    default: return list;
  }
}

const clock = (at) => {
  const match = /T(\d\d:\d\d:\d\d)/.exec(String(at || ''));
  return match ? match[1] : '';
};

function linkButton(link) {
  if (!link) return '';
  const label = typeof link === 'object' ? link.label : link;
  return `<span class="dbg-link"><i class="bi bi-box-arrow-up-right"></i> ${escapeHtml(label)}</span>`;
}

const dropped = (data) => (data.result === 'dropped' ? `<div class="dbg-dropped">nicht gesendet: ${escapeHtml(data.reason || '')}</div>` : '');

function body(label, value) {
  if (!value) return '';
  return `<div class="dbg-body"><span class="studio-muted">${escapeHtml(label)}</span><pre>${escapeHtml(value)}</pre></div>`;
}

function line(kind, time, inner) {
  return `<div class="dbg-entry is-${escapeHtml(kind)}"><span class="dbg-time">${escapeHtml(time)}</span><div class="dbg-main">${inner}</div></div>`;
}

/** @returns {string} escaped HTML of one debug event. */
export function renderDebugEntry(event) {
  const d = event.data || {};
  const time = clock(event.at);
  switch (event.type) {
    case 'dm':
      return line('dm', time, `
        <div class="dbg-message"><span class="dbg-avatar" aria-hidden="true"><i class="bi bi-person-fill"></i></span>
          <div><strong>${escapeHtml(d.userName || d.userId || 'Unbekannt')}</strong>
            <div class="dbg-text">${escapeHtml(d.text)}</div>${linkButton(d.link)}</div></div>${dropped(d)}`);
    case 'channel':
      return line('channel', time, `
        <div class="dbg-message"><span class="dbg-avatar" aria-hidden="true"><i class="bi bi-hash"></i></span>
          <div><strong>#${escapeHtml(d.channel)}</strong>
            <div class="dbg-text">${escapeHtml(d.text)}</div>${linkButton(d.link)}</div></div>${dropped(d)}`);
    case 'role': {
      const result = d.result === 'dropped' || d.reason ? ` · nicht ausgeführt: ${escapeHtml(d.reason || '')}` : ` · ${escapeHtml(d.result || 'ok')}`;
      return line('role', time, `<div><i class="bi bi-shield"></i> Rolle ${escapeHtml(d.roleId)} an ${escapeHtml(d.userId)} ${d.give ? 'vergeben' : 'entzogen'}${result}</div>`);
    }
    case 'request':
      return line('request', time, `
        <details><summary>${escapeHtml(d.method)} ${escapeHtml(d.path)} <span class="dbg-code">${escapeHtml(d.status)}</span> ${escapeHtml(d.ms)} ms</summary>
          ${body('Anfrage', d.requestBody)}${body('Antwort', d.responseBody)}</details>`);
    case 'hook':
      return line('hook', time, `<div><i class="bi bi-lightning"></i> Hook ${escapeHtml(d.name)} · ${d.ok ? 'ok' : 'Fehler'}${d.summary ? ` <span class="studio-muted">${escapeHtml(d.summary)}</span>` : ''}${d.ok || !d.error ? '' : `<div class="dbg-dropped">${escapeHtml(d.error)}</div>`}</div>`);
    case 'log':
      return line('log', time, `<div class="dbg-log level-${escapeHtml(d.level)}"><span class="dbg-level">${escapeHtml(d.level)}</span> ${escapeHtml(d.text)}</div>`);
    case 'error':
      return line('error', time, `<div class="dbg-error"><i class="bi bi-exclamation-octagon"></i> <strong>${escapeHtml(d.where)}</strong> ${escapeHtml(d.message)}</div>`);
    default:
      return line('other', time, escapeHtml(event.type));
  }
}

const RECONNECTING = 'Verbindung zum Studio getrennt – versuche erneut …';
const GAVE_UP = 'Verbindung getrennt. Seite mit dem Start-Link neu öffnen.';
const MAX_CONSECUTIVE_ERRORS = 10;

/**
 * Fills `container` with the panel and opens the event stream. Stream, listeners and clear requests
 * end with `signal` (or `dispose()`).
 * @param {HTMLElement} container
 * @param {{ api: object, signal: AbortSignal, createEventSource?: (url: string) => EventSource, onLifecycle?: (data: object) => void,
 *   onFiles?: (event: object) => void, now?: () => number }} options -> `onFiles`: the plugin folder changed on disk.
 * @returns {{ dispose(): void }}
 */
export function mountDebug(container, { api, signal, createEventSource = (url) => new EventSource(url), onLifecycle = () => {}, onFiles = () => {}, now = Date.now }) {
  container.innerHTML = `
    <div class="dbg-head">
      <strong>Debug</strong>
      <select class="studio-input dbg-filter" aria-label="Filter">${KINDS.map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}</select>
      <button type="button" class="studio-btn dbg-clear"><i class="bi bi-trash"></i> Leeren</button>
    </div>
    <div class="dbg-status is-hidden" role="status"></div>
    <div class="dbg-list" role="log"></div>`;
  const listEl = container.querySelector('.dbg-list');
  const filterEl = container.querySelector('.dbg-filter');
  const clearEl = container.querySelector('.dbg-clear');
  const statusEl = container.querySelector('.dbg-status');
  const EMPTY = '<p class="studio-muted dbg-empty">Noch keine Ereignisse.</p>';
  let events = [];
  let kind = 'alle';
  let closed = false;
  let errors = 0;
  let lastLifecycleAt = now(); // lifecycle events of the replayed history are older than this
  // Entries not yet in the DOM and old entries to drop from its start: one DOM write per burst.
  let pendingHtml = [];
  let pendingRemove = 0;
  let domCount = 0;
  let showingHint = false; // the list holds only the „Noch keine Ereignisse“ note
  let scheduled = false;

  const shows = (event) => filterEvents([event], kind).length > 0;

  function setStatus(text) {
    if (!statusEl) return;
    statusEl.textContent = text || '';
    statusEl.classList.toggle('is-hidden', !text);
  }

  /** Full re-render: only for the filter, „Leeren“ and a (re)opened stream. */
  function render() {
    pendingHtml = [];
    pendingRemove = 0;
    if (!listEl) return;
    const shown = filterEvents(events, kind);
    domCount = shown.length;
    showingHint = !shown.length;
    listEl.innerHTML = shown.length ? shown.map(renderDebugEntry).join('') : EMPTY;
    listEl.scrollTop = listEl.scrollHeight;
  }

  function flush() {
    scheduled = false;
    if (closed || !listEl) return;
    const stick = listEl.scrollTop + listEl.clientHeight >= listEl.scrollHeight - 8;
    let remove = pendingRemove;
    pendingRemove = 0;
    while (remove > 0 && domCount > 0) {
      const first = listEl.firstElementChild;
      if (first) first.remove();
      domCount -= 1;
      remove -= 1;
    }
    const html = pendingHtml.slice(remove); // entries trimmed again before they were ever drawn
    pendingHtml = [];
    if (html.length) {
      if (showingHint) { listEl.innerHTML = ''; showingHint = false; }
      listEl.insertAdjacentHTML('beforeend', html.join(''));
      domCount += html.length;
    }
    if (stick) listEl.scrollTop = listEl.scrollHeight;
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(flush);
    else queueMicrotask(flush);
  }

  function add(event) {
    events.push(event);
    if (events.length > MAX_EVENTS) {
      const oldest = events.shift();
      if (shows(oldest)) pendingRemove += 1;
    }
    if (shows(event)) pendingHtml.push(renderDebugEntry(event));
    schedule();
  }

  function lifecycle(event) {
    const at = Date.parse(event.at);
    if (!event.data || event.data.where !== 'child' || !(at > lastLifecycleAt)) return;
    lastLifecycleAt = at;
    onLifecycle(event.data);
  }

  const source = createEventSource(api.eventsUrl());
  // After a reconnect the server replays its whole log, so start from scratch.
  source.addEventListener('open', () => {
    if (closed) return;
    errors = 0;
    setStatus('');
    events = [];
    render();
  });
  source.addEventListener('error', () => {
    if (closed) return;
    errors += 1;
    if (errors >= MAX_CONSECUTIVE_ERRORS) {
      closed = true;
      source.close();
      setStatus(GAVE_UP);
    } else {
      setStatus(RECONNECTING);
    }
  });
  source.addEventListener('studio', (message) => {
    if (closed) return;
    let event;
    try { event = JSON.parse(message.data); } catch { return; }
    if (!event || typeof event !== 'object') return;
    if (errors) { errors = 0; setStatus(''); }
    if (event.type === 'lifecycle') lifecycle(event);
    else if (event.type === 'files') onFiles(event);
    else add(event);
  });

  const dispose = () => {
    closed = true;
    source.close(); // closing twice is harmless
  };
  signal.addEventListener('abort', dispose, { once: true });
  if (signal.aborted) dispose();

  if (filterEl) filterEl.addEventListener('change', () => { kind = filterEl.value; render(); }, { signal });
  if (clearEl) {
    clearEl.addEventListener('click', async () => {
      try { await api.clearEvents(); } catch { /* clearing the own view is enough */ }
      if (signal.aborted) return;
      events = []; // the server does not tell open streams
      render();
    }, { signal });
  }
  render();
  return { dispose };
}
