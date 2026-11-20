/**
 * Pure markup of the official plugin „Event einreichen“.
 *
 * Uses only the `helpers` of `ui.helpers` handed over by `client.js`; no DOM
 * access and no imports outside the plugin folder.
 */

export const CATEGORIES = Object.freeze(['Tournament', 'Community', 'Workshop', 'Gamenight', 'Meeting', 'Sonstiges']);

const STATUS_META = Object.freeze({
    open: { label: 'Offen', tone: '' },
    planning: { label: 'In Planung', tone: 'chip-info' },
    accepted: { label: 'Eingetragen', tone: 'chip-success' },
    rejected: { label: 'Abgelehnt', tone: 'chip-danger' }
});

const FILTER_OPTIONS = Object.freeze([
    { key: 'open', label: 'Offen' },
    { key: 'planning', label: 'In Planung' },
    { key: 'done', label: 'Erledigt' }
]);

/**
 * Render the status chip of a submission.
 *
 * @param {string} status -> `'open'`, `'planning'`, `'accepted'`, `'rejected'`.
 * @returns {string} -> HTML of `.chip.chip-sm`.
 */
export function statusChip(status) {
    const meta = Object.hasOwn(STATUS_META, status) ? STATUS_META[status] : STATUS_META.open;
    const tone = meta.tone ? ` ${meta.tone}` : '';
    return `<span class="chip chip-sm${tone}">${meta.label}</span>`;
}

function formatWishedDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
    const [year, month, day] = value.split('-');
    return `${day}.${month}.${year}`;
}

function renderTitle(item, escapeHtml) {
    const safeTitle = escapeHtml(item.title || '');
    if (item.status === 'accepted' && item.eventId) {
        const safeEventId = escapeHtml(item.eventId);
        return `<a class="es-item-title es-event-link" href="#event/${safeEventId}">${safeTitle} <i class="bi bi-arrow-right ms-1" aria-hidden="true"></i></a>`;
    }
    return `<span class="es-item-title">${safeTitle}</span>`;
}

function renderMetaParts(item, helpers, now) {
    const { escapeHtml, relativeDay } = helpers;
    const parts = [];
    if (item.createdAt) {
        const parsed = new Date(item.createdAt);
        if (!Number.isNaN(parsed.getTime())) parts.push(escapeHtml(relativeDay(parsed, now)));
    }
    if (item.category) parts.push(escapeHtml(item.category));
    const wished = formatWishedDate(item.wishedDate);
    if (wished) parts.push(`Wunschtermin: ${escapeHtml(wished)}`);
    return parts.length > 0 ? `<span class="es-item-meta text-secondary">${parts.join(' · ')}</span>` : '';
}

function renderDescriptionPreview(item, helpers) {
    if (!item.description) return '';
    const { escapeHtml, markdownPreview } = helpers;
    const preview = markdownPreview(item.description);
    return preview ? `<p class="es-description text-secondary mb-0">${escapeHtml(preview)}</p>` : '';
}

function renderReason(item, escapeHtml) {
    if (item.status !== 'rejected' || !item.reason) return '';
    return `<p class="es-reason mb-0"><span class="text-secondary">Begründung:</span> ${escapeHtml(item.reason)}</p>`;
}

/**
 * Pill tabs at the top of the page for admins („Alle Vorschläge“ / „Selbst einreichen“).
 *
 * @param {{ tab: string, openCount: number }} state
 * @returns {string} -> HTML.
 */
export function renderAdminTabs({ tab = 'admin', openCount = 0 } = {}) {
    const count = Math.max(0, Math.floor(Number(openCount) || 0));
    const countChip = `<span class="chip chip-sm ms-2">${count}</span>`;
    const isAdminTab = tab !== 'submit';
    return `<ul class="nav nav-pills es-tabs" role="tablist">
        <li class="nav-item" role="presentation">
            <button type="button" class="nav-link${isAdminTab ? ' active' : ''}" role="tab" aria-selected="${isAdminTab}" data-click="p:event-submissions:showTab" data-tab="admin">
                <i class="bi bi-inbox me-1" aria-hidden="true"></i>Alle Vorschläge${countChip}
            </button>
        </li>
        <li class="nav-item" role="presentation">
            <button type="button" class="nav-link${!isAdminTab ? ' active' : ''}" role="tab" aria-selected="${!isAdminTab}" data-click="p:event-submissions:showTab" data-tab="submit">
                <i class="bi bi-plus-circle me-1" aria-hidden="true"></i>Selbst einreichen
            </button>
        </li>
    </ul>`;
}

/**
 * Form to submit a new event idea.
 *
 * @param {string[]} categories -> Select options (`CATEGORIES`).
 * @param {object} helpers -> `ui.helpers`.
 * @returns {string} -> HTML.
 */
export function renderSubmitForm(categories, helpers) {
    const { escapeHtml } = helpers;
    const list = Array.isArray(categories) ? categories : CATEGORIES;
    const options = [`<option value="">Keine Kategorie</option>`]
        .concat(list.map(cat => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`))
        .join('');
    return `<section class="glass-card es-card">
        <h4 class="es-section-title">Neue Idee</h4>
        <div class="es-form-fields">
            <div>
                <label class="form-label" for="es-title">Titel *</label>
                <input type="text" class="form-control" id="es-title" maxlength="100" placeholder="z. B. Quiz-Nacht oder Retro-Turnier">
            </div>
            <div>
                <label class="form-label" for="es-description">Beschreibung <span class="text-secondary">(Markdown, optional)</span></label>
                <textarea class="form-control" id="es-description" rows="3" maxlength="2000" placeholder="Worum geht es? Was wird gebraucht?"></textarea>
            </div>
            <div class="es-form-row">
                <div>
                    <label class="form-label" for="es-wished-date">Wunschtermin</label>
                    <input type="date" class="form-control" id="es-wished-date">
                </div>
                <div>
                    <label class="form-label" for="es-category">Kategorie</label>
                    <select class="form-select" id="es-category">${options}</select>
                </div>
            </div>
            <div class="es-form-actions">
                <button type="button" class="btn btn-primary" id="es-submit-btn" data-click="p:event-submissions:submit">
                    <i class="bi bi-send me-1" aria-hidden="true"></i>Vorschlag einreichen
                </button>
            </div>
        </div>
    </section>`;
}

/**
 * List of the current member's own submissions („Deine Vorschläge“).
 *
 * @param {Array<object>} items -> Submissions from `GET /mine`.
 * @param {object} helpers -> `ui.helpers`.
 * @param {Date} [now] -> Reference timestamp for relative day labels.
 * @returns {string} -> HTML.
 */
export function renderOwnList(items, helpers, now = new Date()) {
    const { escapeHtml, emptyState } = helpers;
    const rows = Array.isArray(items) ? items : [];
    if (rows.length === 0) {
        return `<section class="glass-card es-card">
            <h4 class="es-section-title">Deine Vorschläge</h4>
            ${emptyState({ icon: 'lightbulb', title: 'Noch keine Vorschläge', text: 'Reiche oben deine erste Event-Idee ein.' })}
        </section>`;
    }
    const listHtml = rows.map(item => {
        const withdrawBtn = item.status === 'open'
            ? `<button type="button" class="btn btn-ghost btn-sm" data-click="p:event-submissions:withdraw" data-id="${escapeHtml(item.id)}">
                <i class="bi bi-x-lg me-1" aria-hidden="true"></i>Zurückziehen
            </button>`
            : '';
        return `<article class="es-item">
            <div class="es-item-head">
                <div class="es-item-main">
                    ${renderTitle(item, escapeHtml)}
                    ${renderMetaParts(item, helpers, now)}
                </div>
                <div class="es-item-side">
                    ${statusChip(item.status)}
                    ${withdrawBtn}
                </div>
            </div>
            ${renderDescriptionPreview(item, helpers)}
            ${renderReason(item, escapeHtml)}
        </article>`;
    }).join('');
    return `<section class="glass-card es-card">
        <h4 class="es-section-title">Deine Vorschläge</h4>
        <div class="es-list">${listHtml}</div>
    </section>`;
}

/**
 * Inline form for an admin to reject a submission with an optional reason.
 *
 * @param {object} item -> Submission being rejected.
 * @param {object} helpers -> `ui.helpers`.
 * @returns {string} -> HTML.
 */
export function renderRejectForm(item, helpers) {
    const { escapeHtml } = helpers;
    const safeId = escapeHtml(item.id);
    const safeTitle = escapeHtml(item.title || '');
    return `<div class="es-reject-box">
        <label class="form-label" for="es-reject-reason">Vorschlag „${safeTitle}“ ablehnen – Begründung (optional)</label>
        <textarea class="form-control" id="es-reject-reason" rows="2" maxlength="500" placeholder="Optionale Begründung für das Mitglied (höchstens 500 Zeichen)"></textarea>
        <div class="es-reject-actions">
            <button type="button" class="btn btn-ghost btn-sm" data-click="p:event-submissions:cancelReject">Abbrechen</button>
            <button type="button" class="btn btn-danger btn-sm" data-click="p:event-submissions:reject" data-id="${safeId}">
                <i class="bi bi-x-circle me-1" aria-hidden="true"></i>Ablehnen
            </button>
        </div>
    </div>`;
}

/**
 * Admin view of all submissions with status filter chips and team actions.
 *
 * @param {Array<object>} items -> Submissions from `GET /?status=…`.
 * @param {{ filter?: string, rejectingId?: string }} [options]
 * @param {object} helpers -> `ui.helpers`.
 * @param {Date} [now] -> Reference timestamp for relative day labels.
 * @returns {string} -> HTML.
 */
export function renderAdminList(items, { filter = 'open', rejectingId = '' } = {}, helpers, now = new Date()) {
    const { escapeHtml, avatar, emptyState } = helpers;
    const rows = Array.isArray(items) ? items : [];
    const filterChips = FILTER_OPTIONS.map(opt => {
        const active = opt.key === filter ? ' active' : '';
        return `<button type="button" class="chip${active}" data-click="p:event-submissions:filter" data-filter="${opt.key}">${opt.label}</button>`;
    }).join('');

    const bodyHtml = rows.length === 0
        ? emptyState({ icon: 'inbox', title: 'Noch keine Vorschläge', text: 'In dieser Ansicht liegen aktuell keine Vorschläge.' })
        : `<div class="es-list">${rows.map(item => {
            const safeId = escapeHtml(item.id);
            const canDecide = item.status === 'open' || item.status === 'planning';
            const actionsHtml = canDecide
                ? `<div class="es-item-actions">
                    <button type="button" class="btn btn-primary btn-sm" data-click="p:event-submissions:takeOver" data-id="${safeId}">
                        <i class="bi bi-calendar-plus me-1" aria-hidden="true"></i>Übernehmen
                    </button>
                    <button type="button" class="btn btn-danger-soft btn-sm" data-click="p:event-submissions:askReject" data-id="${safeId}">
                        <i class="bi bi-x-circle me-1" aria-hidden="true"></i>Ablehnen
                    </button>
                </div>`
                : '';
            const rejectBox = canDecide && rejectingId === item.id ? renderRejectForm(item, helpers) : '';
            const authorAvatar = avatar({ url: item.userAvatar || '', name: item.userName || 'Mitglied', size: 'sm' });
            return `<article class="es-item">
                <div class="es-item-head">
                    <div class="es-item-main">
                        <div class="es-author">
                            ${authorAvatar}
                            <span class="es-author-name">${escapeHtml(item.userName || 'Mitglied')}</span>
                            ${statusChip(item.status)}
                        </div>
                        ${renderTitle(item, escapeHtml)}
                        ${renderMetaParts(item, helpers, now)}
                    </div>
                    ${actionsHtml}
                </div>
                ${renderDescriptionPreview(item, helpers)}
                ${renderReason(item, escapeHtml)}
                ${rejectBox}
            </article>`;
        }).join('')}</div>`;

    return `<section class="glass-card es-card">
        <div class="es-admin-head">
            <h4 class="es-section-title mb-0">Alle Vorschläge</h4>
            <div class="es-filters">${filterChips}</div>
        </div>
        ${bodyHtml}
    </section>`;
}
