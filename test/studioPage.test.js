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
    now: () => Date.parse('2026-11-26T09:00:00.000Z'),
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

// ---- Task 11 fix round 1 ----

/** Minimal fake of the debug panel DOM: counts full re-renders and appended HTML. */
function fakeDebugDom() {
  const makeList = () => {
    const list = {
      scrollTop: 0, clientHeight: 100, scrollHeight: 100, sets: 0, appended: [], removed: 0, children: 0,
      get innerHTML() { return this._html || ''; },
      set innerHTML(v) { this._html = v; this.sets += 1; this.children = v ? 1 : 0; },
      insertAdjacentHTML(where, html) { assert.equal(where, 'beforeend'); this.appended.push(html); this.children += (html.match(/dbg-entry/g) || []).length; },
      get firstElementChild() { const self = this; return self.children ? { remove() { self.removed += 1; self.children -= 1; } } : null; },
    };
    return list;
  };
  const list = makeList();
  const status = { textContent: '', classList: { hidden: true, toggle(_, force) { this.hidden = force; } } };
  const filter = { value: 'alle', listeners: {}, addEventListener(n, fn) { this.listeners[n] = fn; } };
  const els = { '.dbg-list': list, '.dbg-status': status, '.dbg-filter': filter };
  return { list, status, filter, container: { innerHTML: '', querySelector: (sel) => els[sel] || null } };
}

function fakeSources() {
  const sources = [];
  class FakeSource {
    constructor(url) { this.url = url; this.closed = false; this.listeners = {}; sources.push(this); }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    close() { this.closed = true; }
    emit(event) { this.listeners.studio({ data: JSON.stringify(event) }); }
  }
  return { sources, create: (url) => new FakeSource(url) };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('mountDebug appends new entries without re-rendering the list, and trims at the cap', async () => {
  const { mountDebug } = await load('debug.js');
  const dom = fakeDebugDom();
  const { sources, create } = fakeSources();
  const controller = new AbortController();
  mountDebug(dom.container, { api: { eventsUrl: () => 'u', clearEvents: async () => {} }, signal: controller.signal, createEventSource: create });
  const setsAfterMount = dom.list.sets;
  sources[0].emit(ev('log', { level: 'info', text: 'a' }));
  await tick();
  const setsAfterFirst = dom.list.sets; // the empty hint is replaced once
  for (let i = 0; i < 3; i += 1) sources[0].emit(ev('log', { level: 'info', text: `b${i}` }));
  await tick();
  assert.equal(dom.list.sets, setsAfterFirst, 'no full re-render for further events');
  assert.ok(setsAfterFirst - setsAfterMount <= 1);
  assert.equal(dom.list.appended.join('').match(/dbg-entry/g).length, 4);
  for (let i = 0; i < 600; i += 1) sources[0].emit(ev('log', { level: 'info', text: `c${i}` }));
  await tick();
  assert.equal(dom.list.sets, setsAfterFirst);
  assert.equal(dom.list.children, 500, 'DOM trimmed to the cap');
  controller.abort();
});

test('mountDebug does not render entries outside the active filter', async () => {
  const { mountDebug } = await load('debug.js');
  const dom = fakeDebugDom();
  const { sources, create } = fakeSources();
  const controller = new AbortController();
  mountDebug(dom.container, { api: { eventsUrl: () => 'u', clearEvents: async () => {} }, signal: controller.signal, createEventSource: create });
  dom.filter.value = 'fehler';
  dom.filter.listeners.change();
  const sets = dom.list.sets;
  sources[0].emit(ev('log', { level: 'info', text: 'x' }));
  await tick();
  assert.equal(dom.list.appended.length, 0);
  assert.equal(dom.list.sets, sets);
  controller.abort();
});

test('mountDebug applies only lifecycle events newer than the mount, once', async () => {
  const { mountDebug } = await load('debug.js');
  const { sources, create } = fakeSources();
  const seen = [];
  const controller = new AbortController();
  mountDebug(fakeDebugDom().container, {
    api: { eventsUrl: () => 'u', clearEvents: async () => {} }, signal: controller.signal, createEventSource: create,
    onLifecycle: (d) => seen.push(d.status), now: () => Date.parse('2026-11-26T10:00:00.000Z'),
  });
  const life = (status, at) => ({ type: 'lifecycle', pluginId: 'p', at, data: { status, where: 'child' } });
  sources[0].emit(life('starting', '2026-11-26T09:59:00.000Z')); // replay of old history
  sources[0].emit(life('running', '2026-11-26T09:59:30.000Z'));
  assert.deepEqual(seen, []);
  sources[0].emit(life('starting', '2026-11-26T10:00:05.000Z'));
  sources[0].emit(life('running', '2026-11-26T10:00:09.000Z'));
  sources[0].emit(life('running', '2026-11-26T10:00:09.000Z')); // replay after a reconnect
  sources[0].emit(life('starting', '2026-11-26T10:00:05.000Z'));
  assert.deepEqual(seen, ['starting', 'running']);
  controller.abort();
});

test('mountDebug shows the connection state on errors and gives up after 10', async () => {
  const { mountDebug } = await load('debug.js');
  const dom = fakeDebugDom();
  const { sources, create } = fakeSources();
  const controller = new AbortController();
  mountDebug(dom.container, { api: { eventsUrl: () => 'u', clearEvents: async () => {} }, signal: controller.signal, createEventSource: create });
  const src = sources[0];
  src.listeners.error();
  assert.equal(dom.status.textContent, 'Verbindung zum Studio getrennt – versuche erneut …');
  assert.equal(dom.status.classList.hidden, false);
  src.listeners.open();
  assert.equal(dom.status.classList.hidden, true);
  for (let i = 0; i < 5; i += 1) src.listeners.error();
  src.emit(ev('log', { level: 'info', text: 'back' })); // a message resets the count
  assert.equal(dom.status.classList.hidden, true);
  for (let i = 0; i < 9; i += 1) src.listeners.error();
  assert.equal(src.closed, false);
  src.listeners.error();
  assert.equal(src.closed, true);
  assert.equal(dom.status.textContent, 'Verbindung getrennt. Seite mit dem Start-Link neu öffnen.');
  controller.abort();
});

test('isVscodeUrl accepts only vscode://file/ links', async () => {
  const { isVscodeUrl } = await load('toolbar.js');
  assert.equal(isVscodeUrl('vscode://file/C:/Users/me/plugin'), true);
  for (const bad of ['javascript:alert(1)', 'https://evil.example/', 'vscode://other/x', 'VSCODE://file/x', '', null, undefined, 42, { url: 'vscode://file/x' }]) {
    assert.equal(isVscodeUrl(bad), false, String(bad));
  }
});

test('scripts/plugin.js assigns module.exports before the main guard runs', () => {
  const source = require('node:fs').readFileSync(path.join(__dirname, '..', 'scripts', 'plugin.js'), 'utf8');
  const exported = source.lastIndexOf('module.exports = { main');
  const guard = source.indexOf('if (require.main === module)');
  assert.ok(exported > 0 && guard > 0);
  assert.ok(exported < guard, 'the studio re-requires plugin.js while main() is still starting');
});

test('plugin.js exports are complete at the moment the CLI loads the studio', () => {
  const { spawnSync } = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const root = path.join(__dirname, '..');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dems-studio-hook-'));
  // Preload: when plugin.js (as entry) requires './studio', report its own exports and stop - no studio, no DEMS child.
  const hook = path.join(work, 'hook.js');
  fs.writeFileSync(hook, `
    const Module = require('module');
    const load = Module._load;
    Module._load = function (request, parent) {
      if (request === './studio' && parent && /plugin\.js$/.test(parent.filename)) {
        console.log(['scaffoldPlugin', 'reportLines', 'prepareDev'].map((n) => typeof parent.exports[n]).join(' '));
        process.exit(0);
      }
      return load.apply(this, arguments);
    };`);
  try {
    const env = { ...process.env };
    delete env.NODE_ENV;
    const result = spawnSync(process.execPath, ['-r', hook, path.join(root, 'scripts', 'plugin.js'), 'studio', '--port', '0'], { cwd: root, env, encoding: 'utf8', timeout: 20000 });
    assert.equal(result.stdout.trim(), 'function function function', result.stderr);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test('createDiskState: keep, reload or conflict after the folder changed', async () => {
  const { createDiskState } = await load('disk.js');
  const disk = createDiskState();
  disk.track('server.js', 'h1');
  disk.track('plugin.json', 'p1');
  assert.equal(disk.hash('server.js'), 'h1');
  assert.equal(disk.compare('server.js', 'h1', false), 'keep');
  assert.equal(disk.compare('server.js', 'h2', false), 'reload');
  assert.equal(disk.hasConflict('server.js'), false);
  assert.equal(disk.compare('plugin.json', 'p2', true), 'conflict');
  assert.equal(disk.hasConflict('plugin.json'), true);
  assert.deepEqual([...disk.conflicts()], ['plugin.json']);
  assert.equal(disk.hash('plugin.json'), 'p1', 'the base hash stays, so the next save meets the 409 path');
  assert.equal(disk.compare('plugin.json', 'p1', true), 'keep', 'the disk went back: no conflict any more');
  assert.equal(disk.hasConflict('plugin.json'), false);
  assert.equal(disk.compare('server.js', null, false), 'conflict', 'a file gone from disk is marked, not reloaded');
  disk.track('server.js', 'h3');
  assert.equal(disk.hasConflict('server.js'), false);
  disk.forget('server.js');
  assert.equal(disk.hash('server.js'), undefined);
});

test('syncTabs reloads clean tabs with new disk content and marks dirty ones', async () => {
  const { createDiskState, syncTabs } = await load('disk.js');
  const disk = createDiskState();
  disk.track('a.js', 'a1');
  disk.track('b.js', 'b1');
  disk.track('c.js', 'c1');
  disk.track('gone.js', 'g1');
  const onDisk = { 'a.js': { content: 'A2', hash: 'a2' }, 'b.js': { content: 'B2', hash: 'b2' }, 'c.js': { content: 'C1', hash: 'c1' } };
  const reloaded = [];
  await syncTabs({
    paths: ['a.js', 'b.js', 'c.js', 'gone.js'],
    state: disk,
    read: async (p) => { if (!onDisk[p]) throw Object.assign(new Error('Datei nicht gefunden'), { status: 404 }); return onDisk[p]; },
    isDirty: (p) => p === 'b.js',
    reload: (p, content) => reloaded.push([p, content]),
  });
  assert.deepEqual(reloaded, [['a.js', 'A2']]);
  assert.equal(disk.hash('a.js'), 'a2');
  assert.equal(disk.hasConflict('b.js'), true);
  assert.equal(disk.hash('b.js'), 'b1');
  assert.equal(disk.hasConflict('c.js'), false);
  assert.equal(disk.hasConflict('gone.js'), true);
});

test('syncTabs does not reload a tab that got edits while its file was read', async () => {
  const { createDiskState, syncTabs } = await load('disk.js');
  const disk = createDiskState();
  disk.track('a.js', 'a1');
  let dirty = false;
  const reloaded = [];
  await syncTabs({
    paths: ['a.js'],
    state: disk,
    read: async () => { dirty = true; return { content: 'A2', hash: 'a2' }; },
    isDirty: () => dirty,
    reload: (p, content) => reloaded.push([p, content]),
  });
  assert.deepEqual(reloaded, []);
  assert.equal(disk.hasConflict('a.js'), true);
});

test('saveTab sends the base hash, and on 409 reloads, overwrites or cancels as chosen', async () => {
  const { createDiskState, saveTab } = await load('disk.js');
  const conflict = () => Object.assign(new Error('Die Datei wurde außerhalb des Studios geändert.'), { status: 409 });
  const run = async (choice, { fail = true } = {}) => {
    const disk = createDiskState();
    disk.track('a.js', 'old');
    const saves = [];
    const reloaded = [];
    const asked = [];
    const outcome = await saveTab({
      path: 'a.js',
      content: 'mine',
      state: disk,
      save: async (p, content, baseHash) => {
        saves.push([p, content, baseHash]);
        if (fail && saves.length === 1) throw conflict();
        return { ok: true, hash: `h-${content}` };
      },
      read: async () => ({ content: 'theirs', hash: 'h-theirs' }),
      reload: (p, content) => reloaded.push([p, content]),
      askConflict: async (p) => { asked.push(p); return choice; },
    });
    return { outcome, saves, reloaded, asked, disk };
  };

  const plain = await run(null, { fail: false });
  assert.equal(plain.outcome, 'saved');
  assert.deepEqual(plain.saves, [['a.js', 'mine', 'old']]);
  assert.deepEqual(plain.asked, []);
  assert.equal(plain.disk.hash('a.js'), 'h-mine');

  const overwrite = await run('overwrite');
  assert.equal(overwrite.outcome, 'saved');
  assert.deepEqual(overwrite.asked, ['a.js']);
  assert.deepEqual(overwrite.saves, [['a.js', 'mine', 'old'], ['a.js', 'mine', undefined]]);
  assert.equal(overwrite.disk.hash('a.js'), 'h-mine');

  const reload = await run('reload');
  assert.equal(reload.outcome, 'reloaded');
  assert.deepEqual(reload.reloaded, [['a.js', 'theirs']]);
  assert.equal(reload.disk.hash('a.js'), 'h-theirs');
  assert.equal(reload.disk.hasConflict('a.js'), false);

  const cancel = await run(null);
  assert.equal(cancel.outcome, 'cancelled');
  assert.equal(cancel.saves.length, 1);
  assert.equal(cancel.disk.hash('a.js'), 'old');

  const other = createDiskState();
  await assert.rejects(saveTab({
    path: 'a.js', content: 'x', state: other,
    save: async () => { throw Object.assign(new Error('Kaputt.'), { status: 400 }); },
    read: async () => null, reload: () => {}, askConflict: async () => 'overwrite',
  }), { message: 'Kaputt.' });
});

test('renderTabs marks a tab whose file changed on disk', async () => {
  const { renderTabs } = await load('workspace.js');
  const html = renderTabs(['a.js', 'b.js'], { active: 'a.js', dirty: new Set(['b.js']), conflicts: new Set(['b.js']) });
  const [first, second] = html.split('class="editor-tab').slice(1);
  assert.ok(!/Auf der Platte geändert/.test(first));
  assert.match(second, /title="Auf der Platte geändert"/);
  assert.match(second, /bi-exclamation-triangle/);
});

test('createApi passes the base hash and keeps the status of a failed request', async () => {
  const { createApi } = await load('api.js');
  const seen = [];
  const answers = [
    { ok: true, status: 200, json: async () => ({ path: 'a.js', content: 'x', hash: 'h1' }) },
    { ok: false, status: 409, json: async () => ({ error: 'Die Datei wurde außerhalb des Studios geändert.' }) },
  ];
  const api = createApi({ token: 'tok', fetchFn: async (url, init) => { seen.push([url, init]); return answers.shift(); } });
  assert.deepEqual(await api.readFileInfo('a.js'), { content: 'x', hash: 'h1' });
  await assert.rejects(api.saveFile('a.js', 'y', 'h1'), (err) => err.status === 409 && /außerhalb/.test(err.message));
  assert.deepEqual(JSON.parse(seen[1][1].body), { path: 'a.js', content: 'y', baseHash: 'h1' });
});

test('mountDebug hands files events to onFiles and draws no line for them', async () => {
  const { mountDebug, filterEvents } = await load('debug.js');
  const dom = fakeDebugDom();
  const { sources, create } = fakeSources();
  const calls = [];
  const controller = new AbortController();
  mountDebug(dom.container, {
    api: { eventsUrl: () => 'u', clearEvents: async () => {} }, signal: controller.signal, createEventSource: create,
    onFiles: (event) => calls.push(event.type),
  });
  sources[0].emit({ type: 'files', pluginId: 'p', at: '2026-11-26T10:00:00.000Z' });
  await tick();
  assert.deepEqual(calls, ['files']);
  assert.equal(dom.list.appended.length, 0);
  assert.deepEqual(filterEvents([{ type: 'files' }], 'alle'), []);
  controller.abort();
  sources[0].emit({ type: 'files', pluginId: 'p', at: '2026-11-26T10:00:01.000Z' });
  assert.deepEqual(calls, ['files'], 'nothing after dispose');
});

test('renderDebugEntry shows file:line of an error and a failed hook, escaped', async () => {
  const { renderDebugEntry } = await load('debug.js');
  const error = renderDebugEntry(ev('error', { message: 'Unexpected identifier', where: 'register', file: 'server.js', line: 3 }));
  assert.match(error, /server\.js:3/);
  const hook = renderDebugEntry(ev('hook', { name: 'event.created', ok: false, error: 'kaputt', file: 'lib/<b>.js', line: 7 }));
  assert.match(hook, /lib\/&lt;b&gt;\.js:7/);
  assert.ok(!hook.includes('<b>'));
  const plain = renderDebugEntry(ev('error', { message: 'x', where: 'run' }));
  assert.ok(!/dbg-where-file/.test(plain), 'no location without a file');
});
