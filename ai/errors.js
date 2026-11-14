'use strict';

/** Admin-facing German messages per error code. Never include provider text, keys or request bodies. */
const AI_ERROR_MESSAGES = {
    invalid_key: 'Der API-Schlüssel wurde vom Anbieter abgelehnt.',
    model_not_found: 'Das Modell wurde beim Anbieter nicht gefunden.',
    unreachable: 'Der KI-Anbieter ist nicht erreichbar.',
    certificate: 'Das Zertifikat des KI-Anbieters wird nicht anerkannt. Prüft ein Virenscanner oder Proxy die HTTPS-Verbindung?',
    timeout: 'Der KI-Anbieter hat nicht rechtzeitig geantwortet.',
    rate_limited: 'Der KI-Anbieter nimmt gerade keine weiteren Anfragen an.',
    provider_error: 'Der KI-Anbieter hat einen Fehler gemeldet.',
    empty_answer: 'Der KI-Anbieter hat keine Antwort geliefert.',
};

/** Error of the AI layer; the message is always the fixed text of `code`. */
class AiError extends Error {
    /**
     * @param {keyof typeof AI_ERROR_MESSAGES} code
     * @param {{ status?: number, detail?: string }} [details] HTTP status and the code of a network cause
     *   (e.g. ECONNREFUSED) only, nothing from the request or response body
     */
    constructor(code, details = {}) {
        super(AI_ERROR_MESSAGES[code] || AI_ERROR_MESSAGES.provider_error);
        this.name = 'AiError';
        this.code = AI_ERROR_MESSAGES[code] ? code : 'provider_error';
        if (details.status !== undefined) this.status = details.status;
        if (details.detail) this.detail = details.detail;
    }
}

/** Maps an HTTP status of a failed provider answer to an AiError. */
function errorFromStatus(status) {
    if (status === 401 || status === 403) return new AiError('invalid_key', { status });
    if (status === 404) return new AiError('model_not_found', { status });
    if (status === 429) return new AiError('rate_limited', { status });
    return new AiError('provider_error', { status });
}

// TLS codes of a certificate the process does not trust: an antivirus or proxy
// that inspects HTTPS puts its own certificate in, which the OS trusts but Node not
const CERTIFICATE_CODES = new Set([
    'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_GET_ISSUER_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'CERT_UNTRUSTED', 'CERT_REJECTED', 'CERT_SIGNATURE_FAILURE', 'CERT_HAS_EXPIRED',
    'CERT_NOT_YET_VALID', 'ERR_TLS_CERT_ALTNAME_INVALID'
]);
const CERTIFICATE_HINT = 'Node vertraut dem Zertifikat nicht (Virenscanner oder Proxy prüft HTTPS?): DEMS mit node --use-system-ca starten oder NODE_EXTRA_CA_CERTS setzen.';

// The code of the network cause below a fetch error (a plain code only, never free text)
function causeCode(err) {
    let current = err;
    for (let depth = 0; current && depth < 4; depth++) {
        if (typeof current.code === 'string' && /^[A-Z][A-Z0-9_]{1,59}$/.test(current.code)) return current.code;
        current = current.cause;
    }
    return undefined;
}

/**
 * Maps an error thrown by fetch (or while reading the body) to an AiError.
 * The adapters rethrow a caller-initiated abort before calling this, so every
 * remaining abort is the timeout.
 */
function errorFromThrown(err) {
    if (err instanceof AiError) return err;
    if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) return new AiError('timeout');
    const detail = causeCode(err);
    return new AiError(CERTIFICATE_CODES.has(detail) ? 'certificate' : 'unreachable', { detail });
}

/**
 * One log line for a failed AI call: where, the error code, the HTTP status
 * and the network cause; never question, answer, prompt or key. A certificate
 * problem names the way out.
 *
 * @param {string} where -> Short German name of the caller (e.g. „Discord-Frage“).
 * @param {Error} err -> The failure.
 * @returns {void}
 */
function logAiFailure(where, err) {
    const parts = err instanceof AiError
        ? [err.code, err.status !== undefined ? `HTTP ${err.status}` : '', err.detail || ''].filter(Boolean)
        : [(err && err.name) || 'Error'];
    const hint = err instanceof AiError && err.code === 'certificate' ? ` – ${CERTIFICATE_HINT}` : '';
    console.warn(`KI-Anfrage fehlgeschlagen (${where}): ${parts.join(' ')}${hint}`);
}

module.exports = { AiError, AI_ERROR_MESSAGES, errorFromStatus, errorFromThrown, logAiFailure };
