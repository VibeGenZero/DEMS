'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGuardedFetch, isBlockedAiHost } = require('../ai/addressGuard');
const { AiError, AI_ERROR_MESSAGES } = require('../ai/errors');

// Security report 2026-11: the admin-typed AI base URL reached every address
// the server could, cloud metadata included. Link-local and metadata addresses
// are refused; loopback and LAN stay open for a local Ollama.

/** A guarded fetch whose network call and DNS lookup are recorded doubles. */
function guarded(resolved = {}) {
    const calls = [];
    const lookups = [];
    const fetchImpl = async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response('{}', { status: 200 });
    };
    const lookup = async (host) => {
        lookups.push(host);
        if (!resolved[host]) throw Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
        return resolved[host].map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
    };
    return { fetch: createGuardedFetch({ fetchImpl, lookup }), calls, lookups };
}

const isBlocked = (err) => err instanceof AiError && err.code === 'blocked_address';

test('link-local and cloud metadata addresses are refused before any request', async () => {
    const { fetch, calls } = guarded();
    for (const url of [
        'http://169.254.169.254/latest/meta-data/models',
        'http://169.254.170.2/v1/models',
        'http://0xa9fea9fe/v1/models',
        'http://2852039166/v1/models',
        'http://[fe80::1]/v1/models',
        'http://[::ffff:169.254.169.254]/v1/models',
        'http://[fd00:ec2::254]/v1/models',
        'http://100.100.100.200/v1/models',
        'http://metadata.google.internal/computeMetadata/v1/models',
        'http://METADATA.GOOGLE.INTERNAL./v1/models'
    ]) {
        await assert.rejects(fetch(url, {}), isBlocked, url);
    }
    assert.equal(calls.length, 0);
});

test('a host name that resolves to a metadata address is refused', async () => {
    const { fetch, calls } = guarded({ 'evil.example': ['203.0.113.9', '169.254.169.254'] });
    await assert.rejects(fetch('https://evil.example/v1/models', {}), isBlocked);
    assert.equal(calls.length, 0);
});

test('only http and https are fetched', async () => {
    const { fetch, calls } = guarded();
    for (const url of ['file:///etc/passwd', 'ftp://127.0.0.1/v1/models', 'data:text/plain,hi']) {
        await assert.rejects(fetch(url, {}), isBlocked, url);
    }
    assert.equal(calls.length, 0);
});

test('loopback, LAN and public addresses stay reachable (local Ollama, hosted providers)', async () => {
    const { fetch, calls } = guarded({ localhost: ['::1', '127.0.0.1'], 'ollama.lan': ['192.168.1.10'], 'api.openai.com': ['162.159.140.245'] });
    for (const url of ['http://localhost:11434/v1/models', 'http://127.0.0.1:11434/v1/models', 'http://192.168.1.10:11434/v1/models', 'http://[::1]:11434/v1/models', 'http://ollama.lan:11434/v1/models', 'https://api.openai.com/v1/models']) {
        await fetch(url, {});
    }
    assert.equal(calls.length, 6);
});

test('a host that does not resolve is left to fetch, which reports it as unreachable', async () => {
    const { fetch, calls, lookups } = guarded();
    await fetch('https://provider.test/v1/models', {});
    assert.deepEqual(lookups, ['provider.test']);
    assert.equal(calls.length, 1);
});

test('redirects are never followed: one could lead to a refused address', async () => {
    const { fetch, calls } = guarded();
    await fetch('http://127.0.0.1:11434/v1/models', { method: 'GET', redirect: 'follow', headers: { a: 'b' } });
    assert.equal(calls[0].init.redirect, 'error');
    assert.equal(calls[0].init.method, 'GET');
    assert.deepEqual(calls[0].init.headers, { a: 'b' });
});

test('the refusal has its own German message', () => {
    assert.equal(AI_ERROR_MESSAGES.blocked_address, 'Diese KI-Adresse ist gesperrt: DEMS ruft keine Link-Local- oder Cloud-Metadaten-Adressen auf.');
});

test('isBlockedAiHost checks a written host without DNS', () => {
    for (const host of ['169.254.169.254', '[fe80::1]', 'metadata.google.internal', '100.100.100.200']) assert.equal(isBlockedAiHost(host), true, host);
    for (const host of ['localhost', '127.0.0.1', '10.0.0.4', 'api.openai.com', '[::1]']) assert.equal(isBlockedAiHost(host), false, host);
});
