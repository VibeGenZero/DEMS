'use strict';

/**
 * Picks the adapter for the configured AI provider. Settings are read from the
 * environment at call time (they are managed system keys and change live).
 */
const { AiError, AI_ERROR_MESSAGES, logAiFailure } = require('./errors');
const openaiAdapter = require('./providers/openaiCompatible');
const anthropicAdapter = require('./providers/anthropic');
const mockAdapter = require('./providers/mock');

const PROVIDERS = Object.freeze({
    ollama: { label: 'Ollama (lokal oder Cloud)', adapter: 'openai', defaultBaseUrl: 'http://localhost:11434/v1', keyRequired: false },
    openrouter: { label: 'OpenRouter', adapter: 'openai', defaultBaseUrl: 'https://openrouter.ai/api/v1', keyRequired: true },
    openai: { label: 'OpenAI', adapter: 'openai', defaultBaseUrl: 'https://api.openai.com/v1', keyRequired: true },
    gemini: { label: 'Google Gemini', adapter: 'openai', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyRequired: true },
    anthropic: { label: 'Claude (Anthropic)', adapter: 'anthropic', defaultBaseUrl: 'https://api.anthropic.com/v1', keyRequired: true }
});

const MOCK_PROVIDER = { label: 'Mock', adapter: 'mock', defaultBaseUrl: '', keyRequired: false };
const TEST_TIMEOUT_MS = 20000;

const filled = (value) => (typeof value === 'string' ? value.trim() : '');
const trimSlash = (value) => value.replace(/\/+$/, '');

/** The provider entry for an id; `mock` only with DEV_MOCK=true. */
function providerEntry(id) {
    if (id === 'mock') return process.env.DEV_MOCK === 'true' ? MOCK_PROVIDER : null;
    return Object.hasOwn(PROVIDERS, id) ? PROVIDERS[id] : null;
}

function settingsFrom(env, overrides, admin) {
    const o = overrides || {};
    const storedProvider = filled(env.AI_PROVIDER);
    const provider = filled(o.provider) || storedProvider;
    // A stored key and base URL belong to the stored provider: never hand them to another one
    const sameProvider = provider === storedProvider;
    const baseUrl = filled(o.baseUrl) || (sameProvider ? filled(env.AI_BASE_URL) : '');
    // The stored key is only sent to the stored endpoint: a typed, different address gets no key
    const storedEndpoint = filled(env.AI_BASE_URL) || (providerEntry(storedProvider) || {}).defaultBaseUrl || '';
    const sameEndpoint = !filled(o.baseUrl) || trimSlash(filled(o.baseUrl)) === trimSlash(storedEndpoint);
    const model = filled(o.model) || (admin ? filled(env.AI_MODEL_ADMIN) : '') || filled(env.AI_MODEL);
    return {
        provider,
        baseUrl,
        apiKey: filled(o.apiKey) || (sameProvider && sameEndpoint ? filled(env.AI_API_KEY) : ''),
        model
    };
}

function isUsable(settings) {
    const entry = providerEntry(settings.provider);
    return !!entry && !!settings.model && (!entry.keyRequired || !!settings.apiKey);
}

/**
 * Whether provider, model and (when the provider needs one) key are set.
 *
 * @param {Object} [env] -> Environment to read (default process.env).
 * @returns {boolean}
 */
function isAiConfigured(env = process.env) {
    return isUsable(settingsFrom(env, null, false));
}

/**
 * Build a client for the configured provider.
 *
 * @param {Object} [options]
 * @param {boolean} [options.admin] -> Use `AI_MODEL_ADMIN` (falls back to `AI_MODEL`).
 * @param {Object|null} [options.overrides] -> `{ provider, baseUrl, apiKey, model }`, unsaved values; an empty `apiKey` keeps the stored one.
 * @param {Object} [options.env] -> Environment to read (default process.env).
 * @returns {{ provider: string, model: string, chat: Function, listModels: Function }}
 * @throws {AiError} -> `unreachable` when not configured.
 */
function getAiClient({ admin = false, overrides = null, env = process.env } = {}) {
    const settings = settingsFrom(env, overrides, admin);
    if (!isUsable(settings)) throw new AiError('unreachable');
    const entry = providerEntry(settings.provider);
    const baseUrl = (settings.baseUrl || entry.defaultBaseUrl).replace(/\/+$/, '');
    const adapterArgs = { baseUrl, apiKey: settings.apiKey, model: settings.model };
    let adapter;
    if (entry.adapter === 'mock') adapter = mockAdapter.create(adapterArgs);
    else if (entry.adapter === 'anthropic') adapter = anthropicAdapter.create(adapterArgs);
    else adapter = openaiAdapter.create(adapterArgs);
    return { provider: settings.provider, model: settings.model, chat: adapter.chat, listModels: adapter.listModels };
}

/**
 * Try one tiny request with the given (possibly unsaved) settings.
 *
 * @param {Object|null} [overrides] -> See getAiClient.
 * @returns {Promise<{ ok: true, ms: number }|{ ok: false, code: string, error: string }>}
 */
async function testConnection(overrides = null) {
    const started = Date.now();
    try {
        const client = getAiClient({ overrides });
        await client.chat({ system: 'Antworte mit einem Wort.', messages: [{ role: 'user', text: 'Hallo' }], maxTokens: 5, timeoutMs: TEST_TIMEOUT_MS });
        return { ok: true, ms: Date.now() - started };
    } catch (err) {
        const code = err instanceof AiError ? err.code : 'unreachable';
        // The provider answered with success but no text: reasoning models spend the few
        // test tokens on thinking. Address, key and model work, which is all this tests.
        if (code === 'empty_answer') return { ok: true, ms: Date.now() - started };
        logAiFailure('Verbindungstest', err);
        return { ok: false, code, error: AI_ERROR_MESSAGES[code] };
    }
}

module.exports = { PROVIDERS, isAiConfigured, getAiClient, testConnection };
