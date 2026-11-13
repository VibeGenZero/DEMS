'use strict';

/** Admin-facing German messages per error code. Never include provider text, keys or request bodies. */
const AI_ERROR_MESSAGES = {
    invalid_key: 'Der API-Schlüssel wurde vom Anbieter abgelehnt.',
    model_not_found: 'Das Modell wurde beim Anbieter nicht gefunden.',
    unreachable: 'Der KI-Anbieter ist nicht erreichbar.',
    timeout: 'Der KI-Anbieter hat nicht rechtzeitig geantwortet.',
    rate_limited: 'Der KI-Anbieter nimmt gerade keine weiteren Anfragen an.',
    provider_error: 'Der KI-Anbieter hat einen Fehler gemeldet.',
    empty_answer: 'Der KI-Anbieter hat keine Antwort geliefert.',
};

/** Error of the AI layer; the message is always the fixed text of `code`. */
class AiError extends Error {
    /**
     * @param {keyof typeof AI_ERROR_MESSAGES} code
     * @param {{ status?: number }} [details] HTTP status only, nothing from the request or response body
     */
    constructor(code, details = {}) {
        super(AI_ERROR_MESSAGES[code] || AI_ERROR_MESSAGES.provider_error);
        this.name = 'AiError';
        this.code = AI_ERROR_MESSAGES[code] ? code : 'provider_error';
        if (details.status !== undefined) this.status = details.status;
    }
}

/** Maps an HTTP status of a failed provider answer to an AiError. */
function errorFromStatus(status) {
    if (status === 401 || status === 403) return new AiError('invalid_key', { status });
    if (status === 404) return new AiError('model_not_found', { status });
    if (status === 429) return new AiError('rate_limited', { status });
    return new AiError('provider_error', { status });
}

/**
 * Maps an error thrown by fetch (or while reading the body) to an AiError.
 * The adapters rethrow a caller-initiated abort before calling this, so every
 * remaining abort is the timeout.
 */
function errorFromThrown(err) {
    if (err instanceof AiError) return err;
    if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) return new AiError('timeout');
    return new AiError('unreachable');
}

module.exports = { AiError, AI_ERROR_MESSAGES, errorFromStatus, errorFromThrown };
