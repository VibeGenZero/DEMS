'use strict';
// Debug events of the plugin studio: an in-memory log (last 500), its SSE stream and the plugin folder watcher.
const fs = require('node:fs');
const path = require('node:path');

/**
 * Bounded in-memory event log with subscribers.
 *
 * @param {{ max?: number }} options -> Number of events kept; the oldest are dropped.
 * @returns {{ push(event): void, broadcast(event): void, list(): object[], clear(): void, subscribe(fn): () => void }}
 */
function createEventLog({ max = 500 } = {}) {
  let events = [];
  const subscribers = new Set();
  function send(event) {
    for (const fn of subscribers) {
      try { fn(event); } catch { /* a broken subscriber must not stop the others */ }
    }
  }
  return {
    push(event) {
      events.push(event);
      if (events.length > max) events = events.slice(events.length - max);
      send(event);
    },
    /** Send to the open streams only; the log does not keep it (studio-internal notices). */
    broadcast: send,
    list: () => events.slice(),
    clear() { events = []; },
    subscribe(fn) {
      subscribers.add(fn);
      return () => { subscribers.delete(fn); };
    },
  };
}

const frame = (event) => `event: studio\ndata: ${JSON.stringify(event)}\n\n`;

/**
 * SSE handler (raw studio route): replays the log, then streams every new event.
 *
 * @param {{ list(): object[], subscribe(fn): () => void }} log
 * @param {{ heartbeatMs?: number }} options -> Interval of the keep-alive comment.
 * @returns {(req, res) => void}
 */
function eventStream(log, { heartbeatMs = 15000 } = {}) {
  return (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    });
    for (const event of log.list()) res.write(frame(event));
    const unsubscribe = log.subscribe((event) => res.write(frame(event)));
    const heartbeat = setInterval(() => res.write(': ping\n\n'), heartbeatMs);
    heartbeat.unref();
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
    };
    req.on('close', close);
    res.on('close', close);
  };
}

const ignored = (filename) => String(filename).split(/[\\/]/).some((s) => s.startsWith('.') || s === 'node_modules');

/**
 * Watch a plugin folder recursively; a burst of changes calls `onChange` once.
 *
 * @param {string} dir
 * @param {() => void} onChange
 * @param {{ debounceMs?: number }} options
 * @returns {{ close(): void }}
 */
function watchPlugin(dir, onChange, { debounceMs = 300 } = {}) {
  let timer = null;
  const watcher = fs.watch(path.resolve(dir), { recursive: true }, (eventType, filename) => {
    if (filename && ignored(filename)) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      try { onChange(); } catch { /* the caller reports its own errors */ }
    }, debounceMs);
  });
  watcher.on('error', () => { /* folder removed or unreadable: the next open replaces the watcher */ });
  return {
    close() {
      clearTimeout(timer);
      timer = null;
      watcher.close();
    },
  };
}

module.exports = { createEventLog, eventStream, watchPlugin };
