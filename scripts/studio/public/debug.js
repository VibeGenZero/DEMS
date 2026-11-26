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

/** Events of one filter kind; `lifecycle` events are no debug lines. */
export function filterEvents(events, kind) {
  const list = events.filter((e) => e && e.type !== 'lifecycle');
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
        <details><summary>${escapeHtml(d.method)} ${escapeHtml(d.path)} <span class="dbg-status">${escapeHtml(d.status)}</span> ${escapeHtml(d.ms)} ms</summary>
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

/**
 * Fills `container` with the panel and opens the event stream. Stream, listeners and clear requests
 * end with `signal` (or `dispose()`).
 * @param {HTMLElement} container
 * @param {{ api: object, signal: AbortSignal, createEventSource?: (url: string) => EventSource, onLifecycle?: (data: object) => void }} options
 * @returns {{ dispose(): void }}
 */
export function mountDebug(container, { api, signal, createEventSource = (url) => new EventSource(url), onLifecycle = () => {} }) {
  container.innerHTML = `
    <div class="dbg-head">
      <strong>Debug</strong>
      <select class="studio-input dbg-filter" aria-label="Filter">${KINDS.map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}</select>
      <button type="button" class="studio-btn dbg-clear"><i class="bi bi-trash"></i> Leeren</button>
    </div>
    <div class="dbg-list" role="log"></div>`;
  const listEl = container.querySelector('.dbg-list');
  const filterEl = container.querySelector('.dbg-filter');
  const clearEl = container.querySelector('.dbg-clear');
  let events = [];
  let kind = 'alle';
  let closed = false;

  function render() {
    if (!listEl) return;
    const stick = listEl.scrollTop + listEl.clientHeight >= listEl.scrollHeight - 8;
    const shown = filterEvents(events, kind);
    listEl.innerHTML = shown.length ? shown.map(renderDebugEntry).join('') : '<p class="studio-muted dbg-empty">Noch keine Ereignisse.</p>';
    if (stick) listEl.scrollTop = listEl.scrollHeight;
  }

  const source = createEventSource(api.eventsUrl());
  // After a reconnect the server replays its whole log, so start from scratch.
  source.addEventListener('open', () => { if (!closed) { events = []; render(); } });
  source.addEventListener('studio', (message) => {
    if (closed) return;
    let event;
    try { event = JSON.parse(message.data); } catch { return; }
    if (!event || typeof event !== 'object') return;
    if (event.type === 'lifecycle') {
      if (event.data && event.data.where === 'child') onLifecycle(event.data);
      return;
    }
    events.push(event);
    if (events.length > MAX_EVENTS) events = events.slice(events.length - MAX_EVENTS);
    render();
  });

  const dispose = () => {
    if (closed) return;
    closed = true;
    source.close();
  };
  signal.addEventListener('abort', dispose, { once: true });
  if (signal.aborted) dispose();

  if (filterEl) filterEl.addEventListener('change', () => { kind = filterEl.value; render(); }, { signal });
  if (clearEl) {
    clearEl.addEventListener('click', async () => {
      try { await api.clearEvents(); } catch { /* clearing the own view is enough */ }
      if (signal.aborted || closed) return;
      events = []; // the server does not tell open streams
      render();
    }, { signal });
  }
  render();
  return { dispose };
}
