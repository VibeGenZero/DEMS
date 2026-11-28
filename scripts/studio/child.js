'use strict';
// DEMS child of the plugin studio: forks dev/start.js in mock mode with one plugin mounted,
// waits for /healthz, forwards the plugin's debug events and restarts or stops the process tree.
const childProcess = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { prepareDev } = require('../plugin');

const STDERR_LINES = 40;
const POLL_MS = 100;
const KILL_GRACE_MS = 3000;
const EXIT_WAIT_MS = 10000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function healthy(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/healthz', agent: false, timeout: 1000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

/**
 * @param {object} options
 * @param {string} options.repoRoot -> Repository with `dev/start.js`; the plugin is mounted under `<repoRoot>/data/dev-plugins`.
 * @param {string} options.folder -> Plugin folder under development.
 * @param {string} options.previewOrigin -> Origin of the preview proxy (BASE_URL of the child).
 * @param {(event: object) => void} options.onEvent -> Debug events of the plugin and the supervisor's own events.
 * @param {Function} [options.fork] -> `child_process.fork` (tests inject a fake).
 * @param {object} [options.env] -> Base environment handed to `prepareDev`.
 * @param {string} [options.platform] -> `process.platform` (tests).
 * @param {Function} [options.execFile] -> `child_process.execFile` (tests).
 * @param {string} [options.devPluginsDir] -> Mount folder handed to `prepareDev` (default `<repoRoot>/data/dev-plugins`).
 * @param {number} [options.readyTimeoutMs] -> How long to wait for /healthz.
 * @returns {{ start(): Promise<void>, restart(): Promise<void>, stop(): Promise<void>, port(): number|null, status(): string }}
 */
function createChild({
  repoRoot,
  folder,
  previewOrigin,
  onEvent = () => {},
  fork = childProcess.fork,
  env = process.env,
  platform = process.platform,
  execFile = childProcess.execFile,
  readyTimeoutMs = 30000,
  devPluginsDir,
} = {}) {
  let state = 'stopped';
  let current = null; // { child, port, ready, killed, exitInfo, exited, stderrEnded }
  let pluginId = path.basename(path.resolve(folder)); // prepareDev insists on folder name = id
  let wanted = false;
  let restarting = null;
  let pending = false;

  function emit(type, data) {
    try { onEvent({ type, pluginId, at: new Date().toISOString(), data }); } catch { /* the page side reports its own errors */ }
  }

  function setStatus(next) {
    if (state === next) return;
    state = next;
    emit('lifecycle', { status: next, where: 'child' });
  }

  function fail(message, where) {
    setStatus('failed');
    emit('error', { message, where });
  }

  function collect(rec, chunk) {
    const lines = (rec.partial + chunk).split(/\r?\n/);
    rec.partial = lines.pop();
    rec.stderr.push(...lines);
    if (rec.stderr.length > STDERR_LINES) rec.stderr = rec.stderr.slice(rec.stderr.length - STDERR_LINES);
  }

  function lastLines(rec) {
    const lines = rec.partial ? [...rec.stderr, rec.partial].slice(-STDERR_LINES) : rec.stderr;
    return lines.join('\n').trimEnd();
  }

  /** Waits until the child's stderr is drained (at most 1 s), so the last lines hold its error. */
  const drained = (rec) => Promise.race([rec.stderrEnded, sleep(1000)]);

  function killTree(rec) {
    const { pid } = rec.child;
    if (!pid || rec.exitInfo) return;
    if (platform === 'win32') {
      execFile('taskkill', ['/T', '/F', '/PID', String(pid)], (err) => {
        if (!err || rec.exitInfo) return;
        try { rec.child.kill('SIGKILL'); } catch { /* already gone */ }
      });
      return;
    }
    const signal = (name) => {
      try { process.kill(-pid, name); } catch {
        try { rec.child.kill(name); } catch { /* already gone */ }
      }
    };
    signal('SIGTERM');
    const timer = setTimeout(() => { if (!rec.exitInfo) signal('SIGKILL'); }, KILL_GRACE_MS);
    timer.unref();
    rec.exited.then(() => clearTimeout(timer));
  }

  async function killCurrent() {
    const rec = current;
    if (!rec) return;
    current = null;
    rec.killed = true;
    killTree(rec);
    let timer;
    await Promise.race([rec.exited, new Promise((resolve) => { timer = setTimeout(resolve, EXIT_WAIT_MS); timer.unref(); })]);
    clearTimeout(timer);
  }

  async function waitReady(rec) {
    const deadline = Date.now() + readyTimeoutMs;
    for (;;) {
      if (rec.killed) return 'killed';
      if (rec.exitInfo) return 'exited';
      if (await healthy(rec.port)) return rec.killed ? 'killed' : 'ready';
      if (Date.now() > deadline) return 'timeout';
      await sleep(POLL_MS);
    }
  }

  async function launch() {
    if (!wanted) return;
    setStatus('starting');
    try {
      await spawnAndWait();
    } catch (err) {
      // freePort or fork failed: report it like a failed start instead of breaking later restarts
      if (wanted) fail(err && err.message ? err.message : String(err), 'start');
    }
  }

  async function spawnAndWait() {
    let prepared;
    try {
      prepared = prepareDev(folder, { repoRoot, env, devPluginsDir });
    } catch (err) {
      fail(err.message, 'start');
      return;
    }
    pluginId = prepared.env.PLUGINS_DEV_ID;
    const port = await freePort();
    if (!wanted) return;
    const child = fork(path.join(repoRoot, 'dev', 'start.js'), [], {
      cwd: repoRoot,
      env: { ...prepared.env, PORT: String(port), PLUGIN_STUDIO: '1', BASE_URL: previewOrigin },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      execArgv: [],
      detached: platform !== 'win32', // own process group, so stop() reaches the whole tree
      windowsHide: true,
    });
    const rec = { child, port, ready: false, killed: false, exitInfo: null, stderr: [], partial: '' };
    current = rec;
    rec.stderrEnded = new Promise((resolve) => {
      if (!child.stderr) return resolve();
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => collect(rec, chunk));
      child.stderr.once('end', resolve);
      child.stderr.once('close', resolve);
    });
    rec.exited = new Promise((resolve) => {
      const done = (info) => {
        if (rec.exitInfo) return;
        rec.exitInfo = info;
        resolve(info);
        if (rec.ready && !rec.killed && current === rec) {
          current = null;
          setStatus('failed');
          drained(rec).then(() => emit('error', { message: lastLines(rec) || `DEMS wurde unerwartet beendet (Code ${info.code}).`, where: 'run' }));
        }
      };
      child.once('exit', (code, signal) => done({ code, signal }));
      child.once('error', (err) => done({ code: null, signal: null, error: err }));
    });
    if (child.stdout) child.stdout.resume();
    child.on('message', (msg) => {
      if (rec.killed || (current && current !== rec)) return; // a stopped or replaced child
      if (!msg || msg.studio !== true || msg.pluginId !== pluginId) return;
      const { type, at, data } = msg;
      try { onEvent({ type, pluginId, at, data }); } catch { /* see emit */ }
    });

    const outcome = await waitReady(rec);
    if (outcome === 'ready') {
      rec.ready = true;
      setStatus('running');
    } else if (outcome === 'exited') {
      current = null;
      await drained(rec);
      const why = rec.exitInfo.error ? rec.exitInfo.error.message : `DEMS wurde beim Start beendet (Code ${rec.exitInfo.code}).`;
      fail(lastLines(rec) || why, 'start');
    } else if (outcome === 'timeout') {
      await killCurrent();
      const seconds = Math.round(readyTimeoutMs / 1000);
      fail([`DEMS war nach ${seconds} s nicht erreichbar.`, lastLines(rec)].filter(Boolean).join('\n'), 'start');
    }
  }

  async function runRestarts() {
    try {
      for (;;) {
        pending = false;
        await killCurrent();
        await launch();
        if (!pending || !wanted) return;
      }
    } finally {
      restarting = null; // runs in the same tick as the last check, so no restart() request is lost
    }
  }

  return {
    start() {
      const wasWanted = wanted;
      wanted = true;
      if (restarting) {
        if (!wasWanted) pending = true; // a stop() is draining this run: launch once more after it
        return restarting;
      }
      if (current) return Promise.resolve();
      restarting = runRestarts(); // nothing to kill: a plain launch that later restart() calls queue behind
      return restarting;
    },
    restart() {
      wanted = true;
      if (restarting) {
        pending = true;
        return restarting;
      }
      restarting = runRestarts();
      return restarting;
    },
    async stop() {
      wanted = false;
      pending = false;
      const inFlight = restarting;
      await killCurrent();
      if (inFlight) await inFlight;
      if (wanted) return; // a start() or restart() during the stop wins
      await killCurrent();
      setStatus('stopped');
    },
    port: () => (state === 'running' && current ? current.port : null),
    status: () => state,
  };
}

module.exports = { createChild };
