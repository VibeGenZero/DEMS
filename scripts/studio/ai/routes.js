'use strict';
/**
 * Chat, apply and undo routes of the studio AI. The chat streams an answer and ends with a
 * checked proposal that lives in studio memory only; `POST /api/ai/apply` is the only path
 * that writes AI output to disk (through the studio file API), `POST /api/ai/undo` restores
 * the disk state before the last apply.
 */
const crypto = require('node:crypto');
const path = require('node:path');
const files = require('../files');
const settings = require('./settings');
const { readBody } = require('../server');
const { createAnswerParser, AnswerError } = require('./answer');
const { loadKnowledge, buildPrompt, PromptError, MAX_ERRORS } = require('./prompt');
const { evaluate, needsRepair, repairMessage } = require('./proposal');
const { AiError, AI_ERROR_MESSAGES } = require('../../../ai/errors');

const { StudioError } = files;
const MANIFEST = 'plugin.json';
const MAX_MESSAGE = 4000;
const MAX_HISTORY = 20;
const TOTAL_TIMEOUT_MS = 20 * 60 * 1000;
const IDLE_TIMEOUT_MS = 120000;
const ERROR_LINE_MAX = 1000;
// Keys shorter than this are not redacted: replacing a short dummy key such as `password` or `test`
// would corrupt ordinary code and text in the answer. Real provider keys are far longer.
const MIN_REDACTED_KEY = 8;
const HASH = /^[0-9a-f]{64}$/;

const NOT_CONFIGURED = 'Die KI ist noch nicht eingerichtet.';
const BUSY = 'Die KI arbeitet noch.';
const INCOMPLETE = 'Die Antwort der KI war unvollständig — eventuell ist die maximale Antwortlänge zu klein.';
const CHANGED = 'Datei wurde inzwischen geändert';
const STALE = 'Der Vorschlag ist nicht mehr aktuell.';
const NOTHING_TO_UNDO = 'Nichts zum Rückgängigmachen.';
const BAD_REQUEST = 'Ungültige Anfrage.';
const STOPPED = 'Der Chat wurde abgebrochen.';
const INTERNAL = 'Interner Fehler im Studio.';

const sha256 = (content) => crypto.createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex');
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

function stringList(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) throw new StudioError(BAD_REQUEST, 400);
  return value;
}

async function readJson(req) {
  const text = await readBody(req);
  if (!text.trim()) return {};
  let body;
  try { body = JSON.parse(text); } catch { body = null; }
  if (!isPlainObject(body)) throw new StudioError(BAD_REQUEST, 400);
  return body;
}

/**
 * The page's chat history as alternating turns: unknown entries dropped, consecutive turns of one
 * role merged, a trailing author turn dropped (`buildPrompt` appends the new message itself).
 */
function normalizeHistory(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new StudioError(BAD_REQUEST, 400);
  const turns = [];
  for (const entry of value.slice(-MAX_HISTORY)) {
    if (!isPlainObject(entry) || (entry.role !== 'user' && entry.role !== 'assistant') || typeof entry.text !== 'string' || !entry.text.trim()) continue;
    const last = turns[turns.length - 1];
    if (last && last.role === entry.role) last.text = `${last.text}\n\n${entry.text}`;
    else turns.push({ role: entry.role, text: entry.text });
  }
  if (turns.length && turns[turns.length - 1].role === 'user') turns.pop();
  return turns;
}

/** @returns {Map<string, { content: string, hash: string|null }>} -> The sent editor buffers by path. */
function readBuffers(dir, value) {
  if (value === undefined || value === null) return new Map();
  if (!Array.isArray(value)) throw new StudioError(BAD_REQUEST, 400);
  const buffers = new Map();
  for (const entry of value) {
    if (!isPlainObject(entry) || typeof entry.path !== 'string' || entry.path === '' || typeof entry.content !== 'string') {
      throw new StudioError(BAD_REQUEST, 400);
    }
    if (entry.hash !== undefined && entry.hash !== null && !(typeof entry.hash === 'string' && HASH.test(entry.hash))) {
      throw new StudioError(BAD_REQUEST, 400);
    }
    const diskHash = files.fileHash(dir, entry.path); // path rules of the file API (throws on a bad path)
    buffers.set(entry.path, { content: entry.content, hash: typeof entry.hash === 'string' ? entry.hash : diskHash });
  }
  return buffers;
}

/**
 * The file set the proposal is built on: the folder's text files with the buffers over them.
 * @returns {{ current: Map<string, string>, bases: Map<string, string|null> }} -> `bases`: the disk hash each file stems from.
 */
function currentSet(dir, buffers) {
  const current = new Map();
  const bases = new Map();
  for (const entry of files.listFiles(dir)) {
    if (!entry.text || !entry.allowed) continue;
    const content = files.readFile(dir, entry.path);
    current.set(entry.path, content);
    bases.set(entry.path, files.fileHash(dir, entry.path));
  }
  for (const [rel, buffer] of buffers) {
    current.set(rel, buffer.content);
    bases.set(rel, buffer.hash);
  }
  return { current, bases };
}

/** Error and lifecycle events of the opened plugin, newest first, as prompt lines. */
function errorLines(events, pluginId) {
  const lines = [];
  for (const event of [...events].reverse()) {
    if (lines.length >= MAX_ERRORS) break;
    if (!event || (event.pluginId && event.pluginId !== pluginId)) continue;
    const d = isPlainObject(event.data) ? event.data : {};
    if (event.type === 'error') {
      const where = d.file ? ` (${d.file}${d.line ? `:${d.line}` : ''})` : '';
      lines.push(`${d.where ? `${d.where}: ` : ''}${String(d.message || 'Fehler')}${where}`.slice(0, ERROR_LINE_MAX));
    } else if (event.type === 'lifecycle' && (d.status === 'error' || d.status === 'failed')) {
      lines.push(d.status === 'error' ? 'Plugin-Status: Fehler' : 'DEMS ist abgestürzt.');
    }
  }
  return lines;
}

function omittedNotice(omitted) {
  const parts = [];
  if (omitted.turns) parts.push(`${omitted.turns} ältere Nachrichten`);
  if (omitted.files.length) parts.push(`Dateien ${omitted.files.join(', ')}`);
  if (omitted.errors) parts.push(`${omitted.errors} Fehlerzeilen`);
  return parts.length ? `Nicht mitgeschickt (zu wenig Platz): ${parts.join('; ')}` : null;
}

/**
 * Replaces the key in streamed text, also when a chunk boundary splits it: the end of the text
 * that could still become the key is held back until the next chunk (or `flush`).
 */
function createRedactor(key) {
  // A key under MIN_REDACTED_KEY characters passes through unchanged (see the constant)
  if (typeof key !== 'string' || key.length < MIN_REDACTED_KEY) return { push: (chunk) => String(chunk), flush: () => '' };
  let held = '';
  return {
    push(chunk) {
      const text = (held + String(chunk)).split(key).join('[Schlüssel entfernt]');
      let keep = Math.min(key.length - 1, text.length);
      while (keep > 0 && !key.startsWith(text.slice(text.length - keep))) keep--;
      held = text.slice(text.length - keep);
      return text.slice(0, text.length - keep);
    },
    flush() {
      const rest = held;
      held = '';
      return rest;
    },
  };
}

/**
 * Console line of a failed chat: code, HTTP status and the network cause code (e.g. ECONNRESET)
 * only, never prompt, answer or key.
 */
function logFailure(err) {
  let code = (err && err.name) || 'Error'; // an unexpected error: its class name, never its text
  if (err instanceof AiError || err instanceof AnswerError || err instanceof PromptError) code = err.code;
  const status = err instanceof AiError && err.status !== undefined ? ` HTTP ${err.status}` : '';
  const detail = err instanceof AiError && err.detail ? ` ${err.detail}` : '';
  console.error(`Studio-KI fehlgeschlagen: ${code}${status}${detail}`);
}

function streamError(err) {
  if (err instanceof AiError) return AI_ERROR_MESSAGES[err.code] || AI_ERROR_MESSAGES.provider_error;
  if (err instanceof AnswerError) return INCOMPLETE;
  if (err instanceof PromptError || err instanceof StudioError) return err.message;
  return INTERNAL;
}

/**
 * @param {object} options
 * @param {string} options.configDir -> Folder of `ai.json`.
 * @param {string} options.repoRoot -> Repository with the SDK guide and types.
 * @param {() => string} options.requireOpen -> Folder of the opened plugin (throws 409 otherwise).
 * @param {{ list(): object[] }} options.log -> Studio event log (plugin errors for `includeErrors`).
 * @param {() => void} options.refresh -> Re-read name and version after a plugin.json change.
 * @param {Function} [options.getAiClient] -> `ai/client.js` `getAiClient` (tests inject a fake).
 * @returns {{ routes: object, reset(): void }}
 */
function createAiRoutes({ configDir, repoRoot, requireOpen, log, refresh, getAiClient = require('../../../ai/client').getAiClient }) {
  let running = null; // { controller } of the chat in progress
  let proposal = null; // { id, dir, files: [{ path, after, base }], unsaved: Map<path, { content, base }> }
  let undo = null; // { dir, entries: [{ path, before: string|null, afterHash }] }

  function reset() {
    if (running) running.controller.abort();
    running = null;
    proposal = null;
    undo = null;
  }

  /** One provider call; streams the explanation and returns the parsed (redacted) answer. */
  async function ask({ client, prompt, maxTokens, signal, key, send }) {
    const parser = createAnswerParser();
    const redactor = createRedactor(key);
    let answer = '';
    let writing = null;
    let streamed = false;
    const feed = (text) => {
      if (!text) return;
      answer += text;
      const out = parser.push(text);
      if (out.text) send('token', { text: out.text });
      if (out.writing && out.writing !== writing) send('status', { text: `Schreibt ${out.writing} …` });
      writing = out.writing;
    };
    const result = await client.chat({
      system: prompt.system,
      messages: prompt.messages,
      maxTokens,
      timeoutMs: TOTAL_TIMEOUT_MS,
      idleTimeoutMs: IDLE_TIMEOUT_MS,
      signal,
      onToken: (piece) => {
        streamed = true;
        feed(redactor.push(piece));
      },
    });
    if (!streamed && result && typeof result.text === 'string') feed(redactor.push(result.text));
    feed(redactor.flush());
    return { ...parser.end(), answer };
  }

  async function chat(req, res) {
    const body = await readJson(req);
    const config = settings.load(configDir);
    if (!settings.isConfigured(config)) throw new StudioError(NOT_CONFIGURED, 409);
    const dir = requireOpen();
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) throw new StudioError('Bitte eine Nachricht eingeben.', 400);
    if (message.length > MAX_MESSAGE) throw new StudioError(`Die Nachricht ist zu lang (höchstens ${MAX_MESSAGE} Zeichen).`, 400);
    const history = normalizeHistory(body.history);
    const open = new Set(stringList(body.open));
    if (running) throw new StudioError(BUSY, 409);
    const buffers = readBuffers(dir, body.buffers);
    const { current, bases } = currentSet(dir, buffers);
    const errors = body.includeErrors === true ? errorLines(log.list(), path.basename(dir)) : [];

    const mine = { controller: new AbortController() };
    running = mine;
    const { signal } = mine.controller;
    // The response closes when the page aborts the fetch or the tab goes away (req 'close'
    // fires once the body is read, so the response is the reliable signal).
    res.on('close', () => { if (!res.writableEnded) mine.controller.abort(); });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    });
    const send = (event, data) => {
      if (res.writableEnded || res.destroyed) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const prompt = buildPrompt({
        knowledge: loadKnowledge(repoRoot),
        files: [...current].map(([rel, content]) => ({ path: rel, content, open: open.has(rel) || buffers.has(rel) })),
        history,
        message,
        errors,
        contextTokens: config.contextTokens,
        maxTokens: config.maxTokens,
      });
      const notice = omittedNotice(prompt.omitted);
      if (notice) send('status', { text: notice });
      const client = getAiClient({ env: settings.toEnv(config) });
      const call = (p) => ask({ client, prompt: p, maxTokens: config.maxTokens, signal, key: config.apiKey, send });

      const first = await call(prompt);
      if (!first.files.length) {
        send('done', { reply: first.reply });
        return;
      }
      send('status', { text: 'Prüfe den Vorschlag …' });
      let reply = first.reply;
      let proposed = first.files;
      let result = evaluate({ current, proposed });
      if (needsRepair(result)) {
        send('status', { text: 'Bessere nach …' });
        const second = await call({
          system: prompt.system,
          messages: [...prompt.messages, { role: 'assistant', text: first.answer }, { role: 'user', text: repairMessage(result) }],
        });
        if (second.files.length) {
          // The repair may resend only the fixed files: it goes over the first answer
          const byPath = new Map(first.files.map((f) => [f.path, f]));
          for (const f of second.files) { byPath.delete(f.path); byPath.set(f.path, f); }
          proposed = [...byPath.values()];
          reply = second.reply || reply;
          send('status', { text: 'Prüfe den Vorschlag …' });
          result = evaluate({ current, proposed });
        }
      }
      if (signal.aborted) { // closed or reset while checking: never keep a stale proposal
        send('error', { error: STOPPED });
        return;
      }
      const id = crypto.randomUUID();
      const changed = new Set(result.files.map((f) => f.path));
      const unsaved = new Map([...buffers].filter(([rel]) => !changed.has(rel)).map(([rel, b]) => [rel, { content: b.content, base: b.hash }]));
      proposal = {
        id,
        dir,
        files: result.files.map((f) => ({ path: f.path, after: f.after, base: f.isNew ? null : bases.get(f.path) })),
        unsaved,
      };
      send('proposal', {
        id,
        reply,
        files: result.files,
        dropped: result.dropped,
        newProblems: result.newProblems,
        oldProblems: result.oldProblems,
        permissionChanges: result.permissionChanges,
        unsaved: [...unsaved.keys()],
      });
    } catch (err) {
      if (signal.aborted) {
        send('error', { error: STOPPED });
        return;
      }
      logFailure(err);
      send('error', { error: streamError(err) });
    } finally {
      if (running === mine) running = null;
      if (!res.writableEnded) res.end();
    }
  }

  /** Put the entries back as they were before a failed write. */
  function rollback(dir, entries) {
    for (const entry of [...entries].reverse()) {
      try {
        if (entry.before === null) files.deleteFile(dir, entry.path);
        else files.writeFile(dir, entry.path, entry.before);
      } catch (err) {
        console.error(`studio ai: ${err && err.message ? err.message : err}`);
      }
    }
  }

  function apply(req, body) {
    const dir = requireOpen();
    const skip = new Set(stringList(body.skip));
    const save = new Set(stringList(body.save));
    if (!proposal || proposal.id !== body.id || proposal.dir !== dir) throw new StudioError(STALE, 409);
    const writes = [
      ...proposal.files.map((f) => ({ path: f.path, content: f.after, base: f.base })),
      ...[...proposal.unsaved].filter(([rel]) => save.has(rel)).map(([rel, b]) => ({ path: rel, content: b.content, base: b.base })),
    ].filter((w) => !skip.has(w.path));
    const conflicts = writes.filter((w) => files.fileHash(dir, w.path) !== w.base).map((w) => w.path);
    if (conflicts.length) return { status: 409, json: { error: CHANGED, conflicts } };

    const entries = [];
    try {
      for (const w of writes) {
        const before = files.fileHash(dir, w.path) === null ? null : files.readFile(dir, w.path);
        files.writeFile(dir, w.path, w.content);
        entries.push({ path: w.path, before, afterHash: sha256(w.content) });
      }
    } catch (err) {
      rollback(dir, entries);
      throw err;
    }
    proposal = null;
    if (entries.length) undo = { dir, entries }; // everything skipped: the previous undo stays
    if (entries.some((e) => e.path === MANIFEST)) refresh();
    return { json: { ok: true, written: entries.map((e) => e.path) } };
  }

  function undoLast() {
    const dir = requireOpen();
    if (!undo || undo.dir !== dir) throw new StudioError(NOTHING_TO_UNDO, 409);
    const { entries } = undo;
    const restored = [];
    const conflicts = [];
    for (const entry of entries) {
      if (files.fileHash(dir, entry.path) !== entry.afterHash) {
        conflicts.push(entry.path);
        continue;
      }
      if (entry.before === null) files.deleteFile(dir, entry.path);
      else files.writeFile(dir, entry.path, entry.before);
      restored.push(entry.path);
    }
    // Cleared only after the loop: a failed write keeps the undo (restored files then count as conflicts)
    undo = null;
    if (restored.includes(MANIFEST)) refresh();
    const json = { ok: true, restored, conflicts };
    if (conflicts.length) json.message = CHANGED;
    return { json };
  }

  return {
    routes: {
      'POST /api/ai/chat': { raw: true, handler: chat },
      'POST /api/ai/apply': apply,
      'POST /api/ai/undo': () => undoLast(),
    },
    reset,
  };
}

module.exports = { createAiRoutes, _test: { normalizeHistory, createRedactor, errorLines } };
