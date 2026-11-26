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
      { dir: 'C:\plugins\a', id: 'a', name: '<script>alert(1)</script>', exists: true },
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
