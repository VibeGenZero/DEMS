/**
 * Discord look of an event announcement: draws the JSON of
 * POST /api/admin/events/preview (embed and button rows of discord.js).
 * Pure: no DOM, no fetch. Styles: block "DISCORD PREVIEW" in style.css.
 */
import { escapeHtml, renderMarkdownSafe } from '../core/ui.js';
import { avatar } from '../core/components.js';

// discord.js ButtonStyle -> class; 5 is a link button
const BUTTON_STYLES = { 1: 'is-primary', 2: 'is-secondary', 3: 'is-success', 4: 'is-danger', 5: 'is-link' };
const LINK_STYLE = 5;

/**
 * Colour of an embed.
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

function renderField(field) {
    const className = field?.inline ? 'discord-field' : 'discord-field is-wide';
    return `<div class="${className}"><div class="discord-field-name">${escapeHtml(String(field?.name ?? ''))}</div>`
        + `<div class="discord-field-value">${renderMarkdownSafe(String(field?.value ?? ''))}</div></div>`;
}

function renderButton(button) {
    const style = BUTTON_STYLES[button?.style] || 'is-secondary';
    const emoji = button?.emoji?.name ? `<span class="discord-button-emoji">${escapeHtml(String(button.emoji.name))}</span>` : '';
    const link = button?.style === LINK_STYLE ? '<i class="bi bi-box-arrow-up-right"></i>' : '';
    return `<span class="discord-button ${style}">${emoji}${escapeHtml(String(button?.label ?? ''))}${link}</span>`;
}

function renderEmbed(embed, footer) {
    const color = discordColor(embed.color);
    const fields = Array.isArray(embed.fields) && embed.fields.length > 0
        ? `<div class="discord-embed-fields">${embed.fields.map(renderField).join('')}</div>`
        : '';
    const image = embed.image?.url
        ? `<img class="discord-embed-image" src="${escapeHtml(String(embed.image.url))}" alt="" data-fallback="hide">`
        : '';
    return `<div class="discord-embed"${color ? ` data-style-border-color="${color}"` : ''}>`
        + (embed.title ? `<div class="discord-embed-title">${escapeHtml(String(embed.title))}</div>` : '')
        + (embed.description ? `<div class="discord-embed-description">${renderMarkdownSafe(String(embed.description))}</div>` : '')
        + fields + image + footer + '</div>';
}

/**
 * One Discord message with its embed and button rows.
 *
 * @param {Object} preview -> `{ embed, components, bot: { name, avatarUrl } }` of the preview route.
 * @param {Date} now -> Reference time for "Heute um …".
 * @returns {string} -> HTML of a div.discord-message; the embed colour sits in data-style-border-color (applyStyleData).
 */
export function renderDiscordMessage(preview, now) {
    const embed = preview?.embed || {};
    const botName = String(preview?.bot?.name || 'DEMS');
    const footerParts = [embed.footer?.text, embed.timestamp ? discordTime(embed.timestamp, now) : '']
        .filter(Boolean)
        .map(part => escapeHtml(String(part)));
    const footer = footerParts.length > 0 ? `<div class="discord-embed-footer">${footerParts.join(' • ')}</div>` : '';
    const rows = (Array.isArray(preview?.components) ? preview.components : [])
        .map(row => `<div class="discord-buttons">${(Array.isArray(row?.components) ? row.components : []).map(renderButton).join('')}</div>`)
        .join('');
    return '<div class="discord-message">'
        + avatar({ url: preview?.bot?.avatarUrl, name: botName })
        + '<div class="discord-message-body">'
        + `<div class="discord-message-header"><span class="discord-message-author">${escapeHtml(botName)}</span>`
        + `<span class="discord-app-tag">APP</span><span class="discord-message-time">${escapeHtml(discordTime(null, now))}</span></div>`
        + renderEmbed(embed, footer) + rows
        + '</div></div>';
}
