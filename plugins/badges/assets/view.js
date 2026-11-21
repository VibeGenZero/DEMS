/**
 * Pure markup of the official plugin „Badges“ (admin page).
 *
 * Uses only the `helpers` of `ui.helpers` handed over by `client.js`; no DOM
 * access and no imports outside the plugin folder. Colours reach the page
 * only as `data-style-color` (set by `helpers.applyStyleData`).
 */

const RULE_OPTIONS = Object.freeze([
    { value: 'manual', label: 'Von Hand' },
    { value: 'participations', label: 'Ab N Teilnahmen' },
    { value: 'checkins', label: 'Ab N Check-ins' }
]);
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const ICON_CLASS = /^bi-[a-z0-9-]+$/;
const DEFAULT_COLOR = '#f59e0b';

const members = count => (count === 1 ? '1 Mitglied' : `${count} Mitglieder`);
// After „bei“ (dative): „bei 1 Mitglied“, „bei 3 Mitgliedern“
const membersDative = count => (count === 1 ? '1 Mitglied' : `${count} Mitgliedern`);
const iconClass = icon => (ICON_CLASS.test(icon) ? icon : 'bi-award');
const colorAttr = (color, escapeHtml) => (HEX_COLOR.test(color) ? ` data-style-color="${escapeHtml(color)}"` : '');

function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * The page frame: title, „Neues Badge“, editor slot and list.
 *
 * @returns {string}
 */
export function renderPage() {
    return `<div class="bd-head">
        <p class="bd-intro text-secondary mb-0">Eigene Badges für eure Community – von Hand oder automatisch vergeben.</p>
        <button type="button" class="btn btn-primary" data-click="p:badges:newBadge"><i class="bi bi-plus-lg me-1" aria-hidden="true"></i>Neues Badge</button>
    </div>
    <div id="bd-pending"></div>
    <div id="bd-editor"></div>
    <div id="bd-list" class="bd-list"></div>`;
}

/**
 * One line about roles that could not be taken back yet (also of deleted badges), with a retry.
 *
 * @param {number} count -> `GET /roles/pending` `removals`.
 * @returns {string} -> '' when there are none.
 */
export function renderPendingRemovals(count) {
    if (!(count > 0)) return '';
    const what = count === 1 ? 'Rolle bei 1 Mitglied' : `Rollen bei ${membersDative(count)}`;
    return `<p class="bd-warning glass-card bd-pending mb-0"><i class="bi bi-exclamation-triangle me-1" aria-hidden="true"></i>${what} noch nicht entzogen
        <button type="button" class="btn btn-sm btn-outline-secondary ms-2" data-click="p:badges:retryPending">Erneut versuchen</button></p>`;
}

function roleChip(badge, meta, escapeHtml) {
    if (!badge.roleId) return '';
    const role = (meta.roles || []).find(entry => entry.id === badge.roleId);
    if (!role) return '<span class="chip chip-sm chip-warning"><i class="bi bi-discord me-1" aria-hidden="true"></i>Rolle nicht verfügbar</span>';
    return `<span class="chip chip-sm"><i class="bi bi-discord me-1" aria-hidden="true"></i>${escapeHtml(role.name)}</span>`;
}

function unsyncedLine(badge, escapeHtml) {
    if (!badge.roleId || !(badge.unsynced > 0)) return '';
    return `<p class="bd-warning mb-0"><i class="bi bi-exclamation-triangle me-1" aria-hidden="true"></i>Rolle bei ${membersDative(badge.unsynced)} noch nicht vergeben
        <button type="button" class="btn btn-sm btn-outline-secondary ms-2" data-click="p:badges:retryRoles" data-id="${escapeHtml(badge.id)}">Erneut versuchen</button></p>`;
}

/**
 * The badge cards of the admin page.
 *
 * @param {object[]} badges -> `GET /badges` entries.
 * @param {{ roles: object[] }} meta -> `GET /meta`.
 * @param {object} helpers -> `ui.helpers`.
 * @param {Object<string, string>} [details] -> Extra HTML below a card by badge id (holders, award search).
 * @returns {string}
 */
export function renderBadgeCards(badges, meta, helpers, details = {}) {
    const { escapeHtml, emptyState } = helpers;
    if (!Array.isArray(badges) || badges.length === 0) {
        return emptyState({ icon: 'award', title: 'Noch keine Badges', text: 'Lege mit „Neues Badge“ das erste an.' });
    }
    return badges.map(badge => {
        const id = escapeHtml(badge.id);
        const description = badge.description ? `<p class="bd-description text-secondary mb-0">${escapeHtml(badge.description)}</p>` : '';
        const detail = details[badge.id] ? `<div class="bd-detail">${details[badge.id]}</div>` : '';
        return `<article class="glass-card bd-card">
            <div class="bd-card-main">
                <span class="bd-icon"${colorAttr(badge.color, escapeHtml)}><i class="bi ${iconClass(badge.icon)}" aria-hidden="true"></i></span>
                <div class="bd-card-body">
                    <h5 class="bd-name mb-0">${escapeHtml(badge.name)}</h5>
                    ${description}
                    <div class="bd-facts">
                        <span class="chip chip-sm chip-info">${escapeHtml(badge.ruleText || '')}</span>
                        ${roleChip(badge, meta || {}, escapeHtml)}
                        <span class="bd-holders-count text-secondary">${members(Number(badge.holders) || 0)}</span>
                    </div>
                    ${unsyncedLine(badge, escapeHtml)}
                </div>
            </div>
            <div class="bd-actions">
                <button type="button" class="btn btn-sm btn-outline-primary" data-click="p:badges:showAward" data-id="${id}"><i class="bi bi-person-plus me-1" aria-hidden="true"></i>Vergeben</button>
                <button type="button" class="btn btn-sm btn-outline-secondary" data-click="p:badges:showHolders" data-id="${id}"><i class="bi bi-people me-1" aria-hidden="true"></i>Inhaber</button>
                <button type="button" class="btn btn-sm btn-outline-secondary" data-click="p:badges:editBadge" data-id="${id}"><i class="bi bi-pencil me-1" aria-hidden="true"></i>Bearbeiten</button>
                <button type="button" class="btn btn-sm btn-outline-danger" data-click="p:badges:deleteBadge" data-id="${id}"><i class="bi bi-trash me-1" aria-hidden="true"></i>Löschen</button>
            </div>
            ${detail}
        </article>`;
    }).join('');
}

function option(value, label, selected, escapeHtml) {
    return `<option value="${escapeHtml(value)}"${selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
}

/**
 * The editor for a new (`badge` null) or a stored badge.
 *
 * @param {object|null} badge
 * @param {{ icons: string[], categories: string[], roles: object[], eventRoleIds: string[] }} meta
 * @param {object} helpers
 * @returns {string}
 */
export function renderEditor(badge, meta, helpers) {
    const { escapeHtml } = helpers;
    const value = badge || { name: '', description: '', icon: (meta.icons || [])[0] || 'bi-award', color: DEFAULT_COLOR, rule: { type: 'manual' }, roleId: null };
    const rule = value.rule || { type: 'manual' };
    const isManual = rule.type === 'manual';
    const icons = (meta.icons || []).map(icon => {
        const safe = escapeHtml(icon);
        const label = escapeHtml(`Icon ${icon.replace(/^bi-/, '')}`);
        return `<label class="bd-icon-option" title="${label}">
            <input type="radio" class="btn-check" name="bd-icon" id="bd-icon-${safe}" value="${safe}" aria-label="${label}"${icon === value.icon ? ' checked' : ''}>
            <span class="bd-icon-choice"><i class="bi ${iconClass(icon)}" aria-hidden="true"></i></span>
        </label>`;
    }).join('');
    const rules = RULE_OPTIONS.map(entry => option(entry.value, entry.label, entry.value === rule.type, escapeHtml)).join('');
    // A stored role or category the lists no longer offer stays selected, so saving another field keeps it
    const categoryList = meta.categories || [];
    const lostCategory = rule.category && !categoryList.includes(rule.category)
        ? option(rule.category, `${rule.category} (kein Event mehr)`, true, escapeHtml) : '';
    const categories = option('', 'Alle Kategorien', !rule.category, escapeHtml) + lostCategory
        + categoryList.map(category => option(category, category, category === rule.category, escapeHtml)).join('');
    const roleList = meta.roles || [];
    const lostRole = value.roleId && !roleList.some(role => role.id === value.roleId)
        ? option(value.roleId, 'Gespeicherte Rolle (nicht verfügbar)', true, escapeHtml) : '';
    const roles = option('', 'Keine', !value.roleId, escapeHtml) + lostRole
        + roleList.map(role => option(role.id, role.name, role.id === value.roleId, escapeHtml)).join('');
    const noRoles = (meta.roles || []).length === 0
        ? '<p class="form-text mb-0">Der Bot ist nicht verbunden oder es gibt keine Rolle, die ein Plugin vergeben darf.</p>'
        : '';
    const eventRole = Boolean(value.roleId) && (meta.eventRoleIds || []).includes(value.roleId);
    const count = Number.isInteger(rule.count) ? rule.count : 5;
    return `<section class="glass-card bd-editor">
        <h4 class="bd-section-title">${badge ? 'Badge bearbeiten' : 'Neues Badge'}</h4>
        <div class="bd-form">
            <div class="bd-form-row">
                <div>
                    <label class="form-label" for="bd-name">Name *</label>
                    <input type="text" class="form-control" id="bd-name" maxlength="40" value="${escapeHtml(value.name)}" placeholder="z. B. Raid-Veteran">
                </div>
                <div>
                    <label class="form-label" for="bd-color">Farbe</label>
                    <input type="color" class="form-control form-control-color" id="bd-color" value="${escapeHtml(HEX_COLOR.test(value.color) ? value.color : DEFAULT_COLOR)}">
                </div>
            </div>
            <div>
                <label class="form-label" for="bd-description">Beschreibung <span class="text-secondary">(optional)</span></label>
                <input type="text" class="form-control" id="bd-description" maxlength="200" value="${escapeHtml(value.description || '')}" placeholder="Wofür gibt es das Badge?">
            </div>
            <fieldset>
                <legend class="form-label">Icon</legend>
                <div class="bd-icon-grid">${icons}</div>
            </fieldset>
            <div class="bd-form-row">
                <div>
                    <label class="form-label" for="bd-rule">Vergabe</label>
                    <select class="form-select" id="bd-rule" data-change="p:badges:changeRuleType">${rules}</select>
                </div>
                <div id="bd-count-row" class="bd-count-row${isManual ? ' is-hidden' : ''}">
                    <label class="form-label" for="bd-count">Anzahl</label>
                    <input type="number" class="form-control" id="bd-count" min="1" max="1000" step="1" value="${count}">
                </div>
            </div>
            <div class="bd-form-row">
                <div>
                    <label class="form-label" for="bd-category">Kategorie</label>
                    <select class="form-select" id="bd-category">${categories}</select>
                </div>
                <div>
                    <label class="form-label" for="bd-role">Discord-Rolle</label>
                    <select class="form-select" id="bd-role" data-change="p:badges:changeRole">${roles}</select>
                    ${noRoles}
                    <p id="bd-role-hint" class="form-text bd-hint mb-0${eventRole ? '' : ' is-hidden'}"><i class="bi bi-info-circle me-1" aria-hidden="true"></i>Diese Rolle wird auch von Events vergeben und danach wieder entzogen.</p>
                </div>
            </div>
            <div class="bd-form-actions">
                <button type="button" class="btn btn-outline-secondary" data-click="p:badges:cancelEdit">Abbrechen</button>
                <button type="button" class="btn btn-primary" id="bd-save-btn" data-click="p:badges:saveBadge"><i class="bi bi-check-lg me-1" aria-hidden="true"></i>Speichern</button>
            </div>
        </div>
    </section>`;
}

/**
 * Holders of a badge, newest first, each with „Entziehen“.
 *
 * @param {object} badge
 * @param {object[]} holders -> `GET /badges/:id/holders`.
 * @param {object} helpers
 * @returns {string}
 */
export function renderHolders(badge, holders, helpers) {
    const { escapeHtml, avatar } = helpers;
    if (!Array.isArray(holders) || holders.length === 0) return '<p class="text-secondary mb-0">Noch niemand hat dieses Badge.</p>';
    const id = escapeHtml(badge.id);
    return `<ul class="bd-holders">${holders.map(holder => `<li class="bd-holder">
        ${avatar({ url: holder.avatar, name: holder.name, size: 'sm' })}
        <span class="bd-holder-name">${escapeHtml(holder.name)}</span>
        <span class="bd-holder-meta text-secondary">${escapeHtml(formatDate(holder.awardedAt))} · ${holder.byRule ? 'automatisch' : 'von Hand'}</span>
        <button type="button" class="btn btn-sm btn-outline-danger" data-click="p:badges:revokeAward" data-id="${id}" data-user="${escapeHtml(holder.userId)}">Entziehen</button>
    </li>`).join('')}</ul>`;
}

/**
 * Search field to award a badge by hand; hits go into `#bd-results`.
 *
 * @param {object} badge
 * @param {object} helpers
 * @returns {string}
 */
export function renderAwardSearch(badge, helpers) {
    const { escapeHtml } = helpers;
    return `<div class="bd-award">
        <label class="form-label" for="bd-search">Mitglied suchen</label>
        <input type="search" class="form-control" data-input="p:badges:searchMembers" data-id="${escapeHtml(badge.id)}" maxlength="50" placeholder="Name eingeben" autocomplete="off" id="bd-search">
        <ul id="bd-results" class="bd-results"></ul>
    </div>`;
}

/**
 * Hits of the member search, each with „Vergeben“.
 *
 * @param {string} badgeId
 * @param {object[]} results -> `GET /members?q=`.
 * @param {object} helpers
 * @returns {string}
 */
export function renderSearchResults(badgeId, results, helpers) {
    const { escapeHtml, avatar } = helpers;
    if (!Array.isArray(results) || results.length === 0) return '<li class="bd-result text-secondary">Niemand gefunden.</li>';
    const id = escapeHtml(badgeId);
    return results.map(member => `<li class="bd-result">
        ${avatar({ url: member.avatar, name: member.name, size: 'sm' })}
        <span class="bd-holder-name">${escapeHtml(member.name)}</span>
        <button type="button" class="btn btn-sm btn-outline-primary" data-click="p:badges:awardMember" data-id="${id}" data-user="${escapeHtml(member.id)}">Vergeben</button>
    </li>`).join('');
}
