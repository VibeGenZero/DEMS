/**
 * Card flight: an overview card lifts, springs into the middle of the window
 * and grows into its event page; closing shrinks the page back into the card,
 * which springs home to its place. Timing and spring come from the prototype
 * of spec 2026-10-17-gsap-animations (variant A, bounce 1.4, duration 1.0).
 *
 * A fixed layer (#card-flight) carries copies of the card and of the page;
 * the router shows the real page underneath once the sheet covers the window.
 */
import { registerActions } from '../core/actions.js';
import { prefersReducedMotion, SPRING } from '../core/motion.js';
import { handleRoute, navigateTo } from '../core/router.js';
import { state } from '../core/state.js';
import { toggleElement } from '../core/ui.js';

export const FLIGHT_OPEN = { dim: 0.4, recede: 0.6, lift: 0.5, growAt: 0.42, grow: 0.55, faceOut: 0.18, contentIn: 0.35 };
export const FLIGHT_CLOSE = { contentOut: 0.15, faceInAt: 0.3, faceIn: 0.2, shrinkAt: 0.05, shrink: 0.45, homeOverlap: 0.06, home: 0.55, recede: 0.55, dim: 0.45 };
export const LIFT_SCALE = 1.06;
export const RECEDE_SCALE = 0.95;
export const SCRIM_OPACITY = 0.8;
// Height of .event-detail-banner-header in style.css (a test keeps both equal)
export const DETAIL_BANNER_HEIGHT = 220;
export const LAND_TIMEOUT_MS = 1500;
const FADE_AWAY_SECONDS = 0.3;

// The flight of the open event page: { eventId, media, radius, mediaBox, scrollY, size, face }
let flight = null;
// "opening" or "closing" while the layer moves
let phase = null;

/**
 * Whether a click is a plain left click (a modifier click opens a new tab instead).
 *
 * @param {MouseEvent|Object} event -> Click event.
 * @returns {boolean}
 */
export function isPlainClick(event = {}) {
    return (event.button ?? 0) === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
}

/**
 * Box of a card of the same size in the middle of the window.
 *
 * @param {{ width: number, height: number }} rect -> Card size.
 * @param {{ width: number, height: number }} viewport -> Window size.
 * @returns {{ left: number, top: number, width: number, height: number }}
 */
export function centerRect(rect, viewport) {
    return { left: (viewport.width - rect.width) / 2, top: (viewport.height - rect.height) / 2, width: rect.width, height: rect.height };
}

/**
 * Box of the whole window; the fixed navbar stays on top of it like on the event page.
 *
 * @param {{ width: number, height: number }} viewport -> Window size.
 * @returns {{ left: number, top: number, width: number, height: number }}
 */
export function fullRect(viewport) {
    return { left: 0, top: 0, width: viewport.width, height: viewport.height };
}

const viewportSize = () => ({ width: document.documentElement.clientWidth, height: window.innerHeight });
const boxOf = (rect) => ({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
// Play a timeline; while it runs, stopFlight() can cut it short (the promise still resolves)
let stopRunning = null;
const play = (build) => new Promise((resolve) => {
    const timeline = gsap.timeline({ onComplete: () => { stopRunning = null; resolve(); } });
    stopRunning = () => { stopRunning = null; timeline.kill(); resolve(); };
    build(timeline);
});
// The overview content scales back; the section itself runs the CSS section fade
const overviewContent = () => document.getElementById('events-section')?.firstElementChild || null;

// Copies must not answer clicks nor duplicate ids. A copied style attribute
// would break the CSP (style-src-attr 'none'), so the inline styles are lifted
// off before cloning and handed to both trees again through the CSSOM.
function inertCopy(node) {
    const originals = [node, ...node.querySelectorAll('*')];
    const styles = originals.map(element => element.getAttribute('style'));
    originals.forEach((element, i) => { if (styles[i] !== null) element.removeAttribute('style'); });
    const copy = node.cloneNode(true);
    const copies = [copy, ...copy.querySelectorAll('*')];
    originals.forEach((element, i) => {
        if (styles[i] === null) return;
        element.style.cssText = styles[i];
        copies[i].style.cssText = styles[i];
    });
    for (const element of [copy, ...copy.querySelectorAll('[id], [data-click], [href]')]) {
        element.removeAttribute('id');
        element.removeAttribute('data-click');
        element.removeAttribute('href');
    }
    return copy;
}

// Build the layer: scrim, sheet with banner, card face and (when closing) the page
function buildLayer({ sheetBox, radius, bannerBox, faceOpacity }) {
    const layer = document.getElementById('card-flight');
    layer.innerHTML = '<div class="card-flight-scrim"></div><div class="card-flight-sheet"><div class="card-flight-banner"></div><div class="card-flight-face"></div></div>';
    const parts = {
        layer,
        scrim: layer.querySelector('.card-flight-scrim'),
        sheet: layer.querySelector('.card-flight-sheet'),
        banner: layer.querySelector('.card-flight-banner'),
        face: layer.querySelector('.card-flight-face')
    };
    const media = inertCopy(flight.media);
    media.querySelector('.event-card-category')?.remove();
    parts.banner.append(media);
    parts.banner.insertAdjacentHTML('beforeend', '<div class="card-flight-banner-overlay"></div>');
    // The same copy of the card serves both ways; append() moves it into the new layer
    parts.face.append(flight.face);
    gsap.set(parts.sheet, { ...sheetBox, borderRadius: radius, scale: 1 });
    gsap.set(parts.banner, bannerBox);
    // The face is the whole card: it keeps the card's size instead of stretching with the sheet
    gsap.set(parts.face, { opacity: faceOpacity, width: flight.size.width, height: flight.size.height });
    toggleElement(layer, true);
    return parts;
}

function clearLayer() {
    const layer = document.getElementById('card-flight');
    if (!layer) return;
    toggleElement(layer, false);
    layer.innerHTML = '';
}

function endFlight() {
    document.querySelectorAll('#events-grid .event-card.is-flying').forEach(card => card.classList.remove('is-flying'));
    const content = overviewContent();
    if (content) gsap.set(content, { clearProps: 'transform,transformOrigin' });
    state.flyingEventId = null;
    flight = null;
    phase = null;
    clearLayer();
}

/**
 * Open an overview card: fly it into its event page (action "openEventCard").
 *
 * @param {HTMLElement} card -> The clicked .event-card.
 * @param {MouseEvent|Object} [event] -> The click; a modifier click never gets here (core/actions.js).
 * @returns {Promise<void>} -> Resolves once the event page is shown.
 */
export async function openEventCard(card, event = {}) {
    const eventId = card.dataset.eventId;
    if (!eventId || phase) return;
    if (prefersReducedMotion() || !isPlainClick(event)) {
        navigateTo(`event/${eventId}`);
        return;
    }
    phase = 'opening';
    const viewport = viewportSize();
    const origin = boxOf(card.getBoundingClientRect());
    const media = card.querySelector('.event-card-media');
    const mediaRect = media ? media.getBoundingClientRect() : { left: origin.left, top: origin.top, width: origin.width, height: 0 };
    flight = {
        eventId,
        media: media || document.createElement('div'),
        radius: parseFloat(getComputedStyle(card).borderTopLeftRadius) || 0,
        mediaBox: { left: mediaRect.left - origin.left, top: mediaRect.top - origin.top, width: mediaRect.width, height: mediaRect.height, borderRadius: media ? parseFloat(getComputedStyle(media).borderTopLeftRadius) || 0 : 0 },
        scrollY: window.scrollY,
        size: { width: origin.width, height: origin.height },
        face: inertCopy(card)
    };
    state.flyingEventId = eventId;
    const parts = buildLayer({ sheetBox: origin, radius: flight.radius, bannerBox: flight.mediaBox, faceOpacity: 1 });
    card.classList.add('is-flying');
    const content = overviewContent();
    if (content) {
        const box = content.getBoundingClientRect();
        gsap.set(content, { transformOrigin: `${viewport.width / 2 - box.left}px ${viewport.height / 2 - box.top}px` });
    }

    const o = FLIGHT_OPEN;
    const opened = flight;
    await play(tl => {
        tl.to(parts.scrim, { opacity: SCRIM_OPACITY, duration: o.dim, ease: 'none' }, 0);
        if (content) tl.to(content, { scale: RECEDE_SCALE, duration: o.recede, ease: 'power2.out' }, 0);
        tl.to(parts.sheet, { ...centerRect(origin, viewport), scale: LIFT_SCALE, duration: o.lift, ease: SPRING }, 0);
        tl.to(parts.sheet, { ...fullRect(viewport), scale: 1, borderRadius: 0, duration: o.grow, ease: 'power3.inOut' }, o.growAt);
        tl.to(parts.banner, { left: 0, top: 0, width: viewport.width, height: DETAIL_BANNER_HEIGHT, borderRadius: 0, duration: o.grow, ease: 'power3.inOut' }, o.growAt);
        tl.to(parts.face, { opacity: 0, duration: o.faceOut, ease: 'none' }, o.growAt);
    });

    // Someone went elsewhere meanwhile (navbar, back button): their way wins
    if (flight !== opened || opened.aborted) {
        if (flight === opened) endFlight();
        return;
    }

    // The sheet covers the window: show the real page underneath, then let it through
    history.pushState(null, '', `#event/${eventId}`);
    window.scrollTo(0, 0);
    await handleRoute();
    if (content) gsap.set(content, { clearProps: 'transform,transformOrigin' });
    await play(tl => tl.to(parts.layer, { opacity: 0, duration: o.contentIn, ease: 'power2.out' }));
    gsap.set(parts.layer, { clearProps: 'opacity' });
    // Left for another page while the layer faded: nothing to fly home to
    if (opened.aborted) {
        endFlight();
        return;
    }
    clearLayer();
    phase = null;
}

/**
 * Start closing a page that was opened by a card flight. The router calls it
 * before it hides the sections, so the sheet can copy the page as it is.
 *
 * @param {string} route -> The route the router is about to show.
 * @returns {boolean} -> True when the flight home has begun (finish it with landCardFlight).
 */
export function beginCardClose(route) {
    if (!flight) return false;
    // A route change while the card still flies open, other than the flight's own: stop the flight
    if (phase === 'opening' && window.location.hash !== `#event/${flight.eventId}`) {
        flight.aborted = true;
        if (stopRunning) stopRunning();
        return false;
    }
    if (phase) return false;
    if (route !== 'events') {
        endFlight();
        return false;
    }
    phase = 'closing';
    const viewport = viewportSize();
    const parts = buildLayer({ sheetBox: fullRect(viewport), radius: 0, bannerBox: { left: 0, top: -window.scrollY, width: viewport.width, height: DETAIL_BANNER_HEIGHT, borderRadius: 0 }, faceOpacity: 0 });
    gsap.set(parts.scrim, { opacity: SCRIM_OPACITY });
    const page = document.getElementById('event-detail-section');
    if (page) {
        const box = page.getBoundingClientRect();
        const copy = inertCopy(page);
        copy.classList.add('card-flight-page');
        gsap.set(copy, { left: box.left, top: box.top, width: box.width });
        parts.sheet.insertBefore(copy, parts.face);
        parts.page = copy;
    }
    flight.parts = parts;
    const content = overviewContent();
    if (content) gsap.set(content, { scale: RECEDE_SCALE, transformOrigin: '50% 50%' });
    return true;
}

/**
 * Finish a close begun by beginCardClose: shrink into the card and fly home
 * once the overview is drawn (or fade away in the middle after LAND_TIMEOUT_MS).
 *
 * @param {Promise<void>} overviewShown -> Resolves once the overview is drawn.
 * @returns {Promise<void>}
 */
export async function landCardFlight(overviewShown) {
    if (!flight || phase !== 'closing') return;
    const { parts, eventId, size } = flight;
    const c = FLIGHT_CLOSE;
    // The cached cards are drawn already: back to where the overview was
    window.scrollTo(0, flight.scrollY);
    const viewport = viewportSize();
    const shrunk = play(tl => {
        if (parts.page) tl.to(parts.page, { opacity: 0, duration: c.contentOut, ease: 'none' }, 0);
        tl.to(parts.face, { opacity: 1, duration: c.faceIn, ease: 'none' }, c.faceInAt);
        tl.to(parts.sheet, { ...centerRect(size, viewport), scale: LIFT_SCALE, borderRadius: flight.radius, duration: c.shrink, ease: 'power3.inOut' }, c.shrinkAt);
        tl.to(parts.banner, { ...flight.mediaBox, duration: c.shrink, ease: 'power3.inOut' }, c.shrinkAt);
    });
    const homeAt = (c.shrinkAt + c.shrink - c.homeOverlap) * 1000;
    await Promise.all([wait(homeAt), Promise.race([overviewShown, wait(LAND_TIMEOUT_MS)])]);

    const card = document.querySelector(`#events-grid .event-card[data-event-id="${CSS.escape(eventId)}"]`);
    const content = overviewContent();
    // Measure where the card stands once the overview is back at full size
    if (content) gsap.set(content, { scale: 1 });
    const rect = card ? card.getBoundingClientRect() : null;
    if (content) gsap.set(content, { scale: RECEDE_SCALE });
    const visible = rect && rect.width > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
    await play(tl => {
        if (visible) tl.to(parts.sheet, { ...boxOf(rect), scale: 1, duration: c.home, ease: SPRING }, 0);
        else tl.to(parts.sheet, { opacity: 0, scale: 0.9, duration: FADE_AWAY_SECONDS, ease: 'power2.in' }, 0);
        tl.to(parts.scrim, { opacity: 0, duration: c.dim, ease: 'none' }, 0);
        if (content) tl.to(content, { scale: 1, duration: c.recede, ease: 'power2.out' }, 0);
    });
    await shrunk;
    endFlight();
}

/**
 * "Zurück zur Übersicht": go back the way the card came, else open the overview.
 *
 * @returns {void}
 */
export function closeEventPage() {
    if (flight && !phase) history.back();
    else navigateTo('events');
}

/**
 * Esc closes a page that a card flight opened, unless a dialog is open or
 * someone is typing.
 *
 * @param {Document} root -> Usually document.
 * @returns {void}
 */
export function initCardFlight(root) {
    root.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || !flight || phase) return;
        if (window.location.hash !== `#event/${flight.eventId}`) return;
        if (document.querySelector('.modal.show')) return;
        const target = event.target;
        if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) return;
        closeEventPage();
    });
}

registerActions({
    openEventCard: (el, event) => openEventCard(el, event),
    closeEventPage: () => closeEventPage()
});
