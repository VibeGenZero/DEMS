/**
 * A little celebration when the news dialog shows a new version: confetti
 * for a major version (3.0.0), a power-up for a minor one (3.1.0), bugs that
 * pop up and scurry off for a patch (3.0.1). Plays once per version and
 * browser, never with "reduce motion". Styles: UPDATE EFFECTS in style.css.
 */
import { registerActions } from './actions.js';
import { showElement } from './ui.js';

// Pieces per effect, the icons they cycle through, and how long one piece moves (ms)
const EFFECTS = {
    confetti: { count: 60, icons: [], minDuration: 2200, maxDuration: 3400, maxDelay: 800 },
    powerup: { count: 28, icons: ['lightning-charge-fill', 'stars', 'plus-lg', 'arrow-up'], minDuration: 1600, maxDuration: 2600, maxDelay: 900 },
    bugs: { count: 14, icons: ['bug-fill'], minDuration: 2400, maxDuration: 3200, maxDelay: 1200 }
};
// Class of a piece per effect
const PIECE_CLASS = { confetti: 'is-confetti', powerup: 'is-powerup', bugs: 'is-bug' };
// Colour classes .update-effect-tone-1 … -6
const TONES = 6;
// Bands around the dialog where bugs appear, in percent of the screen: [left from, left to, top from, top to]
const BUG_BANDS = [[3, 22, 10, 88], [78, 97, 10, 88], [22, 78, 4, 16], [22, 78, 82, 94]];
// Version whose effect this browser has seen
const SEEN_KEY = 'dems_last_effect_version';
// Time the layer stays after the last piece has finished (ms)
const CLEANUP_MARGIN_MS = 300;

// Counts the effects played, so the cleanup of an older one leaves a newer one alone
let effectRun = 0;

/**
 * Effect that fits a version number.
 *
 * @param {string} version -> Version of updates.json, e.g. "3.1.0", "v3.0.0" or "3.0.0-beta.1".
 * @returns {string|null} -> "bugs" for a patch (x.y.1), "powerup" for a minor version (x.1.0), "confetti" for a major one (x.0.0); null when the text is no version number.
 */
export function updateEffectKind(version) {
    const match = typeof version === 'string' ? version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/) : null;
    if (!match) return null;
    if (Number(match[3]) > 0) return 'bugs';
    return Number(match[2]) > 0 ? 'powerup' : 'confetti';
}

/**
 * Pieces of an effect with their random places and timings.
 *
 * @param {string} kind -> "confetti", "powerup" or "bugs".
 * @param {Function} [random] -> Source of numbers in [0, 1); the tests pass a repeatable one.
 * @returns {Array<Object>} -> `{ kind, tone, icon, left, top?, delay, duration, drift, turn }` per piece: `left`/`top` in percent of the screen (`top` only for bugs, which sit around the dialog), `delay`/`duration` in ms, `drift` sideways in vw, `turn` in degrees. Empty for an unknown kind.
 */
export function buildEffectPieces(kind, random = Math.random) {
    if (typeof kind !== 'string' || !Object.hasOwn(EFFECTS, kind)) return [];
    const effect = EFFECTS[kind];
    const between = (min, max) => min + random() * (max - min);
    return Array.from({ length: effect.count }, (_, index) => {
        const piece = {
            kind,
            tone: (index % TONES) + 1,
            icon: effect.icons.length ? effect.icons[index % effect.icons.length] : '',
            left: Math.round(between(2, 98) * 10) / 10,
            delay: Math.round(between(0, effect.maxDelay)),
            duration: Math.round(between(effect.minDuration, effect.maxDuration)),
            drift: Math.round(between(-12, 12)),
            turn: Math.round(between(-360, 360))
        };
        if (kind === 'bugs') {
            const [leftFrom, leftTo, topFrom, topTo] = BUG_BANDS[index % BUG_BANDS.length];
            piece.left = Math.round(between(leftFrom, leftTo) * 10) / 10;
            piece.top = Math.round(between(topFrom, topTo) * 10) / 10;
        }
        return piece;
    });
}

/**
 * Markup of an effect's pieces. Places and timings travel as data attributes,
 * because the CSP allows no style attribute; applyEffectData() sets them.
 *
 * @param {string} kind -> "confetti", "powerup" or "bugs".
 * @param {Function} [random] -> Source of numbers in [0, 1).
 * @returns {string} -> HTML of all pieces: icons for power-up and bugs, plain shapes for confetti; empty for an unknown kind.
 */
export function renderEffectPieces(kind, random = Math.random) {
    return buildEffectPieces(kind, random).map(renderEffectPiece).join('');
}

function renderEffectPiece(piece) {
    const classes = `update-effect-piece ${PIECE_CLASS[piece.kind]} update-effect-tone-${piece.tone}`;
    const data = `data-fx-left="${piece.left}" data-fx-delay="${piece.delay}" data-fx-duration="${piece.duration}" data-fx-drift="${piece.drift}" data-fx-turn="${piece.turn}"`
        + (piece.top === undefined ? '' : ` data-fx-top="${piece.top}"`);
    return piece.icon
        ? `<i class="bi bi-${piece.icon} ${classes}" ${data}></i>`
        : `<span class="${classes}" ${data}></span>`;
}

/**
 * Give the rendered pieces their places and timings through the CSSOM.
 *
 * @param {Element} layer -> Element that holds the pieces.
 * @returns {void}
 */
function applyEffectData(layer) {
    for (const piece of layer.querySelectorAll('.update-effect-piece')) {
        const { fxLeft, fxTop, fxDelay, fxDuration, fxDrift, fxTurn } = piece.dataset;
        piece.style.left = `${Number(fxLeft) || 0}%`;
        if (fxTop !== undefined) piece.style.top = `${Number(fxTop) || 0}%`;
        piece.style.animationDelay = `${Number(fxDelay) || 0}ms`;
        piece.style.animationDuration = `${Number(fxDuration) || 0}ms`;
        piece.style.setProperty('--fx-drift', `${Number(fxDrift) || 0}vw`);
        piece.style.setProperty('--fx-turn', `${Number(fxTurn) || 0}deg`);
    }
}

// People who asked their system for less motion get none
function prefersReducedMotion() {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Play an effect over the page. The layer takes no clicks and empties itself when the last piece is done.
 *
 * @param {string} kind -> "confetti", "powerup" or "bugs".
 * @returns {boolean} -> true when the effect started; false for an unknown kind, with reduced motion, or without the layer.
 */
export function playUpdateEffect(kind) {
    const layer = document.getElementById('update-effects');
    const pieces = buildEffectPieces(kind);
    if (!layer || pieces.length === 0 || prefersReducedMotion()) return false;

    const run = ++effectRun;
    layer.innerHTML = pieces.map(renderEffectPiece).join('');
    applyEffectData(layer);
    showElement(layer);
    setTimeout(() => {
        if (run !== effectRun) return;
        layer.innerHTML = '';
        layer.style.display = 'none';
    }, Math.max(...pieces.map(piece => piece.delay + piece.duration)) + CLEANUP_MARGIN_MS);
    return true;
}

/**
 * Celebrate a version the first time this browser meets it.
 *
 * @param {string} version -> Version of updates.json.
 * @returns {string|null} -> The effect that started, or null (already seen, no version number, reduced motion).
 */
export function celebrateUpdate(version) {
    const kind = updateEffectKind(version);
    if (!kind || localStorage.getItem(SEEN_KEY) === version) return null;
    if (!playUpdateEffect(kind)) return null;
    localStorage.setItem(SEEN_KEY, version);
    return kind;
}

registerActions({
    playUpdateEffect: (el) => playUpdateEffect(el.dataset.kind)
});
