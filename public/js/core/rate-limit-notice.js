/**
 * The general /api limiter refused a request (429): one toast with the
 * server's sentence (it names the wait), at most every 30 seconds, instead of
 * the page silently doing nothing. Installed once by finishLoading(); every
 * module keeps calling fetch as before and still gets the response.
 */
import { showToast } from './ui.js';

const QUIET_MS = 30000;
const FALLBACK = 'Zu viele Anfragen. Bitte warte einen Moment und versuche es dann erneut.';

let installed = false;
let lastShown = 0;

const pathOf = (input) => String(typeof input === 'string' ? input : (input && input.url) || '').replace(/^https?:\/\/[^/]+/, '');

async function notify(res) {
    const now = Date.now();
    if (now - lastShown < QUIET_MS) return;
    lastShown = now;
    let message = FALLBACK;
    try {
        // A copy: the caller may read the body itself
        const data = await (typeof res.clone === 'function' ? res.clone() : res).json();
        if (data && typeof data.error === 'string' && data.error) message = data.error;
    } catch {
        // No JSON: the general sentence
    }
    showToast(message, 'warning');
}

/**
 * Wrap window.fetch once so a 429 of /api/* tells the user how long to wait.
 *
 * @returns {void}
 */
export function installRateLimitNotice() {
    if (installed || typeof window.fetch !== 'function') return;
    installed = true;
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
        const res = await original(input, init);
        if (res && res.status === 429 && pathOf(input).startsWith('/api/')) await notify(res);
        return res;
    };
}
