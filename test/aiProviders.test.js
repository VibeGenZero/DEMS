'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const openai = require('../ai/providers/openaiCompatible');
const anthropic = require('../ai/providers/anthropic');
const { readServerSentEvents } = require('../ai/providers/sse');
const { AiError, AI_ERROR_MESSAGES, errorFromStatus } = require('../ai/errors');

const SECRET = 'sk-test-secret-key-123';

/**
 * Starts a local fake provider. `handler(req, body, res)` plays the scripted answer;
 * every request is recorded in `requests`.
 */
async function startFake(handler) {
    const requests = [];
    const sockets = new Set();
    const closed = [];
    const server = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            const record = { method: req.method, url: req.url, headers: req.headers, raw, body: raw ? JSON.parse(raw) : null };
            requests.push(record);
            res.on('close', () => closed.push(record.url));
            handler(record, res);
        });
    });
    server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    return {
        baseUrl,
        requests,
        closed,
        async stop() {
            sockets.forEach((s) => s.destroy());
            await new Promise((resolve) => server.close(resolve));
        },
    };
}

function sendJson(res, status, payload) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
}

const OPENAI_ANSWER = {
    choices: [{ message: { role: 'assistant', content: 'Hallo Welt' } }],
    usage: { prompt_tokens: 11, completion_tokens: 3 },
};

const MESSAGES = [{ role: 'user', text: 'Hi' }, { role: 'assistant', text: 'Hey' }, { role: 'user', text: 'Wann?' }];

test('openai-compatible: request shape, bearer key, plain answer with usage', async () => {
    const fake = await startFake((req, res) => sendJson(res, 200, OPENAI_ANSWER));
    try {
        const client = openai.create({ baseUrl: `${fake.baseUrl}/v1/`, apiKey: SECRET, model: 'gpt-x' });
        const result = await client.chat({ system: 'Sei nett.', messages: MESSAGES, maxTokens: 400, timeoutMs: 5000 });
        assert.deepEqual(result, { text: 'Hallo Welt', usage: { inputTokens: 11, outputTokens: 3 } });
        const req = fake.requests[0];
        assert.equal(req.method, 'POST');
        assert.equal(req.url, '/v1/chat/completions');
        assert.equal(req.headers.authorization, `Bearer ${SECRET}`);
        assert.equal(req.body.model, 'gpt-x');
        assert.equal(req.body.max_completion_tokens, 400);
        assert.equal(req.body.stream, undefined);
        assert.equal('limit' in req.body, false);
        assert.deepEqual(req.body.messages, [
            { role: 'system', content: 'Sei nett.' },
            { role: 'user', content: 'Hi' },
            { role: 'assistant', content: 'Hey' },
            { role: 'user', content: 'Wann?' },
        ]);
    } finally { await fake.stop(); }
});

test('json mode asks by prompt, not through response_format (both adapters)', async () => {
    const fake = await startFake((req, res) => {
        if (req.url.endsWith('/messages')) return sendJson(res, 200, { content: [{ type: 'text', text: '{}' }], usage: {} });
        return sendJson(res, 200, OPENAI_ANSWER);
    });
    try {
        for (const adapter of [openai, anthropic]) {
            const client = adapter.create({ baseUrl: fake.baseUrl, apiKey: SECRET, model: 'm' });
            await client.chat({ system: 'Sei nett.', messages: MESSAGES, maxTokens: 10, timeoutMs: 5000, json: true });
        }
        const [a, b] = fake.requests.map((r) => r.body);
        assert.equal('response_format' in a, false);
        assert.match(a.messages[0].content, /^Sei nett[.][^]+JSON/);
        assert.match(b.system, /^Sei nett[.][^]+JSON/);
    } finally { await fake.stop(); }
});

test('openai-compatible: no Authorization header without a key (local Ollama)', async () => {
    const fake = await startFake((req, res) => sendJson(res, 200, OPENAI_ANSWER));
    try {
        const client = openai.create({ baseUrl: fake.baseUrl, apiKey: '', model: 'llama3' });
        await client.chat({ system: '', messages: MESSAGES, maxTokens: 10, timeoutMs: 5000 });
        assert.equal('authorization' in fake.requests[0].headers, false);
        assert.equal(fake.requests[0].body.messages[0].role, 'user', 'no empty system message');
    } finally { await fake.stop(); }
});

test('openai-compatible: a 400 on max_completion_tokens is retried once with max_tokens', async () => {
    const fake = await startFake((req, res) => {
        if (req.body.max_completion_tokens !== undefined) return sendJson(res, 400, { error: { message: 'unknown parameter' } });
        return sendJson(res, 200, OPENAI_ANSWER);
    });
    try {
        const client = openai.create({ baseUrl: fake.baseUrl, apiKey: '', model: 'm' });
        const result = await client.chat({ system: 's', messages: MESSAGES, maxTokens: 77, timeoutMs: 5000 });
        assert.equal(result.text, 'Hallo Welt');
        assert.equal(fake.requests.length, 2);
        assert.equal(fake.requests[1].body.max_tokens, 77);
        assert.equal(fake.requests[1].body.max_completion_tokens, undefined);
        assert.equal('limit' in fake.requests[0].body, false);
        assert.equal('limit' in fake.requests[1].body, false);
    } finally { await fake.stop(); }
});

test('openai-compatible: streamed pieces arrive in order and join to the text', async () => {
    const lines = [
        ': keep-alive\r\n\r\n',
        'data: {"choices":[{"delta":{"role":"assistant","content":"Hal"}}]}\r\n\r\n',
        'data: {"choices":[{"delta":{"content":"lo "}}]}\r\n\r\n',
        'data: {"choices":[{"delta":{"content":"Welt"}}]}\r\n\r\n',
        'data: {"choices":[],"usage":{"prompt_tokens":9,"completion_tokens":4}}\r\n\r\n',
        'data: [DONE]\r\n\r\n',
    ].join('');
    const fake = await startFake((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        // Split in the middle of a "data:" line on purpose.
        const cut = lines.indexOf('"content":"lo') + 5;
        res.write(lines.slice(0, cut));
        setTimeout(() => { res.write(lines.slice(cut)); res.end(); }, 30);
    });
    try {
        const pieces = [];
        const client = openai.create({ baseUrl: fake.baseUrl, apiKey: SECRET, model: 'm' });
        const result = await client.chat({
            system: 's', messages: MESSAGES, maxTokens: 50, timeoutMs: 5000, onToken: (p) => pieces.push(p),
        });
        assert.deepEqual(pieces, ['Hal', 'lo ', 'Welt']);
        assert.equal(result.text, 'Hallo Welt');
        assert.deepEqual(result.usage, { inputTokens: 9, outputTokens: 4 });
        assert.equal(fake.requests[0].body.stream, true);
        assert.deepEqual(fake.requests[0].body.stream_options, { include_usage: true });
    } finally { await fake.stop(); }
});

test('openai-compatible: streamed usage missing -> zeros, never undefined', async () => {
    const fake = await startFake((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.end('data: {"choices":[{"delta":{"content":"Ok"}}]}\n\ndata: [DONE]\n\n');
    });
    try {
        const client = openai.create({ baseUrl: fake.baseUrl, apiKey: '', model: 'm' });
        const result = await client.chat({ system: 's', messages: MESSAGES, maxTokens: 5, timeoutMs: 5000, onToken: () => {} });
        assert.deepEqual(result.usage, { inputTokens: 0, outputTokens: 0 });
    } finally { await fake.stop(); }
});

test('anthropic: request shape (x-api-key, anthropic-version, system outside messages)', async () => {
    const fake = await startFake((req, res) => sendJson(res, 200, {
        content: [{ type: 'text', text: 'Hallo ' }, { type: 'text', text: 'Claude' }],
        usage: { input_tokens: 21, output_tokens: 5 },
    }));
    try {
        const client = anthropic.create({ baseUrl: `${fake.baseUrl}/v1`, apiKey: SECRET, model: 'claude-x' });
        const result = await client.chat({ system: 'Sei nett.', messages: MESSAGES, maxTokens: 300, timeoutMs: 5000 });
        assert.deepEqual(result, { text: 'Hallo Claude', usage: { inputTokens: 21, outputTokens: 5 } });
        const req = fake.requests[0];
        assert.equal(req.url, '/v1/messages');
        assert.equal(req.headers['x-api-key'], SECRET);
        assert.equal(req.headers['anthropic-version'], '2023-06-01');
        assert.equal('authorization' in req.headers, false);
        assert.equal(req.body.system, 'Sei nett.');
        assert.equal(req.body.max_tokens, 300);
        assert.equal(req.body.model, 'claude-x');
        assert.deepEqual(req.body.messages, [
            { role: 'user', content: 'Hi' },
            { role: 'assistant', content: 'Hey' },
            { role: 'user', content: 'Wann?' },
        ]);
    } finally { await fake.stop(); }
});

test('anthropic: streamed content_block_delta pieces join to the text', async () => {
    const events = [
        ['message_start', { type: 'message_start', message: { usage: { input_tokens: 25, output_tokens: 1 } } }],
        ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
        ['ping', { type: 'ping' }],
        ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hal' } }],
        ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'lo' } }],
        ['content_block_stop', { type: 'content_block_stop', index: 0 }],
        ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 15 } }],
        ['message_stop', { type: 'message_stop' }],
    ].map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join('');
    const fake = await startFake((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const cut = Math.floor(events.length / 2);
        res.write(events.slice(0, cut));
        setTimeout(() => { res.write(events.slice(cut)); res.end(); }, 30);
    });
    try {
        const pieces = [];
        const client = anthropic.create({ baseUrl: fake.baseUrl, apiKey: SECRET, model: 'm' });
        const result = await client.chat({
            system: 's', messages: MESSAGES, maxTokens: 50, timeoutMs: 5000, onToken: (p) => pieces.push(p),
        });
        assert.deepEqual(pieces, ['Hal', 'lo']);
        assert.deepEqual(result, { text: 'Hallo', usage: { inputTokens: 25, outputTokens: 15 } });
        assert.equal(fake.requests[0].body.stream, true);
    } finally { await fake.stop(); }
});

test('status 401 -> invalid_key, 404 -> model_not_found, 429 -> rate_limited, 500 -> provider_error', async () => {
    const expected = { 401: 'invalid_key', 403: 'invalid_key', 404: 'model_not_found', 429: 'rate_limited', 500: 'provider_error' };
    for (const [status, code] of Object.entries(expected)) {
        const fake = await startFake((req, res) => sendJson(res, Number(status), { error: { message: 'boom' } }));
        try {
            for (const adapter of [openai, anthropic]) {
                const client = adapter.create({ baseUrl: fake.baseUrl, apiKey: SECRET, model: 'm' });
                await assert.rejects(
                    client.chat({ system: 's', messages: MESSAGES, maxTokens: 5, timeoutMs: 5000 }),
                    (err) => err instanceof AiError && err.code === code && err.message === AI_ERROR_MESSAGES[code],
                );
            }
        } finally { await fake.stop(); }
    }
    assert.equal(errorFromStatus(400).code, 'provider_error');
});

test('a closed port -> unreachable; a server that never answers -> timeout after timeoutMs', async () => {
    const probe = http.createServer();
    await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const closedUrl = `http://127.0.0.1:${probe.address().port}`;
    await new Promise((resolve) => probe.close(resolve));
    for (const adapter of [openai, anthropic]) {
        const client = adapter.create({ baseUrl: closedUrl, apiKey: SECRET, model: 'm' });
        await assert.rejects(
            client.chat({ system: 's', messages: MESSAGES, maxTokens: 5, timeoutMs: 2000 }),
            (err) => err instanceof AiError && err.code === 'unreachable',
        );
        await assert.rejects(client.listModels(), (err) => err instanceof AiError && err.code === 'unreachable');
    }

    const fake = await startFake(() => { /* never answers */ });
    try {
        for (const adapter of [openai, anthropic]) {
            const client = adapter.create({ baseUrl: fake.baseUrl, apiKey: SECRET, model: 'm' });
            const started = Date.now();
            await assert.rejects(
                client.chat({ system: 's', messages: MESSAGES, maxTokens: 5, timeoutMs: 150 }),
                (err) => err instanceof AiError && err.code === 'timeout',
            );
            assert.ok(Date.now() - started < 3000);
        }
    } finally { await fake.stop(); }
});

test('an answer without text -> empty_answer', async () => {
    const fake = await startFake((req, res) => {
        if (req.url.endsWith('/messages')) return sendJson(res, 200, { content: [], usage: { input_tokens: 1, output_tokens: 0 } });
        return sendJson(res, 200, { choices: [{ message: { content: '  ' } }], usage: {} });
    });
    try {
        for (const adapter of [openai, anthropic]) {
            const client = adapter.create({ baseUrl: fake.baseUrl, apiKey: SECRET, model: 'm' });
            await assert.rejects(
                client.chat({ system: 's', messages: MESSAGES, maxTokens: 5, timeoutMs: 5000 }),
                (err) => err instanceof AiError && err.code === 'empty_answer',
            );
        }
    } finally { await fake.stop(); }
});

test('an empty stream -> empty_answer', async () => {
    const fake = await startFake((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.end('data: [DONE]\n\n');
    });
    try {
        const client = openai.create({ baseUrl: fake.baseUrl, apiKey: '', model: 'm' });
        await assert.rejects(
            client.chat({ system: 's', messages: MESSAGES, maxTokens: 5, timeoutMs: 5000, onToken: () => {} }),
            (err) => err.code === 'empty_answer',
        );
    } finally { await fake.stop(); }
});

test('aborting the signal ends the request and the fake sees the connection close', async () => {
    for (const adapter of [openai, anthropic]) {
        const fake = await startFake((req, res) => {
            res.writeHead(200, { 'Content-Type': 'text/event-stream' });
            res.write(': hold\n\n');
        });
        try {
            const controller = new AbortController();
            const client = adapter.create({ baseUrl: fake.baseUrl, apiKey: SECRET, model: 'm' });
            const pending = client.chat({
                system: 's', messages: MESSAGES, maxTokens: 5, timeoutMs: 10000, signal: controller.signal, onToken: () => {},
            });
            const outcome = assert.rejects(pending, (err) => err.name === 'AbortError' && !(err instanceof AiError));
            setTimeout(() => controller.abort(), 100);
            await outcome;
            for (let i = 0; i < 50 && fake.closed.length === 0; i += 1) await new Promise((r) => setTimeout(r, 20));
            assert.equal(fake.closed.length, 1);
        } finally { await fake.stop(); }
    }
});

test('listModels returns the sorted ids', async () => {
    const fake = await startFake((req, res) => sendJson(res, 200, { data: [{ id: 'zeta' }, { id: 'alpha' }, { id: 'mid' }] }));
    try {
        const a = await openai.create({ baseUrl: `${fake.baseUrl}/v1`, apiKey: SECRET, model: 'm' }).listModels();
        assert.deepEqual(a, ['alpha', 'mid', 'zeta']);
        assert.equal(fake.requests[0].method, 'GET');
        assert.equal(fake.requests[0].url, '/v1/models');
        assert.equal(fake.requests[0].headers.authorization, `Bearer ${SECRET}`);
        const b = await anthropic.create({ baseUrl: fake.baseUrl, apiKey: SECRET, model: 'm' }).listModels();
        assert.deepEqual(b, ['alpha', 'mid', 'zeta']);
        assert.ok(fake.requests[1].url.startsWith('/models'));
        assert.equal(fake.requests[1].headers['x-api-key'], SECRET);
    } finally { await fake.stop(); }
});

test('listModels maps a rejected key to invalid_key', async () => {
    const fake = await startFake((req, res) => sendJson(res, 401, {}));
    try {
        const client = openai.create({ baseUrl: fake.baseUrl, apiKey: SECRET, model: 'm' });
        await assert.rejects(client.listModels(), (err) => err.code === 'invalid_key');
    } finally { await fake.stop(); }
});

test('the key never shows in a thrown error message', async () => {
    const fake = await startFake((req, res) => sendJson(res, 401, { error: { message: `bad key ${SECRET}` } }));
    const probe = http.createServer();
    await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const closedUrl = `http://127.0.0.1:${probe.address().port}`;
    await new Promise((resolve) => probe.close(resolve));
    try {
        for (const baseUrl of [fake.baseUrl, closedUrl]) {
            for (const adapter of [openai, anthropic]) {
                const client = adapter.create({ baseUrl, apiKey: SECRET, model: 'm' });
                let caught;
                try {
                    await client.chat({ system: 'geheim', messages: [{ role: 'user', text: 'Frage-Text' }], maxTokens: 5, timeoutMs: 2000 });
                } catch (err) { caught = err; }
                assert.ok(caught);
                const dump = `${caught.message} ${caught.stack} ${JSON.stringify(caught)}`;
                assert.equal(dump.includes(SECRET), false);
                assert.equal(dump.includes('Frage-Text'), false);
                assert.equal(dump.includes('geheim'), false);
            }
        }
    } finally { await fake.stop(); }
});

test('readServerSentEvents: CRLF, comments, split chunks, multi-line data, trailing event without blank line', async () => {
    const parts = ['event: a\r\nda', 'ta: one\r\n', 'data: two\r\n\r\n: comment\r\n\r\ndata: solo\r\n\r\ndata: tail'];
    const encoder = new TextEncoder();
    const response = new Response(new ReadableStream({
        start(controller) { parts.forEach((p) => controller.enqueue(encoder.encode(p))); controller.close(); },
    }));
    const seen = [];
    for await (const evt of readServerSentEvents(response)) seen.push(evt);
    assert.deepEqual(seen, [
        { event: 'a', data: 'one\ntwo' },
        { event: 'message', data: 'solo' },
        { event: 'message', data: 'tail' },
    ]);
});
