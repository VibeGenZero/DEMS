/**
 * Client-side theme preview and reload (`ui.theme`) for plugins with the
 * `theme` permission, plus the core preview bar (`#design-preview-bar`).
 */
import { registerActions } from './actions.js';
import { state } from './state.js';
import { showElement, toggleElement } from './ui.js';

let previewVersion = 0;
let reloadVersion = 0;

/**
 * Whether the `?design=standard` escape hatch disabled custom themes on boot.
 *
 * @returns {boolean}
 */
export function isStandardDesign() {
    return document.documentElement.getAttribute('data-design') === 'standard';
}

function setThemeHref(href) {
    const link = document.getElementById('custom-theme');
    if (!link) return;
    link.href = href;
    link.setAttribute?.('href', href);
}

/**
 * Switch this tab's `#custom-theme` link to `/theme-preview.css?v=<n>` and
 * show the core preview bar. No-op when `?design=standard` is active.
 *
 * @returns {void}
 */
export function showThemePreview() {
    if (isStandardDesign()) return;
    previewVersion += 1;
    setThemeHref(`/theme-preview.css?v=${previewVersion}`);
    const bar = document.getElementById('design-preview-bar');
    if (bar) showElement(bar);
}

/**
 * Restore `/theme.css` on `#custom-theme` and hide the core preview bar.
 *
 * @returns {void}
 */
export function hideThemePreview() {
    setThemeHref('/theme.css');
    const bar = document.getElementById('design-preview-bar');
    if (bar) toggleElement(bar, false);
}

/**
 * Force-reload `/theme.css` with a cache-busting query after publish or reset.
 *
 * @returns {void}
 */
export function reloadTheme() {
    reloadVersion += 1;
    setThemeHref(`/theme.css?v=${reloadVersion}`);
}

/**
 * Build `ui.theme` for a plugin.
 *
 * @param {string[]} permissions -> Granted permissions of the plugin.
 * @returns {Readonly<{ showPreview(): void, hidePreview(): void, reload(): void, isStandardMode(): boolean }>}
 */
export function createThemeUi(permissions) {
    const hasTheme = Array.isArray(permissions) && permissions.includes('theme');
    const requirePerm = () => {
        if (!hasTheme) throw new Error('ui.theme needs the permission theme');
    };
    return Object.freeze({
        showPreview() {
            requirePerm();
            if (!state.currentUser || !state.currentUser.isAdmin) {
                throw new Error('ui.theme is for admins only');
            }
            showThemePreview();
        },
        hidePreview() {
            requirePerm();
            hideThemePreview();
        },
        reload() {
            requirePerm();
            reloadTheme();
        },
        isStandardMode() {
            requirePerm();
            return isStandardDesign();
        }
    });
}

registerActions({
    endDesignPreview: () => hideThemePreview()
});
