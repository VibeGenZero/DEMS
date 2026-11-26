'use strict';
// API routes of the plugin studio: open/new plugin, recent list, file API, check, build,
// event stream, hook triggers and the VS Code link. Wires files, child, events and triggers.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const files = require('./files');
const recent = require('./recent');
const { createEventLog, eventStream, watchPlugin } = require('./events');
const { PackageError } = require('../../plugin-sdk/errors');
const { ID_PATTERN } = require('../../plugin-sdk/manifest');
const { analyzePlugin, writeManifest, packPlugin } = require('../../plugin-sdk/package');
const { scaffoldPlugin, reportLines } = require('../plugin');

const { StudioError } = files;
const MANIFEST = 'plugin.json';
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

const value = (v) => (typeof v === 'function' ? v() : v);
const ok = () => ({ json: { ok: true } });

function text(v, message) {
  if (typeof v !== 'string' || v === '') throw new StudioError(message, 400);
  return v;
}

const pathArg = (v) => text(v, 'Bitte einen Pfad angeben.');
const sha256 = (content) => crypto.createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex');
const CHANGED_OUTSIDE = 'Die Datei wurde außerhalb des Studios geändert.';

/** `vscode://file/<abs dir>` with forward slashes; segments are URL-encoded, a drive letter stays as it is. */
function vscodeUrl(dir) {
  const segments = dir.split(/[\\/]+/).filter(Boolean);
  return `vscode://file/${segments.map((s) => (/^[A-Za-z]:$/.test(s) ? s : encodeURIComponent(s))).join('/')}`;
}

/**
 * @param {object} options
 * @param {string} options.repoRoot -> Repository with `dev/start.js` (the child mounts the plugin below it).
 * @param {string|(() => string)} options.previewOrigin -> Origin of the preview proxy (a function: known after listen).
 * @param {string} [options.configDir] -> Folder of `recent.json`.
 * @param {object} [options.env] -> Base environment of the DEMS child.
 * @param {Function} [options.createChild] -> `child.createChild` (tests inject a fake).
 * @param {Function} [options.createTriggers] -> `triggers.createTriggers`.
 * @param {string} [options.devPluginsDir] -> Mount folder of the child (default `<repoRoot>/data/dev-plugins`).
 * @param {number} [options.debounceMs] -> Debounce of the folder watcher.
 * @returns {{ routes: object, log: object, childPort(): number|null, stop(): Promise<void> }}
 */
function createActions({
  repoRoot,
  previewOrigin,
  configDir = recent.configDir(),
  env = process.env,
  createChild = require('./child').createChild,
  createTriggers = require('./triggers').createTriggers,
  debounceMs = 300,
  devPluginsDir,
} = {}) {
  const log = createEventLog();
  let opened = null; // { dir, id, name, version } as at open time; refreshed after a valid plugin.json save
  let child = null;
  let watcher = null;
  let triggers = null;
  let queue = Promise.resolve();

  /** Opening and stopping run one after another (two children would share data/dev-plugins). */
  function exclusive(fn) {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  }

  const view = () => (opened ? { ...opened } : null);

  function requireOpen() {
    if (!opened) throw new StudioError('Bitte zuerst ein Plugin öffnen.', 409);
    return opened.dir;
  }

  function loadRecent() {
    try {
      return recent.load(configDir);
    } catch (err) {
      console.error(`studio recent: ${err && err.message ? err.message : err}`);
      return [];
    }
  }

  function bestEffort(fn) {
    try {
      fn();
    } catch (err) {
      console.error(`studio recent: ${err && err.message ? err.message : err}`);
    }
  }

  /** Take name and version of a valid plugin.json; an invalid one leaves the session as it was. */
  function refresh() {
    if (!opened) return;
    try {
      const next = files.openPlugin(opened.dir);
      if (next.dir === opened.dir && next.id === opened.id) {
        opened = { ...opened, name: next.manifest.name, version: next.version };
      }
    } catch { /* check and build report the problem */ }
  }

  async function closeCurrent() {
    if (watcher) watcher.close();
    watcher = null;
    if (child) await child.stop();
    child = null;
    triggers = null;
  }

  function open(folder) {
    return exclusive(async () => {
      const plugin = files.openPlugin(folder);
      await closeCurrent();
      log.clear();
      opened = { id: plugin.id, name: plugin.manifest.name, version: plugin.version, dir: plugin.dir };
      const current = createChild({ repoRoot, folder: plugin.dir, previewOrigin: value(previewOrigin), onEvent: (e) => log.push(e), env, devPluginsDir });
      child = current;
      triggers = createTriggers({ childPort: () => current.port() });
      watcher = watchPlugin(plugin.dir, () => {
        refresh();
        // Studio-internal: the page refreshes its file list and open tabs (no debug line, not kept)
        log.broadcast({ type: 'files', pluginId: plugin.id, at: new Date().toISOString() });
        current.restart().catch((err) => console.error(`studio child: ${err && err.stack ? err.stack : err}`));
      }, { debounceMs });
      bestEffort(() => recent.add(configDir, { dir: plugin.dir, id: plugin.id, name: plugin.manifest.name }));
      current.start().catch((err) => console.error(`studio child: ${err && err.stack ? err.stack : err}`));
      return { json: { plugin: view() } };
    });
  }

  function createPlugin(body) {
    const id = body.id;
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw new StudioError('Die ID ist nicht erlaubt.', 400);
    const parent = text(body.parentDir, 'Bitte einen Ordner angeben.');
    if (!path.isAbsolute(parent)) throw new StudioError('Bitte einen vollständigen Pfad angeben.', 400);
    if (fs.existsSync(path.join(parent, id))) throw new StudioError(`Den Ordner gibt es schon: ${id}`, 409);
    let dir;
    try {
      dir = scaffoldPlugin(id, parent);
    } catch (err) {
      console.error(`studio new: ${err && err.stack ? err.stack : err}`);
      throw new StudioError('Das Plugin konnte nicht angelegt werden.', 500);
    }
    return open(dir);
  }

  /** `analyzePlugin`, or the German reason when plugin.json cannot be read as a manifest. */
  function analyze(dir) {
    if (!fs.existsSync(dir)) throw new StudioError('Der Plugin-Ordner wurde nicht gefunden.', 404);
    try {
      return { analysis: analyzePlugin(dir) };
    } catch (err) {
      if (err instanceof PackageError) return { failure: err.message };
      if (err && err.code === 'ENOENT') return { failure: 'Im Ordner liegt keine plugin.json.' };
      throw err;
    }
  }

  function check() {
    const { analysis, failure } = analyze(requireOpen());
    if (failure) return { json: { lines: [], errors: [`Fehler: ${failure}`], changed: false } };
    return { json: { ...reportLines(analysis), changed: analysis.changed } };
  }

  function build(body) {
    const dir = requireOpen();
    const apply = body.apply === true;
    const { analysis, failure } = analyze(dir);
    if (failure) {
      const errors = [`Fehler: ${failure}`];
      if (apply) return { status: 400, json: { error: failure, lines: [], errors } };
      return { json: { lines: [], errors, changed: false, nextManifest: null } };
    }
    const { lines, errors } = reportLines(analysis);
    if (!apply) return { json: { lines, errors, changed: analysis.changed, nextManifest: analysis.nextRaw } };
    if (analysis.errors.length) return { status: 400, json: { error: analysis.errors[0], lines, errors } };
    if (analysis.changed) {
      writeManifest(dir, analysis.nextRaw);
      refresh();
    }
    let pack;
    try {
      pack = packPlugin(dir);
    } catch (err) {
      if (err instanceof PackageError) throw new StudioError(err.message, 400);
      throw err;
    }
    const fileName = pack.fileName.replace(/["\\\r\n]/g, '_');
    return {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store',
      },
      body: pack.buffer,
    };
  }

  function upload(dir, rel, base64) {
    const compact = typeof base64 === 'string' ? base64.replace(/\s+/g, '') : null;
    if (compact === null || compact.length % 4 !== 0 || !BASE64.test(compact)) throw new StudioError('Die Datei ist nicht lesbar.', 400);
    files.writeBinary(dir, rel, Buffer.from(compact, 'base64'));
  }

  const routes = {
    'GET /api/state': () => ({
      json: { plugin: view(), child: child ? child.status() : 'stopped', previewUrl: value(previewOrigin), recent: loadRecent() },
    }),
    'POST /api/open': (req, body) => open(text(body.dir, 'Bitte einen Ordner angeben.')),
    'POST /api/new': (req, body) => createPlugin(body),
    'POST /api/recent/remove': (req, body) => {
      const dir = text(body.dir, 'Bitte einen Ordner angeben.');
      bestEffort(() => recent.remove(configDir, dir));
      return { json: { recent: loadRecent() } };
    },
    'GET /api/files': () => ({ json: { files: files.listFiles(requireOpen()) } }),
    'GET /api/file': (req, body, query) => {
      const dir = requireOpen();
      const rel = pathArg(query.path);
      const content = files.readFile(dir, rel);
      return { json: { path: rel, content, hash: sha256(content) } };
    },
    'PUT /api/file': (req, body) => {
      const dir = requireOpen();
      const rel = pathArg(body.path);
      // baseHash: the hash the page loaded or last saved; without it (old clients) the save overwrites
      if (body.baseHash !== undefined) {
        if (typeof body.baseHash !== 'string') throw new StudioError('Ungültiger Stand der Datei.', 400);
        if (files.fileHash(dir, rel) !== body.baseHash) throw new StudioError(CHANGED_OUTSIDE, 409);
      }
      files.writeFile(dir, rel, body.content);
      if (rel === MANIFEST) refresh();
      return { json: { ok: true, hash: sha256(body.content) } };
    },
    'POST /api/file': (req, body) => {
      const dir = requireOpen();
      const rel = pathArg(body.path);
      if (body.base64 !== undefined) upload(dir, rel, body.base64);
      else files.createFile(dir, rel);
      if (rel === MANIFEST) refresh();
      return ok();
    },
    'POST /api/file/rename': (req, body) => {
      const dir = requireOpen();
      const from = pathArg(body.from);
      const to = pathArg(body.to);
      files.renameFile(dir, from, to);
      if (from === MANIFEST || to === MANIFEST) refresh();
      return ok();
    },
    'DELETE /api/file': (req, body) => {
      files.deleteFile(requireOpen(), pathArg(body.path));
      return ok();
    },
    'POST /api/check': () => check(),
    'POST /api/build': (req, body) => build(body),
    'POST /api/events/clear': () => {
      log.clear();
      return ok();
    },
    'GET /api/events': { raw: true, handler: eventStream(log) },
    'POST /api/trigger': async (req, body) => {
      requireOpen();
      return { json: await triggers.run(body.action) };
    },
    'GET /api/vscode': () => ({ json: { url: vscodeUrl(requireOpen()) } }),
  };

  return {
    routes,
    log,
    /** Port of the running DEMS child (null while none is running or it is starting). */
    childPort: () => (child ? child.port() : null),
    stop: () => exclusive(async () => {
      await closeCurrent();
    }),
  };
}

module.exports = { createActions, _test: { vscodeUrl } };
