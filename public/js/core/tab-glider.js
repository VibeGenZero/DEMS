/**
 * Gliding markers: the underline of the active navbar link and the surface
 * of the active tab (.nav-pills) slide to the new place with the shared
 * spring instead of jumping there.
 */
import { animateTo, SPRING } from './motion.js';
import { showElement, toggleElement } from './ui.js';

// Same width as the former .nav-link.active::after
export const NAV_MARKER_WIDTH = 30;

// Markers that stand somewhere already; their next move glides
const placed = new WeakSet();
// Last box of the glider per tab container; a redrawn list starts the glider there
const lastTabBox = new WeakMap();

/**
 * Where a marker stands under a link, relative to the container.
 *
 * @param {{ left: number }} containerRect -> Box of the container.
 * @param {{ left: number, width: number }} linkRect -> Box of the link.
 * @param {number} [width] -> Fixed marker width, centered under the link; without it the link's width.
 * @returns {{ x: number, width: number }}
 */
export function markerBox(containerRect, linkRect, width) {
    const offset = linkRect.left - containerRect.left;
    if (width === undefined) return { x: offset, width: linkRect.width };
    return { x: offset + (linkRect.width - width) / 2, width };
}

/**
 * Move a marker under the active link.
 *
 * @param {HTMLElement} container -> Positioned element the marker lives in.
 * @param {HTMLElement} marker -> The marker.
 * @param {HTMLElement|null} activeLink -> Link to stand under; none (or a hidden one) hides the marker.
 * @param {Object} [options] -> `{ width, animate }`; the first placement never animates.
 * @returns {void}
 */
export function glideMarker(container, marker, activeLink, { width, animate = true } = {}) {
    if (!activeLink || activeLink.offsetParent === null) {
        toggleElement(marker, false);
        return;
    }
    const box = markerBox(container.getBoundingClientRect(), activeLink.getBoundingClientRect(), width);
    showElement(marker);
    if (animate && placed.has(marker)) animateTo(marker, { ...box, duration: 0.5, ease: SPRING });
    else gsap.set(marker, box);
    placed.add(marker);
}

/**
 * Put the navbar marker under the active navbar link.
 *
 * @param {boolean} [animate] -> False on a resize: the marker follows at once.
 * @returns {void}
 */
export function placeNavMarker(animate = true) {
    const marker = document.getElementById('nav-marker');
    if (!marker) return;
    glideMarker(marker.parentElement, marker, document.querySelector('#main-navbar .nav-link.active'), { width: NAV_MARKER_WIDTH, animate });
}

/**
 * Let the surface of a tab list (.nav-pills) glide to its active tab. Works
 * after the list was redrawn: the glider starts where it stood last time.
 *
 * @param {HTMLElement|null} container -> The .nav-pills element.
 * @returns {void}
 */
export function glideTabs(container) {
    if (!container) return;
    let glider = container.querySelector(':scope > .nav-glider');
    if (!glider) {
        glider = document.createElement('span');
        glider.className = 'nav-glider';
        glider.setAttribute('aria-hidden', 'true');
        container.prepend(glider);
    }
    const active = container.querySelector('.nav-link.active');
    // Not laid out yet (a closed dialog, a hidden section): the tab keeps its own surface until it can be measured
    if (!active || active.offsetWidth === 0) {
        container.classList.remove('has-glider');
        toggleElement(glider, false);
        return;
    }
    container.classList.add('has-glider');
    showElement(glider);
    const target = { x: active.offsetLeft, y: active.offsetTop, width: active.offsetWidth, height: active.offsetHeight };
    const from = lastTabBox.get(container);
    gsap.set(glider, from || target);
    if (from) animateTo(glider, { ...target, duration: 0.5, ease: SPRING });
    lastTabBox.set(container, target);
}

/**
 * Glide the tabs Bootstrap switches itself (data-bs-toggle="pill") and keep
 * the navbar marker under its link when the window changes size.
 *
 * @param {Document} root -> Usually document.
 * @returns {void}
 */
export function initTabGlider(root) {
    root.addEventListener('shown.bs.tab', (event) => glideTabs(event.target?.closest?.('.nav-pills') || null));
    // Tabs drawn inside a closed dialog can be measured once it shows
    root.addEventListener('shown.bs.modal', (event) => {
        for (const tabs of event.target?.querySelectorAll?.('.nav-pills') || []) glideTabs(tabs);
    });
    window.addEventListener('resize', () => placeNavMarker(false));
    // A font that arrives late changes the width of the links
    if (root.fonts && typeof root.fonts.addEventListener === 'function') root.fonts.addEventListener('loadingdone', () => placeNavMarker(false));
}
