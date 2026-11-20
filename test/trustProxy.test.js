const { test } = require('node:test');
const assert = require('node:assert/strict');
const { trustProxySetting } = require('../utils/trustProxy');

// Security report 2026-11: `trust proxy 1` let any client that reached the
// port directly choose its own req.ip through X-Forwarded-For.

test('by default only a proxy on a loopback or private address is trusted', () => {
    const trust = trustProxySetting(undefined);
    assert.equal(typeof trust, 'function');
    for (const peer of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '10.1.2.3', '172.18.0.3', '::ffff:172.18.0.3', '192.168.1.20', 'fd12:3456::1', '169.254.1.1', 'fe80::1']) {
        assert.equal(trust(peer, 0), true, peer);
    }
    for (const peer of ['203.0.113.7', '8.8.8.8', '::ffff:8.8.8.8', '2001:db8::1', '172.32.0.1', '100.64.0.1']) {
        assert.equal(trust(peer, 0), false, peer);
    }
});

test('by default only one hop is trusted: the address the proxy forwards is the client', () => {
    const trust = trustProxySetting('');
    assert.equal(trust('10.0.0.5', 1), false);
    assert.equal(trust('127.0.0.1', 1), false);
});

test('TRUST_PROXY switches the trust off, sets a hop count or a list of proxy addresses', () => {
    assert.equal(trustProxySetting('false'), false);
    assert.equal(trustProxySetting('0'), false);
    assert.equal(trustProxySetting(' 2 '), 2);
    assert.equal(trustProxySetting('1'), 1);
    assert.equal(trustProxySetting('true'), true);
    assert.equal(trustProxySetting(' loopback, 10.0.0.0/8 '), 'loopback, 10.0.0.0/8');
});
