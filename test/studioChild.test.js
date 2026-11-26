'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createChild } = require('../scripts/studio/child');
const { createEventLog, eventStream, watchPlugin } = require('../scripts/studio/events');
const { cleanEnv } = require('./helpers');

const REAL_REPO = path.join(__dirname, '..');
const PREVIEW = 'http://127.0.0.1:4101';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const temps = [];

after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dems-${prefix}-`));
  temps.push(dir);
  return dir;
}

function writePlugin(folder, id, serverJs = 'module.exports = { async register() {} };\n') {
  fs.mkdirSync(folder, { recursive: true });
  const manifest = { id, name: id, version: '0.1.0', sdk: 1.1, description: 'Test', author: 'Test', server: 'server.js', permissions: [], settings: [] };
  fs.writeFileSync(path.join(folder, 'plugin.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(folder, 'server.js'), serverJs);
}

/** Temp repo root with `plugins/`, a `dev/start.js` and a plugin folder `work/studio-probe`. */
function makeRepo(startJs = '') {
  const root = tempDir('studio-child');
  fs.mkdirSync(path.join(root, 'plugins'));
  fs.mkdirSync(path.join(root, 'dev'));
  fs.writeFileSync(path.join(root, 'dev', 'start.js'), startJs);
  const folder = path.join(root, 'work', 'studio-probe');
  return { root, folder };
}

/** Fake `fork`: an EventEmitter child; a healthy one answers /healthz on env.PORT. */
function fakeFork({ stderr } = {}) {
  const forks = [];
  const killCalls = [];
  function fork(file, args, opts) {
    const child = new EventEmitter();
    child.pid = 40000 + forks.length;
    child.file = file;
    child.opts = opts;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.exitCode = null;
    child.exit = (code) => {
      if (child.exitCode !== null) return;
      child.exitCode = code;
      const done = () => {
        child.stdout.end();
        child.stderr.end();
        child.emit('exit', code, null);
      };
      if (child.server) {
        child.server.close(done);
        child.server.closeAllConnections();
      } else setImmediate(done);
    };
    child.kill = () => child.exit(null);
    if (stderr) {
      setTimeout(() => {
        child.stderr.write(stderr);
        setTimeout(() => child.exit(1), 20);
      }, 20);
    } else {
      child.server = http.createServer((req, res) => res.end(req.url === '/healthz' ? 'ok' : 'x'));
      child.server.listen(Number(opts.env.PORT), '127.0.0.1');
    }
    forks.push(child);
    return child;
  }
  function execFile(cmd, args, cb) {
    killCalls.push([cmd, args]);
    const child = forks.find((f) => String(f.pid) === args[args.length - 1]);
    if (child) child.exit(1);
    cb(null, '', '');
  }
  return { fork, forks, execFile, killCalls };
}

function setup(options = {}) {
  const { root, folder } = makeRepo();
  writePlugin(folder, 'studio-probe');
  const fake = fakeFork(options);
  const events = [];
  const child = createChild({
    repoRoot: root,
    folder,
    previewOrigin: PREVIEW,
    onEvent: (e) => events.push(e),
    fork: fake.fork,
    env: cleanEnv(),
    platform: 'win32',
    execFile: fake.execFile,
  });
  return { root, folder, fake, events, child };
}

test('forks dev/start.js with the studio env and waits for /healthz', async () => {
  const { root, fake, child } = setup();
  try {
    assert.equal(child.status(), 'stopped');
    assert.equal(child.port(), null);
    await child.start();
    assert.equal(child.status(), 'running');
    const [forked] = fake.forks;
    assert.equal(forked.file, path.join(root, 'dev', 'start.js'));
    assert.deepEqual(forked.opts.stdio, ['ignore', 'pipe', 'pipe', 'ipc']);
    const env = forked.opts.env;
    assert.equal(env.PLUGIN_STUDIO, '1');
    assert.equal(env.PLUGINS_DEV_ID, 'studio-probe');
    assert.equal(env.PLUGINS_DIR, path.join(root, 'data', 'dev-plugins'));
    assert.equal(env.BASE_URL, PREVIEW);
    assert.match(env.PORT, /^\d+$/);
    assert.equal(child.port(), Number(env.PORT));
  } finally {
    await child.stop();
  }
  assert.equal(child.status(), 'stopped');
  assert.equal(child.port(), null);
});

test('three restart() calls in a row cause exactly two real restarts', async () => {
  const { fake, child } = setup();
  try {
    await child.start();
    await Promise.all([child.restart(), child.restart(), child.restart()]);
    assert.equal(fake.forks.length, 3);
    assert.equal(child.status(), 'running');
    assert.deepEqual(fake.forks.map((f) => f.exitCode !== null), [true, true, false]);
  } finally {
    await child.stop();
  }
});

test('a child exiting before ready fails with an error event carrying its stderr', async () => {
  const { events, child } = setup({ stderr: 'Error: Cannot find module x\n    at boot (start.js:1)\n' });
  try {
    await child.start();
    assert.equal(child.status(), 'failed');
    assert.equal(child.port(), null);
    const error = events.find((e) => e.type === 'error');
    assert.ok(error, 'error event expected');
    assert.equal(error.data.where, 'start');
    assert.equal(error.data.message, 'Error: Cannot find module x\n    at boot (start.js:1)');
  } finally {
    await child.stop();
  }
});

test('keeps only the last 40 stderr lines', async () => {
  const lines = Array.from({ length: 60 }, (_, i) => `line ${i}`);
  const { events, child } = setup({ stderr: `${lines.join('\n')}\n` });
  try {
    await child.start();
    const error = events.find((e) => e.type === 'error');
    assert.equal(error.data.message, lines.slice(20).join('\n'));
  } finally {
    await child.stop();
  }
});

test('forwards only studio IPC messages of the opened plugin', async () => {
  const { fake, events, child } = setup();
  try {
    await child.start();
    const [forked] = fake.forks;
    const at = new Date().toISOString();
    forked.emit('message', { studio: true, type: 'dm', pluginId: 'studio-probe', at, data: { text: 'Hallo' } });
    forked.emit('message', { studio: true, type: 'dm', pluginId: 'badges', at, data: { text: 'fremd' } });
    forked.emit('message', { type: 'dm', pluginId: 'studio-probe', at, data: {} });
    forked.emit('message', 'plain');
    const dms = events.filter((e) => e.type === 'dm');
    assert.deepEqual(dms, [{ type: 'dm', pluginId: 'studio-probe', at, data: { text: 'Hallo' } }]);
  } finally {
    await child.stop();
  }
});

test('reports child status changes as lifecycle events', async () => {
  const { events, child } = setup();
  try {
    await child.start();
  } finally {
    await child.stop();
  }
  const statuses = events.filter((e) => e.type === 'lifecycle').map((e) => e.data.status);
  assert.deepEqual(statuses, ['starting', 'running', 'stopped']);
  assert.ok(events.every((e) => e.pluginId === 'studio-probe' && typeof e.at === 'string'));
});

test('an invalid plugin.json fails the start with the German reason', async () => {
  const { folder, events, child, fake } = setup();
  fs.writeFileSync(path.join(folder, 'plugin.json'), '{ kaputt');
  try {
    await child.start();
    assert.equal(child.status(), 'failed');
    assert.equal(fake.forks.length, 0);
    const error = events.find((e) => e.type === 'error');
    assert.equal(error.data.where, 'start');
    assert.equal(error.data.message, 'Im Ordner fehlt eine gültige plugin.json.');
  } finally {
    await child.stop();
  }
});

test('stop() kills the process tree with taskkill /T /F on win32', async () => {
  const { fake, child } = setup();
  await child.start();
  await child.stop();
  assert.deepEqual(fake.killCalls, [['taskkill', ['/T', '/F', '/PID', String(fake.forks[0].pid)]]]);
  assert.equal(fake.forks[0].exitCode, 1);
});

test('stop() during a restart leaves no child running', async () => {
  const { fake, child } = setup();
  await child.start();
  const restarting = child.restart();
  await child.stop();
  await restarting;
  assert.equal(child.status(), 'stopped');
  assert.ok(fake.forks.every((f) => f.exitCode !== null));
});

test('event log keeps 500 and drops the oldest', () => {
  const log = createEventLog();
  for (let i = 0; i < 510; i += 1) log.push({ type: 'log', data: { i } });
  const list = log.list();
  assert.equal(list.length, 500);
  assert.equal(list[0].data.i, 10);
  assert.equal(list[499].data.i, 509);
  log.clear();
  assert.deepEqual(log.list(), []);
});

test('event log subscribers get new events until they unsubscribe', () => {
  const log = createEventLog({ max: 3 });
  const seen = [];
  const unsubscribe = log.subscribe((e) => seen.push(e.n));
  log.subscribe(() => { throw new Error('broken subscriber'); });
  log.push({ n: 1 });
  unsubscribe();
  log.push({ n: 2 });
  assert.deepEqual(seen, [1]);
});

function readStream(res) {
  let text = '';
  res.setEncoding('utf8');
  res.on('data', (chunk) => { text += chunk; });
  return {
    text: () => text,
    async until(fragment, ms = 2000) {
      const deadline = Date.now() + ms;
      while (!text.includes(fragment)) {
        if (Date.now() > deadline) throw new Error(`"${fragment}" not in stream:\n${text}`);
        await sleep(10);
      }
    },
  };
}

test('SSE replays the log, then streams new events and unsubscribes on close', async () => {
  const log = createEventLog();
  log.push({ type: 'log', n: 1 });
  log.push({ type: 'dm', n: 2 });
  let unsubscribed = false;
  const tracked = {
    list: () => log.list(),
    subscribe: (fn) => {
      const off = log.subscribe(fn);
      return () => { unsubscribed = true; off(); };
    },
  };
  const server = http.createServer(eventStream(tracked, { heartbeatMs: 30 }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const req = http.get({ host: '127.0.0.1', port, path: '/' });
  try {
    const res = await new Promise((resolve, reject) => { req.on('response', resolve); req.on('error', reject); });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'text/event-stream; charset=utf-8');
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(res.headers['x-accel-buffering'], 'no');
    const stream = readStream(res);
    await stream.until('"n":2');
    assert.ok(stream.text().startsWith(
      `event: studio\ndata: ${JSON.stringify({ type: 'log', n: 1 })}\n\nevent: studio\ndata: ${JSON.stringify({ type: 'dm', n: 2 })}\n\n`,
    ));
    log.push({ type: 'request', n: 3 });
    await stream.until(`event: studio\ndata: ${JSON.stringify({ type: 'request', n: 3 })}\n\n`);
    await stream.until(': ping\n\n');
  } finally {
    req.destroy();
    const deadline = Date.now() + 2000;
    while (!unsubscribed && Date.now() < deadline) await sleep(10);
    await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
  }
  assert.equal(unsubscribed, true);
});

test('watchPlugin coalesces a burst and ignores dot entries and node_modules', async () => {
  const dir = tempDir('studio-watch');
  fs.mkdirSync(path.join(dir, 'lib'));
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.mkdirSync(path.join(dir, '.git'));
  await sleep(100);
  let calls = 0;
  const watcher = watchPlugin(dir, () => { calls += 1; }, { debounceMs: 150 });
  try {
    fs.writeFileSync(path.join(dir, 'node_modules', 'x.js'), '1');
    fs.writeFileSync(path.join(dir, '.git', 'index'), '1');
    fs.writeFileSync(path.join(dir, '.env'), '1');
    await sleep(500);
    assert.equal(calls, 0);
    fs.writeFileSync(path.join(dir, 'server.js'), '1');
    fs.writeFileSync(path.join(dir, 'lib', 'a.js'), '1');
    fs.writeFileSync(path.join(dir, 'server.js'), '2');
    await sleep(600);
    assert.equal(calls, 1);
  } finally {
    watcher.close();
  }
});

function portClosed(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => resolve(true));
  });
}

test('runs the real DEMS mock child on a temp plugin folder and stops it', { timeout: 120000 }, async (t) => {
  // Temp repo root: prepareDev mounts under <temp>/data/dev-plugins, the stub boots the real DEMS.
  const { root, folder } = makeRepo(`require(${JSON.stringify(path.join(REAL_REPO, 'dev', 'start.js'))});\n`);
  writePlugin(folder, 'studio-probe', "module.exports = { async register(ctx) { ctx.log.info('Studio-Test bereit'); } };\n");
  const events = [];
  const child = createChild({
    repoRoot: root,
    folder,
    previewOrigin: PREVIEW,
    onEvent: (e) => events.push(e),
    env: cleanEnv({ DEV_SQLITE_PATH: path.join(root, 'dev.sqlite'), DEV_UPLOAD_DIR: path.join(root, 'uploads') }),
    readyTimeoutMs: 60000,
  });
  let port = null;
  try {
    let timer;
    const outcome = await Promise.race([
      child.start().then(() => 'done'),
      new Promise((resolve) => { timer = setTimeout(() => resolve('slow'), 60000); }),
    ]);
    clearTimeout(timer);
    if (outcome === 'slow') return t.skip('DEMS brauchte länger als 60 s zum Start');
    assert.equal(child.status(), 'running', JSON.stringify(events.filter((e) => e.type === 'error')));
    port = child.port();
    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(health.status, 200);
    const deadline = Date.now() + 5000;
    while (!events.some((e) => e.type === 'log') && Date.now() < deadline) await sleep(50);
    const log = events.find((e) => e.type === 'log');
    assert.ok(log, 'log event of the plugin expected');
    assert.equal(log.data.text, 'Studio-Test bereit');
    assert.ok(events.every((e) => e.pluginId === 'studio-probe'));
  } finally {
    await child.stop();
  }
  assert.equal(child.status(), 'stopped');
  assert.equal(await portClosed(port), true);
});
