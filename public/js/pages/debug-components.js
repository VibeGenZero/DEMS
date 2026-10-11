/**
 * Styleguide part "Komponenten" (#debug): one block per component of
 * public/css/components.css, with every variant and its class names.
 * All texts are fixed examples, no user data.
 */
import { registerActions } from '../core/actions.js';
import { avatar, emptyState } from '../core/components.js';
import { renderCapacity, renderDateTile } from '../events/cards.js';
import { showConfirmDialog, showToast, TOAST_ICONS } from '../core/ui.js';

// Long German words show what happens when a label does not fit
const LONG_LABEL = 'Mittwochs-Raid der Schattenfestung für Fortgeschrittene';
const TOAST_TEXTS = {
    success: 'Du bist angemeldet.',
    danger: 'Anmeldung fehlgeschlagen.',
    warning: 'Das Event ist fast voll.',
    info: 'Neue Version verfügbar.'
};

const block = (id, title, classes, body) => `
    <section class="sg-block" id="sg-${id}">
        <h5 class="sg-section-title">${title} <code class="sg-classes">${classes}</code></h5>
        <div class="glass-card p-4 mb-4">${body}</div>
    </section>`;
const row = (label, content) => `<div class="sg-row"><div class="sg-label">${label}</div><div class="sg-samples">${content}</div></div>`;

function buttonBlock() {
    const variants = ['btn-primary', 'btn-secondary', 'btn-ghost', 'btn-danger', 'btn-discord'];
    return block('button', 'Button', '.btn + .btn-primary | -secondary | -ghost | -danger | -discord', [
        row('Varianten', variants.map(variant => `<button type="button" class="btn ${variant}">${variant}</button>`).join('')),
        row('Größen', `
            <button type="button" class="btn btn-primary btn-sm">btn-sm · 32</button>
            <button type="button" class="btn btn-primary">Standard · 40</button>
            <button type="button" class="btn btn-primary btn-lg">btn-lg · 48</button>`),
        row('Mit Symbol', `
            <button type="button" class="btn btn-primary"><i class="bi bi-plus-lg me-2"></i>Event anlegen</button>
            <button type="button" class="btn btn-ghost btn-icon" title="Mehr"><i class="bi bi-three-dots"></i></button>`),
        row('Deaktiviert', variants.map(variant => `<button type="button" class="btn ${variant}" disabled>${variant}</button>`).join('')),
        row('Langer Text', `<button type="button" class="btn btn-secondary">${LONG_LABEL}</button>`)
    ].join(''));
}

function cardBlock() {
    return block('card', 'Karte', '.glass-card, klickbar mit .is-clickable, a oder data-click', `
        <div class="row g-3">
            <div class="col-md-6">
                <div class="glass-card is-clickable p-4">
                    <div class="fw-semibold mb-1">Raid: Nachtfestung</div>
                    <small class="text-muted">Klickbar: reagiert aufs Überfahren</small>
                </div>
            </div>
            <div class="col-md-6">
                <div class="glass-card p-4">
                    <div class="fw-semibold mb-1">Statistik</div>
                    <small class="text-muted">Statisch: bleibt ruhig</small>
                </div>
            </div>
        </div>`);
}

function chipBlock() {
    const statuses = [['', 'Entwurf'], ['chip-warning', 'Ausstehend'], ['chip-success', 'Angenommen'], ['chip-danger', 'Abgelehnt'], ['chip-info', 'Warteliste'], ['chip-accent', 'Raid']];
    const filters = ['Alle', 'Raid', 'Dungeon', 'Social'];
    return block('chip', 'Chip', '.chip + .chip-success | -warning | -danger | -info | -accent, .chip-sm', [
        row('Status', statuses.map(([variant, label]) => `<span class="chip ${variant}">${label}</span>`).join('')),
        row('Klein', statuses.map(([variant, label]) => `<span class="chip chip-sm ${variant}">${label}</span>`).join('')),
        row('Filter', filters.map((label, index) => `<button type="button" class="chip${index === 0 ? ' active' : ''}">${label}</button>`).join('')),
        row('Alte Namen', `
            <span class="badge-pill status-accepted">badge-pill</span>
            <span class="category-pill">category-pill</span>
            <span class="event-status-badge event-status-active">event-status-badge</span>
            <span class="event-category-tag">event-category-tag</span>
            <span class="event-category-tag d-inline-block">mit d-inline-block</span>`),
        row('Langer Text', `<span class="chip chip-info">${LONG_LABEL} ${LONG_LABEL}</span>`)
    ].join(''));
}

function tabsBlock() {
    const tabs = [['drafts', 'Entwürfe', 2], ['active', 'Aktiv', 5], ['archive', 'Archiv', 12]];
    const many = ['Übersicht', 'Anmeldungen', 'Warteliste', 'Aufstellung', 'Kommentare', 'Ankündigungen', 'Protokoll', 'Einstellungen'];
    return block('tabs', 'Tabs', '.nav.nav-pills mit .nav-link, Zähler als .chip.chip-sm', [
        row('Segmente', `
            <ul class="nav nav-pills" role="tablist">${tabs.map(([id, label, count]) => `
                <li class="nav-item" role="presentation">
                    <button type="button" class="nav-link${id === 'active' ? ' active' : ''}" data-bs-toggle="pill" data-bs-target="#sg-tab-${id}" role="tab">${label} <span class="chip chip-sm">${count}</span></button>
                </li>`).join('')}
            </ul>`),
        `<div class="tab-content mb-3">${tabs.map(([id, label]) => `
            <div class="tab-pane fade${id === 'active' ? ' show active' : ''}" id="sg-tab-${id}" role="tabpanel"><small class="text-muted">Inhalt von „${label}“</small></div>`).join('')}
        </div>`,
        row('Viele Einträge', `
            <ul class="nav nav-pills">${many.map((label, index) => `
                <li class="nav-item"><button type="button" class="nav-link${index === 0 ? ' active' : ''}">${label}</button></li>`).join('')}
            </ul>`)
    ].join(''));
}

function dialogBlock() {
    return block('dialog', 'Dialog', '.modal mit .modal-content, -header, -body, -footer', `
        <div class="modal sg-modal-static mb-3" tabindex="-1">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Event löschen?</h5>
                        <button type="button" class="btn-close" aria-label="Schließen"></button>
                    </div>
                    <div class="modal-body">„Raid: Nachtfestung“ und alle 14 Anmeldungen werden endgültig entfernt.</div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary">Abbrechen</button>
                        <button type="button" class="btn btn-danger">Löschen</button>
                    </div>
                </div>
            </div>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" data-click="sgShowDialog">Echten Dialog öffnen</button>`);
}

function toastBlock() {
    const types = Object.keys(TOAST_TEXTS);
    return block('toast', 'Toast', "showToast(text, 'success' | 'danger' | 'warning' | 'info')", [
        row('Typen', types.map(type => `
            <div class="toast show toast-${type}" role="status">
                <div class="d-flex align-items-center">
                    <i class="toast-icon bi ${TOAST_ICONS[type]} ms-3"></i>
                    <div class="toast-body">${TOAST_TEXTS[type]}</div>
                </div>
            </div>`).join('')),
        row('Auslösen', `
            <button type="button" class="btn btn-secondary btn-sm" data-click="sgShowToast" data-type="success">success</button>
            <button type="button" class="btn btn-secondary btn-sm" data-click="sgShowToast" data-type="danger">danger</button>
            <button type="button" class="btn btn-secondary btn-sm" data-click="sgShowToast" data-type="warning">warning</button>
            <button type="button" class="btn btn-secondary btn-sm" data-click="sgShowToast" data-type="info">info</button>`)
    ].join(''));
}

function emptyStateBlock() {
    const refresh = '<button type="button" class="btn btn-secondary btn-sm" data-click="sgShowToast" data-type="info">Aktualisieren</button>';
    return block('empty-state', 'Leerzustand', 'emptyState({ icon, title, text, action })', `
        <div class="row g-3">
            <div class="col-md-6">${emptyState({ icon: 'calendar-x', title: 'Noch keine Events', text: 'Sobald ein Event geplant ist, erscheint es hier.', action: refresh })}</div>
            <div class="col-md-6">${emptyState({ title: 'Keine Treffer' })}</div>
        </div>`);
}

function skeletonBlock() {
    return block('skeleton', 'Skeleton', '.skeleton + -text | -title | -img | -chip | -avatar', [
        row('Bausteine', `
            <div class="skeleton skeleton-avatar"></div>
            <div class="skeleton skeleton-chip"></div>
            <div class="skeleton skeleton-chip"></div>`),
        `<div class="glass-card p-0">
            <div class="skeleton skeleton-img"></div>
            <div class="skeleton-card-body p-4">
                <div>
                    <div class="skeleton skeleton-title mb-3"></div>
                    <div class="skeleton skeleton-text"></div>
                    <div class="skeleton skeleton-text is-short"></div>
                </div>
                <div class="d-flex gap-2 mt-3">
                    <div class="skeleton skeleton-chip"></div>
                    <div class="skeleton skeleton-chip"></div>
                </div>
            </div>
        </div>`
    ].join(''));
}

function avatarBlock() {
    const sizes = ['sm', undefined, 'lg', 'xl'];
    const name = 'Lyonel Berzen';
    return block('avatar', 'Avatar', 'avatar({ url, name, size }) → .avatar + .avatar-sm | -lg | -xl', [
        row('Bild', sizes.map(size => avatar({ url: '/logo.svg', name, size })).join('')),
        row('Initialen', sizes.map(size => avatar({ name, size })).join('')),
        // The address answers with the app page, so the image fails and the fallback shows
        row('Bild fehlt', avatar({ url: '/img/kein-bild.png', name, size: 'lg' }) + avatar({ url: '/img/kein-bild.png', name: 'Mo', size: 'lg' })),
        row('Stapel', `<div class="avatar-stack">${avatar({ url: '/logo.svg', name })}${avatar({ name: 'Mara Klein' })}${avatar({ name: 'Tom Sommer' })}<span class="avatar avatar-more">+3</span></div>`)
    ].join(''));
}

function dateTileBlock() {
    // Fixed example dates; "now" is Saturday afternoon
    const now = new Date(2026, 9, 10, 15, 0);
    const at = (day, hour, minute = 0) => ({ startDate: new Date(2026, 9, day, hour, minute).toISOString() });
    return block('date-tile', 'Datums-Kachel', 'renderDateTile(event, now) → .date-tile, .is-live', [
        row('Kommend', renderDateTile(at(11, 19), now) + renderDateTile(at(15, 20), now) + renderDateTile(at(31, 18), now)),
        row('Läuft gerade', renderDateTile(at(10, 14, 30), now))
    ].join(''));
}

function capacityBlock() {
    const sample = (currentParticipants, maxParticipants) => `<div class="sg-capacity-sample">${renderCapacity({ currentParticipants, maxParticipants })}</div>`;
    return block('capacity', 'Plätze-Balken', 'renderCapacity(event) → .capacity, .is-low ab 80 %, .is-full', [
        row('Frei', sample(5, 20)),
        row('Fast voll', sample(8, 10)),
        row('Ausgebucht', sample(5, 5)),
        row('Unbegrenzt', sample(3, 0))
    ].join(''));
}

function dataTableBlock() {
    const head = (label, sort, icon) => `<th scope="col" aria-sort="${sort}"><button type="button" class="data-table-sort">${label}<i class="bi bi-${icon}" aria-hidden="true"></i></button></th>`;
    const actions = (label, className = 'btn-secondary') => `<td class="data-table-actions"><div class="data-table-buttons"><button type="button" class="btn btn-sm ${className}">${label}</button><button type="button" class="btn btn-sm btn-ghost btn-icon" aria-label="Weitere Aktionen"><i class="bi bi-three-dots"></i></button></div></td>`;
    return block('data-table', 'Tabelle', '.data-table mit .data-table-sort, -title, -meta, -actions, -buttons; Zeilen .is-sub, .is-muted', `
        <table class="data-table">
            <thead><tr>${head('Event', 'none', 'arrow-down-up')}${head('Termin', 'ascending', 'arrow-up')}<th scope="col" class="data-table-actions">Aktionen</th></tr></thead>
            <tbody>
                <tr><td><button type="button" class="data-table-title">${LONG_LABEL}</button><div class="data-table-meta">Raid · Rolle nötig · Sofort bestätigt</div></td><td>Mi., 14. Okt. · 20:00<div class="data-table-meta">in 4 Tagen</div></td>${actions('Anmeldungen · 2 offen', 'btn-primary')}</tr>
                <tr class="is-sub"><td>Termin 2 von 3</td><td>Mi., 21. Okt. · 20:00<div class="data-table-meta">in 11 Tagen</div></td>${actions('Anmeldungen')}</tr>
                <tr class="is-muted"><td><button type="button" class="data-table-title">Retro-Spieleabend</button> <span class="chip chip-sm">Vorbei</span><div class="data-table-meta">Gaming · Offen · Sofort bestätigt</div></td><td>So., 4. Okt. · 19:00<div class="data-table-meta">vor 6 Tagen</div></td>${actions('Archivieren')}</tr>
            </tbody>
        </table>`);
}

function menuBlock() {
    const item = (icon, label, className = '') => `<li><button type="button" class="dropdown-item${className}"><i class="bi bi-${icon} me-2" aria-hidden="true"></i>${label}</button></li>`;
    // Shown open and in the flow of the page; a real menu opens from a button with data-bs-toggle="dropdown"
    return block('menu', 'Menü', '.dropdown-menu mit .dropdown-item, .dropdown-header, .dropdown-divider; .dropdown-item.is-danger', `
        <ul class="dropdown-menu show position-static d-inline-block">
            ${item('pencil', 'Bearbeiten')}
            ${item('copy', 'Duplizieren')}
            <li><hr class="dropdown-divider"></li>
            <li><h6 class="dropdown-header">Status</h6></li>
            ${item('archive', 'Archivieren')}
            <li><hr class="dropdown-divider"></li>
            ${item('trash', 'Löschen …', ' is-danger')}
        </ul>`);
}

/**
 * Render one block per component.
 *
 * @param {Element} container -> #sg-components.
 * @returns {void}
 */
export function renderDebugComponents(container) {
    container.innerHTML = [
        buttonBlock(), cardBlock(), chipBlock(), tabsBlock(), dialogBlock(),
        toastBlock(), emptyStateBlock(), skeletonBlock(), avatarBlock(), dateTileBlock(), capacityBlock(),
        dataTableBlock(), menuBlock()
    ].join('');
}

registerActions({
    sgShowDialog: () => showConfirmDialog('„Raid: Nachtfestung“ und alle 14 Anmeldungen werden endgültig entfernt.', 'Löschen'),
    sgShowToast: (el) => showToast(TOAST_TEXTS[el.dataset.type] || 'Hinweis', el.dataset.type)
});
