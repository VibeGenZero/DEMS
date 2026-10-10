const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const vm = require('vm');
const { loadFrontendModules, REPO_ROOT } = require('./helpers');
const { readCss, readTokens } = require('./cssSource');

const TOKENS = readTokens(readCss('tokens.css'));
const CONTRAST_FILE = path.join(REPO_ROOT, 'public', 'js', 'core', 'contrast.js');

const REQUIRED = [
    '--bg-primary', '--bg-secondary', '--bg-card', '--bg-glass', '--bg-glass-hover', '--bg-tint-1', '--bg-tint-2', '--bg-tint-3', '--bg-inset', '--bg-scrim',
    '--text-primary', '--text-secondary', '--text-muted',
    '--border-subtle', '--border-strong', '--border-accent',
    '--accent', '--accent-light', '--accent-dark', '--accent-text', '--accent-fill', '--accent-fill-hover', '--on-accent', '--accent-tint-1', '--accent-tint-2', '--accent-glow',
    '--success', '--success-bg', '--success-border', '--success-fill', '--on-success',
    '--warning', '--warning-bg', '--warning-border', '--warning-fill', '--on-warning',
    '--danger', '--danger-bg', '--danger-border', '--danger-fill', '--danger-fill-hover', '--on-danger',
    '--info', '--info-bg', '--info-border', '--info-fill', '--on-info',
    '--discord', '--discord-hover', '--on-discord',
    '--font-body', '--font-logo',
    '--font-size-xs', '--font-size-sm', '--font-size-md', '--font-size-lg', '--font-size-xl', '--font-size-2xl', '--font-size-3xl', '--font-size-4xl', '--font-size-display', '--font-size-logo',
    '--space-4', '--space-8', '--space-12', '--space-16', '--space-24', '--space-32', '--space-48', '--space-64',
    '--radius-sm', '--radius', '--radius-lg', '--radius-pill',
    '--z-dropdown', '--z-sticky', '--z-nav', '--z-banner', '--z-dialog', '--z-toast', '--z-overlay',
    '--shadow-sm', '--shadow-md', '--shadow-lg', '--shadow-glow', '--shadow-ring',
    '--duration-fast', '--duration-base', '--duration-slow', '--ease-standard', '--transition'
];

// Tokens whose value must be one plain colour
const COLOR_TOKEN = /^--(bg-|text-|border-|accent|on-|success|warning|danger|info|discord)/;
// --bg-glass and --bg-glass-hover are translucent and lie on the page background
const BASE_SURFACES = ['--bg-primary', '--bg-secondary', '--bg-card', '--bg-glass', '--bg-glass-hover'];
const TEXT_COLORS = ['--text-primary', '--text-secondary', '--text-muted', '--accent-text', '--success', '--warning', '--danger', '--info'];
const STRONG_TEXT = ['--text-primary', '--text-secondary'];
const OWN_TINT = { '--success': '--success-bg', '--warning': '--warning-bg', '--danger': '--danger-bg', '--info': '--info-bg', '--accent-text': '--accent-tint-2' };
const FILLS = {
    '--on-accent': ['--accent-fill', '--accent-fill-hover'],
    '--on-success': ['--success-fill'],
    '--on-warning': ['--warning-fill'],
    '--on-info': ['--info-fill'],
    '--on-danger': ['--danger-fill', '--danger-fill-hover'],
    '--on-discord': ['--discord', '--discord-hover']
};
const AA_TEXT = 4.5;
const AA_NON_TEXT = 3;

/**
 * Contrast helpers bound to the tokens: color(name), surface(base), on(tint, base), ratio(text, background).
 */
async function loadPalette() {
    const { parseColor, composite, contrastRatio } = (await loadFrontendModules(CONTRAST_FILE, vm.createContext({}))).get('contrast.js');
    const color = (name) => {
        const parsed = parseColor(TOKENS.get(name));
        assert.ok(parsed, `${name} is not a plain colour: ${TOKENS.get(name)}`);
        return parsed;
    };
    const surface = (base) => composite(color(base), color('--bg-primary'));
    const on = (tint, base) => composite(color(tint), surface(base));
    const ratio = (text, background) => contrastRatio(color(text), background);
    return { parseColor, color, surface, on, ratio };
}

const tooLow = (label, value, minimum) => (value < minimum ? [`${label}: ${value.toFixed(2)} < ${minimum}`] : []);

test('every required token is defined', () => {
    assert.deepEqual(REQUIRED.filter(name => !TOKENS.has(name)), []);
});

test('every colour token is one plain colour the contrast check can read', async () => {
    const { parseColor } = await loadPalette();
    const unreadable = [...TOKENS].filter(([name, value]) => COLOR_TOKEN.test(name) && !parseColor(value)).map(([name, value]) => `${name}: ${value}`);
    assert.deepEqual(unreadable, []);
});

test('every text colour reaches AA contrast on every surface and on the light tint', async () => {
    const { surface, on, ratio } = await loadPalette();
    const failures = [];
    for (const base of BASE_SURFACES) {
        for (const text of TEXT_COLORS) {
            failures.push(...tooLow(`${text} on ${base}`, ratio(text, surface(base)), AA_TEXT));
            failures.push(...tooLow(`${text} on --bg-tint-1 over ${base}`, ratio(text, on('--bg-tint-1', base)), AA_TEXT));
        }
    }
    assert.deepEqual(failures, []);
});

test('primary and secondary text reach AA contrast on the stronger tints', async () => {
    const { on, ratio } = await loadPalette();
    const failures = [];
    for (const base of BASE_SURFACES) {
        for (const text of STRONG_TEXT) {
            for (const tint of ['--bg-tint-2', '--bg-tint-3']) {
                failures.push(...tooLow(`${text} on ${tint} over ${base}`, ratio(text, on(tint, base)), AA_TEXT));
            }
        }
    }
    assert.deepEqual(failures, []);
});

test('status and accent text reach AA contrast on their own tint', async () => {
    const { on, ratio } = await loadPalette();
    const failures = [];
    for (const base of BASE_SURFACES) {
        for (const [text, tint] of Object.entries(OWN_TINT)) {
            failures.push(...tooLow(`${text} on ${tint} over ${base}`, ratio(text, on(tint, base)), AA_TEXT));
        }
    }
    assert.deepEqual(failures, []);
});

test('text on solid fills reaches AA contrast', async () => {
    const { color, ratio } = await loadPalette();
    const failures = [];
    for (const [text, fills] of Object.entries(FILLS)) {
        for (const fill of fills) failures.push(...tooLow(`${text} on ${fill}`, ratio(text, color(fill)), AA_TEXT));
    }
    assert.deepEqual(failures, []);
});

test('the brand violet reaches 3:1 as a non-text colour', async () => {
    const { surface, ratio } = await loadPalette();
    assert.deepEqual(BASE_SURFACES.flatMap(base => tooLow(`--accent on ${base}`, ratio('--accent', surface(base)), AA_NON_TEXT)), []);
});

test('spacing names are pixel sizes and layers rise in order', () => {
    for (const [name, value] of TOKENS) {
        const space = /^--space-(\d+)$/.exec(name);
        if (space) assert.equal(value, `${Number(space[1]) / 16}rem`, name);
    }
    const layers = ['--z-dropdown', '--z-sticky', '--z-nav', '--z-banner', '--z-dialog', '--z-toast', '--z-overlay'].map(name => TOKENS.get(name));
    for (const value of layers) assert.match(String(value), /^\d+$/);
    assert.deepEqual(layers.map(Number), [...layers.map(Number)].sort((a, b) => a - b));
});
