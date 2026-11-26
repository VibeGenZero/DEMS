'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createStudioServer } = require('../scripts/studio/server');
const security = require('../scripts/studio/security');
const staticGuard = require('../scripts/studio/server')._test;

const TOKEN = 'a'.repeat(64);
const PREVIEW = 4555;
let server, port, tmp, studioOrigin, symlinkOk = false;

function request(method, urlPath, { headers = {}, body, host } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, method, path: urlPath,
      headers: { Host: host || `127.0.0.1:${port}`, ...headers },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}
const authed = (extra = {}) => ({ 'X-Studio-Token': TOKEN, ...extra });

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-srv-'));
  const vendor = path.join(tmp, 'vendor');
  fs.mkdirSync(vendor);
  fs.writeFileSync(path.join(vendor, 'lib.js'), 'export const a = 1;');
  fs.writeFileSync(path.join(vendor, '.hidden'), 'secret');
  fs.writeFileSync(path.join(tmp, 'tokens.css'), ':root{}');
  fs.writeFileSync(path.join(tmp, 'package.json'), '{"secret":"PARENT"}');
  fs.writeFileSync(path.join(vendor, '.hiddenfile'), 'hidden');
  const types = path.join(tmp, 'types');
  fs.mkdirSync(types);
  fs.writeFileSync(path.join(types, 'host.d.ts'), 'declare const x: number;');
  try { fs.symlinkSync(tmp, path.join(vendor, 'out'), 'junction'); symlinkOk = true; } catch { symlinkOk = false; }
  server = createStudioServer({
    port: 0,
    previewPort: PREVIEW,
    token: TOKEN,
    vendorDirs: { '/types/': path.join(tmp, 'types'), '/vendor/': vendor, '/monaco/': vendor, '/css/tokens.css': path.join(tmp, 'tokens.css') },
    routes: {
      'GET /api/ping': async () => ({ status: 200, json: { ok: true } }),
      'POST /api/ping': async (req, body) => ({ status: 200, json: { echo: body } }),
      'GET /api/events': async () => ({ status: 200, json: { events: true } }),
      'GET /api/boom': async () => { throw new Error('geheim'); },
      'GET /api/teapot': async () => { const e = new Error('Kein Kaffee.'); e.status = 418; throw e; },
      'GET /api/raw': { raw: true, handler: (req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('raw'); } },
    },
  });
  await server.listen();
  port = server.address().port;
  studioOrigin = `http://127.0.0.1:${port}`;
});
after(async () => { await server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('listens on 127.0.0.1 only and exposes its url', () => {
  assert.equal(server.address().address, '127.0.0.1');
  assert.equal(server.url, `http://127.0.0.1:${port}`);
});

test('rejects a foreign Host header (DNS rebinding)', async () => {
  const res = await request('GET', '/', { host: 'evil.example' });
  assert.equal(res.status, 403);
  const api = await request('GET', '/api/ping', { host: 'evil.example', headers: authed() });
  assert.equal(api.status, 403);
});

test('serves the page with a per-load nonce in CSP and meta tag', async () => {
  const one = await request('GET', '/');
  const two = await request('GET', '/');
  assert.equal(one.status, 200);
  const csp = one.headers['content-security-policy'];
  assert.ok(csp.includes(`frame-src http://127.0.0.1:${PREVIEW}`));
  const nonce = /'nonce-([^']+)'/.exec(csp)[1];
  assert.ok(one.text.includes(`<meta name="csp-nonce" content="${nonce}">`));
  const nonce2 = /'nonce-([^']+)'/.exec(two.headers['content-security-policy'])[1];
  assert.notEqual(nonce, nonce2);
  assert.equal(one.headers['x-content-type-options'], 'nosniff');
  assert.match(one.headers['content-type'], /text\/html/);
  assert.ok(!one.text.includes('__NONCE__'));
});

test('API needs the token (header)', async () => {
  assert.equal((await request('GET', '/api/ping')).status, 401);
  assert.equal((await request('GET', '/api/ping', { headers: { 'X-Studio-Token': 'b'.repeat(64) } })).status, 401);
  assert.equal((await request('GET', '/api/ping', { headers: { 'X-Studio-Token': 'short' } })).status, 401);
  const ok = await request('GET', '/api/ping', { headers: authed() });
  assert.equal(ok.status, 200);
  assert.deepEqual(JSON.parse(ok.text), { ok: true });
});

test('token query parameter works only for GET /api/events', async () => {
  assert.equal((await request('GET', `/api/events?token=${TOKEN}`)).status, 200);
  assert.equal((await request('GET', `/api/ping?token=${TOKEN}`)).status, 401);
});

test('mutating calls need the studio Origin', async () => {
  const bad = await request('POST', '/api/ping', { headers: authed({ Origin: `http://127.0.0.1:${PREVIEW}`, 'Content-Type': 'application/json' }), body: '{}' });
  assert.equal(bad.status, 403);
  const none = await request('POST', '/api/ping', { headers: authed({ 'Content-Type': 'application/json' }), body: '{}' });
  assert.equal(none.status, 403);
  const good = await request('POST', '/api/ping', { headers: authed({ Origin: studioOrigin, 'Content-Type': 'application/json' }), body: '{"x":1}' });
  assert.equal(good.status, 200);
  assert.deepEqual(JSON.parse(good.text), { echo: { x: 1 } });
});

test('rejects bodies over 3 MB with 413', async () => {
  const res = await request('POST', '/api/ping', { headers: authed({ Origin: studioOrigin }), body: 'x'.repeat(4 * 1024 * 1024) });
  assert.equal(res.status, 413);
  assert.deepEqual(JSON.parse(res.text), { error: 'Die Anfrage ist zu groß.' });
});

test('invalid JSON gives 400', async () => {
  const res = await request('POST', '/api/ping', { headers: authed({ Origin: studioOrigin }), body: '{nope' });
  assert.equal(res.status, 400);
});

test('static files: served, but no traversal, no dotfiles', async () => {
  const ok = await request('GET', '/vendor/lib.js');
  assert.equal(ok.status, 200);
  assert.match(ok.headers['content-type'], /javascript/);
  assert.equal((await request('GET', '/css/tokens.css')).status, 200);
  for (const p of ['/vendor/../../package.json', '/vendor/%2e%2e/package.json', '/vendor/..%2fpackage.json',
    '/vendor/..%5cpackage.json', '/vendor/%00', '/monaco/.hidden', '/vendor/', '/vendor/nope.js', '/css/tokens.css/x', '/nope']) {
    assert.equal((await request('GET', p)).status, 404, p);
  }
});

test('/types/ serves d.ts files read-only', async () => {
  const res = await request('GET', '/types/host.d.ts');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /^(text\/plain|application\/typescript)/);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.text, 'declare const x: number;');
  assert.equal((await request('GET', '/types/nope.d.ts')).status, 404);
});

test('the page is only reachable at / (never as a plain static file)', async () => {
  for (const p of ['/%69ndex.html', '/Index.html', '/INDEX.HTML', '/index.htm', '/vendor/x.html']) {
    const res = await request('GET', p);
    assert.equal(res.status, 404, p);
    assert.ok(!res.text.includes('__NONCE__'));
  }
  assert.equal((await request('GET', '/index.html')).status, 200);
});

test('traversal never returns the parent file', async () => {
  for (const p of ['/vendor/../package.json', '/vendor/%2e%2e/package.json', '/vendor/..%2fpackage.json']) {
    const res = await request('GET', p);
    assert.ok(!res.text.includes('PARENT'), p);
  }
});

test('a link out of the mounted folder is not followed', { skip: !symlinkOk && 'no symlink permission' }, async () => {
  const res = await request('GET', '/vendor/out/package.json');
  assert.equal(res.status, 404);
  assert.ok(!res.text.includes('PARENT'));
});

test('dot segments are refused after real-path resolution (8.3 names)', async () => {
  assert.equal(staticGuard.hasDotSegment('.hiddenfile'), true);
  assert.equal(staticGuard.hasDotSegment(path.join('a', '.b')), true);
  assert.equal(staticGuard.hasDotSegment(path.join('..', 'a')), true);
  assert.equal(staticGuard.hasDotSegment(path.join('a', 'b.js')), false);
  if (process.platform === 'win32') {
    let short = null;
    try { short = fs.realpathSync.native(path.join(tmp, 'vendor', 'HIDDEN~1')); } catch { /* no 8.3 name */ }
    if (short) assert.equal((await request('GET', '/monaco/HIDDEN~1')).status, 404);
  }
});

test('route errors: status errors pass through, others are hidden', async () => {
  const t = await request('GET', '/api/teapot', { headers: authed() });
  assert.equal(t.status, 418);
  assert.deepEqual(JSON.parse(t.text), { error: 'Kein Kaffee.' });
  const orig = console.error; console.error = () => {};
  let b;
  try { b = await request('GET', '/api/boom', { headers: authed() }); } finally { console.error = orig; }
  assert.equal(b.status, 500);
  assert.deepEqual(JSON.parse(b.text), { error: 'Interner Fehler im Studio.' });
  assert.equal((await request('GET', '/api/unknown', { headers: authed() })).status, 404);
});

test('raw routes run after the security checks', async () => {
  assert.equal((await request('GET', '/api/raw')).status, 401);
  const ok = await request('GET', '/api/raw', { headers: authed() });
  assert.equal(ok.text, 'raw');
});

test('previewPort may be a function, read per request', async () => {
  let p = 1111;
  const s = createStudioServer({ port: 0, previewPort: () => p, token: TOKEN, routes: {} });
  await s.listen();
  try {
    const get = () => new Promise((resolve) => {
      http.get({ host: '127.0.0.1', port: s.address().port, path: '/' }, (res) => { res.resume(); res.on('end', () => resolve(res.headers['content-security-policy'])); });
    });
    assert.ok((await get()).includes('http://127.0.0.1:1111'));
    p = 2222;
    assert.ok((await get()).includes('http://127.0.0.1:2222'));
  } finally { await s.close(); }
});

test('security helpers', () => {
  const req = (h, m = 'GET', u = '/api/x') => ({ headers: h, method: m, url: u });
  assert.equal(security.checkHost(req({ host: 'localhost:3100' }), 3100), true);
  assert.equal(security.checkHost(req({ host: 'localhost:3101' }), 3100), false);
  assert.equal(security.checkHost(req({}), 3100), false);
  assert.equal(security.checkOrigin(req({ origin: 'http://localhost:3100' }), 3100), true);
  assert.equal(security.checkOrigin(req({ origin: 'null' }), 3100), false);
  assert.equal(security.checkToken(req({ 'x-studio-token': 'abc' }), 'abc'), true);
  assert.equal(security.checkToken(req({}), 'abc'), false);
  assert.match(security.pageCsp('N', 99), /style-src 'self' 'nonce-N'/);
});

test('JSON bodies must be plain objects', async () => {
  for (const b of ['null', '5', '[1,2]', '"x"']) {
    const res = await request('POST', '/api/ping', { headers: authed({ Origin: studioOrigin }), body: b });
    assert.equal(res.status, 400, b);
    assert.deepEqual(JSON.parse(res.text), { error: 'Ungültige Anfrage.' });
  }
});

test('a declared oversized Content-Length is answered at once', async () => {
  const res = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/api/ping',
      headers: { Host: `127.0.0.1:${port}`, 'X-Studio-Token': TOKEN, Origin: studioOrigin, 'Content-Length': String(50 * 1024 * 1024) } },
    (r) => { const c = []; r.on('data', (d) => c.push(d)); r.on('end', () => resolve({ status: r.statusCode, headers: r.headers, text: Buffer.concat(c).toString() })); });
    req.on('error', reject);
    req.flushHeaders(); // no body is ever sent
    setTimeout(() => reject(new Error('no answer without a body')), 3000).unref();
  });
  assert.equal(res.status, 413);
  assert.equal(res.headers.connection, 'close');
});

test('style-src fallback: nonce by default, unsafe-inline without the nonce', () => {
  const dflt = security.pageCsp('N', 99);
  assert.match(dflt, /style-src 'self' 'nonce-N'/);
  assert.ok(!dflt.includes('unsafe-inline'));
  const fb = security.pageCsp('N', 99, 'unsafe-inline');
  assert.match(fb, /style-src 'self' 'unsafe-inline'/);
  assert.ok(!/style-src[^;]*nonce/.test(fb));
});

test('style-src attr mode: style elements need the nonce, only style attributes are open (Monaco)', () => {
  const csp = security.pageCsp('N', 99, 'attr');
  assert.match(csp, /style-src 'self' 'nonce-N'/);
  assert.match(csp, /style-src-attr 'unsafe-inline'/);
  assert.ok(!/style-src 'self'[^;]*unsafe-inline/.test(csp));
  assert.ok(!/style-src-attr/.test(security.pageCsp('N', 99)));
});

test('page CSP lets fonts come from data: URLs (Monaco ships its icon font inline)', () => {
  assert.match(security.pageCsp('N', 99), /font-src 'self' data:/);
});

test('405 carries Allow, url is null before listen', () => {
  const s = createStudioServer({ port: 0, previewPort: 1, token: TOKEN });
  assert.equal(s.url, null);
});

test('405 answers carry an Allow header', async () => {
  const res = await request('DELETE', '/index.html');
  assert.equal(res.status, 405);
  assert.equal(res.headers.allow, 'GET, HEAD');
});

test('NTFS stream suffixes and colons never reach a file', async () => {
  for (const p of ['/vendor/lib.js:x', '/index.html:x', '/vendor/a:b/c']) {
    assert.equal((await request('GET', p)).status, 404, p);
  }
  if (process.platform === 'win32') {
    for (const p of ['/index.html::$DATA', '/Index.html::$DATA', '/%69ndex.html::$DATA', '/INDEX~1.HTM::$DATA', '/INDEX~1.HTM']) {
      const res = await request('GET', p);
      assert.equal(res.status, 404, p);
      assert.ok(!res.text.includes('__NONCE__'), p);
    }
  }
});

test('a resolved .html file is never served as a static file', async () => {
  const dir = path.join(tmp, 'htmlmount');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'page.html'), '<p>x</p>');
  const s = createStudioServer({ port: 0, previewPort: 1, token: TOKEN, vendorDirs: { '/m/': dir } });
  await s.listen();
  try {
    const res = await new Promise((resolve) => http.get({ host: '127.0.0.1', port: s.address().port, path: '/m/page.html' }, (r) => { r.resume(); r.on('end', () => resolve(r.statusCode)); }));
    assert.equal(res, 404);
  } finally { await s.close(); }
});

test('fetch with an oversized body gets the German 413, not a network error', async () => {
  for (const mb of [4, 10]) {
    const res = await fetch(`${studioOrigin}/api/ping`, { method: 'POST', headers: { 'X-Studio-Token': TOKEN, Origin: studioOrigin }, body: 'x'.repeat(mb * 1024 * 1024) });
    assert.equal(res.status, 413, `${mb} MB`);
    assert.deepEqual(await res.json(), { error: 'Die Anfrage ist zu groß.' });
  }
});

test('a body far beyond the hard cap is answered 413 without hanging', async () => {
  const res = await new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/api/ping',
      headers: { Host: `127.0.0.1:${port}`, 'X-Studio-Token': TOKEN, Origin: studioOrigin, 'Content-Length': String(50 * 1024 * 1024) } },
    (r) => { r.resume(); resolve(r.statusCode); });
    req.on('error', () => resolve('closed'));
    req.flushHeaders();
    setTimeout(() => resolve('hang'), 2000).unref();
  });
  assert.ok(res === 413 || res === 'closed', String(res));
});
