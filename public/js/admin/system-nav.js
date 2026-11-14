/**
 * Categories of the admin page "System" (#system/<category>): the list on the
 * left, the panel that is shown and the marks for unsaved changes.
 * Loading and saving the values stays in system.js.
 */
import { escapeHtml, showElement, toggleElement } from '../core/ui.js';

// Order of the list; every entry has a panel #system-panel-<id> in index.html
export const SYSTEM_CATEGORIES = [
    { id: 'overview', label: 'Übersicht', subtitle: 'Version, Status', icon: 'bi-speedometer2' },
    { id: 'discord', label: 'Discord', subtitle: 'Bot, Rollen, Kanäle', icon: 'bi-discord' },
    { id: 'server', label: 'Server', subtitle: 'Adresse, Zeitzone', icon: 'bi-hdd-network' },
    { id: 'security', label: 'Sicherheit', subtitle: 'Reset-Passwort', icon: 'bi-shield-lock' },
    { id: 'privacy', label: 'Datenschutz', subtitle: 'Datenschutzerklärung', icon: 'bi-file-earmark-lock' }
];

const DEFAULT_CATEGORY = 'overview';
// Category id -> sources that hold unsaved input (a category can have several, e.g. fields and a settings block)
const dirty = new Map();
let activeId = DEFAULT_CATEGORY;

/**
 * The category a hash parameter names.
 *
 * @param {string} [param] -> Second part of the hash (`#system/<param>`).
 * @returns {string} -> A known category id, else the overview.
 */
export function categoryOf(param) {
    return SYSTEM_CATEGORIES.some(category => category.id === param) ? param : DEFAULT_CATEGORY;
}

/**
 * Add a category to the list (e.g. "KI").
 *
 * @param {Object} category -> `{ id, label, subtitle, icon }`; needs a panel #system-panel-<id>.
 * @param {string} [afterId] -> Id of the entry it follows; missing or unknown = at the end.
 * @returns {void}
 */
export function addSystemCategory(category, afterId) {
    if (SYSTEM_CATEGORIES.some(entry => entry.id === category.id)) return;
    const index = SYSTEM_CATEGORIES.findIndex(entry => entry.id === afterId);
    SYSTEM_CATEGORIES.splice(index < 0 ? SYSTEM_CATEGORIES.length : index + 1, 0, category);
}

function entryHtml(category) {
    const current = category.id === activeId ? ' aria-current="page"' : '';
    const hidden = dirty.get(category.id)?.size > 0 ? '' : ' is-hidden';
    return `<a class="settings-nav-item" href="#system/${category.id}"${current}>
        <i class="bi ${category.icon}" aria-hidden="true"></i>
        <span class="settings-nav-text"><span class="settings-nav-label">${escapeHtml(category.label)}</span>
        <span class="settings-nav-sub">${escapeHtml(category.subtitle)}</span></span>
        <span class="settings-nav-dot${hidden}" id="system-nav-dot-${category.id}"><span class="visually-hidden">ungespeicherte Änderungen</span></span>
    </a>`;
}

/**
 * Draw the category list.
 *
 * @param {string} id -> Active category.
 * @returns {void}
 */
export function renderSystemNav(id) {
    activeId = categoryOf(id);
    document.getElementById('system-nav').innerHTML = SYSTEM_CATEGORIES.map(entryHtml).join('');
}

/**
 * Show one panel and mark its entry.
 *
 * @param {string} id -> Category id.
 * @param {Object} [options]
 * @param {boolean} [options.focus] -> Move the focus to the panel heading (after a click in the list).
 * @returns {void}
 */
export function showSystemCategory(id, { focus = false } = {}) {
    const wanted = categoryOf(id);
    renderSystemNav(wanted);
    for (const category of SYSTEM_CATEGORIES) {
        const panel = document.getElementById(`system-panel-${category.id}`);
        if (!panel) continue;
        if (category.id === wanted) showElement(panel);
        else panel.style.display = 'none';
    }
    if (focus) document.getElementById(`system-panel-${wanted}-title`)?.focus?.();
}

/**
 * Set or clear the mark for unsaved changes of a category.
 *
 * @param {string} id -> Category id.
 * @param {boolean} isDirty -> Whether the source holds unsaved input.
 * @param {string} [source] -> Part of the category that reports; the mark stays while any source is dirty.
 * @returns {void}
 */
export function markCategoryDirty(id, isDirty, source = 'main') {
    const sources = dirty.get(id) || new Set();
    if (isDirty) sources.add(source);
    else sources.delete(source);
    if (sources.size > 0) dirty.set(id, sources);
    else dirty.delete(id);
    const dot = document.getElementById(`system-nav-dot-${id}`);
    if (dot) toggleElement(dot, sources.size > 0);
}

/**
 * Categories with unsaved input.
 *
 * @returns {string[]} -> Category ids in the order of the list.
 */
export function dirtyCategories() {
    return SYSTEM_CATEGORIES.map(category => category.id).filter(id => dirty.has(id));
}

/** Forget every mark (the page was left or reloaded). */
export function clearDirtyCategories() {
    dirty.clear();
}
