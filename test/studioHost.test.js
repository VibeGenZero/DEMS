'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { listenHost, createHostGuard } = require('../dev/studioHost');

const STUDIO = { DEV_MOCK: 'true', PLUGIN_STUDIO: '1', PORT: '4321', BASE_URL: 'http://127.0.0.1:4101' };

/** Runs the guard for one Host header; returns `next` or the refused status and body. */
function run(guard, host) {
  let outcome = null;
  const res = {
    statusCode: 200,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    type(value) { this.headers['content-type'] = value; return this; },
    send(body) { outcome = { status: this.statusCode, body }; return this; },
  };
  guard({ headers: host === undefined ? {} : { host } }, res, () => { outcome = 'next'; });
  return outcome;
}

test('the studio child listens on 127.0.0.1 only; other modes keep the default address', () => {
  assert.equal(listenHost(STUDIO), '127.0.0.1');
  assert.equal(listenHost({ ...STUDIO, PLUGIN_STUDIO: undefined }), undefined);
  assert.equal(listenHost({ ...STUDIO, DEV_MOCK: 'false' }), undefined);
  assert.equal(listenHost({ PORT: '3000' }), undefined);
});

test('the studio host guard accepts the preview origin and the own loopback port', () => {
  const guard = createHostGuard(STUDIO);
  assert.equal(typeof guard, 'function');
  assert.equal(run(guard, '127.0.0.1:4101'), 'next');
  assert.equal(run(guard, '127.0.0.1:4321'), 'next');
  assert.equal(run(guard, 'localhost:4321'), 'next');
  assert.equal(run(guard, 'LOCALHOST:4321'), 'next');
});

test('the studio host guard refuses every other Host with 403', () => {
  const guard = createHostGuard(STUDIO);
  for (const host of ['example.test', 'example.test:4321', '127.0.0.1:4102', '192.168.1.5:4321', 'localhost:4101x', '', undefined]) {
    const outcome = run(guard, host);
    assert.notEqual(outcome, 'next', `Host ${host} must be refused`);
    assert.equal(outcome.status, 403);
    assert.equal(outcome.body, 'Ungültiger Host.');
  }
});

test('the studio host guard reads BASE_URL and PORT per request', () => {
  const env = { ...STUDIO };
  const guard = createHostGuard(env);
  env.BASE_URL = 'http://127.0.0.1:5101';
  assert.equal(run(guard, '127.0.0.1:5101'), 'next');
  assert.equal(run(guard, '127.0.0.1:4101').status, 403);
});

test('the studio host guard is inert without PLUGIN_STUDIO or outside mock mode', () => {
  assert.equal(createHostGuard({ ...STUDIO, PLUGIN_STUDIO: undefined }), null);
  assert.equal(createHostGuard({ ...STUDIO, PLUGIN_STUDIO: '0' }), null);
  assert.equal(createHostGuard({ ...STUDIO, DEV_MOCK: undefined }), null);
  assert.equal(createHostGuard({ ...STUDIO, NODE_ENV: 'production' }), null);
});

test('server.js mounts the studio host guard before every other middleware and listens via listenHost', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'server.js'), 'utf8');
  const guardAt = source.indexOf('createHostGuard(');
  assert.ok(guardAt > 0, 'server.js uses createHostGuard');
  const firstUse = source.search(/app\.(use|get)\(/);
  assert.ok(guardAt < firstUse, 'the guard comes before the first app.use/app.get');
  assert.match(source, /listenHost\(\)/);
  assert.match(source, /app\.listen\(PORT, listenAddress, onListen\)/);
});
