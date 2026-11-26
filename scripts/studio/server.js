'use strict';
// Local HTTP server of the plugin studio: static page + token-guarded JSON API (no Express).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const security = require('./security');

const MAX_BODY = 3 * 1024 * 1024;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.ts': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function sendJson(res, status, json, headers = {}) {
  const body = JSON.stringify(json);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(body);
}

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
  res.end('Nicht gefunden.');
}

/** Decode a URL path; null when it holds anything suspicious. */
function cleanSegments(pathname) {
  if (/%2f|%5c|%00/i.test(pathname) || pathname.includes('\\') || pathname.includes('\0')) return null;
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const segments = decoded.split('/').slice(1);
  for (let i = 0; i < segments.length; i += 1) {
    const s = segments[i];
    if (s === '' && i === segments.length - 1) continue;
    if (s === '' || s.startsWith('.')) return null;
  }
  return segments;
}

/** Reads a regular file below `root` (never through a link out of it) and sends it; false when not served. */
function sendFile(req, res, root, segments, extraHeaders = {}) {
  if (!segments.length || segments[segments.length - 1] === '') return false;
  let real;
  try {
    const rootReal = fs.realpathSync(root);
    real = fs.realpathSync(path.join(rootReal, ...segments));
    if (real !== rootReal && !real.startsWith(rootReal + path.sep)) return false;
    if (!fs.statSync(real).isFile()) return false;
  } catch { return false; }
  const type = TYPES[path.extname(real).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache', ...extraHeaders });
  if (req.method === 'HEAD') { res.end(); return true; }
  fs.createReadStream(real).on('error', () => res.destroy()).pipe(res);
  return true;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooBig = false;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { tooBig = true; chunks.length = 0; return; }
      if (!tooBig) chunks.push(c);
    });
    req.on('end', () => {
      if (tooBig) return reject(Object.assign(new Error('Die Anfrage ist zu groß.'), { status: 413 }));
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

function createStudioServer({ port = 3100, previewPort, token, routes = {}, publicDir, vendorDirs = {} } = {}) {
  const pubDir = publicDir || path.join(__dirname, 'public');
  const mounts = { '/types/': path.join(__dirname, '..', '..', 'plugin-sdk', 'types'), ...vendorDirs };
  const server = http.createServer();
  const actualPort = () => server.address().port;

  async function handleApi(req, res, url) {
    if (!security.checkToken(req, token)) return sendJson(res, 401, { error: 'Nicht autorisiert.' });
    if (req.method !== 'GET' && req.method !== 'HEAD' && !security.checkOrigin(req, actualPort)) {
      return sendJson(res, 403, { error: 'Ungültiger Ursprung.' });
    }
    const route = routes[`${req.method} ${url.pathname}`];
    if (!route) return sendJson(res, 404, { error: 'Nicht gefunden.' });
    const query = Object.fromEntries(url.searchParams);
    if (route.raw) return route.handler(req, res, { query, url });
    let body = {};
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const text = await readBody(req);
      if (text.trim()) {
        try { body = JSON.parse(text); } catch { return sendJson(res, 400, { error: 'Ungültige Anfrage.' }); }
      }
    }
    const result = await route(req, body, query);
    const { status = 200, json, headers = {}, body: raw } = result || {};
    if (json !== undefined) return sendJson(res, status, json, headers);
    res.writeHead(status, { 'X-Content-Type-Options': 'nosniff', ...headers });
    res.end(raw);
  }

  function handlePage(req, res) {
    const nonce = crypto.randomBytes(16).toString('base64url');
    let html;
    try { html = fs.readFileSync(path.join(pubDir, 'index.html'), 'utf8'); } catch { return notFound(res); }
    res.writeHead(200, {
      'Content-Type': TYPES['.html'],
      'Content-Security-Policy': security.pageCsp(nonce, previewPort),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    });
    res.end(req.method === 'HEAD' ? undefined : html.replaceAll('__NONCE__', nonce));
  }

  function handleStatic(req, res, pathname) {
    const segments = cleanSegments(pathname);
    if (!segments) return notFound(res);
    for (const [prefix, dir] of Object.entries(mounts)) {
      if (prefix.endsWith('/')) {
        if (pathname.startsWith(prefix) && sendFile(req, res, dir, segments.slice(prefix.split('/').length - 2))) return;
      } else if (pathname === prefix) {
        if (sendFile(req, res, path.dirname(dir), [path.basename(dir)])) return;
      }
    }
    if (!sendFile(req, res, pubDir, segments)) notFound(res);
  }

  server.on('request', async (req, res) => {
    try {
      if (!security.checkHost(req, actualPort)) return sendJson(res, 403, { error: 'Ungültiger Host.' });
      let url;
      try { url = new URL(req.url, 'http://studio.invalid'); } catch { return sendJson(res, 400, { error: 'Ungültige Anfrage.' }); }
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Methode nicht erlaubt.' });
      if (url.pathname === '/' || url.pathname === '/index.html') return handlePage(req, res);
      return handleStatic(req, res, url.pathname);
    } catch (err) {
      if (!res.headersSent) {
        if (err && Number.isInteger(err.status)) return sendJson(res, err.status, { error: err.message });
        console.error(err && err.stack ? err.stack : err);
        return sendJson(res, 500, { error: 'Interner Fehler im Studio.' });
      }
      console.error(err && err.stack ? err.stack : err);
      res.destroy();
    }
  });

  return {
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
    }),
    close: () => new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    }),
    address: () => server.address(),
    get url() { return `http://127.0.0.1:${actualPort()}`; },
  };
}

module.exports = { createStudioServer };
