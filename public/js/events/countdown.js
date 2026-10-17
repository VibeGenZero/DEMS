/**
 * Countdown on the event page. Every digit sits in its own cell; once a
 * second only the digits that change flip: the old one leaves upwards, the
 * new one springs in from below, like a split-flap board.
 */
import { prefersReducedMotion, SPRING } from '../core/motion.js';
import { state } from '../core/state.js';

const EXPIRED_HTML = '<span class="countdown-expired"><i class="bi bi-clock-history me-1"></i>Event hat bereits begonnen</span>';
const UNITS = ['Tage', 'Std', 'Min', 'Sek'];

/**
 * Time left until a date.
 *
 * @param {string} targetDate -> ISO date.
 * @returns {{ days: number, hours: number, mins: number, secs: number }|null} -> null once the date has passed.
 */
export function formatCountdown(targetDate) {
    const diff = new Date(targetDate) - new Date();
    if (diff <= 0) return null;
    return {
        days: Math.floor(diff / (1000 * 60 * 60 * 24)),
        hours: Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
        mins: Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)),
        secs: Math.floor((diff % (1000 * 60)) / 1000)
    };
}

// Days as they are, the rest with two digits
const unitTexts = (cd) => [String(cd.days), ...[cd.hours, cd.mins, cd.secs].map(value => String(value).padStart(2, '0'))];
const digitCells = (text) => [...text].map(char => `<span class="countdown-digit"><span>${char}</span></span>`).join('');

/**
 * Markup of the countdown: one cell per digit.
 *
 * @param {Object|null} cd -> Result of formatCountdown.
 * @returns {string}
 */
export function renderCountdownHTML(cd) {
    if (!cd) return EXPIRED_HTML;
    return unitTexts(cd).map((text, i) => `<div class="countdown-item"><span class="countdown-value">${digitCells(text)}</span><span class="countdown-label">${UNITS[i]}</span></div>`).join('');
}

/**
 * Positions of the digits that differ between two texts of one unit.
 *
 * @param {string} oldText -> Shown text.
 * @param {string} newText -> Next text.
 * @returns {number[]|'rebuild'} -> 'rebuild' when the number of digits changes (10 -> 9 days).
 */
export function changedDigits(oldText, newText) {
    if (oldText.length !== newText.length) return 'rebuild';
    return [...newText].map((char, i) => (char === oldText[i] ? -1 : i)).filter(i => i >= 0);
}

// One digit flips: the old one leaves upwards, the new one springs in from below
function flipDigit(cell, char) {
    if (!cell) return;
    // A flip that has not ended yet (a slow tab) ends now
    const children = [...cell.children];
    if (children.length > 1) {
        gsap.killTweensOf(children);
        children.slice(0, -1).forEach(child => child.remove());
    }
    const old = cell.lastElementChild;
    const next = document.createElement('span');
    next.textContent = char;
    if (!old || prefersReducedMotion()) {
        cell.replaceChildren(next);
        return;
    }
    old.classList.remove('countdown-digit-next');
    gsap.set(old, { clearProps: 'all' });
    next.className = 'countdown-digit-next';
    cell.append(next);
    gsap.to(old, { yPercent: -100, opacity: 0, duration: 0.35, ease: 'power2.in' });
    // The old digit keeps the cell's width until the new one has landed
    gsap.fromTo(next, { yPercent: 100 }, {
        yPercent: 0, duration: 0.5, ease: SPRING,
        onComplete: () => {
            old.remove();
            next.classList.remove('countdown-digit-next');
        }
    });
}

/**
 * Run the countdown in `element` until the date has passed.
 *
 * @param {HTMLElement} element -> Countdown area.
 * @param {string} targetDate -> ISO date.
 * @returns {number|undefined} -> The interval id while it runs.
 */
export function startCountdown(element, targetDate) {
    let timer; // Declare first to avoid TDZ
    let shown = null;
    const update = () => {
        const cd = formatCountdown(targetDate);
        if (!cd) {
            element.innerHTML = EXPIRED_HTML;
            if (timer) clearInterval(timer);
            element.classList.remove('countdown-live');
            return false;
        }
        const texts = unitTexts(cd);
        if (!shown) {
            element.innerHTML = renderCountdownHTML(cd);
        } else {
            const values = element.querySelectorAll('.countdown-value');
            texts.forEach((text, unit) => {
                const change = changedDigits(shown[unit], text);
                if (change === 'rebuild') {
                    if (values[unit]) values[unit].innerHTML = digitCells(text);
                    return;
                }
                const cells = values[unit] ? values[unit].querySelectorAll('.countdown-digit') : [];
                change.forEach(i => flipDigit(cells[i], text[i]));
            });
        }
        shown = texts;
        return true;
    };

    // Run once immediately
    if (update()) {
        timer = setInterval(update, 1000);
        state.countdownTimers.push(timer);
        return timer;
    }
}
