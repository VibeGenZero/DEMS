/**
 * Shared pieces of the Components V2 messages (B-05): the container colour,
 * the text budget, the ping line above an announcement and the counters that
 * check Discord's limits. Pure: no client, no database.
 */
const { ComponentType } = require('discord.js');

// D-02 accent; containers of events without an own colour use it
const DEMS_ACCENT = 0x8b5cf6;
// Discord: at most 40 components (nested ones count) and 4000 characters of text per message
const MESSAGE_COMPONENTS_MAX = 40;
const MESSAGE_TEXT_MAX = 4000;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * Container accent of an event.
 *
 * @param {*} color -> Event colour, e.g. '#f59e0b'.
 * @returns {number} -> The colour as 0xRRGGBB, DEMS_ACCENT for anything that is not '#rrggbb'.
 */
function toAccentColor(color) {
    return typeof color === 'string' && HEX_COLOR.test(color) ? parseInt(color.slice(1), 16) : DEMS_ACCENT;
}

/**
 * Text cut to a maximum length.
 *
 * @param {string} [text] -> Any text.
 * @param {number} max -> Maximum length in UTF-16 units.
 * @returns {string} -> The text, or its start and "…"; '' for no text.
 */
function fitText(text, max) {
    if (!text) return '';
    if (text.length <= max) return text;
    if (max <= 0) return '';
    let cut = text.slice(0, max - 1);
    // A cut through an emoji would leave half a character
    if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
    return `${cut}…`;
}

/**
 * Ping line above an announcement: role mentions, @everyone, the admin's text.
 *
 * @param {Object} [options] -> `{ text, roleIds, pingEveryone }` from the announce dialog.
 * @returns {string} -> Lines joined with "\n"; '' when there is nothing to show.
 */
function buildAnnouncementIntro({ text = '', roleIds = [], pingEveryone = false } = {}) {
    const lines = [];
    const roles = Array.isArray(roleIds) ? roleIds.filter(id => typeof id === 'string' && id) : [];
    if (roles.length > 0) lines.push(roles.map(id => `<@&${id}>`).join(' '));
    if (pingEveryone) lines.push('@everyone');
    if (typeof text === 'string' && text.trim()) lines.push(text.trim());
    return lines.join('\n');
}

/** JSON of a builder or the value itself. */
function toJson(component) {
    return component && typeof component.toJSON === 'function' ? component.toJSON() : component;
}

/** Every component of a payload with its nested ones, depth first. */
function flatten(components) {
    const all = [];
    for (const raw of components || []) {
        const component = toJson(raw);
        if (!component) continue;
        all.push(component);
        if (Array.isArray(component.components)) all.push(...flatten(component.components));
        if (component.accessory) all.push(component.accessory);
    }
    return all;
}

/**
 * Number of components as Discord counts them (nested ones included).
 *
 * @param {Object} payload -> `{ components }` of a message.
 * @returns {number} -> Count to compare with MESSAGE_COMPONENTS_MAX.
 */
function countComponents(payload) {
    return flatten(payload?.components).length;
}

/**
 * Characters over all text displays of a message.
 *
 * @param {Object} payload -> `{ components }` of a message.
 * @returns {number} -> Count to compare with MESSAGE_TEXT_MAX.
 */
function textLength(payload) {
    return flatten(payload?.components)
        .filter(component => component.type === ComponentType.TextDisplay)
        .reduce((sum, component) => sum + String(component.content || '').length, 0);
}

module.exports = {
    DEMS_ACCENT,
    MESSAGE_COMPONENTS_MAX,
    MESSAGE_TEXT_MAX,
    toAccentColor,
    fitText,
    buildAnnouncementIntro,
    countComponents,
    textLength
};
