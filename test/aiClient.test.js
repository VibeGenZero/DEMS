const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PROVIDERS, isAiConfigured, getAiClient, testConnection } = require('../ai/client');
const { create: createMock } = require('../ai/providers/mock');
const { normalizeSystemValue } = require('../utils/systemValues');

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

test('overrides win, an empty override key keeps the stored one', async () => {
    const seen = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
        seen.push({ url: String(url), auth: init.headers.Authorization || init.headers.authorization });
        return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    try {
        const env = { AI_PROVIDER: 'openai', AI_MODEL: 'stored', AI_API_KEY: 'stored-key' };
        const client = getAiClient({ env, overrides: { provider: 'openrouter', baseUrl: 'https://example.test/v1', apiKey: '', model: 'other' } });
        assert.equal(client.provider, 'openrouter');
        assert.equal(client.model, 'other');
        await client.chat({ system: 's', messages: [{ role: 'user', text: 'hi' }], maxTokens: 5 });
        assert.equal(seen[0].url, 'https://example.test/v1/chat/completions');
        assert.equal(seen[0].auth, 'Bearer stored-key');
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
    assert.deepEqual(normalizeSystemValue('AI_BASE_URL', 'https://x.test/v1/'), urlError);
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
