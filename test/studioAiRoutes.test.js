'use strict';
// Studio AI routes (scripts/studio/ai/routes.js): chat stream, apply and undo, through the real
// studio server with a fake DEMS child and a local fake provider (Ollama dialect) on 127.0.0.1.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { createStudioServer } = require('../scripts/studio/server');
const { createActions } = require('../scripts/studio/actions');
const { createAiRoutes } = require('../scripts/studio/ai/routes');
const { createEventLog } = require('../scripts/studio/events');
const { scaffoldPlugin } = require('../scripts/plugin');
const { estimateTokens } = require('../scripts/studio/ai/prompt');
const { AiError } = require('../ai/errors');

const REPO = path.join(__dirname, '..');
const TOKEN = 'b'.repeat(64);
const KEY = 'sk-studio-geheim-4711-XYZ';
const INCOMPLETE = 'Die Antwort der KI war unvollständig — eventuell ist die maximale Antwortlänge zu klein.';
const CHANGED = 'Datei wurde inzwischen geändert';
const sha256 = (text) => crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const temps = [];
const stops = [];

after(async () => {
  for (const stop of stops) await stop();
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `dems-${prefix}-`)));
  temps.push(dir);
  return dir;
}

async function waitFor(check, ms = 3000) {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) return false;
    await sleep(20);
  }
  return true;
}

const manifest = (id, patch = {}) => `${JSON.stringify({
  id, name: id, version: '0.1.0', sdk: 1.1, description: 'Neues DEMS-Plugin.', author: 'Unbekannt',
  server: 'server.js', client: 'client.js', permissions: [], settings: [], ...patch,
}, null, 2)}\n`;
const block = (file, content) => `<<<DATEI ${file}\n${content}>>>DATEI\n`;
const SERVER = "'use strict';\n// changed by the AI\nmodule.exports = { register() {} };\n";
const SERVER_DM = "module.exports = (ctx) => { ctx.discord.sendDM('1', 'Danke!'); };\n";
const NOTES = '# Notizen\n';
const CLEAN = `Ich ändere server.js und lege notes.md an.\n${block('server.js', SERVER)}${block('notes.md', NOTES)}`;

/** Local provider in the OpenAI dialect; `answers` is a queue of strings (streamed) or handlers. */
async function fakeProvider() {
  const state = { calls: [], answers: [], aborted: 0 };
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    let body = {};
    try { body = JSON.parse(raw || '{}'); } catch { /* keep empty */ }
    const call = { url: req.url, auth: req.headers.authorization, body };
    state.calls.push(call);
    res.on('close', () => { if (!res.writableEnded) state.aborted += 1; });
    const answer = state.answers.shift();
    if (typeof answer === 'function') return answer(req, res, call);
    return stream(res, answer === undefined ? 'Okay.' : answer);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  stops.push(() => new Promise((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }));
  state.port = server.address().port;
  return state;
}

function frame(text) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
}

function stream(res, text, size = 7) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  for (let i = 0; i < text.length; i += size) res.write(frame(text.slice(i, i + size)));
  res.end('data: [DONE]\n\n');
}

function writeSettings(configDir, port, patch = {}) {
  fs.writeFileSync(path.join(configDir, 'ai.json'), JSON.stringify({
    provider: 'ollama', baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: KEY, model: 'test-model',
    maxTokens: 8192, contextTokens: 32768, ...patch,
  }));
}

function parseFrames(text) {
  return text.split('\n\n').filter((chunk) => chunk.trim()).map((chunk) => {
    const event = /^event: (.*)$/m.exec(chunk);
    const data = /^data: (.*)$/m.exec(chunk);
    return { event: event ? event[1] : null, data: data ? JSON.parse(data[1]) : null };
  });
}

function fakeChildFactory() {
  return function createChild() {
    let state = 'stopped';
    return {
      start() { state = 'running'; return Promise.resolve(); },
      restart() { return Promise.resolve(); },
      stop() { state = 'stopped'; return Promise.resolve(); },
      port: () => null,
      status: () => state,
    };
  };
}

/** Studio with an opened, freshly scaffolded plugin and AI settings pointing at a fake provider. */
async function setup({ settings = true, id = 'ki-plugin' } = {}) {
  const provider = await fakeProvider();
  const configDir = tempDir('studio-ai-config');
  if (settings) writeSettings(configDir, provider.port);
  const actions = createActions({
    repoRoot: REPO,
    previewOrigin: () => 'http://127.0.0.1:4101',
    configDir,
    createChild: fakeChildFactory(),
    debounceMs: 60000, // the watcher must not refresh on its own during a test
  });
  const server = createStudioServer({ port: 0, previewPort: 4101, token: TOKEN, routes: actions.routes });
  await server.listen();
  stops.push(async () => { await actions.stop(); await server.close(); });
  const base = server.url;
  const bodies = [];
  async function call(method, pathname, body) {
    const headers = { 'X-Studio-Token': TOKEN, Origin: base };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + pathname, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    bodies.push(text);
    const type = res.headers.get('content-type') || '';
    if (type.includes('event-stream')) return { status: res.status, type, events: parseFrames(text) };
    return { status: res.status, type, data: text ? JSON.parse(text) : null };
  }
  const chat = (body) => call('POST', '/api/ai/chat', { history: [], buffers: [], open: [], includeErrors: false, ...body });
  const parent = tempDir('studio-ai-parent');
  const created = await call('POST', '/api/new', { id, parentDir: parent });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const dir = path.join(parent, id);
  const read = (rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
  return { actions, provider, configDir, base, call, chat, dir, read, bodies, parent };
}

const proposalOf = (res) => (res.events.find((e) => e.event === 'proposal') || {}).data;

function rawRequest(port, method, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers: { Host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', reject);
    if (method !== 'GET') req.end('{}'); else req.end();
  });
}

test('every AI route needs token, Host and Origin', async () => {
  const { base } = await setup();
  const port = Number(new URL(base).port);
  const routes = [['GET', '/api/ai/settings'], ['PUT', '/api/ai/settings'], ['POST', '/api/ai/test'], ['POST', '/api/ai/models'],
    ['POST', '/api/ai/chat'], ['POST', '/api/ai/apply'], ['POST', '/api/ai/undo']];
  for (const [method, urlPath] of routes) {
    const json = { 'Content-Type': 'application/json' };
    assert.equal((await rawRequest(port, method, urlPath, { ...json, Origin: base })).status, 401, `${method} ${urlPath} without token`);
    assert.equal((await rawRequest(port, method, urlPath, { ...json, Origin: base, 'X-Studio-Token': TOKEN, Host: 'evil.example' })).status, 403, `${method} ${urlPath} foreign host`);
    if (method !== 'GET') {
      const res = await rawRequest(port, method, urlPath, { ...json, Origin: 'http://evil.example', 'X-Studio-Token': TOKEN });
      assert.equal(res.status, 403, `${method} ${urlPath} foreign origin`);
      assert.deepEqual(JSON.parse(res.text), { error: 'Ungültiger Ursprung.' });
    }
  }
});

test('chat before settings → 409 „Die KI ist noch nicht eingerichtet.“', async () => {
  const { chat, provider } = await setup({ settings: false });
  const res = await chat({ message: 'Hallo' });
  assert.equal(res.status, 409);
  assert.deepEqual(res.data, { error: 'Die KI ist noch nicht eingerichtet.' });
  assert.equal(provider.calls.length, 0);
});

test('chat refuses a missing or too long message and needs an opened plugin', async () => {
  const { chat } = await setup();
  const long = await chat({ message: 'x'.repeat(4001) });
  assert.equal(long.status, 400);
  assert.deepEqual(long.data, { error: 'Die Nachricht ist zu lang (höchstens 4000 Zeichen).' });
  const empty = await chat({ message: '   ' });
  assert.equal(empty.status, 400);
  assert.deepEqual(empty.data, { error: 'Bitte eine Nachricht eingeben.' });
  const broken = await chat({ message: 'Hallo', buffers: [{ path: '../x.js', content: 'x' }] });
  assert.equal(broken.status, 400);
});

test('chat streams tokens and a proposal; nothing is on disk yet', async () => {
  const { chat, provider, read, dir } = await setup();
  provider.answers.push(CLEAN);
  const before = read('server.js');
  const res = await chat({ message: 'Ändere server.js' });
  assert.equal(res.status, 200);
  assert.match(res.type, /^text\/event-stream/);
  const text = res.events.filter((e) => e.event === 'token').map((e) => e.data.text).join('');
  assert.equal(text, 'Ich ändere server.js und lege notes.md an.\n');
  const statuses = res.events.filter((e) => e.event === 'status').map((e) => e.data.text);
  assert.ok(statuses.includes('Schreibt server.js …'), JSON.stringify(statuses));
  assert.ok(statuses.includes('Schreibt notes.md …'));
  assert.ok(statuses.includes('Prüfe den Vorschlag …'));
  const proposal = proposalOf(res);
  assert.ok(proposal, JSON.stringify(res.events.map((e) => e.event)));
  assert.match(proposal.id, /^[0-9a-f-]{36}$/);
  assert.equal(proposal.reply, 'Ich ändere server.js und lege notes.md an.');
  assert.deepEqual(proposal.files, [
    { path: 'server.js', before, after: SERVER, isNew: false },
    { path: 'notes.md', before: '', after: NOTES, isNew: true },
  ]);
  assert.deepEqual(proposal.dropped, []);
  assert.deepEqual(proposal.newProblems, []);
  assert.deepEqual(proposal.unsaved, []);
  assert.deepEqual(proposal.permissionChanges, { added: [], sdk: null });
  assert.equal(res.events.at(-1).event, 'proposal');
  // nothing written
  assert.equal(read('server.js'), before);
  assert.equal(fs.existsSync(path.join(dir, 'notes.md')), false);
  // the request: streamed, limits, system prompt with the SDK knowledge, files in the user message
  const sent = provider.calls[0].body;
  assert.equal(sent.stream, true);
  assert.equal(sent.model, 'test-model');
  assert.equal(sent.max_completion_tokens, 8192);
  assert.equal(sent.messages[0].role, 'system');
  assert.match(sent.messages[0].content, /<<<DATEI/);
  assert.equal(sent.messages.at(-1).role, 'user');
  assert.match(sent.messages.at(-1).content, /### server\.js/);
  assert.match(sent.messages.at(-1).content, /Auftrag:\nÄndere server\.js$/);
});

test('a reply without blocks ends with done', async () => {
  const { chat, call, provider } = await setup();
  provider.answers.push('Das geht mit ctx.discord.sendDM.\nSoll ich es einbauen?');
  const res = await chat({ message: 'Wie schicke ich eine DM?' });
  assert.equal(res.status, 200);
  assert.equal(res.events.some((e) => e.event === 'proposal'), false);
  assert.deepEqual(res.events.at(-1), { event: 'done', data: { reply: 'Das geht mit ctx.discord.sendDM.\nSoll ich es einbauen?' } });
  assert.equal((await call('POST', '/api/ai/apply', { id: 'x' })).status, 409);
});

test('the history alternates: same-role turns are merged and a trailing user turn is dropped', async () => {
  const { chat, provider } = await setup();
  provider.answers.push('Gut.');
  const res = await chat({
    message: 'Neu',
    history: [
      { role: 'assistant', text: 'Vorab' },
      { role: 'user', text: 'Eins' },
      { role: 'assistant', text: '   ' }, // an empty turn is dropped, so the user turns around it merge
      { role: 'user', text: 'Zwei' },
      { role: 'assistant', text: `Antwort\n${block('server.js', SERVER)}` },
      { role: 'user', text: 'Abgebrochen' },
      { role: 'system', text: 'nope' },
    ],
  });
  assert.equal(res.status, 200);
  const roles = provider.calls[0].body.messages.map((m) => m.role);
  assert.deepEqual(roles, ['system', 'user', 'assistant', 'user']);
  const [, first, second, last] = provider.calls[0].body.messages;
  assert.equal(first.content, 'Eins\n\nZwei');
  assert.equal(second.content, 'Antwort\n[Dateien: server.js]');
  assert.match(last.content, /Auftrag:\nNeu$/);
});

test('includeErrors sends the plugin error events, newest first', async () => {
  const { chat, provider, actions } = await setup();
  actions.log.push({ type: 'error', pluginId: 'ki-plugin', at: '2026-11-27T10:00:00.000Z', data: { message: 'alt', where: 'register' } });
  actions.log.push({ type: 'error', pluginId: 'anderes', at: '2026-11-27T10:00:01.000Z', data: { message: 'fremd', where: 'register' } });
  actions.log.push({ type: 'lifecycle', pluginId: 'ki-plugin', at: '2026-11-27T10:00:02.000Z', data: { status: 'error' } });
  actions.log.push({ type: 'error', pluginId: 'ki-plugin', at: '2026-11-27T10:00:03.000Z', data: { message: 'ctx.foo is not a function', where: 'hook:checkin', file: 'server.js', line: 3 } });
  provider.answers.push('Ok.', 'Ok.');
  await chat({ message: 'Behebe', includeErrors: true });
  const withErrors = provider.calls[0].body.messages.at(-1).content;
  const section = /Aktuelle Fehler:\n([\s\S]*?)\n\n/.exec(withErrors);
  assert.ok(section, withErrors.slice(-500));
  assert.deepEqual(section[1].split('\n'), [
    '- hook:checkin: ctx.foo is not a function (server.js:3)',
    '- Plugin-Status: Fehler',
    '- register: alt',
  ]);
  await chat({ message: 'Ohne' });
  assert.equal(provider.calls[1].body.messages.at(-1).content.includes('Aktuelle Fehler'), false);
});

test('a new missing permission triggers exactly one repair call', async () => {
  const { chat, provider } = await setup();
  const fixed = manifest('ki-plugin', { permissions: ['discord:dm'] });
  provider.answers.push(`Ich schicke eine DM.\n${block('server.js', SERVER_DM)}`, `Berechtigung ergänzt.\n${block('plugin.json', fixed)}`);
  const res = await chat({ message: 'Schick eine DM' });
  assert.equal(provider.calls.length, 2);
  const repair = provider.calls[1].body.messages;
  assert.equal(repair.at(-2).role, 'assistant');
  assert.match(repair.at(-2).content, /<<<DATEI server\.js/);
  assert.equal(repair.at(-1).role, 'user');
  assert.match(repair.at(-1).content, /^Bitte korrigiere:\n- .*discord:dm/);
  const statuses = res.events.filter((e) => e.event === 'status').map((e) => e.data.text);
  assert.ok(statuses.includes('Bessere nach …'), JSON.stringify(statuses));
  const repairStatus = res.events.filter((e) => e.event === 'status' && e.data.phase === 'repair');
  assert.equal(repairStatus.length, 1, 'the repair status carries phase "repair"');
  const proposal = proposalOf(res);
  assert.deepEqual(proposal.newProblems, []);
  assert.equal(proposal.reply, 'Berechtigung ergänzt.');
  assert.deepEqual(proposal.files.map((f) => f.path).sort(), ['plugin.json', 'server.js']);
  assert.deepEqual(proposal.permissionChanges, { added: [], sdk: null });
});

test('a repair that still fails is shown with its problems, never a third call', async () => {
  const { chat, provider } = await setup();
  provider.answers.push(`DM.\n${block('server.js', SERVER_DM)}`, 'Ich weiß nicht weiter.');
  const res = await chat({ message: 'Schick eine DM' });
  assert.equal(provider.calls.length, 2);
  const proposal = proposalOf(res);
  assert.equal(proposal.reply, 'DM.');
  assert.ok(proposal.newProblems.some((p) => p.message.includes('discord:dm')));
  assert.deepEqual(proposal.permissionChanges.added, ['discord:dm']);
});

test('an unterminated block ends with the incomplete error and no proposal', async (t) => {
  const logged = [];
  t.mock.method(console, 'error', (...args) => { logged.push(args.join(' ')); });
  const { chat, provider, call, read } = await setup();
  const before = read('server.js');
  provider.answers.push(`Hier kommt es.\n<<<DATEI server.js\n${SERVER}`);
  const res = await chat({ message: 'Ändere' });
  assert.equal(res.status, 200);
  assert.equal(res.events.some((e) => e.event === 'proposal'), false);
  assert.deepEqual(res.events.at(-1), { event: 'error', data: { error: INCOMPLETE } });
  assert.deepEqual(logged, ['Studio-KI fehlgeschlagen: incomplete']);
  assert.equal(read('server.js'), before);
  const apply = await call('POST', '/api/ai/apply', { id: 'x' });
  assert.equal(apply.status, 409);
});

test('a second chat while one runs → 409; closing the request aborts the fake upstream', async () => {
  const { base, chat, provider } = await setup();
  provider.answers.push((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(frame('Ich denke'));
    // never ends: the studio must abort it
  });
  const controller = new AbortController();
  const first = await fetch(`${base}/api/ai/chat`, {
    method: 'POST',
    headers: { 'X-Studio-Token': TOKEN, Origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Lang', history: [], buffers: [] }),
    signal: controller.signal,
  });
  assert.equal(first.status, 200);
  const reader = first.body.getReader();
  const { value } = await reader.read();
  assert.match(Buffer.from(value).toString('utf8'), /event: token/);

  const busy = await chat({ message: 'Noch eine' });
  assert.equal(busy.status, 409);
  assert.deepEqual(busy.data, { error: 'Die KI arbeitet noch.' });

  controller.abort();
  assert.ok(await waitFor(() => provider.aborted === 1), 'the fake upstream saw the socket close');
  provider.answers.push('Wieder frei.');
  let next;
  for (let i = 0; i < 150; i++) { // the studio releases the lock once the aborted upstream call has failed
    next = await chat({ message: 'Jetzt' });
    if (next.status !== 409) break;
    await sleep(20);
  }
  assert.equal(next.status, 200);
  assert.deepEqual(next.events.at(-1), { event: 'done', data: { reply: 'Wieder frei.' } });
});

test('opening another plugin aborts a running chat', async () => {
  const { base, call, chat, provider, parent } = await setup();
  provider.answers.push((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(frame(`Ich schreibe.\n<<<DATEI server.js\n${SERVER}`));
  });
  const running = fetch(`${base}/api/ai/chat`, {
    method: 'POST',
    headers: { 'X-Studio-Token': TOKEN, Origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Lang' }),
  }).then((res) => res.text());
  assert.ok(await waitFor(() => provider.calls.length === 1));
  assert.equal((await call('POST', '/api/new', { id: 'drittes-plugin', parentDir: parent })).status, 200);
  const events = parseFrames(await running);
  assert.deepEqual(events.at(-1), { event: 'error', data: { error: 'Der Chat wurde abgebrochen.' } });
  assert.equal(events.some((e) => e.event === 'proposal'), false);
  assert.ok(await waitFor(() => provider.aborted === 1), 'the upstream request was aborted');
  provider.answers.push('Frei.');
  assert.equal((await chat({ message: 'Weiter' })).status, 200);
});

test('chat passes limits, timeouts and the abort signal to the client', async () => {
  const configDir = tempDir('studio-ai-direct');
  writeSettings(configDir, 9, { maxTokens: 4096, contextTokens: 65536 });
  const dir = scaffoldPlugin('direkt-plugin', tempDir('studio-ai-direct-parent'));
  const seen = {};
  const ai = createAiRoutes({
    configDir,
    repoRoot: REPO,
    requireOpen: () => dir,
    log: createEventLog(),
    refresh: () => {},
    getAiClient: (options) => {
      seen.options = options;
      return { chat: async (args) => { seen.args = args; args.onToken('Hallo.'); return { text: 'Hallo.' }; } };
    },
  });
  const server = createStudioServer({ port: 0, previewPort: 4101, token: TOKEN, routes: ai.routes });
  await server.listen();
  stops.push(() => server.close());
  const res = await fetch(`${server.url}/api/ai/chat`, {
    method: 'POST',
    headers: { 'X-Studio-Token': TOKEN, Origin: server.url, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Hi' }),
  });
  assert.deepEqual(parseFrames(await res.text()).at(-1), { event: 'done', data: { reply: 'Hallo.' } });
  assert.equal(seen.options.env.AI_PROVIDER, 'ollama');
  assert.equal(seen.args.maxTokens, 4096);
  assert.equal(seen.args.timeoutMs, 20 * 60 * 1000);
  assert.equal(seen.args.idleTimeoutMs, 120000);
  assert.equal(seen.args.firstByteTimeoutMs, 300000, 'the first chunk may take 300 s (prompt processing)');
  assert.ok(seen.args.signal instanceof AbortSignal);
  assert.equal(typeof seen.args.onToken, 'function');
});

test('the chat body has the studio body limit', async () => {
  const { base } = await setup();
  const res = await fetch(`${base}/api/ai/chat`, {
    method: 'POST',
    headers: { 'X-Studio-Token': TOKEN, Origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'x', buffers: [{ path: 'a.js', content: 'y'.repeat(4 * 1024 * 1024) }] }),
  });
  assert.equal(res.status, 413);
  assert.deepEqual(await res.json(), { error: 'Die Anfrage ist zu groß.' });
});

test('apply writes the files, creates new ones and calls refresh for plugin.json', async () => {
  const { chat, call, provider, read } = await setup();
  provider.answers.push(`Neu.\n${block('server.js', SERVER)}${block('notes.md', NOTES)}${block('plugin.json', manifest('ki-plugin', { name: 'KI-Plugin' }))}`);
  const proposal = proposalOf(await chat({ message: 'Los' }));
  const res = await call('POST', '/api/ai/apply', { id: proposal.id });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.deepEqual(res.data, { ok: true, written: ['server.js', 'notes.md', 'plugin.json'] });
  assert.equal(read('server.js'), SERVER);
  assert.equal(read('notes.md'), NOTES);
  const state = await call('GET', '/api/state');
  assert.equal(state.data.plugin.name, 'KI-Plugin');
  // a proposal is applied once
  const again = await call('POST', '/api/ai/apply', { id: proposal.id });
  assert.equal(again.status, 409);
  assert.deepEqual(again.data, { error: 'Der Vorschlag ist nicht mehr aktuell.' });
});

test('apply refuses a file changed on disk since the proposal; skip writes the rest', async () => {
  const { chat, call, provider, read, dir } = await setup();
  provider.answers.push(CLEAN);
  const proposal = proposalOf(await chat({ message: 'Los' }));
  fs.writeFileSync(path.join(dir, 'server.js'), '// saved by hand\n');
  const refused = await call('POST', '/api/ai/apply', { id: proposal.id });
  assert.equal(refused.status, 409);
  assert.deepEqual(refused.data, { error: CHANGED, conflicts: ['server.js'] });
  assert.equal(fs.existsSync(path.join(dir, 'notes.md')), false, 'nothing written on a conflict');
  const skipped = await call('POST', '/api/ai/apply', { id: proposal.id, skip: ['server.js'] });
  assert.equal(skipped.status, 200, JSON.stringify(skipped.data));
  assert.deepEqual(skipped.data, { ok: true, written: ['notes.md'] });
  assert.equal(read('server.js'), '// saved by hand\n');
  assert.equal(read('notes.md'), NOTES);
});

test('a buffer hash is the base: a buffer of an older disk state is a conflict', async () => {
  const { chat, call, provider, read } = await setup();
  provider.answers.push(`Neu.\n${block('server.js', SERVER)}`);
  const stale = sha256('// what the editor loaded long ago\n');
  const proposal = proposalOf(await chat({ message: 'Los', buffers: [{ path: 'server.js', content: '// typing\n', hash: stale }] }));
  assert.equal(proposal.files[0].before, '// typing\n');
  const res = await call('POST', '/api/ai/apply', { id: proposal.id });
  assert.equal(res.status, 409);
  assert.deepEqual(res.data.conflicts, ['server.js']);
  assert.notEqual(read('server.js'), SERVER);
});

test('apply also saves the listed unsaved buffers', async () => {
  const { chat, call, provider, read } = await setup();
  const css = read('client.css');
  const js = read('client.js');
  provider.answers.push(`Neu.\n${block('server.js', SERVER)}`);
  const res = await chat({
    message: 'Los',
    buffers: [
      { path: 'client.css', content: '/* edited */\n', hash: sha256(css) },
      { path: 'client.js', content: '// half typed\n', hash: sha256(js) },
      { path: 'server.js', content: '// buffer\n', hash: sha256(read('server.js')) },
    ],
    open: ['client.css'],
  });
  const proposal = proposalOf(res);
  assert.deepEqual(proposal.unsaved, ['client.css', 'client.js']);
  const applied = await call('POST', '/api/ai/apply', { id: proposal.id, save: ['client.css'] });
  assert.equal(applied.status, 200, JSON.stringify(applied.data));
  assert.deepEqual(applied.data, { ok: true, written: ['server.js', 'client.css'] });
  assert.equal(read('client.css'), '/* edited */\n');
  assert.equal(read('client.js'), js, 'a buffer not listed in save stays unsaved');
  assert.equal(read('server.js'), SERVER);
  const undo = await call('POST', '/api/ai/undo');
  assert.equal(undo.status, 200);
  assert.equal(read('client.css'), css, 'undo restores the disk state before the apply, saved buffers included');
});

test('undo restores replaced files and deletes created ones', async () => {
  const { chat, call, provider, read, dir } = await setup();
  const before = read('server.js');
  provider.answers.push(CLEAN);
  const proposal = proposalOf(await chat({ message: 'Los' }));
  assert.equal((await call('POST', '/api/ai/apply', { id: proposal.id })).status, 200);
  const undo = await call('POST', '/api/ai/undo');
  assert.equal(undo.status, 200, JSON.stringify(undo.data));
  assert.deepEqual(undo.data, { ok: true, restored: ['server.js', 'notes.md'], conflicts: [] });
  assert.equal(read('server.js'), before);
  assert.equal(fs.existsSync(path.join(dir, 'notes.md')), false);
  const again = await call('POST', '/api/ai/undo');
  assert.equal(again.status, 409);
  assert.deepEqual(again.data, { error: 'Nichts zum Rückgängigmachen.' });
});

test('undo keeps a file saved by hand afterwards', async () => {
  const { chat, call, provider, read, dir } = await setup();
  provider.answers.push(CLEAN);
  const proposal = proposalOf(await chat({ message: 'Los' }));
  await call('POST', '/api/ai/apply', { id: proposal.id });
  fs.writeFileSync(path.join(dir, 'server.js'), '// my own fix\n');
  const undo = await call('POST', '/api/ai/undo');
  assert.equal(undo.status, 200);
  assert.deepEqual(undo.data, { ok: true, restored: ['notes.md'], conflicts: ['server.js'], message: CHANGED });
  assert.equal(read('server.js'), '// my own fix\n');
  assert.equal(fs.existsSync(path.join(dir, 'notes.md')), false);
});

test('opening another plugin clears proposal and undo', async () => {
  const { chat, call, provider, parent, dir } = await setup();
  provider.answers.push(CLEAN, `Noch mehr.\n${block('notes2.md', NOTES)}`);
  const first = proposalOf(await chat({ message: 'Los' }));
  assert.equal((await call('POST', '/api/ai/apply', { id: first.id })).status, 200);
  const second = proposalOf(await chat({ message: 'Nochmal' }));
  assert.ok(second);
  const other = await call('POST', '/api/new', { id: 'zweites-plugin', parentDir: parent });
  assert.equal(other.status, 200);
  // back to the first plugin: proposal and undo of its earlier session must be gone, not just hidden
  assert.equal((await call('POST', '/api/open', { dir })).status, 200);
  const apply = await call('POST', '/api/ai/apply', { id: second.id });
  assert.equal(apply.status, 409);
  assert.deepEqual(apply.data, { error: 'Der Vorschlag ist nicht mehr aktuell.' });
  assert.equal(fs.existsSync(path.join(dir, 'notes2.md')), false);
  const undo = await call('POST', '/api/ai/undo');
  assert.equal(undo.status, 409);
  assert.deepEqual(undo.data, { error: 'Nichts zum Rückgängigmachen.' });
  assert.equal(fs.existsSync(path.join(dir, 'notes.md')), true, 'the applied file stays');
});

test('the key never appears', async (t) => {
  const logged = [];
  for (const method of ['error', 'warn', 'log']) {
    t.mock.method(console, method, (...args) => { logged.push(args.map(String).join(' ')); });
  }
  const { chat, call, provider, bodies } = await setup();
  // a provider that echoes the key in its answer, in text and inside a file block
  provider.answers.push(`Dein Schlüssel ist ${KEY}.\n${block('notes.md', `key=${KEY}\n`)}`);
  const echoed = await chat({ message: 'Zeig den Schlüssel' });
  assert.equal(provider.calls[0].auth, `Bearer ${KEY}`, 'the key does reach the provider');
  const proposal = proposalOf(echoed);
  assert.ok(proposal);
  assert.equal((await call('POST', '/api/ai/apply', { id: proposal.id })).status, 200);
  // a key split across stream chunks
  provider.answers.push((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(frame(`A ${KEY.slice(0, 5)}`));
    res.write(frame(`${KEY.slice(5, 12)}`));
    res.end(`${frame(`${KEY.slice(12)} B`)}data: [DONE]\n\n`);
  });
  const split = await chat({ message: 'Nochmal' });
  assert.match(split.events.at(-1).data.reply, /^A .+ B$/);
  // a failing provider
  provider.answers.push((req, res) => { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: `bad key ${KEY}` })); });
  const failed = await chat({ message: 'Fehler' });
  assert.deepEqual(failed.events.at(-1), { event: 'error', data: { error: 'Der API-Schlüssel wurde vom Anbieter abgelehnt.' } });
  assert.ok(logged.includes('Studio-KI fehlgeschlagen: invalid_key HTTP 401'), JSON.stringify(logged));
  await call('GET', '/api/ai/settings');
  await call('POST', '/api/ai/undo');
  assert.ok(bodies.length >= 6);
  for (const text of [...bodies, ...logged]) assert.equal(text.includes(KEY), false, text.slice(0, 300));
});

/**
 * AI routes on their own studio server with a fake client: `answers` is a queue of answer texts
 * (an Error is thrown instead), every call's arguments land in `calls`.
 */
async function direct({ settings: patch = {}, answers = [], fileApi, id = 'direkt-plugin' } = {}) {
  const configDir = tempDir('studio-ai-direct');
  writeSettings(configDir, 9, patch);
  const dir = scaffoldPlugin(id, tempDir('studio-ai-direct-parent'));
  const calls = [];
  const ai = createAiRoutes({
    configDir,
    repoRoot: REPO,
    requireOpen: () => dir,
    log: createEventLog(),
    refresh: () => {},
    ...(fileApi ? { fileApi } : {}),
    getAiClient: () => ({
      chat: async (args) => {
        calls.push(args);
        const next = answers.shift();
        if (next instanceof Error) throw next;
        const text = next === undefined ? 'Okay.' : next;
        args.onToken(text);
        return { text };
      },
    }),
  });
  const server = createStudioServer({ port: 0, previewPort: 4101, token: TOKEN, routes: ai.routes });
  await server.listen();
  stops.push(() => server.close());
  async function post(pathname, body) {
    const res = await fetch(`${server.url}${pathname}`, {
      method: 'POST',
      headers: { 'X-Studio-Token': TOKEN, Origin: server.url, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if ((res.headers.get('content-type') || '').includes('event-stream')) return { status: res.status, events: parseFrames(text) };
    return { status: res.status, data: text ? JSON.parse(text) : null };
  }
  const read = (rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
  return { calls, dir, read, chat: (body) => post('/api/ai/chat', { history: [], buffers: [], open: [], ...body }), post };
}

const tokensOf = (messages) => messages.reduce((sum, m) => sum + estimateTokens(m.text), 0);

test('what the prompt left out arrives as its own notice event', async () => {
  const { chat, dir } = await direct();
  fs.writeFileSync(path.join(dir, 'big.md'), 'b'.repeat(250 * 1024));
  const res = await chat({ message: 'Hallo' });
  const notices = res.events.filter((e) => e.event === 'notice');
  assert.equal(notices.length, 1, JSON.stringify(res.events.map((e) => e.event)));
  assert.match(notices[0].data.text, /^Nicht mitgeschickt \(zu wenig Platz\): Dateien big\.md$/);
  assert.equal(res.events.some((e) => e.event === 'status' && /Nicht mitgeschickt/.test(e.data.text)), false);
});

test('the fixed history cap is not reported as lack of space', async () => {
  const { chat } = await direct();
  const history = [];
  for (let i = 0; i < 12; i += 1) history.push({ role: 'user', text: `Frage ${i}` }, { role: 'assistant', text: `Antwort ${i}` });
  const res = await chat({ message: 'Weiter', history });
  assert.equal(res.events.some((e) => e.event === 'notice'), false, JSON.stringify(res.events));
});

test('a repair over the budget compacts the first answer to its file list', async () => {
  const broken = `module.exports = (;\n// ${'x'.repeat(120000)}\n`;
  const { chat, calls } = await direct({ answers: [`Erster Versuch.\n${block('server.js', broken)}`, `Repariert.\n${block('server.js', SERVER)}`] });
  const res = await chat({ message: 'Los', history: [{ role: 'user', text: 'Alt' }, { role: 'assistant', text: 'Alte Antwort' }] });
  assert.equal(calls.length, 2);
  const repair = calls[1].messages;
  const budget = 32768 - 8192;
  assert.ok(estimateTokens(calls[1].system) + tokensOf(repair) <= budget, 'the repair request fits the budget');
  assert.equal(repair.at(-2).role, 'assistant');
  assert.match(repair.at(-2).text, /\[Dateien: server\.js\]/);
  assert.equal(repair.at(-2).text.includes('xxxxxxxxxx'), false);
  assert.match(repair.at(-1).text, /^Bitte korrigiere:/);
  assert.equal(repair[0].role, 'user');
  const proposal = proposalOf(res);
  assert.deepEqual(proposal.newProblems, []);
  assert.equal(proposal.files[0].after, SERVER);
});

test('a repair that fits keeps the full first answer', async () => {
  const { chat, calls } = await direct({ answers: [`Versuch.\n${block('server.js', 'module.exports = (;\n')}`, `Gut.\n${block('server.js', SERVER)}`] });
  await chat({ message: 'Los' });
  assert.equal(calls.length, 2);
  assert.match(calls[1].messages.at(-2).text, /<<<DATEI server\.js\nmodule\.exports = \(;/);
});

test('a repair that cannot fit is skipped: the proposal keeps its problems and the chat says why', async () => {
  const { chat, calls } = await direct({ answers: [`Versuch.\n${block('server.js', 'module.exports = (;\n')}`] });
  const res = await chat({
    message: 'Los',
    buffers: [{ path: 'notes.md', content: 'n'.repeat(80000) }], // open buffers are never cut
    open: ['notes.md'],
  });
  assert.equal(calls.length, 1, 'no repair call');
  const proposal = proposalOf(res);
  assert.ok(proposal.newProblems.some((p) => p.file === 'server.js'), JSON.stringify(proposal.newProblems));
  const notices = res.events.filter((e) => e.event === 'notice').map((e) => e.data.text);
  assert.ok(notices.includes('Nachbessern übersprungen (zu wenig Platz): die Probleme stehen beim Vorschlag.'), JSON.stringify(notices));
  assert.equal(res.events.some((e) => e.event === 'status' && e.data.phase === 'repair'), false);
});

test('a certificate failure logs the --use-system-ca hint, never the key', async (t) => {
  const logged = [];
  t.mock.method(console, 'error', (...args) => { logged.push(args.map(String).join(' ')); });
  const { chat } = await direct({ answers: [new AiError('certificate', { detail: 'SELF_SIGNED_CERT_IN_CHAIN' })] });
  const res = await chat({ message: `Hallo ${KEY}` });
  assert.equal(res.events.at(-1).event, 'error');
  assert.equal(logged.length, 1);
  assert.match(logged[0], /^Studio-KI fehlgeschlagen: certificate SELF_SIGNED_CERT_IN_CHAIN – .*--use-system-ca/);
  assert.equal(logged[0].includes(KEY), false);
});

/** A file API whose writes and deletes fail once for each path added to `failing`. */
function failingFiles(failing) {
  const files = require('../scripts/studio/files');
  const fail = (rel) => {
    if (!failing.has(rel)) return;
    failing.delete(rel);
    throw new Error('Platte voll');
  };
  return {
    ...files,
    writeFile: (dir, rel, content) => { fail(rel); return files.writeFile(dir, rel, content); },
    deleteFile: (dir, rel) => { fail(rel); return files.deleteFile(dir, rel); },
  };
}

test('a failed write during apply rolls the earlier writes back', async (t) => {
  t.mock.method(console, 'error', () => {});
  const failing = new Set();
  const answer = `Neu.\n${block('notes.md', NOTES)}${block('server.js', SERVER)}${block('client.css', '/* ki */\n')}`;
  const { chat, post, read, dir } = await direct({ answers: [answer], fileApi: failingFiles(failing) });
  const before = { server: read('server.js'), css: read('client.css') };
  const proposal = proposalOf(await chat({ message: 'Los' }));
  failing.add('client.css');
  const failed = await post('/api/ai/apply', { id: proposal.id });
  assert.equal(failed.status, 500);
  assert.deepEqual(failed.data, { error: 'Interner Fehler im Studio.' });
  assert.equal(read('server.js'), before.server, 'the replaced file is restored');
  assert.equal(fs.existsSync(path.join(dir, 'notes.md')), false, 'the created file is removed');
  assert.equal(read('client.css'), before.css);
  assert.equal((await post('/api/ai/undo', {})).status, 409, 'a failed apply leaves nothing to undo');
  const again = await post('/api/ai/apply', { id: proposal.id });
  assert.equal(again.status, 200, 'the proposal can be applied once the disk works again');
  assert.deepEqual(again.data.written, ['notes.md', 'server.js', 'client.css']);
});

test('a failed write during undo keeps the undo for the next try', async (t) => {
  t.mock.method(console, 'error', () => {});
  const failing = new Set();
  const { chat, post, read, dir } = await direct({ answers: [CLEAN], fileApi: failingFiles(failing) });
  const before = read('server.js');
  const proposal = proposalOf(await chat({ message: 'Los' }));
  assert.equal((await post('/api/ai/apply', { id: proposal.id })).status, 200);
  failing.add('notes.md');
  const failed = await post('/api/ai/undo', {});
  assert.equal(failed.status, 500);
  assert.equal(read('server.js'), before, 'the entry before the failure is restored');
  assert.equal(fs.existsSync(path.join(dir, 'notes.md')), true);
  const again = await post('/api/ai/undo', {});
  assert.equal(again.status, 200);
  // server.js no longer holds the applied content, so the second undo counts it as changed and leaves it
  assert.deepEqual(again.data, { ok: true, restored: ['notes.md'], conflicts: ['server.js'], message: CHANGED });
  assert.equal(read('server.js'), before);
  assert.equal(fs.existsSync(path.join(dir, 'notes.md')), false);
});
