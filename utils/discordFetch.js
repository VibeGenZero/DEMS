/**
 * Plain HTTP calls to the Discord REST API that are not bot calls: the OAuth2
 * login (routes/auth.js) and the check of the client id and secret in the
 * setup wizard (#138).
 */
const DISCORD_API = 'https://discord.com/api/v10';

// Transient network errors that are safe to retry
const RETRYABLE_CODES = new Set([
    'ERR_STREAM_PREMATURE_CLOSE',
    'ECONNRESET',
    'ETIMEDOUT',
    'EPIPE',
    'UND_ERR_SOCKET'
]);

/**
 * fetch with a small retry for transient connection errors
 * (e.g. Discord/Cloudflare closing the connection mid-response).
 *
 * @param {string} url -> Request URL.
 * @param {Object} [options] -> fetch options.
 * @param {number} [retries] -> Retries after a transient error.
 * @returns {Promise<Response>}
 */
async function discordFetch(url, options = {}, retries = 2) {
    for (let attempt = 0; ; attempt++) {
        try {
            return await fetch(url, options);
        } catch (err) {
            const code = err.code || err.errno || (err.cause && err.cause.code);
            if (attempt >= retries || !RETRYABLE_CODES.has(code)) {
                throw err;
            }
            console.warn(`Discord API request failed (${code}), retrying (${attempt + 1}/${retries})...`);
            await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
        }
    }
}

/**
 * Whether Discord accepts a client id and secret: an OAuth2 token request
 * with the client credentials grant, which Discord allows for the owner of
 * every application. The token is thrown away.
 *
 * @param {string} clientId -> Application (client) id.
 * @param {string} clientSecret -> Client secret.
 * @returns {Promise<{ ok: true }|{ ok: false, error: 'invalid_client'|'unreachable' }>}
 */
async function checkClientCredentials(clientId, clientSecret) {
    if (!clientId || !clientSecret) return { ok: false, error: 'invalid_client' };
    try {
        const res = await discordFetch(`${DISCORD_API}/oauth2/token`, {
            method: 'POST',
            headers: {
                Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'identify' })
        });
        if (res.ok) return { ok: true };
        if (res.status === 400 || res.status === 401) return { ok: false, error: 'invalid_client' };
        return { ok: false, error: 'unreachable' };
    } catch (err) {
        console.error('Discord-Prüfung der Client-Daten fehlgeschlagen:', err.message);
        return { ok: false, error: 'unreachable' };
    }
}

module.exports = { DISCORD_API, discordFetch, checkClientCredentials };
