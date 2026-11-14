const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AiError, AI_ERROR_MESSAGES, errorFromThrown, logAiFailure } = require('../ai/errors');
const openai = require('../ai/providers/openaiCompatible');
const anthropic = require('../ai/providers/anthropic');

// Why a provider call failed, without leaking anything: the code of the
// cause (TLS, connection) is kept, a certificate problem has its own message,
// and every failure leaves one log line with code and cause only.

/** An error like the one fetch throws, with the network cause below it. */
const fetchFailed = (code) => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('x'), { code }) });

test('a certificate the process does not trust is its own error with a German sentence', () => {
    for (const code of ['SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID']) {
        const err = errorFromThrown(fetchFailed(code));
        assert.equal(err.code, 'certificate', code);
        assert.equal(err.detail, code);
    }
    assert.equal(AI_ERROR_MESSAGES.certificate, 'Das Zertifikat des KI-Anbieters wird nicht anerkannt. Prüft ein Virenscanner oder Proxy die HTTPS-Verbindung?');
});

test('other network failures stay „unreachable" and keep their cause code', () => {
    const refused = errorFromThrown(fetchFailed('ECONNREFUSED'));
    assert.equal(refused.code, 'unreachable');
    assert.equal(refused.detail, 'ECONNREFUSED');
    assert.equal(errorFromThrown(new TypeError('fetch failed')).detail, undefined);
    // Only a plain code is kept, never free text of the cause
    assert.equal(errorFromThrown(fetchFailed('a key: sk-123 leaked')).detail, undefined);
    assert.equal(errorFromThrown(Object.assign(new Error('t'), { name: 'TimeoutError' })).code, 'timeout');
});

test('both adapters report a certificate problem as such', async () => {
    const fetchImpl = async () => { throw fetchFailed('SELF_SIGNED_CERT_IN_CHAIN'); };
    for (const adapter of [openai, anthropic]) {
        const client = adapter.create({ baseUrl: 'https://provider.test/v1', apiKey: 'sk-geheim', model: 'm', fetchImpl });
        await assert.rejects(client.chat({ system: 's', messages: [{ role: 'user', text: 'Hi' }], maxTokens: 5, timeoutMs: 1000 }),
            (err) => err instanceof AiError && err.code === 'certificate');
    }
});

test('a failure leaves one log line with code and cause; a certificate problem says what helps', () => {
    const lines = [];
    const original = console.warn;
    console.warn = (...args) => lines.push(args.join(' '));
    try {
        logAiFailure('Discord-Frage', errorFromThrown(fetchFailed('SELF_SIGNED_CERT_IN_CHAIN')));
        logAiFailure('Entwurf', new AiError('invalid_key', { status: 401 }));
        logAiFailure('Entwurf', new Error('sk-geheim in a message'));
    } finally {
        console.warn = original;
    }
    assert.equal(lines.length, 3);
    assert.match(lines[0], /^KI-Anfrage fehlgeschlagen \(Discord-Frage\): certificate SELF_SIGNED_CERT_IN_CHAIN/);
    assert.match(lines[0], /--use-system-ca/);
    assert.match(lines[1], /^KI-Anfrage fehlgeschlagen \(Entwurf\): invalid_key HTTP 401$/);
    assert.equal(lines[2], 'KI-Anfrage fehlgeschlagen (Entwurf): Error');
    assert.ok(lines.every(line => !line.includes('sk-geheim')));
});
