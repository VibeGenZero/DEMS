'use strict';

const { AiError, errorFromStatus, errorFromThrown } = require('../errors');
const { readServerSentEvents } = require('./sse');
const { JSON_HINT } = require('./jsonHint');

const DEFAULT_TIMEOUT_MS = 60000;

/**
 * Adapter for servers that speak the OpenAI chat completions dialect
 * (OpenAI, OpenRouter, Ollama /v1, Gemini /v1beta/openai).
 * @param {{ baseUrl: string, apiKey?: string, model: string, fetchImpl?: typeof fetch }} options
 */
function create({ baseUrl, apiKey, model, fetchImpl = fetch }) {
    const root = String(baseUrl || '').replace(/\/+$/, '');

    // The key goes only into this header and never into an error.
    function headers(extra) {
        const result = { ...extra };
        if (apiKey) result.Authorization = `Bearer ${apiKey}`;
        return result;
    }

    function signalFor(timeoutMs, signal) {
        const timeout = AbortSignal.timeout(timeoutMs || DEFAULT_TIMEOUT_MS);
        return signal ? AbortSignal.any([timeout, signal]) : timeout;
    }

    async function send(url, init, callerSignal) {
        let response;
        try {
            response = await fetchImpl(url, init);
        } catch (err) {
            if (callerSignal && callerSignal.aborted) throw err;
            throw errorFromThrown(err);
        }
        return response;
    }

    // Newer OpenAI models reject max_tokens, some compatible servers only know it.
    // So the newer name goes first and the old one is the single fallback after a 400.
    async function post(body, { timeoutMs, signal }) {
        const { limit, ...rest } = body;
        const combined = signalFor(timeoutMs, signal);
        const attempt = (limitKey) => send(`${root}/chat/completions`, {
            method: 'POST',
            headers: headers({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ ...rest, [limitKey]: limit }),
            signal: combined,
        }, signal);
        let response = await attempt('max_completion_tokens');
        if (response.status === 400) {
            await response.body?.cancel().catch(() => {});
            response = await attempt('max_tokens');
        }
        if (!response.ok) {
            await response.body?.cancel().catch(() => {});
            throw errorFromStatus(response.status);
        }
        return response;
    }

    async function chat({ system, messages, maxTokens, timeoutMs, signal, onToken, json }) {
        const systemText = [system, json ? JSON_HINT : ''].filter(Boolean).join('\n\n');
        const body = {
            model,
            messages: [
                ...(systemText ? [{ role: 'system', content: systemText }] : []),
                ...messages.map((m) => ({ role: m.role, content: m.text })),
            ],
            limit: maxTokens,
        };
        if (onToken) {
            body.stream = true;
            body.stream_options = { include_usage: true };
        }
        const response = await post(body, { timeoutMs, signal });
        try {
            const result = onToken ? await readStream(response, onToken) : await readPlain(response);
            if (!result.text.trim()) throw new AiError('empty_answer');
            return result;
        } catch (err) {
            if (signal && signal.aborted) throw err;
            throw errorFromThrown(err);
        }
    }

    async function listModels() {
        const response = await send(`${root}/models`, {
            method: 'GET',
            headers: headers(),
            signal: signalFor(15000),
        });
        if (!response.ok) {
            await response.body?.cancel().catch(() => {});
            throw errorFromStatus(response.status);
        }
        try {
            const json = await response.json();
            return (json.data || []).map((m) => m.id).filter((id) => typeof id === 'string').sort();
        } catch (err) {
            throw errorFromThrown(err);
        }
    }

    return { chat, listModels };
}

function usageOf(raw) {
    return {
        inputTokens: Number(raw && raw.prompt_tokens) || 0,
        outputTokens: Number(raw && raw.completion_tokens) || 0,
    };
}

async function readPlain(response) {
    const json = await response.json();
    const content = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
    return { text: typeof content === 'string' ? content : '', usage: usageOf(json.usage) };
}

async function readStream(response, onToken) {
    let text = '';
    let usage = usageOf(null);
    for await (const evt of readServerSentEvents(response)) {
        if (evt.data === '[DONE]') break;
        let chunk;
        try { chunk = JSON.parse(evt.data); } catch { continue; }
        const piece = chunk.choices && chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content;
        if (typeof piece === 'string' && piece) {
            text += piece;
            onToken(piece);
        }
        if (chunk.usage) usage = usageOf(chunk.usage);
    }
    return { text, usage };
}

module.exports = { create };
