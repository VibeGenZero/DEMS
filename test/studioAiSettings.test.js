'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { load, save, publicView, toEnv, isConfigured, routes } = require('../scripts/studio/ai/settings');

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'studio-ai-'));
const OLLAMA = { provider: 'ollama', baseUrl: 'http://localhost:11434/v1', model: 'qwen3' };

test('load returns defaults without a file', () => {
    const s = load(tempDir());
    assert.deepEqual(s, { provider: '', baseUrl: '', apiKey: '', model: '', maxTokens: 8192, contextTokens: 128000 });
    assert.equal(isConfigured(s), false);
});

test('save then load round-trips', () => {
    const dir = tempDir();
    const saved = save(dir, { ...OLLAMA, maxTokens: 4096, contextTokens: 16384 });
    assert.deepEqual(load(dir), saved);
    assert.equal(saved.maxTokens, 4096);
    assert.equal(saved.contextTokens, 16384);
    assert.equal(isConfigured(saved), true);
});

test('a broken file gives the defaults', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'ai.json'), '{nope');
    assert.equal(load(dir).provider, '');
});

test('contextTokens defaults to 32768 for ollama and 128000 for openai', () => {
    assert.equal(save(tempDir(), OLLAMA).contextTokens, 32768);
    assert.equal(save(tempDir(), { provider: 'openai', model: 'gpt', apiKey: 'k' }).contextTokens, 128000);
});

test('publicView never contains the key', () => {
    const s = save(tempDir(), { provider: 'openai', model: 'gpt', apiKey: 'sk-secret-123' });
    const view = publicView(s);
    assert.equal(JSON.stringify(view).includes('sk-secret-123'), false);
    assert.equal(view.apiKeySet, true);
    assert.deepEqual(view.providers.map(p => p.id).sort(), ['anthropic', 'gemini', 'ollama', 'openai', 'openrouter']);
    assert.equal(view.ollamaPresets.cloud, 'https://ollama.com/v1');
    assert.equal(view.apiKey, undefined);
});

test('changing provider without a new key drops it', () => {
    const dir = tempDir();
    save(dir, { provider: 'openai', model: 'gpt', apiKey: 'k1' });
    assert.equal(save(dir, { provider: 'openrouter', model: 'm' }).apiKey, '');
});

test('changing baseUrl without a new key drops it', () => {
    const dir = tempDir();
    save(dir, { provider: 'openai', model: 'gpt', apiKey: 'k1' });
    assert.equal(save(dir, { provider: 'openai', model: 'gpt', baseUrl: 'https://proxy.example.com/v1' }).apiKey, '');
});

test('same provider and url keep the key', () => {
    const dir = tempDir();
    save(dir, { provider: 'openai', model: 'gpt', apiKey: 'k1' });
    assert.equal(save(dir, { provider: 'openai', model: 'gpt-2', baseUrl: 'https://api.openai.com/v1' }).apiKey, 'k1');
    assert.equal(save(dir, { provider: 'openai', model: 'gpt-3' }).apiKey, 'k1');
});

test('invalid values are refused with German messages', () => {
    const dir = tempDir();
    const refused = (input, message) => assert.throws(() => save(dir, { ...OLLAMA, ...input }), { name: 'StudioError', status: 400, message });
    refused({ provider: 'nope' }, 'Unbekannter KI-Anbieter.');
    refused({ maxTokens: 1023 }, 'Die maximale Antwortlänge muss zwischen 1024 und 64000 liegen.');
    refused({ maxTokens: 64001 }, 'Die maximale Antwortlänge muss zwischen 1024 und 64000 liegen.');
    refused({ contextTokens: 8191 }, 'Die Kontextlänge muss zwischen 8192 und 1000000 liegen.');
    refused({ maxTokens: 16384, contextTokens: 16384 }, 'Die Antwortlänge muss kleiner als die Kontextlänge sein.');
    assert.throws(() => save(dir, { ...OLLAMA, baseUrl: 'http://169.254.169.254/v1' }), { name: 'StudioError', status: 400 });
    assert.throws(() => save(dir, { ...OLLAMA, baseUrl: 'ftp://x' }), { name: 'StudioError', status: 400 });
});

test('toEnv maps the settings', () => {
    assert.deepEqual(toEnv({ provider: 'p', baseUrl: 'u', apiKey: 'k', model: 'm' }), { AI_PROVIDER: 'p', AI_BASE_URL: 'u', AI_API_KEY: 'k', AI_MODEL: 'm' });
});

test('ai.json has mode 0600', { skip: process.platform === 'win32' }, () => {
    const dir = tempDir();
    save(dir, OLLAMA);
    assert.equal(fs.statSync(path.join(dir, 'ai.json')).mode & 0o777, 0o600);
});

async function withFake(fn) {
    const seen = [];
    const fake = http.createServer((req, res) => {
        seen.push({ url: req.url, auth: req.headers.authorization });
        res.writeHead(200, { 'content-type': 'application/json' });
        if (req.url.endsWith('/models')) res.end(JSON.stringify({ data: [{ id: 'm-a' }, { id: 'm-b' }] }));
        else res.end(JSON.stringify({ choices: [{ message: { content: 'Hallo' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    });
    await new Promise(r => fake.listen(0, '127.0.0.1', r));
    try {
        await fn(`http://127.0.0.1:${fake.address().port}/v1`, seen);
    } finally {
        await new Promise(r => fake.close(r));
    }
}

test('GET route answers publicView', async () => {
    const dir = tempDir();
    save(dir, { provider: 'openai', model: 'gpt', apiKey: 'sk-x' });
    const answer = await routes(dir)['GET /api/ai/settings']({}, {});
    assert.deepEqual(answer.json, publicView(load(dir)));
});

test('PUT route saves and refuses with the status', async () => {
    const dir = tempDir();
    const r = routes(dir);
    const answer = await r['PUT /api/ai/settings']({}, OLLAMA);
    assert.equal(answer.json.provider, 'ollama');
    assert.equal(answer.json.apiKeySet, false);
    await assert.rejects(async () => r['PUT /api/ai/settings']({}, { ...OLLAMA, maxTokens: 5 }), { name: 'StudioError', status: 400 });
});

test('POST /api/ai/test against a fake ollama server answers { ok: true }', async () => {
    await withFake(async (baseUrl) => {
        const answer = await routes(tempDir())['POST /api/ai/test']({}, { provider: 'ollama', baseUrl, model: 'm' });
        assert.equal(answer.json.ok, true);
    });
});

test('POST /api/ai/models answers the fake ids and reuses the stored key only for the stored endpoint', async () => {
    await withFake(async (baseUrl, seen) => {
        const dir = tempDir();
        save(dir, { provider: 'ollama', baseUrl, model: 'm', apiKey: 'stored-key' });
        const r = routes(dir);
        const same = await r['POST /api/ai/models']({}, { provider: 'ollama', baseUrl, model: '' });
        assert.deepEqual(same.json, { models: ['m-a', 'm-b'] });
        assert.equal(seen.at(-1).auth, 'Bearer stored-key');
        save(dir, { provider: 'ollama', baseUrl: 'http://127.0.0.1:9/v1', model: 'm', apiKey: 'stored-key' });
        const other = await r['POST /api/ai/models']({}, { provider: 'ollama', baseUrl });
        assert.deepEqual(other.json, { models: ['m-a', 'm-b'] });
        assert.equal(seen.at(-1).auth, undefined);
    });
});

test('POST /api/ai/models refuses a blocked address', async () => {
    const answer = await routes(tempDir())['POST /api/ai/models']({}, { provider: 'ollama', baseUrl: 'http://169.254.169.254/v1' });
    assert.equal(answer.status, 400);
    assert.match(answer.json.error, /gesperrt/);
});
