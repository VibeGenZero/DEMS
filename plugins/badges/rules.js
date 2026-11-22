/**
 * Rules of the official plugin „Badges“: input checks, counting, due awards
 * and message texts. Pure (no I/O, no requires), so server, engine and tests
 * share one definition.
 *
 * Teilnahme = the member's own registration `accepted` for an event with
 * status `archived`. Check-in = the member's own registration with
 * `checkedIn === true` for an event that is not `cancelled`. A rule with a
 * category counts only events with exactly that `category`.
 */

/** Bootstrap Icons an admin can pick; each one is checked against the vendored font in a test. */
const ICONS = Object.freeze([
    'bi-award', 'bi-award-fill', 'bi-trophy', 'bi-trophy-fill', 'bi-star', 'bi-star-fill', 'bi-stars', 'bi-gem',
    'bi-shield', 'bi-shield-fill', 'bi-shield-check', 'bi-heart', 'bi-heart-fill', 'bi-fire', 'bi-lightning',
    'bi-lightning-fill', 'bi-rocket', 'bi-rocket-takeoff', 'bi-controller', 'bi-joystick', 'bi-dice-5', 'bi-flag',
    'bi-flag-fill', 'bi-bookmark-star', 'bi-patch-check', 'bi-patch-check-fill', 'bi-gift', 'bi-music-note-beamed',
    'bi-mic', 'bi-camera-video', 'bi-brush', 'bi-palette', 'bi-compass', 'bi-map', 'bi-binoculars', 'bi-bullseye',
    'bi-hourglass-split', 'bi-calendar-check', 'bi-people-fill', 'bi-person-heart', 'bi-hand-thumbs-up',
    'bi-emoji-smile', 'bi-cup-hot', 'bi-balloon', 'bi-tree', 'bi-sun', 'bi-moon-stars', 'bi-snow', 'bi-lightbulb',
    'bi-puzzle', 'bi-infinity', 'bi-magic'
]);

const MAX_BADGES = 100;
const NAME_MAX = 40;
const DESCRIPTION_MAX = 200;
const CATEGORY_MAX = 80;
const COUNT_MIN = 1;
const COUNT_MAX = 1000;
const RULE_TYPES = ['manual', 'participations', 'checkins'];
const COLOR = /^#[0-9a-fA-F]{6}$/;
const SNOWFLAKE = /^\d{17,20}$/;

const ERRORS = Object.freeze({
    invalid: 'Ungültige Eingabe.',
    name: `Der Name muss 1 bis ${NAME_MAX} Zeichen lang sein.`,
    description: `Die Beschreibung darf höchstens ${DESCRIPTION_MAX} Zeichen lang sein.`,
    icon: 'Bitte wähle ein Icon aus der Liste.',
    color: 'Bitte wähle eine gültige Farbe.',
    rule: 'Bitte wähle, wie das Badge vergeben wird.',
    count: `Die Anzahl muss zwischen ${COUNT_MIN} und ${COUNT_MAX} liegen.`,
    category: `Die Kategorie darf höchstens ${CATEGORY_MAX} Zeichen lang sein.`,
    role: 'Diese Rolle kann das Plugin nicht vergeben.'
});

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = error => ({ ok: false, error });

/** The rule part of a badge input, or an error. */
function validateRule(raw) {
    if (!isPlainObject(raw) || !RULE_TYPES.includes(raw.type)) return fail(ERRORS.rule);
    if (raw.type === 'manual') return { ok: true, value: { type: 'manual' } };
    if (!Number.isInteger(raw.count) || raw.count < COUNT_MIN || raw.count > COUNT_MAX) return fail(ERRORS.count);
    const category = raw.category === undefined || raw.category === null ? '' : raw.category;
    if (typeof category !== 'string' || category.trim().length > CATEGORY_MAX) return fail(ERRORS.category);
    return { ok: true, value: { type: raw.type, count: raw.count, category: category.trim() || null } };
}

/**
 * Check and normalize what an admin sends for a badge.
 *
 * @param {unknown} input -> `{ name, description?, icon, color, rule, roleId? }`.
 * @returns {{ ok: true, value: { name: string, description: string, icon: string, color: string, rule: object, roleId: string|null } }
 *   | { ok: false, error: string }} -> `error` is German and names the first problem.
 */
function validateBadge(input) {
    if (!isPlainObject(input)) return fail(ERRORS.invalid);
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (name.length < 1 || name.length > NAME_MAX) return fail(ERRORS.name);
    const description = input.description === undefined || input.description === null ? '' : input.description;
    if (typeof description !== 'string' || description.trim().length > DESCRIPTION_MAX) return fail(ERRORS.description);
    if (!ICONS.includes(input.icon)) return fail(ERRORS.icon);
    if (typeof input.color !== 'string' || !COLOR.test(input.color)) return fail(ERRORS.color);
    const rule = validateRule(input.rule);
    if (!rule.ok) return rule;
    const roleId = input.roleId === undefined || input.roleId === null || input.roleId === '' ? null : input.roleId;
    if (roleId !== null && (typeof roleId !== 'string' || !SNOWFLAKE.test(roleId))) return fail(ERRORS.role);
    return {
        ok: true,
        value: { name, description: description.trim(), icon: input.icon, color: input.color.toLowerCase(), rule: rule.value, roleId }
    };
}

/**
 * How a badge is awarded, in German.
 *
 * @param {{ type: string, count?: number, category?: string|null }} rule
 * @returns {string} -> e.g. „Von Hand“, „Ab 10 Teilnahmen · Raid“, „Ab 1 Check-in“.
 */
function ruleText(rule) {
    if (!rule || rule.type === 'manual') return 'Von Hand';
    const one = rule.count === 1;
    const noun = rule.type === 'checkins' ? (one ? 'Check-in' : 'Check-ins') : (one ? 'Teilnahme' : 'Teilnahmen');
    const text = `Ab ${rule.count} ${noun}`;
    return rule.category ? `${text} · ${rule.category}` : text;
}

/** Whether a registration counts for a rule, given its event. */
function counts(rule, registration, event) {
    if (!event || (rule.category && event.category !== rule.category)) return false;
    if (rule.type === 'participations') return registration.status === 'accepted' && event.status === 'archived';
    if (rule.type === 'checkins') return registration.checkedIn === true && event.status !== 'cancelled';
    return false;
}

/**
 * How many of one member's registrations count for a rule.
 *
 * @param {{ type: string, category?: string|null }} rule
 * @param {Array<{ eventId: string, status: string, checkedIn: boolean }>} registrations -> One member's registrations.
 * @param {Map<string, { status: string, category?: string }>} eventsById
 * @returns {number}
 */
function countFor(rule, registrations, eventsById) {
    return registrations.filter(registration => counts(rule, registration, eventsById.get(registration.eventId))).length;
}

/** Document id of the award of one badge to one member (one per pair, so a repeat overwrites). */
const awardId = (badgeId, userId) => `${badgeId}_${userId}`;

/** An award that was not revoked. */
const isActive = award => !award.revokedAt;

/** Share of a rule a member has reached, 0–1. */
const progressFor = (rule, count) => Math.min(1, count / rule.count);

/**
 * Awards that rule badges are due for: count reached and no award (active or revoked) yet.
 *
 * @param {object} input
 * @param {object[]} input.badges -> Stored badges with `id` and `rule`.
 * @param {object[]} input.awards -> Stored awards (`badgeId`, `userId`, `revokedAt`).
 * @param {object[]} input.registrations -> Registrations in the `ctx.registrations` shape.
 * @param {object[]} input.events -> Events with `id`, `status`, `category`.
 * @param {string[]|null} [input.userIds] -> Only these members; null = every member with a registration.
 * @returns {Array<{ badgeId: string, userId: string }>} -> Badge order, then members in order of their first registration.
 */
function dueAwards({ badges, awards, registrations, events, userIds = null }) {
    const eventsById = new Map(events.map(event => [event.id, event]));
    const byUser = new Map();
    for (const registration of registrations) {
        if (userIds && !userIds.includes(registration.userId)) continue;
        if (!byUser.has(registration.userId)) byUser.set(registration.userId, []);
        byUser.get(registration.userId).push(registration);
    }
    const existing = new Set(awards.map(award => awardId(award.badgeId, award.userId)));
    const due = [];
    for (const badge of badges) {
        if (!badge.rule || badge.rule.type === 'manual') continue;
        for (const [userId, own] of byUser) {
            if (existing.has(awardId(badge.id, userId))) continue;
            if (countFor(badge.rule, own, eventsById) >= badge.rule.count) due.push({ badgeId: badge.id, userId });
        }
    }
    return due;
}

/** Discord markdown characters escaped, so a name cannot format or break a message. */
const escapeMarkdown = text => String(text).replace(/[\\*_~`|]/g, character => `\\${character}`);

/** DM text for a new badge. */
const awardDm = badge => `Du hast das Badge **${escapeMarkdown(badge.name)}** erhalten!`;

/** Channel post for a new badge (display name, no mention). */
const awardPost = (memberName, badge) => `**${escapeMarkdown(memberName)}** hat das Badge **${escapeMarkdown(badge.name)}** erhalten.`;

module.exports = {
    ICONS,
    MAX_BADGES,
    ERRORS,
    validateBadge,
    ruleText,
    countFor,
    awardId,
    isActive,
    progressFor,
    dueAwards,
    awardDm,
    awardPost
};
