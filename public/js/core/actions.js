/**
 * Event delegation for the SPA. Markup names an action, the module that owns
 * the function registers what it does:
 *   <button data-click="editEvent" data-event-id="…">
 *   registerActions({ editEvent: (el) => editEvent(el.dataset.eventId) });
 * Replaces inline onclick/onchange/oninput/onerror handlers, so the CSP can
 * forbid them. Broken images use data-fallback="hide|invisible|initials".
 */
import { toggleElement } from './ui.js';

const actions = new Map();

// Event type -> attribute that names the action
const ACTION_ATTRIBUTES = { click: 'data-click', change: 'data-change', input: 'data-input' };

const FALLBACKS = {
    hide: (img) => { img.style.display = 'none'; },
    invisible: (img) => { img.style.visibility = 'hidden'; },
    initials: (img) => {
        // Library avatars keep their size classes; older images get the participant tile
        const isAvatar = /(^|\s)avatar(\s|$)/.test(img.className || '');
        const placeholder = document.createElement(isAvatar ? 'span' : 'div');
        placeholder.className = isAvatar ? `${img.className} avatar-initials` : 'participant-avatar-placeholder';
        placeholder.title = img.title;
        placeholder.textContent = img.dataset.initials || '?';
        img.replaceWith(placeholder);
    }
};

/**
 * Register actions by name. Every module registers its own on import.
 *
 * @param {Object<string, Function>} map -> Name -> (element, event) => any.
 * @returns {void}
 */
export function registerActions(map) {
    for (const [name, handler] of Object.entries(map)) {
        if (actions.has(name)) throw new Error(`Action "${name}" is registered twice`);
        actions.set(name, handler);
    }
}

/**
 * Names of all registered actions (for the guard tests).
 *
 * @returns {string[]}
 */
export function actionNames() {
    return [...actions.keys()];
}

/**
 * Run one action. Unknown names and errors end up in the console, never as
 * an exception in the event listener.
 *
 * @param {string} name -> Action name.
 * @param {Element} element -> Element that carries the action attribute.
 * @param {Event|Object} [event] -> Triggering event.
 * @returns {Promise<void>}
 */
export async function runAction(name, element, event = {}) {
    const handler = actions.get(name);
    if (!handler) {
        console.error(`Unknown action "${name}"`);
        return;
    }
    try {
        await handler(element, event);
    } catch (err) {
        console.error(`Action "${name}" failed:`, err);
    }
}

/**
 * Listen for actions and image errors below `root`; give images that failed
 * before the modules ran their fallback now.
 *
 * @param {Document} root -> Usually document.
 * @returns {void}
 */
export function initActions(root) {
    for (const [type, attribute] of Object.entries(ACTION_ATTRIBUTES)) {
        root.addEventListener(type, (event) => dispatch(event, attribute));
    }
    // error does not bubble; the capture phase still sees it at the root
    root.addEventListener('error', (event) => {
        const target = event.target;
        if (target && target.tagName === 'IMG' && target.dataset && target.dataset.fallback) applyFallback(target);
    }, true);
    for (const img of root.querySelectorAll('img[data-fallback]')) {
        if (img.complete && img.naturalWidth === 0) applyFallback(img);
    }
}

function dispatch(event, attribute) {
    const target = event.target;
    if (!target || typeof target.closest !== 'function') return;
    // The innermost element with an action wins; outer actions do not run
    const element = target.closest(`[${attribute}]`);
    if (!element) return;
    if (attribute === 'data-click' && element.tagName === 'A') event.preventDefault();
    runAction(element.getAttribute(attribute), element, event);
}

function applyFallback(img) {
    const fallback = FALLBACKS[img.dataset.fallback];
    if (fallback) fallback(img);
    else console.error(`Unknown image fallback "${img.dataset.fallback}"`);
}

registerActions({
    toggleVisible: (el) => {
        const target = document.getElementById(el.dataset.target);
        if (target) toggleElement(target, el.checked);
    },
    hide: (el) => {
        const target = document.getElementById(el.dataset.target);
        if (target) target.style.display = 'none';
    },
    scrollTo: (el) => document.getElementById(el.dataset.target)?.scrollIntoView({ behavior: 'smooth' })
});
