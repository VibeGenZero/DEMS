'use strict';
// Studio API routes (scripts/studio/actions.js) through the real studio server, with temp folders and a fake child.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStudioServer } = require('../scripts/studio/server');
const { createActions } = require('../scripts/studio/actions');
const { readZip } = require('../plugin-sdk/zip');
const crypto = require('node:crypto');

const sha256 = (text) => crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');

const TOKEN = 'a'.repeat(64);
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

/** Fake child supervisor: records calls, never forks. */
function fakeChildFactory() {
  const made = [];
  function createChild(options) {
    const child = {
      options,
      calls: [],
      state: 'stopped',
      start() { child.calls.push('start'); child.state = 'running'; return Promise.resolve(); },
      restart() { child.calls.push('restart'); child.state = 'running'; return Promise.resolve(); },
      stop() { child.calls.push('stop'); child.state = 'stopped'; return Promise.resolve(); },
      port: () => null,
      status: () => child.state,
    };
    made.push(child);
    return child;
  }
  return { createChild, made };
}

async function setup(options = {}) {
  const fake = fakeChildFactory();
  const configDir = tempDir('studio-config');
  const actions = createActions({
    repoRoot: tempDir('studio-repo'),
    previewOrigin: () => 'http://127.0.0.1:4101',
    configDir,
    createChild: fake.createChild,
    debounceMs: 50,
    ...options,
  });
  const server = createStudioServer({ port: 0, previewPort: 4101, token: TOKEN, routes: actions.routes });
  await server.listen();
  const stop = async () => { await actions.stop(); await server.close(); };
  stops.push(stop);
  const base = server.url;
  async function call(method, pathname, body) {
    const headers = { 'X-Studio-Token': TOKEN, Origin: base };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + pathname, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, headers: res.headers, data };
  }
  return { actions, fake, configDir, call, base };
}

async function waitFor(check, ms = 3000) {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) return false;
    await sleep(25);
  }
  return true;
}

test('POST /api/new scaffolds a plugin, opens it, adds it to recent and starts the child', async () => {
  const { call, fake } = await setup();
  const parent = tempDir('studio-parent');
  const res = await call('POST', '/api/new', { id: 'mein-plugin', parentDir: parent });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const dir = path.join(parent, 'mein-plugin');
  assert.deepEqual(res.data.plugin, { id: 'mein-plugin', name: 'mein-plugin', version: '0.1.0', dir });
  assert.ok(fs.existsSync(path.join(dir, 'server.js')));
  assert.equal(fake.made.length, 1);
  assert.equal(fake.made[0].options.folder, dir);
  assert.deepEqual(fake.made[0].calls, ['start']);

  const state = await call('GET', '/api/state');
  assert.equal(state.status, 200);
  assert.deepEqual(state.data.plugin, res.data.plugin);
  assert.equal(state.data.child, 'running');
  assert.equal(state.data.previewUrl, 'http://127.0.0.1:4101');
  assert.deepEqual(state.data.recent.map((e) => [e.id, e.dir, e.exists]), [['mein-plugin', dir, true]]);

  const files = await call('GET', '/api/files');
  assert.deepEqual(files.data.files.map((f) => f.path), ['client.css', 'client.js', 'plugin.json', 'server.js']);
});

test('POST /api/new refuses a bad id, an existing folder and a relative parent', async () => {
  const { call } = await setup();
  const parent = tempDir('studio-parent');
  const bad = await call('POST', '/api/new', { id: 'Bad', parentDir: parent });
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.data, { error: 'Die ID ist nicht erlaubt.' });
  fs.mkdirSync(path.join(parent, 'schon-da'));
  const exists = await call('POST', '/api/new', { id: 'schon-da', parentDir: parent });
  assert.equal(exists.status, 409);
  assert.deepEqual(exists.data, { error: 'Den Ordner gibt es schon: schon-da' });
  const relative = await call('POST', '/api/new', { id: 'neu', parentDir: 'relativ' });
  assert.equal(relative.status, 400);
  assert.deepEqual(relative.data, { error: 'Bitte einen vollständigen Pfad angeben.' });
});

test('file routes need an opened plugin', async () => {
  const { call } = await setup();
  for (const [method, pathname] of [['GET', '/api/files'], ['GET', '/api/file?path=server.js'], ['POST', '/api/check'], ['GET', '/api/vscode']]) {
    const res = await call(method, pathname, method === 'GET' ? undefined : {});
    assert.equal(res.status, 409, pathname);
    assert.deepEqual(res.data, { error: 'Bitte zuerst ein Plugin öffnen.' });
  }
  const trigger = await call('POST', '/api/trigger', { action: 'create' });
  assert.equal(trigger.status, 409);
});

test('PUT /api/file writes the file and the watcher restarts the child', async () => {
  const { call, fake } = await setup();
  const parent = tempDir('studio-parent');
  await call('POST', '/api/new', { id: 'watch-plugin', parentDir: parent });
  const child = fake.made[0];
  await sleep(150); // let the watcher settle after the scaffold
  child.calls.length = 0;
  const res = await call('PUT', '/api/file', { path: 'server.js', content: 'module.exports = { register() {} };\n' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.data, { ok: true, hash: sha256('module.exports = { register() {} };\n') });
  assert.equal(fs.readFileSync(path.join(parent, 'watch-plugin', 'server.js'), 'utf8'), 'module.exports = { register() {} };\n');
  assert.ok(await waitFor(() => child.calls.includes('restart')), JSON.stringify(child.calls));

  const read = await call('GET', '/api/file?path=server.js');
  assert.deepEqual(read.data, { path: 'server.js', content: 'module.exports = { register() {} };\n', hash: sha256('module.exports = { register() {} };\n') });
});

test('PUT /api/file with a baseHash that no longer matches the disk is refused with 409 and writes nothing', async () => {
  const { call } = await setup();
  const parent = tempDir('studio-parent');
  await call('POST', '/api/new', { id: 'conflict-plugin', parentDir: parent });
  const file = path.join(parent, 'conflict-plugin', 'server.js');
  const read = await call('GET', '/api/file?path=server.js');
  assert.equal(read.data.hash, sha256(fs.readFileSync(file, 'utf8')));

  const same = await call('PUT', '/api/file', { path: 'server.js', content: 'eins\n', baseHash: read.data.hash });
  assert.equal(same.status, 200, JSON.stringify(same.data));
  assert.equal(same.data.hash, sha256('eins\n'));

  fs.writeFileSync(file, 'von außen\n');
  const stale = await call('PUT', '/api/file', { path: 'server.js', content: 'zwei\n', baseHash: same.data.hash });
  assert.equal(stale.status, 409);
  assert.deepEqual(stale.data, { error: 'Die Datei wurde außerhalb des Studios geändert.' });
  assert.equal(fs.readFileSync(file, 'utf8'), 'von außen\n');

  const forced = await call('PUT', '/api/file', { path: 'server.js', content: 'zwei\n' });
  assert.equal(forced.status, 200);
  assert.equal(fs.readFileSync(file, 'utf8'), 'zwei\n');

  fs.rmSync(file);
  const gone = await call('PUT', '/api/file', { path: 'server.js', content: 'drei\n', baseHash: forced.data.hash });
  assert.equal(gone.status, 409, 'a file deleted on disk is a conflict too');
  const bad = await call('PUT', '/api/file', { path: 'server.js', content: 'drei\n', baseHash: 42 });
  assert.equal(bad.status, 400);
});

test('a change in the plugin folder is broadcast as a files event that the log does not keep', async () => {
  const { call, actions } = await setup();
  const parent = tempDir('studio-parent');
  await call('POST', '/api/new', { id: 'files-plugin', parentDir: parent });
  await sleep(150);
  const seen = [];
  const unsubscribe = actions.log.subscribe((e) => seen.push(e));
  try {
    fs.writeFileSync(path.join(parent, 'files-plugin', 'client.css'), 'body {}\n');
    assert.ok(await waitFor(() => seen.some((e) => e.type === 'files')), JSON.stringify(seen));
    const event = seen.find((e) => e.type === 'files');
    assert.equal(typeof event.at, 'string');
    assert.ok(!actions.log.list().some((e) => e.type === 'files'), 'not replayed as a debug line');
  } finally {
    unsubscribe();
  }
});

test('create, upload, rename and delete files', async () => {
  const { call } = await setup();
  const parent = tempDir('studio-parent');
  await call('POST', '/api/new', { id: 'files-plugin', parentDir: parent });
  const dir = path.join(parent, 'files-plugin');
  assert.deepEqual((await call('POST', '/api/file', { path: 'lib/util.js' })).data, { ok: true });
  assert.equal(fs.readFileSync(path.join(dir, 'lib', 'util.js'), 'utf8'), '');
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255]);
  assert.deepEqual((await call('POST', '/api/file', { path: 'assets/logo.png', base64: png.toString('base64') })).data, { ok: true });
  assert.deepEqual(fs.readFileSync(path.join(dir, 'assets', 'logo.png')), png);
  const bad = await call('POST', '/api/file', { path: 'assets/x.png', base64: '***' });
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.data, { error: 'Die Datei ist nicht lesbar.' });
  assert.deepEqual((await call('POST', '/api/file/rename', { from: 'lib/util.js', to: 'lib/helpers.js' })).data, { ok: true });
  assert.ok(fs.existsSync(path.join(dir, 'lib', 'helpers.js')));
  assert.deepEqual((await call('DELETE', '/api/file', { path: 'lib/helpers.js' })).data, { ok: true });
  assert.equal(fs.existsSync(path.join(dir, 'lib', 'helpers.js')), false);
  const outside = await call('GET', '/api/file?path=../x.js');
  assert.equal(outside.status, 400);
  const missing = await call('GET', '/api/file');
  assert.equal(missing.status, 400);
  assert.deepEqual(missing.data, { error: 'Bitte einen Pfad angeben.' });
});

function addDm(dir) {
  fs.writeFileSync(path.join(dir, 'server.js'), 'module.exports = { async register(ctx) { await ctx.discord.sendDM("1", "Hallo"); } };\n');
}

test('POST /api/check returns the CLI lines for a missing permission and writes nothing', async () => {
  const { call } = await setup();
  const parent = tempDir('studio-parent');
  await call('POST', '/api/new', { id: 'check-plugin', parentDir: parent });
  const dir = path.join(parent, 'check-plugin');
  addDm(dir);
  const before = fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8');
  const res = await call('POST', '/api/check', {});
  assert.equal(res.status, 200);
  assert.ok(res.data.lines.includes('+ discord:dm'), JSON.stringify(res.data.lines));
  assert.deepEqual(res.data.errors, []);
  assert.equal(res.data.changed, true);
  assert.equal(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8'), before);
});

test('an invalid plugin.json keeps the session; check reports it, a valid save reopens', async () => {
  const { call } = await setup();
  const parent = tempDir('studio-parent');
  const opened = await call('POST', '/api/new', { id: 'json-plugin', parentDir: parent });
  assert.equal((await call('PUT', '/api/file', { path: 'plugin.json', content: '{ kaputt' })).status, 200);
  const state = await call('GET', '/api/state');
  assert.deepEqual(state.data.plugin, opened.data.plugin);
  const check = await call('POST', '/api/check', {});
  assert.equal(check.status, 200);
  assert.deepEqual(check.data, { lines: [], errors: ['Fehler: plugin.json ist kein gültiges JSON.'], changed: false });
  const build = await call('POST', '/api/build', { apply: true });
  assert.equal(build.status, 400);
  assert.equal(build.data.error, 'plugin.json ist kein gültiges JSON.');

  const manifest = { id: 'json-plugin', name: 'Neuer Name', version: '0.2.0', sdk: 1.1, description: 'x', author: 'y', server: 'server.js', client: 'client.js', permissions: [], settings: [] };
  assert.equal((await call('PUT', '/api/file', { path: 'plugin.json', content: JSON.stringify(manifest) })).status, 200);
  const again = await call('GET', '/api/state');
  assert.equal(again.data.plugin.name, 'Neuer Name');
  assert.equal(again.data.plugin.version, '0.2.0');
});

test('POST /api/build apply:false previews without touching plugin.json, apply:true writes and returns the package', async () => {
  const { call } = await setup();
  const parent = tempDir('studio-parent');
  await call('POST', '/api/new', { id: 'build-plugin', parentDir: parent });
  const dir = path.join(parent, 'build-plugin');
  addDm(dir);
  const before = fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8');

  const preview = await call('POST', '/api/build', { apply: false });
  assert.equal(preview.status, 200);
  assert.ok(preview.data.lines.includes('+ discord:dm'));
  assert.deepEqual(preview.data.nextManifest.permissions, ['discord:dm']);
  assert.equal(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8'), before);

  const built = await call('POST', '/api/build', { apply: true });
  assert.equal(built.status, 200);
  assert.equal(built.headers.get('content-type'), 'application/octet-stream');
  assert.equal(built.headers.get('content-disposition'), 'attachment; filename="build-plugin-0.1.0.dems"');
  const entries = readZip(built.data);
  const manifestEntry = entries.find((e) => e.name === 'plugin.json');
  assert.ok(manifestEntry, entries.map((e) => e.name).join());
  assert.deepEqual(JSON.parse(manifestEntry.data.toString('utf8')).permissions, ['discord:dm']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8')).permissions, ['discord:dm']);
});

test('GET /api/vscode returns a vscode://file/ URL with forward slashes', async () => {
  const { call } = await setup();
  const parent = tempDir('studio-parent');
  await call('POST', '/api/new', { id: 'code-plugin', parentDir: parent });
  const res = await call('GET', '/api/vscode');
  assert.equal(res.status, 200);
  assert.match(res.data.url, /^vscode:\/\/file\//);
  assert.equal(res.data.url.includes('\\'), false);
  const expected = path.join(parent, 'code-plugin').split(path.sep).join('/').replace(/^\/+/, '');
  assert.equal(decodeURIComponent(res.data.url.slice('vscode://file/'.length)), expected);
});

test('opening another plugin stops the old child, clears the events and starts a new one', async () => {
  const { call, fake, actions } = await setup();
  const parent = tempDir('studio-parent');
  await call('POST', '/api/new', { id: 'first-plugin', parentDir: parent });
  await call('POST', '/api/new', { id: 'second-plugin', parentDir: parent });
  actions.log.push({ type: 'log', pluginId: 'second-plugin', at: 'x', data: {} });
  const res = await call('POST', '/api/open', { dir: path.join(parent, 'first-plugin') });
  assert.equal(res.status, 200);
  assert.equal(res.data.plugin.id, 'first-plugin');
  assert.equal(fake.made.length, 3);
  assert.deepEqual(fake.made[1].calls, ['start', 'stop']);
  assert.deepEqual(fake.made[2].calls, ['start']);
  assert.deepEqual(actions.log.list(), []);
  const state = await call('GET', '/api/state');
  assert.deepEqual(state.data.recent.map((e) => e.id), ['first-plugin', 'second-plugin']);
  assert.deepEqual((await call('POST', '/api/events/clear', {})).data, { ok: true });
});

test('an unwritable recent list does not block opening; remove answers the list', async () => {
  const blocked = path.join(tempDir('studio-config'), 'file');
  fs.writeFileSync(blocked, 'kein Ordner');
  const { call } = await setup({ configDir: path.join(blocked, 'sub') });
  const parent = tempDir('studio-parent');
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    const res = await call('POST', '/api/new', { id: 'recent-plugin', parentDir: parent });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    const removed = await call('POST', '/api/recent/remove', { dir: path.join(parent, 'recent-plugin') });
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.data, { recent: [] });
  } finally {
    console.error = original;
  }
  assert.ok(errors.length >= 2, errors.join('\n'));
});

test('POST /api/recent/remove drops an entry', async () => {
  const { call } = await setup();
  const parent = tempDir('studio-parent');
  await call('POST', '/api/new', { id: 'gone-plugin', parentDir: parent });
  const res = await call('POST', '/api/recent/remove', { dir: path.join(parent, 'gone-plugin') });
  assert.deepEqual(res.data, { recent: [] });
});

test('GET /api/events streams the event log', async () => {
  const { actions, base } = await setup();
  actions.log.push({ type: 'log', pluginId: 'x', at: '2026-11-26T00:00:00.000Z', data: { text: 'hallo' } });
  const controller = new AbortController();
  const res = await fetch(`${base}/api/events?token=${TOKEN}`, { signal: controller.signal });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const reader = res.body.getReader();
  const { value } = await reader.read();
  assert.match(Buffer.from(value).toString('utf8'), /"text":"hallo"/);
  controller.abort();
});

test('POST /api/trigger refuses an unknown action', async () => {
  const { call } = await setup();
  const parent = tempDir('studio-parent');
  await call('POST', '/api/new', { id: 'trigger-plugin', parentDir: parent });
  const res = await call('POST', '/api/trigger', { action: 'explode' });
  assert.equal(res.status, 400);
  assert.deepEqual(res.data, { error: 'Unbekannte Aktion.' });
});
