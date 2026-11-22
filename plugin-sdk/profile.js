/**
 * Plugin badges on the member's profile (`ctx.profile.badges`, SDK 1.1).
 *
 * `GET /api/user/profile` asks every switched-on plugin that registered a
 * provider, all at once and each with a time limit, so a slow or broken
 * plugin can never hold or break the profile. Every answer is checked and
 * copied field by field: the browser gets plain data in the shape of the
 * built-in badges, which `renderBadgeList` escapes.
 */

const DEFAULT_TIMEOUT_MS = 2000;
const MAX_BADGES = 50;
const ID_PATTERN = /^[a-zA-Z0-9-]{1,40}$/;
const ICON_PATTERN = /^bi-[a-z0-9-]+$/;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const NAME_MAX = 40;
const DESCRIPTION_MAX = 200;

const seconds = ms => String(ms / 1000).replace('.', ',');
const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * One checked copy of a provider's entry, or null when any field is invalid.
 *
 * @param {string} pluginId
 * @param {unknown} raw
 * @returns {object|null}
 */
function toBadge(pluginId, raw) {
    if (!isPlainObject(raw)) return null;
    const { id, icon, color, unlocked, progress } = raw;
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) return null;
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (name.length < 1 || name.length > NAME_MAX) return null;
    const description = raw.description === undefined ? '' : raw.description;
    if (typeof description !== 'string' || description.length > DESCRIPTION_MAX) return null;
    if (typeof icon !== 'string' || !ICON_PATTERN.test(icon)) return null;
    if (color !== undefined && (typeof color !== 'string' || !COLOR_PATTERN.test(color))) return null;
    if (typeof unlocked !== 'boolean') return null;
    if (progress !== undefined && (typeof progress !== 'number' || !Number.isFinite(progress) || progress < 0 || progress > 1)) return null;

    const badge = { id: `p:${pluginId}:${id}`, name, description, icon };
    if (color !== undefined) badge.color = color;
    badge.unlocked = unlocked;
    if (progress !== undefined) badge.progress = progress;
    return badge;
}

/**
 * Check a provider's answer.
 *
 * @param {string} pluginId -> The plugin that answered (prefix of every id).
 * @param {unknown} raw -> What the provider returned.
 * @returns {{ badges: object[], dropped: number }} -> At most 50 valid copies; `dropped` counts invalid entries
 *   (an answer that is no list counts as one).
 */
function validatePluginBadges(pluginId, raw) {
    if (!Array.isArray(raw)) return { badges: [], dropped: 1 };
    const badges = [];
    let dropped = 0;
    for (const entry of raw) {
        if (badges.length >= MAX_BADGES) break;
        const badge = toBadge(pluginId, entry);
        if (badge) badges.push(badge);
        else dropped += 1;
    }
    return { badges, dropped };
}

/** The provider's answer, or a rejection after `timeoutMs`. */
function withTimeout(promise, timeoutMs) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Profil-Badges haben nicht innerhalb von ${seconds(timeoutMs)} s geantwortet.`)), timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Badges of every provider for one member, in provider order.
 *
 * @param {object} options
 * @param {string} options.userId -> The member whose profile is shown.
 * @param {Array<{ id: string, provider: Function }>} options.providers -> From the plugin host (`profileProviders()`).
 * @param {number} [options.timeoutMs=2000] -> Time limit per provider.
 * @param {(pluginId: string, message: string) => void} [options.onError] -> Gets throws, timeouts and non-list answers.
 * @returns {Promise<object[]>} -> Never rejects.
 */
async function collectPluginBadges({ userId, providers, timeoutMs = DEFAULT_TIMEOUT_MS, onError = () => {} }) {
    const report = (id, message) => {
        console.error(`[plugin:${id}] Profil-Badges: ${message}`);
        try {
            onError(id, message);
        } catch (err) {
            console.error(`[plugin:${id}] Error reporter failed:`, err);
        }
    };
    const answers = await Promise.all((providers || []).map(async ({ id, provider }) => {
        try {
            const raw = await withTimeout(Promise.resolve().then(() => provider({ userId })), timeoutMs);
            if (!Array.isArray(raw)) {
                report(id, 'Profil-Badges müssen eine Liste sein.');
                return [];
            }
            const { badges, dropped } = validatePluginBadges(id, raw);
            if (dropped > 0) console.warn(`[plugin:${id}] ${dropped} ungültige Profil-Badges ausgelassen.`);
            return badges;
        } catch (err) {
            report(id, err && err.message ? err.message : String(err));
            return [];
        }
    }));
    return answers.flat();
}

module.exports = { validatePluginBadges, collectPluginBadges, DEFAULT_TIMEOUT_MS };
