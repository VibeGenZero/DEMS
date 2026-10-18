/**
 * Motion of the event page: the page slides in when it opens; after a
 * registration or a check-in it updates in place and the new state springs
 * in instead (the success moment). The page keeps its look either way.
 */
import { animateFromTo, animateTo, growMeter } from '../core/motion.js';

const sidebarMeter = () => document.querySelector('#sidebar-capacity-content .capacity-meter');

/**
 * The places of the sidebar meter, read before the page is drawn again.
 *
 * @returns {number|undefined}
 */
export function sidebarTaken() {
    const meter = sidebarMeter();
    return meter ? Number(meter.value) || 0 : undefined;
}

/**
 * The clicked button presses in.
 *
 * @param {HTMLElement|null} button -> The button.
 * @returns {void}
 */
export function pressButton(button) {
    if (button) animateTo(button, { scale: 0.94, duration: 0.1, ease: 'power2.in' });
}

/**
 * Bring the drawn event page in.
 *
 * @param {'registered'|'checkedin'} [celebrate] -> Success moment instead of the slide-in.
 * @param {Object} [options] -> `{ fromTaken }`: places before a registration, the bar grows from there.
 * @returns {void}
 */
export function revealDetail(celebrate, { fromTaken } = {}) {
    const meter = sidebarMeter();
    if (celebrate === 'registered') {
        animateFromTo(document.getElementById('detail-registered'), { scale: 0.92, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.5, ease: 'back.out(2)' });
        animateFromTo('#sidebar-status-btn', { scale: 0.94 }, { scale: 1, duration: 0.5, ease: 'back.out(2.2)' });
        if (meter) growMeter(meter, { from: fromTaken ?? 0, duration: 0.6 });
        return;
    }
    if (celebrate === 'checkedin') {
        animateFromTo(document.getElementById('checkin-section'), { scale: 0.92, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.5, ease: 'back.out(2)' });
        return;
    }
    animateFromTo('#detail-main', { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: 'power3.out' });
    if (meter) growMeter(meter);
}

/**
 * The status box fades away before the page shows the form again (unregister).
 *
 * @returns {Promise<void>} -> Resolves once it is gone; it leaves no inline style behind.
 */
export function fadeOutRegistration() {
    const box = document.getElementById('detail-registered');
    if (!box) return Promise.resolve();
    return new Promise(resolve => animateTo(box, {
        opacity: 0,
        duration: 0.25,
        ease: 'power2.in',
        onComplete: () => {
            box.style.display = 'none';
            gsap.set(box, { clearProps: 'opacity' });
            resolve();
        }
    }));
}
