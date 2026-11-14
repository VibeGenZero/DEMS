const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PROVIDERS, isAiConfigured, getAiClient, testConnection } = require('../ai/client');
const { create: createMock } = require('../ai/providers/mock');
const { normalizeSystemValue, dropsStoredAiKey } = require('../utils/systemValues');

const setDevMock = (value) => {
    const before = process.env.DEV_MOCK;
    if (value === undefined) delete process.env.DEV_MOCK; else process.env.DEV_MOCK = value;
    return () => {
        if (before === undefined) delete process.env.DEV_MOCK; else process.env.DEV_MOCK = before;
    };
};

test('the provider table names the five providers with their default URLs', () => {
    assert.deepEqual(Object.keys(PROVIDERS), ['ollama', 'openrouter', 'openai', 'gemini', 'anthropic']);
    assert.equal(PROVIDERS.ollama.label, 'Ollama (lokal oder Cloud)');
    assert.equal(PROVIDERS.openrouter.label, 'OpenRouter');
    assert.equal(PROVIDERS.openai.label, 'OpenAI');
    assert.equal(PROVIDERS.gemini.label, 'Google Gemini');
    assert.equal(PROVIDERS.anthropic.label, 'Claude (Anthropic)');
    assert.equal(PROVIDERS.ollama.defaultBaseUrl, 'http://localhost:11434/v1');
    assert.equal(PROVIDERS.openrouter.defaultBaseUrl, 'https://openrouter.ai/api/v1');
    assert.equal(PROVIDERS.openai.defaultBaseUrl, 'https://api.openai.com/v1');
    assert.equal(PROVIDERS.gemini.defaultBaseUrl, 'https://generativelanguage.googleapis.com/v1beta/openai');
    assert.equal(PROVIDERS.anthropic.defaultBaseUrl, 'https://api.anthropic.com/v1');
    assert.equal(PROVIDERS.anthropic.adapter, 'anthropic');
    assert.equal(PROVIDERS.openai.adapter, 'openai');
    assert.deepEqual(Object.entries(PROVIDERS).filter(([, p]) => !p.keyRequired).map(([id]) => id), ['ollama']);
});

test('isAiConfigured: provider, model and (except Ollama) key', () => {
    assert.equal(isAiConfigured({}), false);
    assert.equal(isAiConfigured({ AI_PROVIDER: 'openai' }), false);
    assert.equal(isAiConfigured({ AI_PROVIDER: 'openai', AI_MODEL: 'gpt' }), false);
    assert.equal(isAiConfigured({ AI_PROVIDER: 'openai', AI_MODEL: 'gpt', AI_API_KEY: 'k' }), true);
    assert.equal(isAiConfigured({ AI_PROVIDER: 'ollama', AI_MODEL: 'llama' }), true);
    assert.equal(isAiConfigured({ AI_PROVIDER: 'nope', AI_MODEL: 'x', AI_API_KEY: 'k' }), false);
});

test('getAiClient picks the admin model and falls back to the normal one', () => {
    const env = { AI_PROVIDER: 'ollama', AI_MODEL: 'small', AI_MODEL_ADMIN: 'big' };
    assert.equal(getAiClient({ env }).model, 'small');
    assert.equal(getAiClient({ env, admin: true }).model, 'big');
    assert.equal(getAiClient({ env: { AI_PROVIDER: 'ollama', AI_MODEL: 'small' }, admin: true }).model, 'small');
    assert.equal(getAiClient({ env }).provider, 'ollama');
    assert.equal(typeof getAiClient({ env }).chat, 'function');
    assert.equal(typeof getAiClient({ env }).listModels, 'function');
});

test('getAiClient throws unreachable when not configured', () => {
    assert.throws(() => getAiClient({ env: {} }), { name: 'AiError', code: 'unreachable' });
});

test('overrides win; an empty override key keeps the stored one for the same provider', async () => {
    const seen = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
        seen.push({ url: String(url), auth: init.headers.Authorization || init.headers.authorization });
        return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    try {
        const env = { AI_PROVIDER: 'openai', AI_MODEL: 'stored', AI_API_KEY: 'stored-key' };
        const client = getAiClient({ env, overrides: { provider: 'openai', baseUrl: '', apiKey: '', model: 'other' } });
        assert.equal(client.provider, 'openai');
        assert.equal(client.model, 'other');
        await client.chat({ system: 's', messages: [{ role: 'user', text: 'hi' }], maxTokens: 5 });
        assert.equal(seen[0].url, 'https://api.openai.com/v1/chat/completions');
        assert.equal(seen[0].auth, 'Bearer stored-key');
    } finally {
        globalThis.fetch = realFetch;
    }
});

test('another provider never inherits the stored key or base URL', async () => {
    const seen = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
        seen.push({ url: String(url), auth: init.headers.Authorization || init.headers.authorization || '' });
        return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    try {
        const env = { AI_PROVIDER: 'openai', AI_MODEL: 'stored', AI_API_KEY: 'stored-key', AI_BASE_URL: 'https://stored.test/v1' };
        // Different provider, no key typed: no key at all (OpenRouter needs one)
        assert.throws(() => getAiClient({ env, overrides: { provider: 'openrouter' } }), { code: 'unreachable' });
        // Ollama needs none: default base URL, no Authorization header
        const ollama = getAiClient({ env, overrides: { provider: 'ollama', model: 'm' } });
        await ollama.chat({ system: 's', messages: [{ role: 'user', text: 'hi' }], maxTokens: 5 });
        assert.equal(seen[0].url, 'http://localhost:11434/v1/chat/completions');
        assert.doesNotMatch(seen[0].auth, /stored-key/);
        // A typed key is used
        const typed = getAiClient({ env, overrides: { provider: 'openrouter', apiKey: 'typed' } });
        await typed.chat({ system: 's', messages: [{ role: 'user', text: 'hi' }], maxTokens: 5 });
        assert.equal(seen[1].url, 'https://openrouter.ai/api/v1/chat/completions');
        assert.equal(seen[1].auth, 'Bearer typed');
        // The same provider keeps both stored values
        const same = getAiClient({ env, overrides: { provider: 'openai' } });
        await same.chat({ system: 's', messages: [{ role: 'user', text: 'hi' }], maxTokens: 5 });
        assert.equal(seen[2].url, 'https://stored.test/v1/chat/completions');
        assert.equal(seen[2].auth, 'Bearer stored-key');
    } finally {
        globalThis.fetch = realFetch;
    }
});

test('the stored key only goes to the stored base URL, never to a typed foreign one', async () => {
    const seen = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
        seen.push({ url: String(url), auth: init.headers.Authorization || init.headers.authorization || '' });
        return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const ask = (client) => client.chat({ system: 's', messages: [{ role: 'user', text: 'hi' }], maxTokens: 5 });
    try {
        const env = { AI_PROVIDER: 'openai', AI_MODEL: 'm', AI_API_KEY: 'stored-key' };
        // Same provider, foreign base URL, empty key: OpenAI needs a key, so there is no client and nothing is sent
        assert.throws(() => getAiClient({ env, overrides: { provider: 'openai', baseUrl: 'https://evil.example/v1', apiKey: '' } }), { code: 'unreachable' });
        assert.throws(() => getAiClient({ env, overrides: { baseUrl: 'https://evil.example/v1' } }), { code: 'unreachable' });
        // A provider without a key requirement (Ollama) with a stored key: the foreign address gets no Authorization header
        const ollama = { AI_PROVIDER: 'ollama', AI_MODEL: 'm', AI_API_KEY: 'stored-key' };
        await ask(getAiClient({ env: ollama, overrides: { provider: 'ollama', baseUrl: 'https://evil.example/v1', apiKey: '' } }));
        assert.equal(seen[0].url, 'https://evil.example/v1/chat/completions');
        assert.doesNotMatch(seen[0].auth, /stored-key/);
        await ask(getAiClient({ env: ollama, overrides: { baseUrl: 'https://evil.example/v1' } }));
        assert.doesNotMatch(seen[1].auth, /stored-key/);
        await ask(getAiClient({ env: ollama, overrides: { baseUrl: 'http://localhost:11434/v1/' } }));
        assert.equal(seen[1 + 1].auth, 'Bearer stored-key');
        seen.splice(0, seen.length);
        // The default base URL of the stored provider (also typed with spaces and a slash) keeps the key
        await ask(getAiClient({ env, overrides: { provider: 'openai', baseUrl: ' https://api.openai.com/v1/ ' } }));
        assert.equal(seen[0].auth, 'Bearer stored-key');
        // A typed key is always used
        await ask(getAiClient({ env, overrides: { provider: 'openai', baseUrl: 'https://evil.example/v1', apiKey: 'typed' } }));
        assert.equal(seen[1].auth, 'Bearer typed');
        // A stored custom base URL is the one that keeps the key
        const custom = { ...env, AI_BASE_URL: 'https://proxy.test/v1' };
        await ask(getAiClient({ env: custom, overrides: { baseUrl: 'https://proxy.test/v1/' } }));
        assert.equal(seen[2].auth, 'Bearer stored-key');
        assert.throws(() => getAiClient({ env: custom, overrides: { baseUrl: 'https://api.openai.com/v1' } }), { code: 'unreachable' });
        // No override at all: stored key and stored URL
        await ask(getAiClient({ env: custom }));
        assert.equal(seen[3].auth, 'Bearer stored-key');
    } finally {
        globalThis.fetch = realFetch;
    }
});

test('the mock provider is refused without DEV_MOCK=true', () => {
    const env = { AI_PROVIDER: 'mock', AI_MODEL: 'mock-1' };
    let restore = setDevMock(undefined);
    try {
        assert.equal(isAiConfigured(env), false);
        assert.throws(() => getAiClient({ env }), { code: 'unreachable' });
        assert.deepEqual(normalizeSystemValue('AI_PROVIDER', 'mock'), { error: 'Unbekannter KI-Anbieter.' });
    } finally { restore(); }
    restore = setDevMock('true');
    try {
        assert.equal(isAiConfigured(env), true);
        assert.equal(getAiClient({ env }).provider, 'mock');
        assert.deepEqual(normalizeSystemValue('AI_PROVIDER', 'mock'), { value: 'mock' });
    } finally { restore(); }
});

test('normalizeSystemValue checks the AI keys', () => {
    assert.deepEqual(normalizeSystemValue('AI_PROVIDER', ''), { value: '' });
    assert.deepEqual(normalizeSystemValue('AI_PROVIDER', ' openai '), { value: 'openai' });
    assert.deepEqual(normalizeSystemValue('AI_PROVIDER', 'foo'), { error: 'Unbekannter KI-Anbieter.' });
    assert.deepEqual(normalizeSystemValue('AI_BASE_URL', ''), { value: '' });
    assert.deepEqual(normalizeSystemValue('AI_BASE_URL', 'https://x.test/v1'), { value: 'https://x.test/v1' });
    const urlError = { error: 'Die KI-Adresse muss mit http:// oder https:// beginnen.' };
    // Provider docs show the address with a trailing slash (Ollama): accepted and stripped
    assert.deepEqual(normalizeSystemValue('AI_BASE_URL', 'http://localhost:11434/v1/'), { value: 'http://localhost:11434/v1' });
    assert.deepEqual(normalizeSystemValue('AI_BASE_URL', 'https://x.test/v1//'), { value: 'https://x.test/v1' });
    assert.deepEqual(normalizeSystemValue('AI_BASE_URL', 'ftp://x'), urlError);
    assert.deepEqual(normalizeSystemValue('AI_MODEL', '  m  '), { value: 'm' });
    assert.equal(normalizeSystemValue('AI_MODEL_ADMIN', 'x'.repeat(300)).value.length, 200);
    assert.deepEqual(normalizeSystemValue('AI_API_KEY', ' k '), { value: 'k' });
    assert.deepEqual(normalizeSystemValue('AI_API_KEY', ''), { skip: true });
    assert.equal(normalizeSystemValue('AI_API_KEY', 'x'.repeat(600)).value.length, 500);
});

test('the mock provider answers JSON and text and streams word by word', async () => {
    const mock = createMock();
    const messages = [{ role: 'user', text: 'alt' }, { role: 'assistant', text: 'x' }, { role: 'user', text: 'Ein Raid am Freitag' }];

    const json = await mock.chat({ system: 's', messages, json: true });
    assert.deepEqual(JSON.parse(json.text), { patch: { title: 'Ein Raid am Freitag' }, reply: 'Entwurf ist im Formular.', questions: [] });
    assert.deepEqual(json.usage, { inputTokens: 10, outputTokens: 10 });

    const long = await mock.chat({ messages: [{ role: 'user', text: 'a'.repeat(100) }], json: true });
    assert.equal(JSON.parse(long.text).patch.title.length, 60);

    const pieces = [];
    const text = await mock.chat({ messages, onToken: (t) => pieces.push(t) });
    assert.equal(text.text, 'Mock-Antwort: Ein Raid am Freitag\nQuelle: Beschreibung');
    assert.ok(pieces.length > 1);
    assert.equal(pieces.join(''), text.text);

    assert.deepEqual(await mock.listModels(), ['mock-1']);
});

test('testConnection reports success and failure without leaking details', async () => {
    const restore = setDevMock('true');
    try {
        const ok = await testConnection({ provider: 'mock', model: 'mock-1' });
        assert.equal(ok.ok, true);
        assert.equal(typeof ok.ms, 'number');
    } finally { restore(); }
    const bad = await testConnection({ provider: 'nope', model: 'x' });
    assert.equal(bad.ok, false);
    assert.equal(bad.code, 'unreachable');
    assert.equal(typeof bad.error, 'string');
});

test('a stored AI key is dropped when the provider or the address changes without a new key', () => {
    const env = { AI_PROVIDER: 'openai', AI_BASE_URL: '', AI_API_KEY: 'sk-alt' };
    assert.equal(dropsStoredAiKey({ AI_PROVIDER: 'ollama' }, env), true);
    assert.equal(dropsStoredAiKey({ AI_PROVIDER: '' }, env), true, 'switching the AI off removes the key');
    assert.equal(dropsStoredAiKey({ AI_BASE_URL: 'http://fremder-host:11434/v1' }, env), true);
    assert.equal(dropsStoredAiKey({ AI_PROVIDER: 'ollama', AI_API_KEY: 'neu' }, env), false, 'a new key replaces it anyway');
    assert.equal(dropsStoredAiKey({ AI_PROVIDER: 'openai', AI_MODEL: 'gpt-x' }, env), false, 'same provider, other model');
    assert.equal(dropsStoredAiKey({ AI_MODEL_ADMIN: 'gpt-y' }, env), false);
    assert.equal(dropsStoredAiKey({ AI_BASE_URL: 'https://api.test/v1' }, { ...env, AI_BASE_URL: 'https://api.test/v1/' }), false, 'a slash is no new address');
    assert.equal(dropsStoredAiKey({ AI_PROVIDER: 'ollama' }, { ...env, AI_API_KEY: '' }), false, 'nothing stored, nothing to drop');
});

test('the connection test counts an answer without text as connected (reasoning models spend the few tokens on thinking)', async () => {
    const http = require('http');
    const fake = http.createServer((req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: '' }, finish_reason: 'length' }], usage: { prompt_tokens: 9, completion_tokens: 5 } }));
    });
    await new Promise(resolve => fake.listen(0, '127.0.0.1', resolve));
    try {
        const result = await testConnection({ provider: 'ollama', baseUrl: `http://127.0.0.1:${fake.address().port}/v1`, model: 'qwen3' });
        assert.equal(result.ok, true, JSON.stringify(result));
    } finally {
        await new Promise(resolve => fake.close(resolve));
    }
});
