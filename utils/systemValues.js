/**
 * Checks of the configuration values the setup wizard and the admin "System"
 * view store (#138), with the German messages both show. Pure, no database.
 */
const SNOWFLAKE = /^\d{17,20}$/;
const RESET_PASSWORD_MIN = 12;
const SERVER_NAME_MAX = 100;
const AI_MODEL_MAX = 200;
const AI_KEY_MAX = 500;
// 'mock' is allowed on top of these with DEV_MOCK=true (checked at call time)
const AI_PROVIDER_IDS = ['ollama', 'openrouter', 'openai', 'gemini', 'anthropic'];

const SYSTEM_VALUE_ERRORS = Object.freeze({
    BASE_URL: 'Die Adresse (BASE_URL) muss eine vollständige Adresse mit http:// oder https:// sein, z. B. https://events.example.org.',
    TIMEZONE: 'Unbekannte Zeitzone. Bitte eine IANA-Zeitzone wie Europe/Berlin angeben.',
    DISCORD_CLIENT_ID: 'Ungültige Client ID (17–20 Ziffern).',
    DISCORD_GUILD_ID: 'Ungültige Server-ID (17–20 Ziffern).',
    DISCORD_ADMIN_ROLE_ID: 'Ungültige ID für die Admin-Rolle.',
    DISCORD_ANNOUNCE_CHANNEL_ID: 'Ungültige ID für den Ankündigungskanal.',
    DISCORD_EVENT_CATEGORY_ID: 'Ungültige ID für die Kategorie der Event-Kanäle.',
    AI_PROVIDER: 'Unbekannter KI-Anbieter.',
    AI_BASE_URL: 'Die KI-Adresse muss mit http:// oder https:// beginnen.',
    ADMIN_RESET_PASSWORD: `Das Admin-Reset-Passwort braucht mindestens ${RESET_PASSWORD_MIN} Zeichen.`
});

// Login errors of bot/lifecycle.js#restartBot -> status and message naming the guide step
const BOT_LOGIN_ERRORS = Object.freeze({
    invalid_token: [400, 'Discord lehnt den Bot-Token ab. Erzeuge unter „Bot“ mit „Reset Token“ einen neuen und füge ihn ein (Schritt 3 der Anleitung).'],
    disallowed_intents: [400, 'Discord verweigert dem Bot die Anmeldung: Schalte im Developer Portal unter „Bot“ den „Server Members Intent“ ein und speichere (Schritt 3 der Anleitung). Danach erneut prüfen.']
});
const BOT_LOGIN_FAILED = [502, 'Der Bot konnte sich nicht bei Discord anmelden. Bitte versuche es noch einmal.'];

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * Normalize BASE_URL: absolute http(s), no credentials, query or fragment, no trailing slash.
 *
 * @param {string} raw -> Entered address.
 * @returns {string|null} -> Normalized address, null when invalid.
 */
function normalizeBaseUrl(raw) {
    try {
        const url = new URL(text(raw));
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
        return url.origin + url.pathname.replace(/\/+$/, '');
    } catch {
        return null;
    }
}

/** Whether Intl knows the IANA time zone. */
function isKnownTimezone(zone) {
    try {
        new Intl.DateTimeFormat('de-DE', { timeZone: zone });
        return true;
    } catch {
        return false;
    }
}

/**
 * Check and normalize one value before it is stored.
 *
 * @param {string} key -> Managed key (utils/systemConfig.js#MANAGED_KEYS).
 * @param {*} raw -> Submitted value.
 * @returns {{ value: string }|{ skip: true }|{ error: string }} -> `skip` = empty secret, keep the stored one.
 */
function normalizeSystemValue(key, raw) {
    const value = key === 'DISCORD_THREAD_SYNC' ? '' : text(raw);
    switch (key) {
        case 'BASE_URL': {
            const url = normalizeBaseUrl(value);
            return url ? { value: url } : { error: SYSTEM_VALUE_ERRORS.BASE_URL };
        }
        case 'TIMEZONE':
            if (value && !isKnownTimezone(value)) return { error: SYSTEM_VALUE_ERRORS.TIMEZONE };
            return { value };
        case 'SERVER_NAME':
            return { value: value.slice(0, SERVER_NAME_MAX) };
        case 'DISCORD_CLIENT_ID':
        case 'DISCORD_GUILD_ID':
        case 'DISCORD_ADMIN_ROLE_ID':
        case 'DISCORD_ANNOUNCE_CHANNEL_ID':
        case 'DISCORD_EVENT_CATEGORY_ID':
            return value && !SNOWFLAKE.test(value) ? { error: SYSTEM_VALUE_ERRORS[key] } : { value };
        case 'DISCORD_THREAD_SYNC':
            return { value: raw === true || raw === 'true' ? 'true' : '' };
        case 'ADMIN_RESET_PASSWORD':
            if (!value) return { skip: true };
            return value.length < RESET_PASSWORD_MIN ? { error: SYSTEM_VALUE_ERRORS.ADMIN_RESET_PASSWORD } : { value };
        case 'AI_PROVIDER':
            if (value && !AI_PROVIDER_IDS.includes(value) && !(value === 'mock' && process.env.DEV_MOCK === 'true')) return { error: SYSTEM_VALUE_ERRORS.AI_PROVIDER };
            return { value };
        case 'AI_BASE_URL': {
            // Provider docs show the address with a trailing slash (Ollama); the client adds its own paths
            const address = value.replace(/\/+$/, '');
            if (address && !/^https?:\/\/[^\s/]\S*$/i.test(address)) return { error: SYSTEM_VALUE_ERRORS.AI_BASE_URL };
            return { value: address };
        }
        case 'AI_MODEL':
        case 'AI_MODEL_ADMIN':
            return { value: value.slice(0, AI_MODEL_MAX) };
        case 'AI_API_KEY':
            return value ? { value: value.slice(0, AI_KEY_MAX) } : { skip: true };
        case 'DISCORD_CLIENT_SECRET':
        case 'DISCORD_BOT_TOKEN':
            return value ? { value } : { skip: true };
        default:
            return { error: `Der Wert ${key} kann hier nicht geändert werden.` };
    }
}

/**
 * Status and German message for a failed bot login.
 *
 * @param {string} code -> Error code of restartBot().
 * @returns {[number, string]}
 */
function botLoginError(code) {
    return BOT_LOGIN_ERRORS[code] || BOT_LOGIN_FAILED;
}

const sameAddress = (a, b) => String(a || '').trim().replace(/\/+$/, '') === String(b || '').trim().replace(/\/+$/, '');

/**
 * Whether a save must remove the stored AI key: a key belongs to the provider
 * and the address it was entered for, so changing either without typing a new
 * key drops it instead of sending it to the new host. Switching the AI off
 * (empty provider) removes it too.
 *
 * @param {Object} changes -> Normalized values about to be saved (an empty key is not in it).
 * @param {Object} [env] -> Current values (process.env).
 * @returns {boolean}
 */
function dropsStoredAiKey(changes, env = process.env) {
    if (Object.hasOwn(changes, 'AI_API_KEY') || !String(env.AI_API_KEY || '').trim()) return false;
    const changed = (key) => Object.hasOwn(changes, key) && !sameAddress(changes[key], env[key]);
    return changed('AI_PROVIDER') || changed('AI_BASE_URL');
}

module.exports = {
    SNOWFLAKE,
    RESET_PASSWORD_MIN,
    SYSTEM_VALUE_ERRORS,
    normalizeBaseUrl,
    isKnownTimezone,
    normalizeSystemValue,
    dropsStoredAiKey,
    botLoginError
};
