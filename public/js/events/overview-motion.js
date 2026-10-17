/**
 * Filtering the overview with motion: cards that drop out shrink away, the
 * remaining ones glide from where they stood to their new place, new ones
 * spring in. The layout itself stays the grid of style.css; only transforms
 * move (a FLIP: measure, redraw, play the difference back).
 */
import { animateFromTo, animateTo, SPRING } from '../core/motion.js';

// The leave phase that still runs: { finish } draws its result at once
let pending = null;

/**
 * Which cards leave, stay and enter when the visible list changes.
 *
 * @param {string[]} beforeIds -> Event ids shown now.
 * @param {string[]} afterIds -> Event ids shown next.
 * @returns {{ leaving: string[], staying: string[], entering: string[] }} -> staying and entering in the new order.
 */
export function planFilterTransition(beforeIds, afterIds) {
    const before = new Set(beforeIds);
    const after = new Set(afterIds);
    return {
        leaving: beforeIds.filter(id => !after.has(id)),
        staying: afterIds.filter(id => before.has(id)),
        entering: afterIds.filter(id => !before.has(id))
    };
}

/**
 * Offset that puts a moved card back where it stood.
 *
 * @param {{ left: number, top: number }} before -> Old box.
 * @param {{ left: number, top: number }} after -> New box.
 * @returns {{ x: number, y: number }}
 */
export function flipOffset(before, after) {
    return { x: before.left - after.left, y: before.top - after.top };
}

const cardsOf = (grid) => [...grid.querySelectorAll('.event-card[data-event-id]')];

/**
 * Redraw the overview grid for a new filter with motion.
 *
 * @param {HTMLElement} grid -> #events-grid.
 * @param {string[]} nextIds -> Event ids the filter shows next.
 * @param {Function} render -> Draws the grid for the current filter.
 * @returns {void}
 */
export function filterOverview(grid, nextIds, render) {
    // A new filter while cards still leave: draw that result at once, then start over
    if (pending) pending.finish();
    const current = cardsOf(grid);
    const before = new Map(current.map(card => [card.dataset.eventId, card.getBoundingClientRect()]));
    gsap.killTweensOf(current);
    const plan = planFilterTransition([...before.keys()], nextIds);

    let done = false;
    const relayout = () => {
        if (done) return;
        done = true;
        pending = null;
        render();
        for (const card of cardsOf(grid)) {
            const old = before.get(card.dataset.eventId);
            if (!old) {
                animateFromTo(card, { scale: 0.7, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.45, ease: SPRING });
                continue;
            }
            const { x, y } = flipOffset(old, card.getBoundingClientRect());
            if (x !== 0 || y !== 0) animateFromTo(card, { x, y }, { x: 0, y: 0, duration: 0.55, ease: SPRING });
        }
    };

    const leaving = current.filter(card => plan.leaving.includes(card.dataset.eventId));
    if (leaving.length === 0) {
        relayout();
        return;
    }
    pending = {
        finish: () => {
            gsap.killTweensOf(leaving);
            relayout();
        }
    };
    animateTo(leaving, { scale: 0.7, opacity: 0, duration: 0.18, ease: 'power2.in', onComplete: relayout });
}
