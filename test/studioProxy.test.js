'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createPreviewProxy } = require('../scripts/studio/proxy');

const STUDIO = 4777;
let upstream, upPort, proxy, port, targetOn = true;

function request(method, urlPath, { headers = {}, body, host, p } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: p || port, method, path: urlPath,
      headers: { Host: host || `127.0.0.1:${p || port}`, ...headers },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('error', reject);
      res.on('close', () => { if (!res.complete) reject(new Error('aborted')); });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

before(async () => {
  upstream = http.createServer((req, res) => {
    if (req.url === '/csp') {
      res.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'self'");
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      res.setHeader('Set-Cookie', ['a=1; Path=/', 'b=2; HttpOnly']);
      return res.end('ok');
    }
    if (req.url === '/csp-noframe') { res.setHeader('Content-Security-Policy', "default-src 'self'; "); return res.end('ok'); }
    if (req.url === '/loc-dots') {
      res.writeHead(302, { Location: `http://127x0x0x1:${upPort}/x` });
      return res.end();
    }
    if (req.url === '/nocsp') { res.setHeader('X-Frame-Options', 'DENY'); return res.end('x'); }
    if (req.url === '/loc') {
      res.writeHead(302, { Location: `http://127.0.0.1:${upPort}/x` });
      return res.end();
    }
    if (req.url === '/host') return res.end(req.headers.host);
    if (req.url === '/204') { res.statusCode = 204; return res.end(); }
    if (req.url === '/304') { res.statusCode = 304; return res.end(); }
    if (req.url === '/abort') { res.write('part'); setTimeout(() => res.socket.destroy(), 20); return; }
    if (req.method === 'POST') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => res.end(String(Buffer.concat(chunks).length)));
      return;
    }
    res.end('plain');
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  upPort = upstream.address().port;
  proxy = createPreviewProxy({ port: 0, studioPort: () => STUDIO, target: () => (targetOn ? { port: upPort } : null) });
  await proxy.listen();
  port = proxy.address().port;
});

after(async () => { await proxy.close(); await new Promise((r) => { upstream.close(r); upstream.closeAllConnections(); }); });

test('replaces frame-ancestors, drops X-Frame-Options, keeps cookies', async () => {
  const r = await request('GET', '/csp');
  assert.equal(r.headers['content-security-policy'], `default-src 'self'; frame-ancestors 'self' http://127.0.0.1:${STUDIO} http://localhost:${STUDIO}`);
  assert.equal(r.headers['x-frame-options'], undefined);
  assert.deepEqual(r.headers['set-cookie'], ['a=1; Path=/', 'b=2; HttpOnly']);
});

test('appends frame-ancestors to a CSP that has none', async () => {
  const r = await request('GET', '/csp-noframe');
  assert.equal(r.headers['content-security-policy'], `default-src 'self'; frame-ancestors 'self' http://127.0.0.1:${STUDIO} http://localhost:${STUDIO}`);
});

test('rewrites only a Location that really names the child (dots are literal)', async () => {
  const r = await request('GET', '/loc-dots');
  assert.equal(r.headers.location, `http://127x0x0x1:${upPort}/x`);
});

test('adds no CSP when the upstream has none, still drops X-Frame-Options', async () => {
  const r = await request('GET', '/nocsp');
  assert.equal(r.headers['content-security-policy'], undefined);
  assert.equal(r.headers['x-frame-options'], undefined);
});

test('streams a 1 MB POST body intact', async () => {
  const r = await request('POST', '/up', { body: Buffer.alloc(1024 * 1024, 7) });
  assert.equal(r.body.toString(), String(1024 * 1024));
});

test('rewrites Location to the preview origin', async () => {
  const r = await request('GET', '/loc');
  assert.equal(r.status, 302);
  assert.equal(r.headers.location, `http://127.0.0.1:${port}/x`);
});

test('forwards the original preview Host', async () => {
  const r = await request('GET', '/host');
  assert.equal(r.body.toString(), `127.0.0.1:${port}`);
});

test('204, 304 and HEAD keep status without body', async () => {
  assert.equal((await request('GET', '/204')).status, 204);
  assert.equal((await request('GET', '/304')).status, 304);
  const h = await request('HEAD', '/csp');
  assert.equal(h.status, 200);
  assert.equal(h.body.length, 0);
});

test('503 German page while the target is missing', async () => {
  targetOn = false;
  try {
    const r = await request('GET', '/');
    assert.equal(r.status, 503);
    const html = r.body.toString();
    assert.match(html, /DEMS startet neu/);
    assert.match(html, /<meta http-equiv="refresh" content="2">/);
    assert.doesNotMatch(html, /<script/i);
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.match(r.headers['content-security-policy'], /default-src 'none'/);
    assert.ok(r.headers['content-security-policy'].endsWith(`frame-ancestors http://127.0.0.1:${STUDIO} http://localhost:${STUDIO}`), r.headers['content-security-policy']);
  } finally { targetOn = true; }
});

test('503 page when the child refuses the connection', async () => {
  const dead = http.createServer(); await new Promise((r) => dead.listen(0, '127.0.0.1', r));
  const deadPort = dead.address().port; await new Promise((r) => dead.close(r));
  const p2 = createPreviewProxy({ port: 0, studioPort: STUDIO, target: () => ({ port: deadPort }) });
  await p2.listen();
  try {
    const r = await request('GET', '/', { p: p2.address().port });
    assert.equal(r.status, 503);
    assert.match(r.body.toString(), /DEMS startet neu/);
  } finally { await p2.close(); }
});

test('wrong Host gets 403', async () => {
  assert.equal((await request('GET', '/', { host: 'evil.example:80' })).status, 403);
  assert.equal((await request('GET', '/', { host: `127.0.0.1:${port + 1}` })).status, 403);
});

test('upstream dying mid-response does not crash the proxy', async () => {
  await request('GET', '/abort').catch(() => {});
  assert.equal((await request('GET', '/')).body.toString(), 'plain');
});
