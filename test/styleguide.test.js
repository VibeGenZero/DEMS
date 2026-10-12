const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadFrontendApp, frontendSources, REPO_ROOT } = require('./helpers');

const INDEX_HTML = fs.readFileSync(path.join(REPO_ROOT, 'public', 'index.html'), 'utf8');
const BLOCKS = ['button', 'card', 'chip', 'tabs', 'dialog', 'toast', 'empty-state', 'skeleton', 'avatar', 'date-tile', 'capacity', 'data-table', 'menu', 'helpers'];

test('the styleguide renders one block per component, in the order of the library', async () => {
    const { app } = await loadFrontendApp({});
    const container = { innerHTML: '' };
    app.renderDebugComponents(container);
    const ids = [...container.innerHTML.matchAll(/<section class="sg-block" id="sg-([a-z-]+)">/g)].map(match => match[1]);
    assert.deepEqual(ids, BLOCKS);
});

test('index.html holds the three parts of the styleguide', () => {
    for (const id of ['sg-tokens', 'sg-components', 'sg-legacy']) assert.match(INDEX_HTML, new RegExp(`id="${id}"`));
    for (const id of ['sg-colors', 'sg-badges']) assert.doesNotMatch(INDEX_HTML, new RegExp(`id="${id}"`));
});

test('the styleguide code sets no style attributes', () => {
    const sources = frontendSources().filter(entry => entry.file.startsWith('pages/debug'));
    assert.equal(sources.length, 2);
    for (const { file, source } of sources) assert.doesNotMatch(source, /style="/, file);
});

test('a contrast is only shown for opaque colours the check can read', async () => {
    const { app } = await loadFrontendApp({});
    assert.equal(app.contrastLabel('#8f8f9a', '#16161f'), '5,62 : 1');
    assert.equal(app.contrastLabel('#ffffff', '#7c3aed'), '5,70 : 1');
    for (const value of ['rgba(255, 255, 255, 0.04)', 'var(--accent-glow)', '0 0 0 3px var(--accent-glow)', '#12', '']) {
        assert.equal(app.contrastLabel(value, '#16161f'), '', value);
    }
    assert.equal(app.contrastLabel('#ffffff', 'rgba(22, 22, 31, 0.85)'), '');
});

test('a contrast note names the pair that matters for the token', async () => {
    const { app } = await loadFrontendApp({});
    const values = {
        '--bg-card': '#16161f', '--text-muted': '#8f8f9a', '--danger': '#f87171', '--accent': '#8b5cf6',
        '--on-accent': '#ffffff', '--accent-fill': '#7c3aed', '--bg-tint-1': 'rgba(255, 255, 255, 0.04)'
    };
    const valueOf = (name) => values[name] || '';
    // Text colours: on the card, where most text sits
    assert.equal(app.contrastNote('--text-muted', valueOf), '5,62 : 1 auf Karte');
    assert.equal(app.contrastNote('--danger', valueOf), '6,50 : 1 auf Karte');
    // Text on a solid fill: against that fill, not against the card
    assert.equal(app.contrastNote('--on-accent', valueOf), '5,70 : 1 auf --accent-fill');
    // Brand colour, fills and surfaces carry no text contrast of their own
    for (const name of ['--accent', '--accent-fill', '--bg-card', '--bg-tint-1']) assert.equal(app.contrastNote(name, valueOf), '', name);
    // A fill that is missing gives no number instead of a wrong one
    assert.equal(app.contrastNote('--on-success', valueOf), '');
});
