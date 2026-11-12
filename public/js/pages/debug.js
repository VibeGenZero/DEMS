/**
 * Styleguide (#debug, only with DEBUG_MODE=true): the tokens read from
 * tokens.css, the nine components (debug-components.js) and the page styles
 * that are not part of the library yet ("Bestand").
 */
import { registerActions } from '../core/actions.js';
import { contrastRatio, parseColor } from '../core/contrast.js';
import { escapeHtml } from '../core/ui.js';
import { renderDebugComponents } from './debug-components.js';
import { renderBadgeList, renderUpcomingRow } from './profile-view.js';

// Token groups in display order: name pattern and how a sample is drawn
const TOKEN_GROUPS = [
    { title: 'Flächen', kind: 'color', match: /^--bg-/ },
    { title: 'Text', kind: 'color', match: /^--text-/ },
    { title: 'Rahmen', kind: 'color', match: /^--border-/ },
    { title: 'Akzent', kind: 'color', match: /^--(accent|on-accent)/ },
    { title: 'Status und Discord', kind: 'color', match: /^--(on-)?(success|warning|danger|info|discord)/ },
    { title: 'Schrift', kind: 'text', match: /^--font-(body|logo)$/ },
    { title: 'Schriftgrößen', kind: 'font-size', match: /^--font-size-/ },
    { title: 'Abstände', kind: 'space', match: /^--space-/ },
    { title: 'Radien', kind: 'radius', match: /^--radius/ },
    { title: 'Schatten', kind: 'shadow', match: /^--shadow-/ },
    { title: 'Ebenen', kind: 'text', match: /^--z-/ },
    { title: 'Bewegung', kind: 'text', match: /^--(duration-|ease-|transition)/ }
];
// CSS property that shows a token on its sample element
const SAMPLE_PROPERTY = { color: 'background', 'font-size': 'font-size', space: 'width', radius: 'border-radius', shadow: 'box-shadow' };
// Text colours are measured on the card surface, where most text sits
const CONTRAST_SURFACE = '--bg-card';
const TEXT_TOKENS = ['--text-primary', '--text-secondary', '--text-muted', '--accent-text', '--success', '--warning', '--danger', '--info'];
// Text on a solid fill is measured against that fill
const FILL_OF = {
    '--on-accent': '--accent-fill', '--on-success': '--success-fill', '--on-warning': '--warning-fill',
    '--on-info': '--info-fill', '--on-danger': '--danger-fill', '--on-discord': '--discord'
};

const LEGACY_BUTTONS = ['btn-outline-primary', 'btn-outline-success', 'btn-outline-warning', 'btn-outline-danger', 'btn-warning', 'btn-link'];
// Samples of the profile page styles (PROFILE SECTION in style.css), built by the page's own functions
const SAMPLE_PROFILE_ENTRY = {
    status: 'accepted', checkedIn: false, slot: { name: 'Tank', emoji: '', wish: false },
    event: { id: 'sample', title: 'profile-event', startDate: '', endDate: '', location: 'Lobby', checkinEnabled: false }
};
const SAMPLE_BADGES = [
    { name: 'badge-row', description: 'erreicht', icon: 'bi-trophy', unlocked: true },
    { name: 'badge-row is-locked', description: '2/3 Events eingecheckt', icon: 'bi-check-all', unlocked: false, progress: 0.66 }
];
const ANIMATIONS = [
    { label: 'Fade In', run: () => gsap.fromTo('.sg-anim-demo-item', { opacity: 0 }, { opacity: 1, duration: 0.6, stagger: 0.1 }) },
    { label: 'Slide Up', run: () => gsap.fromTo('.sg-anim-demo-item', { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, stagger: 0.1, ease: 'power3.out' }) },
    { label: 'Stagger', run: () => gsap.from('.sg-anim-demo-item', { scale: 0.8, opacity: 0, duration: 0.4, stagger: 0.15, ease: 'back.out(1.7)' }) },
    { label: 'Bounce', run: () => gsap.from('.sg-anim-demo-item', { y: -30, duration: 0.5, stagger: 0.1, ease: 'bounce.out' }) },
    { label: 'Shake', run: () => gsap.to('.sg-anim-demo-item', { x: 10, duration: 0.07, repeat: 5, yoyo: true, ease: 'power1.inOut', stagger: 0.05 }) },
    { label: 'Pulse', run: () => gsap.to('.sg-anim-demo-item', { scale: 1.05, duration: 0.3, repeat: 3, yoyo: true, ease: 'power1.inOut', stagger: 0.1 }) }
];
const ICONS = [
    'calendar-event', 'calendar-check', 'calendar-x', 'people', 'person', 'person-fill',
    'gear', 'gear-fill', 'star', 'star-fill', 'trophy', 'trophy-fill',
    'check-circle', 'check-circle-fill', 'x-circle', 'x-circle-fill',
    'exclamation-triangle', 'exclamation-triangle-fill', 'info-circle', 'info-circle-fill',
    'bell', 'bell-fill', 'chat-dots', 'chat-dots-fill', 'discord', 'robot',
    'moon-stars', 'moon-stars-fill', 'sun', 'lightning', 'lightning-fill',
    'list-check', 'journal-text', 'inbox', 'hourglass-split', 'shield-check',
    'bug', 'bug-fill', 'palette', 'palette-fill', 'code-slash', 'terminal'
];

/**
 * Contrast of a colour on a surface, as text for the styleguide.
 *
 * @param {string} value -> Token value, e.g. "#8f8f9a".
 * @param {string} surface -> Surface colour.
 * @returns {string} -> e.g. "5,62 : 1"; "" when one value is no opaque plain colour.
 */
export function contrastLabel(value, surface) {
    const color = parseColor(value);
    const background = parseColor(surface);
    if (!color || !background || color.a !== 1 || background.a !== 1) return '';
    return `${contrastRatio(color, background).toFixed(2).replace('.', ',')} : 1`;
}

/**
 * Contrast line of a token tile: only for tokens that are text colours, and
 * against the surface they are meant for. Fills, surfaces and the brand violet
 * get none, a number against the card would read like a failed check.
 *
 * @param {string} name -> Token name, e.g. "--text-muted".
 * @param {(name: string) => string} valueOf -> Value of a token.
 * @returns {string} -> e.g. "5,62 : 1 auf Karte" or "5,70 : 1 auf --accent-fill"; "" for other tokens.
 */
export function contrastNote(name, valueOf) {
    const surface = TEXT_TOKENS.includes(name) ? CONTRAST_SURFACE : (Object.hasOwn(FILL_OF, name) ? FILL_OF[name] : null);
    if (!surface) return '';
    const label = contrastLabel(valueOf(name), valueOf(surface));
    if (!label) return '';
    return `${label} auf ${surface === CONTRAST_SURFACE ? 'Karte' : surface}`;
}

/**
 * Names of the custom properties that tokens.css defines, over all its rules
 * (shared tokens, dark and light scheme), each once in source order.
 *
 * @param {Iterable<{ href: string|null, cssRules: Iterable<{ selectorText?: string, style?: Iterable<string> }> }>} sheets -> document.styleSheets.
 * @returns {string[]} -> Token names; [] when tokens.css is not loaded.
 */
export function tokenNamesOf(sheets) {
    for (const sheet of sheets) {
        if (!sheet.href || !sheet.href.includes('/css/tokens.css')) continue;
        const names = new Set();
        for (const rule of sheet.cssRules) {
            if (!rule.style) continue;
            for (const name of rule.style) {
                if (name.startsWith('--')) names.add(name);
            }
        }
        return [...names];
    }
    return [];
}

function renderTokens(container) {
    const names = tokenNamesOf(document.styleSheets);
    const root = getComputedStyle(document.documentElement);
    const valueOf = (name) => root.getPropertyValue(name).trim();
    container.innerHTML = TOKEN_GROUPS.map(group => `
        <h5 class="sg-section-title">${group.title}</h5>
        <div class="sg-token-grid mb-4">${names.filter(name => group.match.test(name)).map(name => `
            <div class="sg-token" data-token="${escapeHtml(name)}" data-kind="${group.kind}">
                <div class="sg-token-sample sg-token-sample-${group.kind}"></div>
                <div class="sg-token-name">${escapeHtml(name)}</div>
                <div class="sg-token-value">${escapeHtml(valueOf(name))}</div>
                <div class="sg-token-contrast">${group.kind === 'color' ? escapeHtml(contrastNote(name, valueOf)) : ''}</div>
            </div>`).join('')}
        </div>`).join('');
    // Samples get their value through the CSSOM; new markup carries no style attributes
    for (const item of container.querySelectorAll('.sg-token')) {
        const property = SAMPLE_PROPERTY[item.dataset.kind];
        if (property) item.querySelector('.sg-token-sample').style.setProperty(property, `var(${item.dataset.token})`);
    }
}

function renderLegacy() {
    document.getElementById('sg-buttons').innerHTML = LEGACY_BUTTONS.map(variant =>
        `<button type="button" class="btn ${variant}">${variant}</button>`
    ).join('');

    document.getElementById('sg-cards').innerHTML = `
      <div class="row g-3 mb-4">
        <div class="col-md-4">
          <div class="stat-card">
            <div class="stat-icon"><i class="bi bi-star" aria-hidden="true"></i></div>
            <div class="stat-body">
              <div class="stat-value">42</div>
              <div class="stat-label">stat-card (.is-warning | -success | -info | -muted)</div>
            </div>
          </div>
        </div>
        <div class="col-md-4">
          ${renderUpcomingRow(SAMPLE_PROFILE_ENTRY, new Date(), false)}
        </div>
        <div class="col-md-4">
          <ul class="badge-list">${renderBadgeList(SAMPLE_BADGES)}</ul>
        </div>
      </div>`;

    document.getElementById('sg-spinners').innerHTML = `
      <div class="spinner-border spinner-border-sm text-secondary" title="spinner-border sm"></div>
      <div class="spinner-border text-accent" title="spinner-border md"></div>
      <div class="spinner-grow spinner-grow-sm text-success" title="spinner-grow sm"></div>
      <div class="spinner-grow text-warning" title="spinner-grow md"></div>`;

    document.getElementById('sg-alerts').innerHTML = `
      <div class="alert alert-success mb-2">alert-success — Aktion erfolgreich abgeschlossen.</div>
      <div class="alert alert-warning mb-2">alert-warning — Bitte beachte diesen Hinweis.</div>
      <div class="alert alert-danger mb-2">alert-danger — Ein Fehler ist aufgetreten.</div>
      <div class="alert alert-info mb-0">alert-info — Informationstext für den Nutzer.</div>`;

    document.getElementById('sg-anim-buttons').innerHTML = ANIMATIONS.map((animation, index) =>
        `<button type="button" class="btn btn-secondary btn-sm" data-click="sgRunAnimation" data-index="${index}">${animation.label}</button>`
    ).join('');

    document.getElementById('sg-icons').innerHTML = ICONS.map(icon =>
        `<div class="sg-icon-item" title="bi-${icon}">
          <i class="bi bi-${icon}"></i>
          <span>${icon}</span>
        </div>`
    ).join('');
}

export function showDebugSection() {
    if (!window.DEBUG_MODE) return;
    document.getElementById('debug-section').style.display = 'block';
    renderTokens(document.getElementById('sg-tokens'));
    renderDebugComponents(document.getElementById('sg-components'));
    renderLegacy();
    if (typeof gsap !== 'undefined') {
        gsap.from('.sg-section-title', { y: 15, opacity: 0, duration: 0.3, stagger: 0.05, ease: 'power3.out' });
    }
}

/**
 * Show the token values of the scheme that is now active, if the styleguide
 * was opened; values and contrasts come from the computed styles.
 *
 * @returns {void}
 */
export function refreshStyleguideTokens() {
    const container = document.getElementById('sg-tokens');
    if (container && container.innerHTML) renderTokens(container);
}

export function sgRunAnimation(index) {
    if (ANIMATIONS[index]) ANIMATIONS[index].run();
}

registerActions({
    sgRunAnimation: (el) => sgRunAnimation(Number(el.dataset.index))
});
