'use strict';
// Entry of the plugin studio: assembles studio server, preview proxy and actions (+ DEMS child) and
// handles start URL, browser opening and shutdown.
const path = require('node:path');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const { createStudioServer } = require('./server');
const { createPreviewProxy } = require('./proxy');
const { createActions } = require('./actions');
const { PackageError } = require('../../plugin-sdk/errors');

const REPO = path.join(__dirname, '..', '..');

/** Command that opens `url` in the default browser; the URL is quoted for cmd.exe on Windows. */
function openCommand(platform, url) {
  if (platform === 'win32') {
    // Inside quotes `#` and `&` are literal for cmd; `"` and `%` could break out or expand, the studio URL has neither.
    if (/["%^<>|\r\n]/.test(url)) throw new Error('Unsicherer URL.');
    return { command: 'cmd', args: ['/d', '/s', '/c', `"start "" "${url}""`], options: { windowsVerbatimArguments: true } };
  }
  return { command: platform === 'darwin' ? 'open' : 'xdg-open', args: [url], options: {} };
}

function defaultOpen(url) {
  const { command, args, options } = openCommand(process.platform, url);
  const child = childProcess.spawn(command, args, { ...options, detached: true, stdio: 'ignore' });
  child.on('error', () => {}); // no browser: the printed URL is the fallback
  child.unref();
}

/**
 * Start the plugin studio.
 *
 * @param {object} options
 * @param {number} [options.port=3100] -> Studio port; the preview proxy takes port + 1 (0: both random).
 * @param {string} [options.repoRoot] -> DEMS repository the child runs from.
 * @param {object} [options.env] -> Environment (NODE_ENV=production is refused).
 * @param {Function} [options.openBrowser] -> `(url) => void`.
 * @param {{ write(text: string): void }} options.out -> Where the start line goes.
 * @param {string} [options.configDir] -> Folder of `recent.json`.
 * @returns {Promise<{ url: string, previewPort: number, stop(): Promise<void>, done: Promise<void> }>}
 */
async function startStudio({ port = 3100, repoRoot = REPO, env = process.env, openBrowser = defaultOpen, out = process.stdout, configDir, _deps = {} } = {}) {
  if (env.NODE_ENV === 'production') throw new PackageError('plugin studio läuft nicht mit NODE_ENV=production.');
  const token = crypto.randomBytes(32).toString('hex');
  const publicDir = path.join(repoRoot, 'public');
  let proxy;
  let server;
  const makeActions = _deps.createActions || createActions;
  const actions = makeActions({
    repoRoot,
    env,
    ...(configDir ? { configDir } : {}),
    previewOrigin: () => proxy.url,
  });
  proxy = (_deps.createPreviewProxy || createPreviewProxy)({
    port: port === 0 ? 0 : port + 1,
    studioPort: () => server.address().port,
    target: () => {
      const childPort = actions.childPort();
      return childPort ? { port: childPort } : null;
    },
  });
  server = (_deps.createStudioServer || createStudioServer)({
    port,
    previewPort: () => proxy.address().port,
    token,
    routes: actions.routes,
    styleFallback: 'attr', // Monaco sets style attributes; its <style> elements carry the page nonce
    vendorDirs: {
      '/vendor/': path.join(publicDir, 'vendor'),
      '/css/tokens.css': path.join(publicDir, 'css', 'tokens.css'),
      '/monaco/': path.join(__dirname, 'vendor', 'monaco'),
      '/types/': path.join(repoRoot, 'plugin-sdk', 'types'),
    },
  });

  // Never throws: every step is caught and logged, and the whole shutdown is capped.
  const closeAll = async () => {
    const step = async (fn) => { try { await fn(); } catch (err) { console.error(`studio stop: ${err && err.message ? err.message : err}`); } };
    const work = (async () => {
      await Promise.all([step(() => actions.stop()), step(() => server.close()), step(() => proxy.close())]);
    })();
    let timer;
    const limit = new Promise((resolve) => {
      timer = setTimeout(() => { console.error('Beenden dauert zu lange – erzwinge Ende.'); resolve(); }, _deps.stopTimeoutMs || 10000);
    });
    await Promise.race([work, limit]);
    clearTimeout(timer);
  };
  const portError = (err, p) => (err && err.code === 'EADDRINUSE'
    ? new PackageError(`Port ${p} ist belegt. Starte mit --port <anderer Port>.`) : err);
  try {
    await server.listen();
  } catch (err) {
    await closeAll();
    throw portError(err, port);
  }
  try {
    await proxy.listen();
  } catch (err) {
    await closeAll();
    throw portError(err, port + 1);
  }

  const url = `http://127.0.0.1:${server.address().port}/#token=${token}`;
  let stopped = null;
  let finish;
  const done = new Promise((resolve) => { finish = resolve; });
  const onSignal = () => { stop().catch(() => {}); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  function stop() {
    if (!stopped) {
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
      stopped = closeAll().finally(() => finish());
    }
    return stopped;
  }

  out.write(`Plugin-Studio läuft auf ${url}\n`);
  try { openBrowser(url); } catch { /* the printed URL is enough */ }
  return { url, previewPort: proxy.address().port, stop, done };
}

module.exports = { startStudio, _test: { openCommand } };
