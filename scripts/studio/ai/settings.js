'use strict';
/**
 * The studio's own AI connection (`ai.json` next to `recent.json`) and the routes that
 * edit and try it. The studio never reads `process.env.AI_*`: the settings are mapped
 * to an env-shaped object and handed to `ai/client.js`.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PROVIDERS, getAiClient, testConnection, isAiConfigured } = require('../../../ai/client');
const { AiError, AI_ERROR_MESSAGES, logAiFailure } = require('../../../ai/errors');
const { normalizeSystemValue } = require('../../../utils/systemValues');
const { StudioError } = require('../files');

const FILE = 'ai.json';
const STUDIO_PROVIDERS = ['openrouter', 'ollama', 'anthropic', 'openai', 'gemini'];
const OLLAMA_PRESETS = { local: 'http://localhost:11434/v1', cloud: 'https://ollama.com/v1' };
const MAX_TOKENS_DEFAULT = 8192;
const MAX_TOKENS_RANGE = [1024, 64000];
const CONTEXT_RANGE = [8192, 1000000];
const KEY_MAX = 500;
const MODEL_MAX = 200;

const text = (v) => (typeof v === 'string' ? v.trim() : '');
const trimSlash = (v) => v.replace(/\/+$/, '');
const defaultContext = (provider) => (provider === 'ollama' ? 32768 : 128000);
const endpointOf = (s) => trimSlash(s.baseUrl || (PROVIDERS[s.provider] || {}).defaultBaseUrl || '');
const inRange = (n, [min, max]) => Number.isInteger(n) && n >= min && n <= max;

/** @returns {{ provider: string, baseUrl: string, apiKey: string, model: string, maxTokens: number, contextTokens: number }} */
function load(configDir) {
    let raw = {};
    try {
        const parsed = JSON.parse(fs.readFileSync(path.join(configDir, FILE), 'utf8').replace(/^﻿/, ''));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) raw = parsed;
    } catch {
        // missing or broken file: defaults
    }
    const provider = STUDIO_PROVIDERS.includes(raw.provider) ? raw.provider : '';
    return {
        provider,
        baseUrl: text(raw.baseUrl),
        apiKey: text(raw.apiKey),
        model: text(raw.model),
        maxTokens: inRange(raw.maxTokens, MAX_TOKENS_RANGE) ? raw.maxTokens : MAX_TOKENS_DEFAULT,
        contextTokens: inRange(raw.contextTokens, CONTEXT_RANGE) ? raw.contextTokens : defaultContext(provider)
    };
}

/** The settings without the key, plus what a settings dialog needs. */
function publicView(settings) {
    return {
        provider: settings.provider,
        baseUrl: settings.baseUrl,
        model: settings.model,
        maxTokens: settings.maxTokens,
        contextTokens: settings.contextTokens,
        apiKeySet: !!settings.apiKey,
        providers: STUDIO_PROVIDERS.map((id) => ({ id, label: PROVIDERS[id].label, defaultBaseUrl: PROVIDERS[id].defaultBaseUrl, keyRequired: PROVIDERS[id].keyRequired })),
        ollamaPresets: { ...OLLAMA_PRESETS }
    };
}

/** The settings as the environment `ai/client.js` reads. */
function toEnv(settings) {
    return { AI_PROVIDER: settings.provider, AI_BASE_URL: settings.baseUrl, AI_API_KEY: settings.apiKey, AI_MODEL: settings.model };
}

const isConfigured = (settings) => isAiConfigured(toEnv(settings));

function numberOr(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    return Number(value);
}

/**
 * Validate and store the connection. An empty key keeps the stored one unless provider or
 * address changed (then it is dropped).
 *
 * @throws {StudioError} -> 400 with a German message.
 */
function save(configDir, input) {
    const body = input && typeof input === 'object' ? input : {};
    const stored = load(configDir);
    const provider = text(body.provider);
    if (!STUDIO_PROVIDERS.includes(provider)) throw new StudioError('Unbekannter KI-Anbieter.', 400);
    const url = normalizeSystemValue('AI_BASE_URL', text(body.baseUrl));
    if (url.error) throw new StudioError(url.error, 400);
    const maxTokens = numberOr(body.maxTokens, MAX_TOKENS_DEFAULT);
    if (!inRange(maxTokens, MAX_TOKENS_RANGE)) throw new StudioError('Die maximale Antwortlänge muss zwischen 1024 und 64000 liegen.', 400);
    const contextTokens = numberOr(body.contextTokens, defaultContext(provider));
    if (!inRange(contextTokens, CONTEXT_RANGE)) throw new StudioError('Die Kontextlänge muss zwischen 8192 und 1000000 liegen.', 400);
    if (maxTokens >= contextTokens) throw new StudioError('Die Antwortlänge muss kleiner als die Kontextlänge sein.', 400);

    const next = { provider, baseUrl: url.value, apiKey: '', model: text(body.model).slice(0, MODEL_MAX), maxTokens, contextTokens };
    const typedKey = text(body.apiKey).slice(0, KEY_MAX);
    const sameConnection = provider === stored.provider && endpointOf(next) === endpointOf(stored);
    next.apiKey = typedKey || (sameConnection ? stored.apiKey : '');

    fs.mkdirSync(configDir, { recursive: true });
    const temp = path.join(configDir, `.${FILE}.${crypto.randomBytes(6).toString('hex')}.tmp`);
    try {
        fs.writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
        fs.renameSync(temp, path.join(configDir, FILE));
    } catch (err) {
        fs.rmSync(temp, { force: true });
        throw err;
    }
    return next;
}

/** The unsaved values of a test or model request; anything but strings is dropped. */
function overridesOf(body) {
    const b = body && typeof body === 'object' ? body : {};
    return { provider: text(b.provider), baseUrl: text(b.baseUrl), apiKey: text(b.apiKey), model: text(b.model) };
}

/** @returns {Object} -> The studio route table entries for the AI settings. */
function routes(configDir) {
    return {
        'GET /api/ai/settings': () => ({ json: publicView(load(configDir)) }),
        'PUT /api/ai/settings': (req, body) => ({ json: publicView(save(configDir, body)) }),
        'POST /api/ai/test': async (req, body) => {
            const result = await testConnection(overridesOf(body), { env: toEnv(load(configDir)) });
            return { json: result.ok ? { ok: true, ms: result.ms } : { ok: false, error: result.error } };
        },
        'POST /api/ai/models': async (req, body) => {
            try {
                const overrides = overridesOf(body);
                // Listing needs no model; a placeholder keeps the client usable before one is chosen
                if (!overrides.model) overrides.model = '-';
                const models = await getAiClient({ overrides, env: toEnv(load(configDir)) }).listModels();
                return { json: { models } };
            } catch (err) {
                const code = err instanceof AiError ? err.code : 'unreachable';
                logAiFailure('Modellliste', err);
                return { status: code === 'blocked_address' ? 400 : 502, json: { error: AI_ERROR_MESSAGES[code] } };
            }
        }
    };
}

module.exports = { STUDIO_PROVIDERS, OLLAMA_PRESETS, load, publicView, save, toEnv, isConfigured, routes };
