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
