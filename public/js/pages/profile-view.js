/**
 * Markup of the profile page (#profile): pure functions that turn the answer
 * of GET /api/user/profile into HTML. No DOM access and no fetch, so the
 * tests call them directly. Styles: PROFILE SECTION in style.css; date tile,
 * chips, avatar, skeleton and the progress bar come from components.css.
 */
import { avatar } from '../core/components.js';
import { escapeHtml } from '../core/ui.js';
import { eventStart, renderDateTile, renderEventWhen, renderStatusChip } from '../events/cards.js';
import { formatOfferDeadline } from '../events/offer.js';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const ICON_CLASS = /^bi-[a-z0-9-]+$/;
// Chip of a history row per registration status; cancelled events and check-ins come first (historyChip)
const HISTORY_LABELS = { accepted: 'Teilgenommen', rejected: 'Abgelehnt', waitlisted: 'Warteliste', pending: 'Nicht bestätigt', tentative: 'Vielleicht' };
const CHECKED_IN = { tone: 'success', icon: 'qr-code-scan' };

/**
 * A small chip.
 *
 * @param {string} label -> Text, already escaped by the caller.
 * @param {Object} [options] -> `tone`: success, warning, danger, info or accent; `icon`: Bootstrap icon name without "bi-".
 * @returns {string} -> HTML of one chip.
 */
function chip(label, { tone = '', icon = '' } = {}) {
    return `<span class="chip chip-sm${tone ? ` chip-${tone}` : ''}">${icon ? `<i class="bi bi-${icon}"></i>` : ''}${label}</span>`;
}

/**
 * Chip for the slot of a registration.
 *
 * @param {Object|null} slot -> `{ name, emoji, wish }` of a profile entry.
 * @returns {string} -> The slot's emoji and name, e.g. "Tank"; for a wish "Wunsch: Tank"; empty without a named slot.
 */
function slotChip(slot) {
    if (!slot || !slot.name) return '';
    const label = `${slot.emoji ? `${escapeHtml(String(slot.emoji))} ` : ''}${escapeHtml(String(slot.name))}`;
    return chip(slot.wish ? `Wunsch: ${label}` : label);
}

/**
 * Profile card: avatar, name, handle and three numbers.
 *
 * @param {Object} user -> Session user (`displayName`, `username`, `avatar`).
 * @param {Object|null} stats -> `stats` of the profile answer; null while it loads or after an error shows dashes.
 * @returns {string} -> HTML for #profile-card.
 */
export function renderProfileCard(user, stats) {
    const numbers = [['Anmeldungen', 'total'], ['Teilnahmen', 'accepted'], ['Check-ins', 'checkedIn']];
    const cells = numbers.map(([label, key]) => {
        const value = stats ? Math.max(0, Math.floor(Number(stats[key]) || 0)) : '–';
        return `<div class="profile-number"><dt>${label}</dt><dd>${value}</dd></div>`;
    }).join('');
    return '<div class="profile-card-head">'
        + avatar({ url: user?.avatar, name: user?.displayName, size: 'lg' })
        + `<div class="profile-card-names"><div class="profile-name">${escapeHtml(String(user?.displayName ?? ''))}</div>`
        + `<div class="profile-handle">@${escapeHtml(String(user?.username ?? ''))}</div></div></div>`
        + `<dl class="profile-numbers">${cells}</dl>`;
}

/**
 * Row of "Kommende Events": date tile, title, time line with the place, chips,
 * and on the right an arrow or the check-in button.
 *
 * @param {Object} entry -> Entry of `upcoming` (with `event`).
 * @param {Date} now -> Reference time for "Heute" and "Läuft gerade".
 * @param {boolean} canOpen -> Whether the user may open the event page; false renders no link and nothing to click.
 * @returns {string} -> HTML of one .profile-event.
 */
export function renderUpcomingRow(entry, now, canOpen) {
    const event = entry.event || {};
    const rejected = entry.status === 'rejected';
    const checkedIn = entry.status === 'accepted' && entry.checkedIn === true;
    const checkinOpen = entry.status === 'accepted' && !checkedIn && event.checkinEnabled === true;

    // Own place on the waitlist (W-05)
    const place = entry.status === 'waitlisted' && entry.waitlistPosition;
    // An open waitlist offer names its deadline (B-15)
    const until = entry.status === 'offered' ? formatOfferDeadline(entry.offerExpiresAt) : '';
    let status = renderStatusChip(entry.status, place
        ? `Warteliste · Platz ${place.position} von ${place.total}`
        : (until ? `Platz angeboten · bis ${until}` : undefined));
    if (checkedIn) status = chip('Eingecheckt', CHECKED_IN);
    if (rejected) status = chip('Abgelehnt', { tone: 'danger', icon: 'x-circle' });

    let action = '';
    if (canOpen && checkinOpen) action = '<span class="btn btn-accent btn-sm profile-event-action"><i class="bi bi-qr-code-scan me-1"></i>Einchecken</span>';
    else if (canOpen) action = '<i class="bi bi-chevron-right profile-event-action" aria-hidden="true"></i>';

    const inner = renderDateTile(event, now)
        + `<div class="profile-event-body"><h4 class="profile-event-title">${escapeHtml(String(event.title ?? ''))}</h4>`
        + renderEventWhen(event, now, event.location)
        + `<div class="profile-event-facts">${status}${rejected ? '' : slotChip(entry.slot)}</div></div>`
        + action;
    const classes = `glass-card profile-event${rejected ? ' is-muted' : ''}`;
    return canOpen
        ? `<a class="${classes}" href="#event/${escapeHtml(String(event.id ?? ''))}">${inner}</a>`
        : `<div class="${classes}">${inner}</div>`;
}

/**
 * Chip of a history row; the first matching case wins.
 *
 * @param {Object} entry -> Entry of `history`.
 * @returns {string} -> "Abgesagt", "Eingecheckt", or the label of the registration status; empty for an unknown status.
 */
function historyChip(entry) {
    if (entry.event && entry.event.status === 'cancelled') return chip('Abgesagt');
    if (entry.status === 'accepted' && entry.checkedIn === true) return chip('Eingecheckt', CHECKED_IN);
    return Object.hasOwn(HISTORY_LABELS, entry.status) ? chip(HISTORY_LABELS[entry.status]) : '';
}

/**
 * Day shown in a history row.
 *
 * @param {Object} entry -> Entry of `history`.
 * @returns {string} -> "06. Okt. 2026" for the start of the event, for a deleted event the day of the registration; "–" without a readable date.
 */
function historyDay(entry) {
    const date = eventStart({ startDate: entry.event ? entry.event.startDate : entry.createdAt });
    return date ? date.toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' }) : '–';
}

/**
 * Row of "Verlauf": day, title and one chip.
 *
 * @param {Object} entry -> Entry of `history`; `event` is null for a deleted event.
 * @param {boolean} canOpen -> Whether the user may open the event page.
 * @returns {string} -> HTML of one .profile-history-row, a link when the event exists and can be opened.
 */
export function renderHistoryRow(entry, canOpen) {
    const title = entry.event
        ? escapeHtml(String(entry.event.title ?? ''))
        : '<span class="text-muted">Gelöschtes Event</span>';
    const inner = `<span class="profile-history-date">${historyDay(entry)}</span>`
        + `<span class="profile-history-title">${title}</span>${historyChip(entry)}`;
    return canOpen && entry.event
        ? `<a class="profile-history-row" href="#event/${escapeHtml(String(entry.event.id ?? ''))}">${inner}</a>`
        : `<div class="profile-history-row">${inner}</div>`;
}

/**
 * Badge list: reached badges first, each with icon, name and rule; open ones
 * with a bar when they carry a progress value.
 *
 * @param {Array<Object>} badges -> `badges` of the profile answer.
 * @returns {string} -> `<li>` rows for #profile-badges; call applyStyleData() afterwards, it sets the colour of reached badges.
 */
export function renderBadgeList(badges) {
    const list = Array.isArray(badges) ? badges : [];
    const ordered = [...list.filter(badge => badge.unlocked), ...list.filter(badge => !badge.unlocked)];
    return ordered.map(badge => {
        const icon = ICON_CLASS.test(badge.icon) ? badge.icon : 'bi-award';
        const colour = badge.unlocked && HEX_COLOR.test(badge.color) ? ` data-style-color="${badge.color}"` : '';
        const rule = escapeHtml(String(badge.description ?? ''));
        const progress = !badge.unlocked && typeof badge.progress === 'number'
            ? `<progress class="capacity-meter" max="100" value="${Math.round(Math.min(1, Math.max(0, badge.progress)) * 100)}" aria-label="Fortschritt: ${rule}"></progress>`
            : '';
        return `<li class="badge-row${badge.unlocked ? '' : ' is-locked'}">`
            + `<span class="badge-row-icon"${colour}><i class="bi ${icon}"></i></span>`
            + `<div class="badge-row-body"><div class="badge-row-name">${escapeHtml(String(badge.name ?? ''))}</div>`
            + `<div class="badge-row-rule">${rule}</div>${progress}</div></li>`;
    }).join('');
}

/**
 * Placeholder rows of "Kommende Events" while the profile loads.
 *
 * @param {number} count -> Number of rows.
 * @returns {string} -> HTML of `count` skeleton rows in the row layout.
 */
export function renderProfileSkeleton(count) {
    const row = '<div class="glass-card profile-event" aria-hidden="true">'
        + '<div class="skeleton event-card-skeleton-date"></div>'
        + '<div class="profile-event-body"><div class="skeleton skeleton-title"></div><div class="skeleton skeleton-text is-short"></div></div>'
        + '</div>';
    return row.repeat(count);
}

/**
 * Placeholder rows of the badge list while the profile loads.
 *
 * @param {number} count -> Number of rows.
 * @returns {string} -> HTML of `count` skeleton rows.
 */
export function renderBadgeSkeleton(count) {
    const row = '<li class="badge-row" aria-hidden="true"><span class="skeleton skeleton-avatar"></span>'
        + '<div class="badge-row-body"><div class="skeleton skeleton-text is-short"></div></div></li>';
    return row.repeat(count);
}
