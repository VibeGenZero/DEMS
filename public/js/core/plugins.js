/**
 * Plugin clients in the browser: loads the `client.js` of every enabled
 * plugin and hands it a `ui` object, the only door a plugin may use. Pages
 * live at `#p/<id>` in the shared `#plugin-section`; actions are named
 * `p:<id>:<name>`; requests go to `/api/plugins/<id>/…`.
 *
 * Everything a plugin gets is created here, so a later sandbox (an iframe
 * with a message bridge) can replace this file without touching plugins.
 */
import { registerActions } from './actions.js';
import { avatar, emptyState } from './components.js';
import { navigateTo, onRouteLeave } from './router.js';
import { state } from './state.js';
import { placeNavMarker, syncNavbarHeight } from './tab-glider.js';
import { applyStyleData, escapeHtml, markdownPreview, renderMarkdownSafe, showConfirmDialog, showElement, showToast, toggleElement } from './ui.js';
import { openEventEditor } from '../admin/editor-page.js';
import { relativeDay } from '../events/cards.js';

const PLUGIN_ID = /^[a-z][a-z0-9-]{2,31}$/;
const ACTION_NAME = /^[A-Za-z][A-Za-z0-9]{0,39}$/;
const TAB_ICON = /^bi-[a-z0-9-]+$/;
const TAB_LABEL_MAX = 30;
const REF_MAX = 100;
const ACCESS = ['member', 'admin'];
// Paths that could leave /api/plugins/<id>: dot segments (also percent-encoded), empty segments, backslashes
const UNSAFE_PATH = /\.\.|\/\/|\\|%2e/i;

const HELPERS = Object.freeze({
    escapeHtml, renderMarkdownSafe, markdownPreview, showToast, showConfirmDialog,
    avatar, emptyState, relativeDay, applyStyleData, showElement, toggleElement
});

/** @type {Map<string, { access: string, title: string, render: Function, leave: Function|null }>} */
const pages = new Map();
// Plugin ids with a tab in the navbar
const tabs = new Set();
const stylesheets = new Set();
let loading = null;
// Plugin whose page is shown; its leave() runs when another plugin page or route replaces it
let shownPluginId = null;

/**
 * Load every enabled plugin client once per page load (the logout reloads the
 * page). A list that could not be fetched (e.g. 403 of the privacy gate) is
 * asked for again by the next call.
 *
 * @param {Object} [options]
 * @param {Function} [options.importModule] -> `(url) => Promise<module>`; tests pass their own.
 * @returns {Promise<void>} -> Never rejects: a broken plugin is skipped and reported.
 */
export function loadPlugins({ importModule = (url) => import(url) } = {}) {
    if (!loading) loading = loadAll(importModule);
    return loading;
}

async function loadAll(importModule) {
    const entries = await fetchPluginList();
    if (!entries) {
        // Nothing was loaded: the next call may try again
        loading = null;
        return;
    }
    const valid = entries.filter(entry => entry && PLUGIN_ID.test(entry.id));
    // Imports run side by side and settle at once (a later one may fail while an earlier one
    // is pending); mounting keeps the server's order (order of the tabs)
    const imports = valid.map(entry => importClient(entry, importModule).then(module => ({ module }), error => ({ error })));
    for (const [index, entry] of valid.entries()) {
        const { module, error } = await imports[index];
        if (error) reportFailure(entry, error);
        else if (module) mountPluginModule(entry, module);
    }
}

// The list of GET /api/plugins; null when it could not be fetched
async function fetchPluginList() {
    try {
        const res = await fetch('/api/plugins');
        if (!res.ok) return null;
        const entries = await res.json();
        return Array.isArray(entries) ? entries : null;
    } catch (err) {
        console.error('Plugins could not be listed:', err);
        return null;
    }
}

// The client of a plugin, only from its own folder; null without one
async function importClient(entry, importModule) {
    const own = `/plugins/${entry.id}/`;
    if (entry.css) {
        if (!String(entry.css).startsWith(own)) throw new Error(`stylesheet outside ${own}`);
        addStylesheet(entry.id, entry.css);
    }
    if (!entry.client) return null;
    if (!String(entry.client).startsWith(own)) throw new Error(`client outside ${own}`);
    return importModule(entry.client);
}

function addStylesheet(pluginId, href) {
    if (stylesheets.has(pluginId)) return;
    stylesheets.add(pluginId);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.querySelector('head').appendChild(link);
}

function reportFailure(entry, err) {
    console.error(`Plugin "${entry.id}" could not be loaded:`, err);
    if (state.currentUser && state.currentUser.isAdmin) {
        showToast(`Plugin „${entry.name || entry.id}“ konnte nicht geladen werden.`, 'warning');
    }
}

/**
 * Call `module.register(ui)` of one client. A failure (also a rejected
 * promise) is reported and its page and tab are removed again.
 *
 * @param {Object} entry -> One item of GET /api/plugins.
 * @param {Object} module -> The imported client module.
 * @returns {void}
 */
export function mountPluginModule(entry, module) {
    const fail = (err) => {
        dropPlugin(entry.id);
        reportFailure(entry, err);
    };
    try {
        if (!module || typeof module.register !== 'function') throw new Error('client.js exports no register(ui)');
        const result = module.register(createPluginUi(entry));
        if (result && typeof result.then === 'function') result.catch(fail);
    } catch (err) {
        fail(err);
    }
}

function dropPlugin(pluginId) {
    pages.delete(pluginId);
    if (removeTab(pluginId)) {
        placeNavMarker();
        syncNavbarHeight();
    }
}

/**
 * Build the `ui` object of one plugin (spec: "Frontend: client.js and ui").
 *
 * @param {Object} entry -> `{ id, name, version, official, permissions }` of GET /api/plugins.
 * @returns {Object} -> Frozen `ui`.
 */
export function createPluginUi(entry) {
    const id = entry.id;
    if (!PLUGIN_ID.test(id)) throw new Error(`Invalid plugin id "${id}"`);
    const permissions = Array.isArray(entry.permissions) ? [...entry.permissions] : [];
    const user = state.currentUser || {};
    const actionNames = new Set();
    const request = (method) => (path, body) => pluginRequest(id, method, path, body);

    return Object.freeze({
        plugin: Object.freeze({ id, name: String(entry.name || ''), version: String(entry.version || ''), official: entry.official === true }),
        user: Object.freeze({ id: user.id || '', name: user.displayName || user.username || '', avatar: user.avatar || '', isAdmin: user.isAdmin === true }),
        addPage: (page) => addPage(id, page),
        setTabBadge: (count) => setTabBadge(id, count),
        actions: Object.freeze({
            register(map) {
                const prefixed = {};
                for (const [name, handler] of Object.entries(map || {})) {
                    if (!ACTION_NAME.test(name)) throw new Error(`Invalid action name "${name}"`);
                    if (typeof handler !== 'function') throw new Error(`Action "${name}" is no function`);
                    if (actionNames.has(name)) throw new Error(`Action "${name}" is registered twice`);
                    prefixed[`p:${id}:${name}`] = handler;
                }
                registerActions(prefixed);
                Object.keys(map).forEach(name => actionNames.add(name));
            }
        }),
        api: Object.freeze({ get: request('GET'), post: request('POST'), put: request('PUT'), delete: request('DELETE') }),
        openEventEditor({ prefill = {}, ref } = {}) {
            if (!state.currentUser || !state.currentUser.isAdmin) throw new Error('openEventEditor is for admins only');
            if (!permissions.includes('events:draft')) throw new Error('openEventEditor needs the permission events:draft');
            const origin = { plugin: id, ref: String(ref ?? '') };
            if (!origin.ref || origin.ref.length > REF_MAX) throw new Error(`ref must have 1 to ${REF_MAX} characters`);
            // The origin comes from the core, never from the plugin; a poll decision is not the plugin's to make
            const { fromPoll, pluginOrigin, ...fields } = prefill && typeof prefill === 'object' ? prefill : {};
            return openEventEditor({ prefill: { ...fields, pluginOrigin: origin }, fresh: true });
        },
        navigate: (param) => navigateTo(`p/${id}${param ? `/${param}` : ''}`),
        helpers: HELPERS
    });
}

/**
 * fetch below /api/plugins/<id>; the path is checked before anything is sent.
 *
 * @returns {Promise<*>} -> Parsed JSON; rejects with the German `error` of a failed answer.
 */
function pluginRequest(id, method, path, body) {
    if (typeof path !== 'string' || !path.startsWith('/') || UNSAFE_PATH.test(path)) throw new Error(`Invalid plugin path "${String(path)}"`);
    const headers = { 'X-CSRF-TOKEN': state.csrfToken };
    const options = { method, headers };
    if (body !== undefined && method !== 'GET') {
        headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
    }
    return (async () => {
        const res = await fetch(`/api/plugins/${id}${path}`, options);
        let json = null;
        try {
            json = await res.json();
        } catch { /* no JSON body */ }
        if (!res.ok) throw new Error((json && json.error) || 'Unbekannter Fehler.');
        return json;
    })();
}

function addPage(id, { access, title, render, leave, tab } = {}) {
    if (pages.has(id)) throw new Error('A plugin has one page');
    if (!ACCESS.includes(access)) throw new Error('access must be "member" or "admin"');
    if (typeof title !== 'string' || !title.trim()) throw new Error('title is required');
    if (typeof render !== 'function') throw new Error('render must be a function');
    if (leave !== undefined && typeof leave !== 'function') throw new Error('leave must be a function');
    if (tab !== undefined) {
        if (!tab || typeof tab.label !== 'string' || !tab.label.trim() || tab.label.length > TAB_LABEL_MAX) throw new Error(`tab.label needs 1 to ${TAB_LABEL_MAX} characters`);
        if (!TAB_ICON.test(tab.icon)) throw new Error('tab.icon must be a Bootstrap icon (bi-*)');
    }
    pages.set(id, { access, title: title.trim(), render, leave: leave || null });
    const isAdmin = !!(state.currentUser && state.currentUser.isAdmin);
    if (tab && (access === 'member' || isAdmin)) addTab(id, tab, access);
}

// Member tabs stand after the core member links, admin tabs after the admin links
function addTab(id, { label, icon }, access) {
    const before = document.getElementById(access === 'admin' ? 'nav-debug' : 'nav-admin');
    if (!before) return;
    const item = document.createElement('li');
    item.className = 'nav-item';
    item.id = `nav-p-${id}`;
    const safeId = escapeHtml(id);
    item.innerHTML = `<a class="nav-link" id="nav-p-${safeId}-link" href="#p/${safeId}" data-section="p-${safeId}-section">`
        + `<i class="bi ${escapeHtml(icon)} me-1"></i>${escapeHtml(label.trim())}`
        + `<span class="badge rounded-pill text-bg-danger ms-1 is-hidden" id="nav-p-${safeId}-badge"></span></a>`;
    before.insertAdjacentElement('beforebegin', item);
    tabs.add(id);
    placeNavMarker();
    syncNavbarHeight();
}

// Callers move the navbar marker and height afterwards; true when a tab was removed
function removeTab(id) {
    if (!tabs.delete(id)) return false;
    document.getElementById(`nav-p-${id}`)?.remove();
    return true;
}

function setTabBadge(id, count) {
    const badge = document.getElementById(`nav-p-${id}-badge`);
    if (!badge) return;
    const value = Math.max(0, Math.floor(Number(count) || 0));
    badge.textContent = value > 99 ? '99+' : String(value);
    toggleElement(badge, value > 0);
}

/**
 * Remove every plugin tab from the navbar (logout).
 *
 * @returns {void}
 */
export function unloadPluginTabs() {
    for (const id of [...tabs]) removeTab(id);
    placeNavMarker();
    syncNavbarHeight();
}

// leave() of the shown plugin page; a broken one must not stop the next page
function leaveShownPage() {
    const page = pages.get(shownPluginId);
    shownPluginId = null;
    if (!page || !page.leave) return;
    try {
        page.leave();
    } catch (err) {
        console.error('Plugin page leave failed:', err);
    }
}

// The address still shows this plugin's page (it may have changed while the plugins loaded)
const stillWanted = (pluginId) => window.location.hash.replace('#', '').split('/').slice(0, 2).join('/') === `p/${pluginId}`;

/**
 * Show the page of a plugin (router, `#p/<id>/<param>`).
 *
 * @param {string} pluginId -> Plugin id from the address.
 * @param {string} [param] -> Rest of the address after the id ('' without).
 * @returns {Promise<void>} -> Resolves when the page is rendered.
 */
export async function showPluginPage(pluginId, param = '') {
    if (!pages.has(pluginId) && loading) {
        // A deep link can arrive before the plugins are loaded
        await loading;
        if (!stillWanted(pluginId)) return;
    }
    const page = pages.get(pluginId);
    if (!page || (page.access === 'admin' && !(state.currentUser && state.currentUser.isAdmin))) {
        navigateTo('events');
        return;
    }
    if (shownPluginId && shownPluginId !== pluginId) leaveShownPage();
    shownPluginId = pluginId;
    onRouteLeave(leaveShownPage);

    document.getElementById('plugin-section').style.display = 'block';
    document.getElementById('plugin-title').textContent = page.title;
    const link = document.getElementById(`nav-p-${pluginId}-link`);
    if (link && !link.classList.contains('active')) {
        link.classList.add('active');
        placeNavMarker();
    }
    const root = document.getElementById('plugin-root');
    root.innerHTML = '';
    const container = document.createElement('div');
    root.appendChild(container);
    try {
        await page.render(container, param);
    } catch (err) {
        console.error(`Plugin page "${pluginId}" failed:`, err);
        container.innerHTML = emptyState({ icon: 'exclamation-triangle', title: 'Plugin-Seite konnte nicht geladen werden', text: '' });
    }
}
