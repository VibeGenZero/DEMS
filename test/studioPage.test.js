const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// The studio page modules are plain ES modules; only their pure functions run here.
const load = (name) => import(pathToFileURL(path.join(__dirname, '..', 'scripts', 'studio', 'public', name)).href);

test('renderStartPage escapes plugin names and marks missing folders', async () => {
  const { renderStartPage } = await load('start.js');
  const html = renderStartPage({
    recent: [
      { dir: 'C:\\plugins\\a', id: 'a', name: '<script>alert(1)</script>', exists: true },
      { dir: '/gone', id: 'gone', name: 'Weg', exists: false },
    ],
  });
  assert.ok(!html.includes('<script>'), 'no raw script tag');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.match(html, /Neues Plugin/);
  assert.match(html, /Plugin öffnen/);
  const missing = html.split('<li').find((part) => part.includes('Weg'));
  assert.match(missing, /is-missing/);
  assert.match(missing, /data-action="open"[^>]*disabled/);
  assert.match(missing, /data-action="remove"/);
  const present = html.split('<li').find((part) => part.includes('&lt;script&gt;'));
  assert.ok(!/is-missing/.test(present));
});

test('renderStartPage escapes folder values placed in data attributes', async () => {
  const { renderStartPage } = await load('start.js');
  const html = renderStartPage({ recent: [{ dir: '"><img src=x>', id: 'x', name: 'x', exists: true }] });
  assert.ok(!html.includes('<img'));
});

test('renderStartPage without recent entries shows an empty hint', async () => {
  const { renderStartPage } = await load('start.js');
  assert.match(renderStartPage({ recent: [] }), /Noch keine/);
});

test('renderFileList marks the active and the dirty file', async () => {
  const { renderFileList } = await load('workspace.js');
  const files = [
    { path: 'plugin.json', size: 10, text: true, allowed: true },
    { path: 'server.js', size: 10, text: true, allowed: true },
    { path: 'logo<b>.png', size: 10, text: false, allowed: true },
  ];
  const html = renderFileList(files, { active: 'server.js', dirty: new Set(['plugin.json']) });
  const items = html.split('<li').slice(1);
  assert.equal(items.length, 3);
  assert.match(items[0], /is-dirty/);
  assert.match(items[0], /\u25cf/);
  assert.ok(!/is-active/.test(items[0]));
  assert.match(items[1], /is-active/);
  assert.ok(!/\u25cf/.test(items[1]));
  assert.match(items[2], /is-binary/);
  assert.ok(!html.includes('<b>'));
});

test('editorLanguage maps extensions', async () => {
  const { editorLanguage } = await load('editor.js');
  assert.equal(editorLanguage('assets/view.js'), 'javascript');
  assert.equal(editorLanguage('plugin.json'), 'json');
  assert.equal(editorLanguage('client.css'), 'css');
  assert.equal(editorLanguage('README.md'), 'markdown');
  assert.equal(editorLanguage('notes.txt'), 'plaintext');
  assert.equal(editorLanguage('LICENSE'), 'plaintext');
});

test('typeLibFor separates client and server files', async () => {
  const { typeLibFor } = await load('workspace.js');
  const manifest = { client: 'client.js' };
  assert.equal(typeLibFor('client.js', manifest), 'client');
  assert.equal(typeLibFor('assets/view.js', manifest), 'client');
  assert.equal(typeLibFor('lib/engine.js', manifest), 'server');
  assert.equal(typeLibFor('server.js', manifest), 'server');
  assert.equal(typeLibFor('README.md', manifest), null);
  assert.equal(typeLibFor('client.css', manifest), null);
  assert.equal(typeLibFor('server.js', null), 'server');
});

test('withTypeHint adds a same-line JSDoc type in front of register(param)', async () => {
  const { withTypeHint } = await load('editor.js');
  const server = 'module.exports = {\n    async register(ctx) {\n        ctx.\n    }\n};\n';
  const a = withTypeHint(server, 'server');
  assert.ok(a.text.includes('/** @param {DemsServerContext} ctx */ async register(ctx)'));
  assert.equal(a.text.split('\n').length, server.split('\n').length, 'line count stays');
  assert.equal(a.text.length - server.length, a.shift);
  assert.equal(server.slice(a.at, a.at + 5), 'async');
  const client = withTypeHint('export function register(ui) {}\n', 'client');
  assert.ok(client.text.startsWith('/** @param {DemsClientUi} ui */ export function register(ui)'));
  const none = withTypeHint('const x = 1;\n', 'server');
  assert.equal(none.shift, 0);
  assert.equal(none.text, 'const x = 1;\n');
});

test('takeToken reads the fragment once and clears it from the address bar', async () => {
  const { takeToken } = await load('api.js');
  const calls = [];
  const location = { hash: '#token=abc123def', pathname: '/', search: '' };
  const history = { replaceState: (...args) => calls.push(args) };
  assert.equal(takeToken(location, history), 'abc123def');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][2], '/');
  const none = takeToken({ hash: '', pathname: '/', search: '' }, history);
  assert.equal(none, null);
  assert.equal(calls.length, 1, 'no history change without a token');
  assert.equal(takeToken({ hash: '#token=x y', pathname: '/', search: '' }, history), null);
});

test('createApi sends the token header and JSON, and turns errors into German messages', async () => {
  const { createApi } = await load('api.js');
  const seen = [];
  const answers = [
    { ok: true, status: 200, json: async () => ({ plugin: null }) },
    { ok: false, status: 400, json: async () => ({ error: 'Kaputt.' }) },
    { ok: false, status: 500, json: async () => { throw new Error('no json'); } },
  ];
  const api = createApi({ token: 'tok', fetchFn: async (url, init) => { seen.push([url, init]); return answers.shift(); } });
  assert.deepEqual(await api.state(), { plugin: null });
  assert.equal(seen[0][0], '/api/state');
  assert.equal(seen[0][1].headers['X-Studio-Token'], 'tok');
  await assert.rejects(api.saveFile('a.js', 'x'), { message: 'Kaputt.' });
  assert.equal(seen[1][1].method, 'PUT');
  assert.deepEqual(JSON.parse(seen[1][1].body), { path: 'a.js', content: 'x' });
  await assert.rejects(api.readFile('a.js'), /Fehler/);
  assert.equal(seen[2][0], '/api/file?path=a.js');
});

function fakeModel() {
  let version = 1;
  const listeners = [];
  return {
    getAlternativeVersionId: () => version,
    onDidChangeContent(fn) { listeners.push(fn); return { dispose() { listeners.splice(listeners.indexOf(fn), 1); } }; },
    edit() { version += 1; listeners.slice().forEach((fn) => fn()); },
    listeners,
  };
}

test('createDirtyTracker: edits typed while a save runs stay unsaved', async () => {
  const { createDirtyTracker } = await load('editor.js');
  const model = fakeModel();
  const seen = [];
  const tracker = createDirtyTracker(model, (d) => seen.push(d));
  model.edit();
  assert.equal(tracker.isDirty(), true);
  const version = tracker.version(); // value and version are taken before the request
  model.edit(); // typed while the request runs
  tracker.markSaved(version);
  assert.equal(tracker.isDirty(), true, 'still dirty');
  tracker.markSaved(tracker.version());
  assert.equal(tracker.isDirty(), false);
  assert.deepEqual(seen, [true, false]);
  tracker.dispose();
  assert.equal(model.listeners.length, 0);
});

test('mountStart returns a disposer that aborts all its listeners', async () => {
  const { mountStart } = await load('start.js');
  const signals = [];
  const root = { innerHTML: '', addEventListener: (type, fn, options) => signals.push(options.signal) };
  const dispose = mountStart(root, { api: {}, recent: [], onOpened() {} });
  assert.equal(signals.length, 2);
  assert.ok(signals.every((s) => s && !s.aborted));
  dispose();
  assert.ok(signals.every((s) => s.aborted));
});

test('showDialog closes (null) when its signal aborts and not at all when already aborted', async () => {
  const { showDialog } = await load('ui.js');
  const removed = [];
  const overlay = { innerHTML: '', className: '', addEventListener() {}, querySelector: () => ({ focus() {} }), remove: () => removed.push(true) };
  global.document = {
    createElement: () => overlay,
    addEventListener() {}, removeEventListener() {},
    body: { appendChild() {} },
  };
  try {
    const controller = new AbortController();
    const pending = showDialog({ title: 'T', buttons: [{ label: 'OK', value: true }], signal: controller.signal });
    controller.abort();
    assert.equal(await pending, null);
    assert.equal(removed.length, 1);
    assert.equal(await showDialog({ title: 'T', buttons: [], signal: controller.signal }), null);
    assert.equal(removed.length, 1, 'no dialog was built');
  } finally {
    delete global.document;
  }
});

test('mountStart sends one request for a double click', async () => {
  const { mountStart } = await load('start.js');
  const handlers = {};
  const root = { innerHTML: '', addEventListener: (type, fn) => { handlers[type] = fn; } };
  let calls = 0;
  let release;
  const api = { open: () => { calls += 1; return new Promise((resolve) => { release = () => resolve({ plugin: { id: 'a' } }); }); } };
  mountStart(root, { api, recent: [], onOpened() {} });
  const click = { target: { closest: () => ({ dataset: { action: 'open', dir: '/x' } }) } };
  handlers.click(click);
  handlers.click(click);
  assert.equal(calls, 1);
  release();
});

// ---- Task 11: debug panel, check/build renderers, preview, hook buttons ----

const ev = (type, data, pluginId = 'p') => ({ type, pluginId, at: '2026-11-26T10:00:00.000Z', data });
const XSS = '<img src=x onerror=alert(1)>';

test('renderDebugEntry escapes DM text, user name, link, request bodies and log text', async () => {
  const { renderDebugEntry } = await load('debug.js');
  const dm = renderDebugEntry(ev('dm', { userId: '1', userName: XSS, text: XSS, link: XSS, result: 'sent', reason: null }));
  const request = renderDebugEntry(ev('request', { method: 'POST', path: `/x${XSS}`, status: 201, ms: 12, requestBody: XSS, responseBody: XSS }));
  const log = renderDebugEntry(ev('log', { level: 'warn', text: XSS }));
  const error = renderDebugEntry(ev('error', { message: XSS, where: XSS }));
  const hook = renderDebugEntry(ev('hook', { name: XSS, summary: XSS, ok: false, error: XSS }));
  for (const html of [dm, request, log, error, hook]) {
    assert.ok(!html.includes('<img'), html);
    assert.ok(html.includes('&lt;img'), html);
  }
  assert.match(request, /POST/);
  assert.match(request, /201/);
  assert.match(request, /12 ms/);
  assert.match(request, /<details/);
  assert.match(hook, /Hook /);
  assert.match(hook, /Fehler/);
});

test('renderDebugEntry shows a dropped DM with its reason and a sent DM like a Discord message', async () => {
  const { renderDebugEntry } = await load('debug.js');
  const dropped = renderDebugEntry(ev('dm', { userId: '1', userName: 'Lena', text: 'Hi', link: null, result: 'dropped', reason: 'Die Nutzer-ID ist ungültig.' }));
  assert.match(dropped, /nicht gesendet: Die Nutzer-ID ist ungültig\./);
  const sent = renderDebugEntry(ev('dm', { userId: '1', userName: 'Lena', text: 'Hi', link: { label: 'Öffnen', url: 'http://x' }, result: 'sent', reason: null }));
  assert.match(sent, /<strong>Lena<\/strong>/);
  assert.match(sent, /Hi/);
  assert.match(sent, /Öffnen/);
  assert.ok(!/nicht gesendet/.test(sent));
});

test('renderDebugEntry renders channel, role and log entries', async () => {
  const { renderDebugEntry } = await load('debug.js');
  assert.match(renderDebugEntry(ev('channel', { channel: 'news', text: 'T', link: null, result: 'sent', reason: null })), /#news/);
  const role = renderDebugEntry(ev('role', { userId: 'u1', roleId: 'r9', give: true, result: 'ok', reason: null }));
  assert.match(role, /Rolle r9 an u1 vergeben/);
  assert.match(renderDebugEntry(ev('role', { userId: 'u1', roleId: 'r9', give: false, result: 'ok', reason: null })), /entzogen/);
  assert.match(renderDebugEntry(ev('log', { level: 'error', text: 'x' })), /level-error/);
  assert.match(renderDebugEntry(ev('error', { message: 'm', where: 'run' })), /run/);
  assert.match(renderDebugEntry(ev('hook', { name: 'event.ended', summary: '', ok: true, error: '' })), /Hook event\.ended · ok/);
});

test('filterEvents keeps only the requested kinds', async () => {
  const { filterEvents } = await load('debug.js');
  const all = ['dm', 'channel', 'role', 'request', 'hook', 'log', 'error', 'lifecycle'].map((t) => ev(t, {}));
  const types = (kind) => filterEvents(all, kind).map((e) => e.type);
  assert.deepEqual(types('discord'), ['dm', 'channel', 'role']);
  assert.deepEqual(types('anfragen'), ['request']);
  assert.deepEqual(types('hooks'), ['hook']);
  assert.deepEqual(types('logs'), ['log']);
  assert.deepEqual(types('fehler'), ['error']);
  assert.equal(types('alle').length, all.length - 1, 'lifecycle is not a debug line');
});

test('renderCheckDialog and renderBuildPreview escape lines and errors', async () => {
  const { renderCheckDialog, renderBuildPreview } = await load('toolbar.js');
  const lines = ['+ discord:dm', 'übersprungen: .git', XSS];
  const check = renderCheckDialog({ lines, errors: [`Fehler: ${XSS}`] });
  assert.ok(!check.includes('<img'));
  assert.match(check, /\+ discord:dm/);
  assert.match(check, /übersprungen: \.git/);
  assert.match(check, /Fehler: &lt;img/);
  assert.equal((check.match(/Fehler: Fehler/g) || []).length, 0, 'no doubled prefix');
  const build = renderBuildPreview({ lines });
  assert.ok(!build.includes('<img'));
  assert.match(build, /\+ discord:dm/);
  assert.match(renderCheckDialog({ lines: [], errors: [] }), /Alles in Ordnung/);
});

test('statusOverlay and personaUrl', async () => {
  const { statusOverlay, personaUrl, PERSONAS } = await load('preview.js');
  assert.equal(statusOverlay('starting'), 'DEMS startet neu …');
  assert.equal(statusOverlay('failed'), 'DEMS konnte nicht starten – siehe Debug');
  assert.equal(statusOverlay('running'), null);
  assert.deepEqual(PERSONAS.map((p) => p.id), ['admin', 'raider', 'member', 'newbie']);
  assert.equal(personaUrl('http://127.0.0.1:3101', 'raider'), 'http://127.0.0.1:3101/auth/dev-login/raider');
  assert.equal(personaUrl('http://127.0.0.1:3101/', 'a/../b'), 'http://127.0.0.1:3101/auth/dev-login/a%2F..%2Fb');
});

test('api exposes the event stream URL with the token as the only query parameter', async () => {
  const { createApi } = await load('api.js');
  const api = createApi({ token: 'abc123', fetchFn: async () => { throw new Error('unused'); } });
  assert.equal(api.eventsUrl(), '/api/events?token=abc123');
});

test('mountDebug closes the event stream on dispose and ignores late events', async () => {
  const { mountDebug } = await load('debug.js');
  const sources = [];
  class FakeSource {
    constructor(url) { this.url = url; this.closed = false; this.listeners = {}; sources.push(this); }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    close() { this.closed = true; }
  }
  const container = { innerHTML: '', querySelector: () => null };
  const seen = [];
  const controller = new AbortController();
  const debug = mountDebug(container, {
    api: { eventsUrl: () => '/api/events?token=t', clearEvents: async () => {} },
    signal: controller.signal,
    createEventSource: (url) => new FakeSource(url),
    onLifecycle: (data) => seen.push(data),
  });
  assert.equal(sources.length, 1);
  assert.equal(sources[0].url, '/api/events?token=t');
  sources[0].listeners.studio({ data: JSON.stringify(ev('lifecycle', { status: 'starting', where: 'child' })) });
  sources[0].listeners.studio({ data: 'not json' });
  assert.deepEqual(seen, [{ status: 'starting', where: 'child' }]);
  debug.dispose();
  assert.equal(sources[0].closed, true);
  sources[0].listeners.studio({ data: JSON.stringify(ev('lifecycle', { status: 'running', where: 'child' })) });
  assert.equal(seen.length, 1);
  debug.dispose(); // idempotent
});
