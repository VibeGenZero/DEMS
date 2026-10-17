/**
 * One motion language for DEMS: the spring every animation uses and the
 * switch for "Bewegung reduzieren" (prefers-reduced-motion). Under reduced
 * motion nothing moves or scales; an element jumps to its end position and
 * only fades, for 0.2 s at most.
 */

// Chosen in the card prototype (variant A, bounce 1.4)
export const SPRING = 'back.out(1.4)';

const CALM_MAX_SECONDS = 0.2;
const MOVEMENT_KEYS = ['x', 'y', 'xPercent', 'yPercent', 'scale', 'scaleX', 'scaleY', 'rotation'];
// Keys that only steer a tween; a tween without anything else changes nothing visible
const CONTROL_KEYS = ['duration', 'ease', 'delay', 'onComplete', 'onUpdate', 'onStart', 'overwrite'];

/**
 * Whether the person asked their system for less motion.
 *
 * @returns {boolean} -> True under prefers-reduced-motion: reduce.
 */
export function prefersReducedMotion() {
    return typeof window === 'object' && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The calm version of tween values: no movement, no stagger, a short linear fade.
 *
 * @param {Object} vars -> GSAP tween values.
 * @returns {Object} -> The same values without movement keys and stagger, duration at most 0.2 s, ease "none".
 */
export function calmVars(vars = {}) {
    const calm = {};
    for (const [key, value] of Object.entries(vars)) {
        if (!MOVEMENT_KEYS.includes(key) && key !== 'stagger') calm[key] = value;
    }
    calm.duration = Math.min(vars.duration ?? CALM_MAX_SECONDS, CALM_MAX_SECONDS);
    calm.ease = 'none';
    return calm;
}

function movementOf(vars = {}) {
    const moves = {};
    for (const key of MOVEMENT_KEYS) if (key in vars) moves[key] = vars[key];
    return moves;
}

function changesSomething(vars) {
    return Object.keys(vars).some(key => !CONTROL_KEYS.includes(key));
}

// Reduced motion: jump to the end position, fade what fades, or finish at once
function calmTween(targets, fromVars, toVars) {
    const moves = movementOf(toVars);
    if (Object.keys(moves).length > 0) gsap.set(targets, moves);
    const calmTo = calmVars(toVars);
    if (!changesSomething(calmTo)) {
        if (typeof calmTo.onComplete === 'function') calmTo.onComplete();
        return null;
    }
    if (!fromVars) return gsap.to(targets, calmTo);
    const calmFrom = calmVars(fromVars);
    delete calmFrom.duration;
    delete calmFrom.ease;
    return gsap.fromTo(targets, calmFrom, calmTo);
}

/**
 * gsap.to that respects reduced motion.
 *
 * @param {*} targets -> Elements or selector.
 * @param {Object} vars -> End values and tween options.
 * @returns {Object|null} -> The tween, or null when nothing was left to animate.
 */
export function animateTo(targets, vars) {
    if (!prefersReducedMotion()) return gsap.to(targets, vars);
    return calmTween(targets, null, vars);
}

/**
 * gsap.fromTo that respects reduced motion.
 *
 * @param {*} targets -> Elements or selector.
 * @param {Object} fromVars -> Start values.
 * @param {Object} toVars -> End values and tween options.
 * @returns {Object|null} -> The tween, or null when nothing was left to animate.
 */
export function animateFromTo(targets, fromVars, toVars) {
    if (!prefersReducedMotion()) return gsap.fromTo(targets, fromVars, toVars);
    return calmTween(targets, fromVars, toVars);
}

/**
 * Let a number count up from 0 to its value.
 *
 * @param {Element} element -> Element whose text is the number.
 * @param {number} to -> Final number.
 * @param {Object} [options] -> `{ duration, delay }` in seconds.
 * @returns {void}
 */
export function countUp(element, to, { duration = 0.8, delay = 0 } = {}) {
    const end = String(to);
    if (prefersReducedMotion()) {
        element.textContent = end;
        return;
    }
    const counter = { value: 0 };
    element.textContent = '0';
    gsap.to(counter, {
        value: Number(to) || 0,
        duration,
        delay,
        ease: 'power2.out',
        onUpdate: () => { element.textContent = String(Math.round(counter.value)); },
        onComplete: () => { element.textContent = end; }
    });
}

/**
 * Let a <progress> meter grow from a start value to the value it shows.
 *
 * @param {HTMLProgressElement} meter -> Meter with its final value set.
 * @param {Object} [options] -> `{ from, duration, delay }`; from defaults to 0.
 * @returns {void}
 */
export function growMeter(meter, { from = 0, duration = 0.8, delay = 0 } = {}) {
    if (prefersReducedMotion()) return;
    const to = Number(meter.value) || 0;
    gsap.fromTo(meter, { value: from }, { value: to, duration, delay, ease: SPRING });
}

/**
 * Let every Bootstrap dialog spring open and shrink away, and the toast glide
 * out. Bootstrap keeps its short fade; GSAP moves the dialog box. Called once
 * at startup from main.js.
 *
 * @param {Document} root -> Usually document; the Bootstrap events bubble up to it.
 * @returns {void}
 */
export function initDialogMotion(root) {
    const dialogOf = (event) => event.target?.querySelector?.('.modal-dialog') || null;
    root.addEventListener('show.bs.modal', (event) => {
        const dialog = dialogOf(event);
        if (dialog) animateFromTo(dialog, { scale: 0.86, y: 12, opacity: 0 }, { scale: 1, y: 0, opacity: 1, duration: 0.45, ease: SPRING });
    });
    // Bootstrap removes a dialog and a toast after its own 0.15 s fade
    root.addEventListener('hide.bs.modal', (event) => {
        const dialog = dialogOf(event);
        if (dialog && !event.defaultPrevented) animateTo(dialog, { scale: 0.94, opacity: 0, duration: 0.15, ease: 'power2.in' });
    });
    root.addEventListener('hide.bs.toast', (event) => {
        if (event.target && !event.defaultPrevented) animateTo(event.target, { x: 40, opacity: 0, duration: 0.15, ease: 'power2.in' });
    });
}

/**
 * Let several meters grow one after the other.
 *
 * @param {Iterable<HTMLProgressElement>} meters -> Meters with their final values set.
 * @param {Object} [options] -> `{ stagger, delay }` in seconds; stagger defaults to 0.12.
 * @returns {void}
 */
export function growMeters(meters, { stagger = 0.12, delay = 0 } = {}) {
    [...meters].forEach((meter, i) => growMeter(meter, { delay: delay + i * stagger }));
}

/**
 * Let bars whose width is set inline grow from 0 to that width, one after the other.
 *
 * @param {Iterable<HTMLElement>} bars -> Bars with style.width set (applyStyleData).
 * @param {Object} [options] -> `{ stagger, delay, duration }` in seconds.
 * @returns {void}
 */
export function growWidths(bars, { stagger = 0.12, delay = 0, duration = 0.8 } = {}) {
    if (prefersReducedMotion()) return;
    [...bars].forEach((bar, i) => {
        const end = bar.style.width;
        if (end) gsap.fromTo(bar, { width: '0%' }, { width: end, duration, delay: delay + i * stagger, ease: SPRING });
    });
}

/**
 * Let every number count up from 0 to the number its text shows.
 *
 * @param {Iterable<Element>} elements -> Elements whose text is a whole number.
 * @param {Object} [options] -> `{ duration, delay }` for countUp.
 * @returns {void}
 */
export function countUpAll(elements, options = {}) {
    for (const element of elements) {
        const text = String(element.textContent).trim();
        if (/^\d+$/.test(text)) countUp(element, Number(text), options);
    }
}
