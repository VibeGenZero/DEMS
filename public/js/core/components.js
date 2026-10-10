/**
 * Markup helpers for the library components that need more than a class
 * name: avatar (image with initials fallback) and empty state. Styles:
 * public/css/components.css; examples: styleguide (#debug).
 */
import { escapeHtml } from './ui.js';

const AVATAR_SIZES = ['sm', 'lg', 'xl'];
const ICON_NAME = /^[a-z0-9-]+$/;

/**
 * Initials of a display name.
 *
 * @param {string} name -> Display name, e.g. from Discord.
 * @returns {string} -> First letters of the first two words in upper case, "?" for an empty name.
 */
export function initialsOf(name) {
    const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return '?';
    // Spread keeps an emoji or an accented letter in one piece
    return words.slice(0, 2).map(word => [...word][0].toUpperCase()).join('');
}

/**
 * Avatar markup: the image, or a tile with initials when there is no image.
 * A broken image turns into the same tile (data-fallback="initials").
 *
 * @param {Object} [options] -> Avatar data.
 * @param {string} [options.url] -> Image address.
 * @param {string} [options.name] -> Display name; used for initials, alt and title.
 * @param {string} [options.size] -> "sm" (24 px), "lg" (64 px), "xl" (96 px); default 36 px.
 * @returns {string} -> HTML of one element.
 */
export function avatar({ url, name, size } = {}) {
    const classes = `avatar${AVATAR_SIZES.includes(size) ? ` avatar-${size}` : ''}`;
    const label = escapeHtml(String(name ?? ''));
    const initials = escapeHtml(initialsOf(name));
    if (typeof url === 'string' && url.trim()) {
        return `<img class="${classes}" src="${escapeHtml(url)}" alt="${label}" title="${label}" data-fallback="initials" data-initials="${initials}">`;
    }
    return `<span class="${classes} avatar-initials" title="${label}">${initials}</span>`;
}

/**
 * Empty state: what a list shows instead of nothing.
 *
 * @param {Object} [options] -> Content.
 * @param {string} [options.icon] -> Bootstrap icon name without "bi-", e.g. "calendar-x".
 * @param {string} [options.title] -> Headline (plain text).
 * @param {string} [options.text] -> One explaining sentence (plain text).
 * @param {string} [options.action] -> Ready button HTML built by the caller. Inserted as it is, because action names must be literal in the markup; the caller escapes its values.
 * @returns {string} -> HTML of the block.
 */
export function emptyState({ icon = 'inbox', title, text = '', action = '' } = {}) {
    const iconName = ICON_NAME.test(icon) ? icon : 'inbox';
    const textHtml = text ? `<p class="empty-state-text">${escapeHtml(String(text))}</p>` : '';
    return `<div class="empty-state"><div class="empty-state-icon"><i class="bi bi-${iconName}"></i></div><h3 class="empty-state-title">${escapeHtml(String(title ?? ''))}</h3>${textHtml}${action}</div>`;
}
