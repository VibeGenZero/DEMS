'use strict';
// Request guards of the plugin studio: only this machine's own page may use the API.
const crypto = require('node:crypto');

const resolvePort = (port) => (typeof port === 'function' ? port() : port);

/** Host must be 127.0.0.1:<port> or localhost:<port> (DNS rebinding guard). */
function checkHost(req, port) {
  const host = String(req.headers.host || '').toLowerCase();
  const p = resolvePort(port);
  return host === `127.0.0.1:${p}` || host === `localhost:${p}`;
}

/** Origin must be the studio's own origin (used for every non-GET/HEAD request). */
function checkOrigin(req, port) {
  const origin = String(req.headers.origin || '').toLowerCase();
  const p = resolvePort(port);
  return origin === `http://127.0.0.1:${p}` || origin === `http://localhost:${p}`;
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a), 'utf8');
  const y = Buffer.from(String(b), 'utf8');
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

/** Token from header `X-Studio-Token`; the `token` query parameter only for `GET /api/events` (EventSource cannot set headers). */
function checkToken(req, token) {
  if (!token) return false;
  const header = req.headers['x-studio-token'];
  if (typeof header === 'string' && header) return safeEqual(header, token);
  if (req.method === 'GET') {
    let url;
    try { url = new URL(req.url, 'http://studio.invalid'); } catch { return false; }
    if (url.pathname === '/api/events') {
      const q = url.searchParams.get('token');
      if (q) return safeEqual(q, token);
    }
  }
  return false;
}

/** CSP of the studio page: own files only, the preview iframe, workers (Monaco), nonce for styles. */
function pageCsp(nonce, previewPort, styleFallback = 'nonce') {
  // Browsers ignore 'unsafe-inline' when a nonce is present, so the fallback must not carry the nonce.
  // 'attr': style elements still need the nonce, only style attributes (which Monaco sets) are open.
  let style = `style-src 'self' 'nonce-${nonce}'`;
  if (styleFallback === 'unsafe-inline') style = "style-src 'self' 'unsafe-inline'";
  if (styleFallback === 'attr') style += "; style-src-attr 'unsafe-inline'";
  return [
    "default-src 'self'",
    `frame-src http://127.0.0.1:${resolvePort(previewPort)}`,
    "worker-src 'self' blob:",
    style,
    "img-src 'self' data:",
    "font-src 'self' data:", // Monaco's editor.main.css carries its icon font as a data: URL
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

module.exports = { checkHost, checkOrigin, checkToken, pageCsp };
