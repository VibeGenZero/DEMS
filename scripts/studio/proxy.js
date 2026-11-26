'use strict';
// Preview proxy of the plugin studio: serves the DEMS child on its own origin so the studio page can frame it
// while the plugin's browser code in the frame cannot reach the studio origin. Only framing headers change.
const http = require('node:http');
const { checkHost } = require('./security');

const resolvePort = (port) => (typeof port === 'function' ? port() : port);
// The studio page may be open under either loopback name (security.checkHost accepts both)
const studioOrigins = (studioPort) => `http://127.0.0.1:${studioPort} http://localhost:${studioPort}`;

function unavailablePage(studioPort) {
  const html = '<!doctype html>\n<html lang="de"><head><meta charset="utf-8">'
    + '<meta http-equiv="refresh" content="2"><title>DEMS startet neu</title></head>'
    + '<body><p>DEMS startet neu \u2026</p></body></html>\n';
  return {
    html,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(html),
      'Cache-Control': 'no-store',
      'Content-Security-Policy': `default-src 'none'; frame-ancestors ${studioOrigins(studioPort)}`,
    },
  };
}

function rewriteHeaders(headers, { childPort, previewPort, studioPort }) {
  const out = { ...headers };
  delete out['x-frame-options'];
  const csp = out['content-security-policy'];
  if (csp !== undefined) {
    const ancestors = `frame-ancestors 'self' ${studioOrigins(studioPort)}`;
    const replace = (value) => {
      const parts = String(value).split(';');
      if (!parts.some((part) => /^\s*frame-ancestors(\s|$)/i.test(part))) {
        return `${String(value).replace(/[\s;]+$/, '')}; ${ancestors}`.replace(/^;\s*/, '');
      }
      return parts.map((part) => (/^\s*frame-ancestors(\s|$)/i.test(part) ? ` ${ancestors}` : part)).join(';').replace(/^\s+/, '');
    };
    out['content-security-policy'] = Array.isArray(csp) ? csp.map(replace) : replace(csp);
  }
  if (typeof out.location === 'string') {
    const child = new RegExp(String.raw`^http://(?:127\.0\.0\.1|localhost):` + childPort + String.raw`(?=[/?#]|$)`, 'i');
    out.location = out.location.replace(child, `http://127.0.0.1:${previewPort}`);
  }
  return out;
}

function createPreviewProxy({ port, studioPort, target }) {
  const server = http.createServer((req, res) => {
    const previewPort = server.address().port;
    const studio = resolvePort(studioPort);
    const sendUnavailable = () => {
      if (res.headersSent) return res.destroy();
      const page = unavailablePage(studio);
      res.writeHead(503, page.headers);
      res.end(req.method === 'HEAD' ? undefined : page.html);
    };

    if (!checkHost(req, previewPort)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Ung\u00fcltiger Host.');
    }
    const t = target();
    if (!t || !t.port) { req.resume(); return sendUnavailable(); }

    const upstream = http.request({
      host: '127.0.0.1', port: t.port, method: req.method, path: req.url,
      headers: req.headers, // original Host stays, so DEMS builds preview-origin URLs
    }, (up) => {
      const headers = rewriteHeaders(up.headers, { childPort: t.port, previewPort, studioPort: studio });
      res.writeHead(up.statusCode, up.statusMessage, headers);
      up.on('error', () => res.destroy());
      up.pipe(res);
    });
    upstream.on('error', () => {
      if (res.headersSent) return res.destroy();
      sendUnavailable();
    });
    res.on('close', () => { if (!res.writableFinished) upstream.destroy(); });
    req.on('error', () => upstream.destroy());
    req.pipe(upstream);
  });
  server.on('clientError', (err, socket) => { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); else socket.destroy(); });

  return {
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(resolvePort(port), '127.0.0.1', () => { server.off('error', reject); resolve(); });
    }),
    close: () => new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    }),
    address: () => server.address(),
    get url() { const a = server.address(); return a ? `http://127.0.0.1:${a.port}` : null; },
  };
}

module.exports = { createPreviewProxy };
