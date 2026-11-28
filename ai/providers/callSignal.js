'use strict';

const DEFAULT_TIMEOUT_MS = 60000;

/**
 * The abort signal of one chat call: the total cap (`timeoutMs`), the caller's
 * own signal and, when `idleTimeoutMs` is set, an idle limit that aborts after that
 * long without a stream chunk. An idle abort carries a TimeoutError, so it ends
 * as `timeout` and not as a caller abort.
 *
 * `firstByteTimeoutMs` (optional, only with `idleTimeoutMs`) is the idle limit until the
 * first stream chunk: the provider processes the whole prompt before it sends one. It also
 * covers the wait after the response headers (`responded`). Without it the first chunk gets
 * `idleTimeoutMs` like every other one.
 *
 * @param {{ timeoutMs?: number, idleTimeoutMs?: number, firstByteTimeoutMs?: number, signal?: AbortSignal }} options
 * @returns {{ signal: AbortSignal, responded: () => void, touch: () => void, done: () => void }}
 *   `responded` restarts the idle timer when the headers arrive, `touch` restarts it per chunk, `done` clears it.
 */
function createCallSignal({ timeoutMs, idleTimeoutMs, firstByteTimeoutMs, signal }) {
    const signals = [AbortSignal.timeout(timeoutMs || DEFAULT_TIMEOUT_MS)];
    if (signal) signals.push(signal);
    const none = () => {};
    if (!idleTimeoutMs) return { signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0], responded: none, touch: none, done: none };

    const idle = new AbortController();
    signals.push(idle.signal);
    let timer = null;
    const restart = (ms) => {
        clearTimeout(timer);
        timer = setTimeout(() => idle.abort(new DOMException('idle', 'TimeoutError')), ms);
    };
    const firstWait = firstByteTimeoutMs || idleTimeoutMs;
    const done = () => clearTimeout(timer);
    restart(firstWait);
    return { signal: AbortSignal.any(signals), responded: () => restart(firstWait), touch: () => restart(idleTimeoutMs), done };
}

module.exports = { createCallSignal };
