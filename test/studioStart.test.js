'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const http = require('node:http');
const path = require('node:path');
const { Writable } = require('node:stream');
const { startStudio, _test } = require('../scripts/studio');

const REPO = path.join(__dirname, '..');

function sink() {
  const chunks = [];
  const stream = new Writable({ write(chunk, enc, cb) { chunks.push(String(chunk)); cb(); } });
  stream.text = () => chunks.join('');
  return stream;
}

function get(port, urlPath = '/') {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    }).on('error', reject);
  });
}

const canConnect = (port) => new Promise((resolve) => {
  const s = net.connect(port, '127.0.0.1');
  s.on('connect', () => { s.destroy(); resolve(true); });
  s.on('error', () => resolve(false));
});

const configDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dems-studio-start-'));

test('startStudio prints the URL with a token, opens it and stop() closes both ports', async () => {
  const out = sink();
  const opened = [];
  const studio = await startStudio({
    port: 0, repoRoot: REPO, env: {}, out, configDir: configDir(), openBrowser: (url) => opened.push(url),
  });
  try {
    assert.match(studio.url, /^http:\/\/127\.0\.0\.1:\d+\/#token=[0-9a-f]{64}$/);
    assert.match(out.text(), /Plugin-Studio läuft auf http:\/\/127\.0\.0\.1:\d+\/#token=[0-9a-f]{64}/);
    assert.deepEqual(opened, [studio.url]);
    const studioPort = Number(new URL(studio.url).port);
    assert.equal(await get(studioPort), 200);
    assert.equal(await get(studioPort, '/vendor/'), 404);
    assert.equal(await get(studioPort, '/css/tokens.css'), 200);
    assert.ok(studio.previewPort && studio.previewPort !== studioPort);
    assert.equal(await canConnect(studio.previewPort), true);
    await studio.stop();
    assert.equal(await canConnect(studioPort), false);
    assert.equal(await canConnect(studio.previewPort), false);
  } finally { await studio.stop(); }
});

test('the printed URL stays the same and works again (a closed tab leaves the studio running)', async () => {
  const studio = await startStudio({ port: 0, repoRoot: REPO, env: {}, out: sink(), configDir: configDir(), openBrowser: () => {} });
  try {
    const port = Number(new URL(studio.url).port);
    assert.equal(await get(port), 200);
    assert.equal(await get(port), 200);
  } finally { await studio.stop(); }
});

test('stop() removes the signal handlers it added', async () => {
  const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
  const studio = await startStudio({ port: 0, repoRoot: REPO, env: {}, out: sink(), configDir: configDir(), openBrowser: () => {} });
  assert.equal(process.listenerCount('SIGINT'), before[0] + 1);
  await studio.stop();
  assert.deepEqual([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')], before);
});

test('a taken port gives the German message and closes what was started', async () => {
  const blocker = net.createServer();
  await new Promise((r) => blocker.listen(0, '127.0.0.1', r));
  const taken = blocker.address().port;
  try {
    await assert.rejects(
      startStudio({ port: taken, repoRoot: REPO, env: {}, out: sink(), configDir: configDir(), openBrowser: () => {} }),
      { message: `Port ${taken} ist belegt. Starte mit --port <anderer Port>.` },
    );
  } finally { await new Promise((r) => blocker.close(r)); }
});

test('a taken preview port closes the studio server again', async () => {
  const blocker = net.createServer();
  await new Promise((r) => blocker.listen(0, '127.0.0.1', r));
  const previewTaken = blocker.address().port;
  try {
    await assert.rejects(
      startStudio({ port: previewTaken - 1, repoRoot: REPO, env: {}, out: sink(), configDir: configDir(), openBrowser: () => {} }),
      /ist belegt/,
    );
    assert.equal(await canConnect(previewTaken - 1), false);
  } finally { await new Promise((r) => blocker.close(r)); }
});

test('NODE_ENV=production is refused', async () => {
  await assert.rejects(
    startStudio({ port: 0, repoRoot: REPO, env: { NODE_ENV: 'production' }, out: sink(), openBrowser: () => {} }),
    { message: 'plugin studio läuft nicht mit NODE_ENV=production.' },
  );
});

test('an opener that throws only leaves the URL printed', async () => {
  const out = sink();
  const studio = await startStudio({
    port: 0, repoRoot: REPO, env: {}, out, configDir: configDir(), openBrowser: () => { throw new Error('kein Browser'); },
  });
  try { assert.match(out.text(), /#token=/); } finally { await studio.stop(); }
});

test('browser command per platform quotes the URL for the shell', () => {
  const url = 'http://127.0.0.1:3100/#token=ab&c';
  assert.deepEqual(_test.openCommand('win32', url), { command: 'cmd', args: ['/d', '/s', '/c', '"start "" "http://127.0.0.1:3100/#token=ab&c""'], options: { windowsVerbatimArguments: true } });
  assert.throws(() => _test.openCommand('win32', 'http://x/" & calc'));
  assert.equal(_test.openCommand('darwin', url).command, 'open');
  assert.deepEqual(_test.openCommand('linux', url), { command: 'xdg-open', args: [url], options: {} });
});
