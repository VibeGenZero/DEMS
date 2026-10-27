/**
 * Discord look of an event announcement: draws the Components V2 message of
 * POST /api/admin/events/preview (container, text displays, sections with a
 * button, media gallery, separator, button rows of discord.js; B-05).
 * Pure: no DOM, no fetch. Styles: block "DISCORD PREVIEW" in style.css.
 */
import { escapeHtml, renderMarkdownSafe } from '../core/ui.js';
import { avatar } from '../core/components.js';

// discord.js ButtonStyle -> class; 5 is a link button
const BUTTON_STYLES = { 1: 'is-primary', 2: 'is-secondary', 3: 'is-success', 4: 'is-danger', 5: 'is-link' };
const LINK_STYLE = 5;
// discord.js ComponentType
const TYPE = { ROW: 1, BUTTON: 2, SECTION: 9, TEXT: 10, GALLERY: 12, SEPARATOR: 14, CONTAINER: 17 };

/**
 * Colour of a container.
 *
 * @param {number} value -> Colour as discord.js stores it (0xRRGGBB).
 * @returns {string} -> '#rrggbb', '' for anything else.
 */
export function discordColor(value) {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffff) return '';
    return `#${value.toString(16).padStart(6, '0')}`;
}

/**
 * Time as Discord shows it next to a message.
 *
 * @param {string|null} value -> ISO date; null for "now".
 * @param {Date} now -> Reference time.
 * @returns {string} -> "Heute um 18:05", another day "01.12.2026 18:05", '' for an unreadable date.
 */
export function discordTime(value, now) {
    const date = value ? new Date(value) : now;
    if (Number.isNaN(date.getTime())) return '';
    const time = date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    if (date.toDateString() === now.toDateString()) return `Heute um ${time}`;
    return `${date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })} ${time}`;
}

const listOf = (value) => (Array.isArray(value) ? value : []);

function renderButton(button) {
    const style = BUTTON_STYLES[button?.style] || 'is-secondary';
    const emoji = button?.emoji?.name ? `<span class="discord-button-emoji">${escapeHtml(String(button.emoji.name))}</span>` : '';
    const link = button?.style === LINK_STYLE ? '<i class="bi bi-box-arrow-up-right"></i>' : '';
    return `<span class="discord-button ${style}">${emoji}${escapeHtml(String(button?.label ?? ''))}${link}</span>`;
}

function renderText(component) {
    // Discord keeps single line breaks; Markdown needs two trailing spaces for that
    const content = String(component?.content ?? '').replace(/\n/g, '  \n');
    return `<div class="discord-text">${renderMarkdownSafe(content)}</div>`;
}

function renderGallery(component) {
    const images = listOf(component.items)
        .filter(item => item?.media?.url)
        .map(item => `<img class="discord-gallery-image" src="${escapeHtml(String(item.media.url))}" alt="" data-fallback="hide">`)
        .join('');
    return `<div class="discord-gallery">${images}</div>`;
}

function renderSection(component) {
    const texts = listOf(component.components).map(renderText).join('');
    const accessory = component.accessory?.type === TYPE.BUTTON ? renderButton(component.accessory) : '';
    return `<div class="discord-section"><div class="discord-section-text">${texts}</div>${accessory}</div>`;
}

function renderContainer(component) {
    const color = discordColor(component.accent_color);
    return `<div class="discord-container"${color ? ` data-style-border-color="${color}"` : ''}>`
        + listOf(component.components).map(renderComponent).join('')
        + '</div>';
}

/**
 * HTML of one V2 component; unknown types draw nothing.
 *
 * @param {Object} component -> Component JSON.
 * @returns {string} -> HTML.
 */
function renderComponent(component) {
    switch (component?.type) {
    case TYPE.CONTAINER: return renderContainer(component);
    case TYPE.TEXT: return renderText(component);
    case TYPE.SECTION: return renderSection(component);
    case TYPE.GALLERY: return renderGallery(component);
    case TYPE.SEPARATOR: return '<hr class="discord-separator">';
    case TYPE.ROW: return `<div class="discord-buttons">${listOf(component.components).map(renderButton).join('')}</div>`;
    default: return '';
    }
}

/**
 * One Discord message with its Components V2 content.
 *
 * @param {Object} preview -> `{ message: { components }, bot: { name, avatarUrl } }` of the preview route.
 * @param {Date} now -> Reference time for "Heute um …".
 * @returns {string} -> HTML of a div.discord-message; the container colour sits in data-style-border-color (applyStyleData).
 */
export function renderDiscordMessage(preview, now) {
    const botName = String(preview?.bot?.name || 'DEMS');
    return '<div class="discord-message">'
        + avatar({ url: preview?.bot?.avatarUrl, name: botName })
        + '<div class="discord-message-body">'
        + `<div class="discord-message-header"><span class="discord-message-author">${escapeHtml(botName)}</span>`
        + `<span class="discord-app-tag">APP</span><span class="discord-message-time">${escapeHtml(discordTime(null, now))}</span></div>`
        + listOf(preview?.message?.components).map(renderComponent).join('')
        + '</div></div>';
}
