'use strict';

const { AiError, errorFromStatus, errorFromThrown } = require('../errors');
const { readServerSentEvents } = require('./sse');

const DEFAULT_TIMEOUT_MS = 60000;
// Long-standing stable version; the provider keeps existing parameters per version.
const API_VERSION = '2023-06-01';
const JSON_HINT = 'Respond with valid JSON only, without any other text.';

/**
 * Adapter for the Anthropic Messages API.
 * @param {{ baseUrl: string, apiKey?: string, model: string, fetchImpl?: typeof fetch }} options
 */
function create({ baseUrl, apiKey, model, fetchImpl = fetch }) {
    const root = String(baseUrl || '').replace(/\/+$/, '');

    // The key goes only into this header and never into an error.
    function headers(extra) {
        return { 'anthropic-version': API_VERSION, ...(apiKey ? { 'x-api-key': apiKey } : {}), ...extra };
    }

    async function send(url, init, callerSignal) {
        let response;
        try {
            response = await fetchImpl(url, init);
        } catch (err) {
            if (callerSignal && callerSignal.aborted) throw err;
            throw errorFromThrown(err);
        }
        if (!response.ok) {
            await response.body?.cancel().catch(() => {});
            throw errorFromStatus(response.status);
        }
        return response;
    }

    async function chat({ system, messages, maxTokens, timeoutMs, signal, onToken, json }) {
        const timeout = AbortSignal.timeout(timeoutMs || DEFAULT_TIMEOUT_MS);
        const systemText = [system, json ? JSON_HINT : ''].filter(Boolean).join('\n\n');
        const body = {
            model,
            max_tokens: maxTokens || 1024,
            messages: messages.map((m) => ({ role: m.role, content: m.text })),
        };
        if (systemText) body.system = systemText;
        if (onToken) body.stream = true;
        const response = await send(`${root}/messages`, {
            method: 'POST',
            headers: headers({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(body),
            signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
        }, signal);
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
        const response = await send(`${root}/models?limit=1000`, {
            method: 'GET',
            headers: headers(),
            signal: AbortSignal.timeout(15000),
        });
        try {
            const json = await response.json();
            return (json.data || []).map((m) => m.id).filter((id) => typeof id === 'string').sort();
        } catch (err) {
            throw errorFromThrown(err);
        }
    }

    return { chat, listModels };
}

async function readPlain(response) {
    const json = await response.json();
    const text = (json.content || [])
        .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('');
    return {
        text,
        usage: {
            inputTokens: Number(json.usage && json.usage.input_tokens) || 0,
            outputTokens: Number(json.usage && json.usage.output_tokens) || 0,
        },
    };
}

async function readStream(response, onToken) {
    let text = '';
    const usage = { inputTokens: 0, outputTokens: 0 };
    // message_start carries the input count, message_delta the final output count.
    const take = (raw) => {
        if (!raw) return;
        if (Number.isFinite(raw.input_tokens)) usage.inputTokens = raw.input_tokens;
        if (Number.isFinite(raw.output_tokens)) usage.outputTokens = raw.output_tokens;
    };
    for await (const evt of readServerSentEvents(response)) {
        let data;
        try { data = JSON.parse(evt.data); } catch { continue; }
        const type = data.type || evt.event;
        if (type === 'content_block_delta') {
            const piece = data.delta && data.delta.text;
            if (typeof piece === 'string' && piece) {
                text += piece;
                onToken(piece);
            }
        } else if (type === 'message_start') {
            take(data.message && data.message.usage);
        } else if (type === 'message_delta') {
            take(data.usage);
        } else if (type === 'message_stop') {
            break;
        }
    }
    return { text, usage };
}

module.exports = { create };
