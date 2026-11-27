'use strict';

const DEFAULT_TIMEOUT_MS = 60000;

/**
 * The abort signal of one chat call: the total cap (`timeoutMs`), the caller's
 * own signal and, when `idleTimeoutMs` is set, an idle limit that aborts after that
 * long without a stream chunk. An idle abort carries a TimeoutError, so it ends
 * as `timeout` and not as a caller abort.
 *
 * @param {{ timeoutMs?: number, idleTimeoutMs?: number, signal?: AbortSignal }} options
 * @returns {{ signal: AbortSignal, touch: () => void, done: () => void }}
 *   `touch` restarts the idle timer (call it per chunk), `done` clears it.
 */
function createCallSignal({ timeoutMs, idleTimeoutMs, signal }) {
    const signals = [AbortSignal.timeout(timeoutMs || DEFAULT_TIMEOUT_MS)];
    if (signal) signals.push(signal);
    if (!idleTimeoutMs) return { signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0], touch() {}, done() {} };

    const idle = new AbortController();
    signals.push(idle.signal);
    let timer = null;
    const touch = () => {
        clearTimeout(timer);
        timer = setTimeout(() => idle.abort(new DOMException('idle', 'TimeoutError')), idleTimeoutMs);
    };
    const done = () => clearTimeout(timer);
    touch();
    return { signal: AbortSignal.any(signals), touch, done };
}

module.exports = { createCallSignal };
