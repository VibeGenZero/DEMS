/**
 * Markup of the member overview (#members and #member/<id>, W-15). Pure
 * functions that turn the answers of GET /api/admin/members(/:id) into HTML;
 * no DOM access. Styles: DATA TABLE in components.css, MEMBERS in style.css.
 */
import { avatar, emptyState } from '../core/components.js';
import { escapeHtml } from '../core/ui.js';
import { relativeDay } from '../events/cards.js';

const SKELETON_ROWS = 6;
const DASH = '–';

const COLUMNS = [
    { key: 'name', label: 'Mitglied' },
    { key: 'registrations', label: 'Anmeldungen' },
    { key: 'attended', label: 'Teilnahmen' },
    { key: 'checkedIn', label: 'Check-ins' },
    { key: 'noShows', label: 'No-Shows' },
    { key: 'lastActive', label: 'Letzte Aktivität' }
];

/**
 * A stored date as Date.
 *
 * @param {string|null} value -> ISO string.
 * @returns {Date|null}
 */
function toDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Exact day and time for a tooltip.
 *
 * @param {Date} date -> Point in time.
 * @returns {string} -> e.g. "12.10.2026, 09:00".
 */
function exactTime(date) {
    return date.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/**
 * Relative day with the exact time as tooltip, or a dash.
 *
 * @param {string|null} value -> ISO string.
 * @param {Date} now -> Reference time.
 * @returns {string} -> HTML.
 */
export function renderMemberWhen(value, now) {
    const date = toDate(value);
    if (!date) return DASH;
    return `<span title="${escapeHtml(exactTime(date))}">${escapeHtml(relativeDay(date, now))}</span>`;
}

/**
 * Header line of the list.
 *
 * @param {number} count -> Number of members.
 * @returns {string} -> "1 Mitglied" / "12 Mitglieder".
 */
export function memberCountText(count) {
    const n = Number(count) || 0;
    return `${n} ${n === 1 ? 'Mitglied' : 'Mitglieder'}`;
}

function renderMemberCell(member) {
    const name = String(member.displayName || member.username || member.id || '');
    const id = escapeHtml(String(member.id ?? ''));
    const username = member.username ? `<div class="data-table-meta">@${escapeHtml(String(member.username))}</div>` : '';
    return `<td><div class="members-person">${avatar({ url: member.avatar, name })}<div><a class="data-table-title" href="#member/${id}">${escapeHtml(name)}</a>${username}</div></div></td>`;
}

function renderMemberRow(member, now) {
    const stats = member.stats || {};
    const number = (key, label) => `<td class="members-number" data-label="${label}">${Number(stats[key]) || 0}</td>`;
    return `<tr>${renderMemberCell(member)}${number('registrations', 'Anmeldungen')}${number('attended', 'Teilnahmen')}${number('checkedIn', 'Check-ins')}${number('noShows', 'No-Shows')}<td class="members-when" data-label="Letzte Aktivität">${renderMemberWhen(member.lastActiveAt, now)}</td></tr>`;
}

/**
 * The member table.
 *
 * @param {Array<Object>} rows -> Sorted list entries; at least one.
 * @param {Object} options -> `{ sort, now }`: sorting shown in the heads, reference time.
 * @returns {string} -> HTML of a .data-table.
 */
export function renderMemberTable(rows, { sort, now = new Date() }) {
    const heads = COLUMNS.map(({ key, label }) => {
        const active = sort && sort.key === key;
        const descending = active && sort.direction === 'desc';
        const ariaSort = active ? (descending ? 'descending' : 'ascending') : 'none';
        const icon = active ? (descending ? 'arrow-down' : 'arrow-up') : 'arrow-down-up';
        return `<th scope="col" aria-sort="${ariaSort}"><button type="button" class="data-table-sort" data-click="sortMembers" data-sort="${key}">${label}<i class="bi bi-${icon}" aria-hidden="true"></i></button></th>`;
    }).join('');
    return `<table class="data-table members-table"><thead><tr>${heads}</tr></thead><tbody>${rows.map(row => renderMemberRow(row, now)).join('')}</tbody></table>`;
}

/**
 * Placeholder rows while the list loads.
 *
 * @returns {string} -> HTML of a table without content.
 */
export function renderMemberTableSkeleton() {
    const person = '<td><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text is-short"></div></td>';
    const number = '<td><div class="skeleton skeleton-chip"></div></td>';
    const row = `<tr>${person}${number.repeat(5)}</tr>`;
    return `<table class="data-table members-table" aria-hidden="true"><tbody>${row.repeat(SKELETON_ROWS)}</tbody></table>`;
}

/**
 * What the list shows without rows.
 *
 * @param {Object} options -> `{ search }`.
 * @returns {string} -> Empty state; after a search with a button that clears it.
 */
export function renderMemberEmpty({ search = '' } = {}) {
    const needle = String(search ?? '').trim();
    if (!needle) {
        return emptyState({ icon: 'people', title: 'Noch keine Mitglieder', text: 'Mitglieder erscheinen nach ihrem ersten Login oder ihrer ersten Anmeldung über Discord.' });
    }
    return emptyState({
        icon: 'search',
        title: 'Keine Mitglieder gefunden',
        text: `Für „${needle}“ passt kein Name, Benutzername oder Discord-ID.`,
        action: '<button type="button" class="btn btn-secondary btn-sm" data-click="resetMemberSearch">Suche zurücksetzen</button>'
    });
}

/**
 * Shown when the list could not be loaded.
 *
 * @returns {string} -> Empty state with a retry button.
 */
export function renderMemberLoadError() {
    return emptyState({
        icon: 'exclamation-triangle',
        title: 'Mitglieder konnten nicht geladen werden',
        action: '<button type="button" class="btn btn-secondary btn-sm" data-click="reloadMembers">Erneut versuchen</button>'
    });
}

// ── Member page (#member/<id>) ────────────────────────────────

const STATUS_LABELS = {
    accepted: { label: 'Angenommen', tone: 'success', icon: 'check-circle-fill' },
    pending: { label: 'Ausstehend', tone: 'warning', icon: 'hourglass-split' },
    waitlisted: { label: 'Warteliste', tone: 'info', icon: 'list-ol' },
    rejected: { label: 'Abgelehnt', tone: 'danger', icon: 'x-circle' }
};

const SOURCES = {
    web: { label: 'Web', icon: 'globe' },
    discord: { label: 'Discord', icon: 'discord' },
    admin: { label: 'Admin', icon: 'person-gear' }
};

const SETTINGS = [
    ['Erinnerungen per DM', 'reminders'],
    ['Änderungen per DM', 'changes'],
    ['Warteliste per DM', 'waitlist']
];

/**
 * A small chip.
 *
 * @param {string} label -> Trusted or already escaped HTML.
 * @param {Object} [options] -> `{ tone, icon }`: chip colour and Bootstrap icon name.
 * @returns {string} -> HTML.
 */
function chip(label, { tone = '', icon = '' } = {}) {
    return `<span class="chip chip-sm${tone ? ` chip-${tone}` : ''}">${icon ? `<i class="bi bi-${icon}" aria-hidden="true"></i>` : ''}${label}</span>`;
}

const onOff = (value) => (value ? chip('an', { tone: 'success' }) : chip('aus'));
const day = (date) => date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

/**
 * Day of a history row.
 *
 * @param {Object} entry -> History entry.
 * @returns {string} -> "06. Okt. 2026" for the event start; for a deleted or undated event the day of the registration; a dash without a date.
 */
function historyDay(entry) {
    const date = toDate(entry.event && entry.event.startDate) || toDate(entry.createdAt);
    return date ? date.toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' }) : DASH;
}

/**
 * One row of the participation history: day, title, chips.
 *
 * @param {Object} entry -> Entry of `history` (GET /api/admin/members/:id); `event` is null for a deleted event.
 * @returns {string} -> HTML of one .members-history-row; a link to the event when it still exists.
 */
export function renderMemberHistoryRow(entry) {
    const event = entry.event;
    const title = event
        ? escapeHtml(String(event.title || '(ohne Titel)'))
        : '<span class="text-muted">Gelöschtes Event</span>';
    const chips = [];
    if (event && event.status === 'cancelled') chips.push(chip('Abgesagt'));
    if (Object.hasOwn(STATUS_LABELS, entry.status)) {
        const { label, tone, icon } = STATUS_LABELS[entry.status];
        chips.push(chip(label, { tone, icon }));
    }
    if (entry.checkedIn === true) chips.push(chip('Eingecheckt', { tone: 'success', icon: 'qr-code-scan' }));
    else if (entry.noShow === true) chips.push(chip('Nicht erschienen', { tone: 'danger', icon: 'person-x' }));
    if (entry.slot && entry.slot.name) {
        const slot = `${entry.slot.emoji ? `${escapeHtml(String(entry.slot.emoji))} ` : ''}${escapeHtml(String(entry.slot.name))}`;
        chips.push(chip(entry.slot.wish ? `Wunsch: ${slot}` : slot));
    }
    const source = Object.hasOwn(SOURCES, entry.source) ? SOURCES[entry.source] : SOURCES.web;
    chips.push(chip(source.label, { icon: source.icon }));

    const inner = `<span class="profile-history-date">${historyDay(entry)}</span>`
        + `<span class="profile-history-title">${title}</span>`
        + `<span class="members-history-chips">${chips.join('')}</span>`;
    return event
        ? `<a class="profile-history-row members-history-row" href="#event/${escapeHtml(String(event.id ?? ''))}">${inner}</a>`
        : `<div class="profile-history-row members-history-row">${inner}</div>`;
}

/**
 * One member's page: card with numbers and account info, then the history.
 *
 * @param {Object} detail -> Answer of GET /api/admin/members/:id (`member`, `stats`, `history`).
 * @param {Date} [now] -> Reference time.
 * @returns {string} -> HTML for #member-detail.
 */
export function renderMemberDetail(detail, now = new Date()) {
    const member = detail.member || {};
    const stats = detail.stats || {};
    const history = Array.isArray(detail.history) ? detail.history : [];
    const name = String(member.displayName || member.username || member.id || '');
    const created = toDate(member.createdAt);
    const notifications = member.notifications || {};

    const facts = [
        ['Discord-ID', `<code>${escapeHtml(String(member.id ?? ''))}</code>`],
        ['Dabei seit', created ? escapeHtml(day(created)) : DASH],
        ['Letzte Aktivität', renderMemberWhen(member.lastActiveAt, now)],
        ['Gast-Einladungen', onOff(member.acceptInvitations !== false)],
        ...SETTINGS.map(([label, key]) => [label, onOff(notifications[key] !== false)])
    ].map(([label, value]) => `<div class="members-fact"><dt>${label}</dt><dd>${value}</dd></div>`).join('');

    const numbers = [['Anmeldungen', 'registrations'], ['Teilnahmen', 'attended'], ['Check-ins', 'checkedIn'], ['No-Shows', 'noShows']]
        .map(([label, key]) => `<div class="profile-number"><dt>${label}</dt><dd>${Number(stats[key]) || 0}</dd></div>`).join('');

    const card = '<div class="glass-card p-4 members-card">'
        + '<div class="profile-card-head">'
        + avatar({ url: member.avatar, name, size: 'lg' })
        + `<div class="profile-card-names"><h2 class="profile-name">${escapeHtml(name)}</h2>`
        + (member.username ? `<div class="profile-handle">@${escapeHtml(String(member.username))}</div>` : '')
        + '</div></div>'
        + `<dl class="profile-numbers members-numbers">${numbers}</dl>`
        + `<dl class="members-facts">${facts}</dl>`
        + '</div>';

    const list = history.length
        ? `<div class="members-history">${history.map(entry => renderMemberHistoryRow(entry)).join('')}</div>`
        : emptyState({ icon: 'calendar-x', title: 'Noch keine Anmeldungen', text: 'Dieses Mitglied hat sich noch für kein Event angemeldet.' });
    const historyCard = '<div class="glass-card p-4">'
        + `<h3 class="members-history-title">Teilnahmeverlauf <span class="chip chip-sm">${history.length}</span></h3>`
        + list
        + '</div>';

    return `<div class="members-detail">${card}${historyCard}</div>`;
}

/**
 * Placeholder while a member loads.
 *
 * @returns {string} -> HTML.
 */
export function renderMemberDetailSkeleton() {
    const line = '<div class="skeleton skeleton-text"></div>';
    return `<div class="members-detail" aria-hidden="true"><div class="glass-card p-4 members-card">${line}${line}<div class="skeleton skeleton-text is-short"></div></div><div class="glass-card p-4">${line.repeat(4)}</div></div>`;
}

/**
 * Shown for an id without users document.
 *
 * @returns {string} -> Empty state with a link back to the list.
 */
export function renderMemberNotFound() {
    return emptyState({
        icon: 'person-x',
        title: 'Mitglied nicht gefunden',
        text: 'Zu dieser ID gibt es kein gespeichertes Mitglied.',
        action: '<a class="btn btn-secondary btn-sm" href="#members">Zu allen Mitgliedern</a>'
    });
}

/**
 * Shown when a member could not be loaded.
 *
 * @param {string} id -> Member id for the retry.
 * @returns {string} -> Empty state with a retry button.
 */
export function renderMemberDetailError(id) {
    return emptyState({
        icon: 'exclamation-triangle',
        title: 'Mitglied konnte nicht geladen werden',
        action: `<button type="button" class="btn btn-secondary btn-sm" data-click="reloadMemberDetail" data-member-id="${escapeHtml(String(id ?? ''))}">Erneut versuchen</button>`
    });
}
