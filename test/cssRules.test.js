const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { frontendSources, REPO_ROOT } = require('./helpers');
const { readCss, parseRules, readTokens } = require('./cssSource');

const CSS_DIR = path.join(REPO_ROOT, 'public', 'css');
const INDEX_HTML = fs.readFileSync(path.join(REPO_ROOT, 'public', 'index.html'), 'utf8');
// Stylesheets that build on the tokens and must not contain raw values
const STYLED = ['components.css', 'style.css'].filter(name => fs.existsSync(path.join(CSS_DIR, name)));
// Stylesheets in the order index.html must load them
const LOAD_ORDER = ['/vendor/bootstrap/bootstrap.min.css', '/css/tokens.css?v=3', '/css/components.css?v=3', '/css/style.css?v=3'];

const rulesOf = (name) => parseRules(readCss(name)).map(rule => ({ ...rule, file: name }));
const allRules = () => STYLED.flatMap(rulesOf);
const selectorsOf = (name) => new Set(rulesOf(name).flatMap(rule => rule.selector.split(', ')));
// Selectors that components.css must define
const COMPONENT_SELECTORS = [
    '[data-bs-theme]', 'a',
    '.text-secondary', '.text-primary', '.text-success', '.text-warning', '.text-danger', '.text-info',
    '.bg-primary', '.text-bg-primary', '.bg-success', '.text-bg-success', '.bg-warning', '.text-bg-warning', '.bg-danger', '.text-bg-danger', '.bg-info', '.text-bg-info',
    '.btn', '.btn-primary', '.btn-accent', '.btn-secondary', '.btn-outline-light', '.btn-outline-secondary', '.btn-ghost', '.btn-danger', '.btn-discord', '.btn-warning',
    '.btn-outline-primary', '.btn-outline-success', '.btn-outline-warning', '.btn-outline-danger', '.btn-sm', '.btn-lg', '.btn-icon',
    '.modal', '.nav-pills', '.nav-pills .nav-link', '.nav-pills .nav-link.active .chip',
    '.toast', '.toast-success', '.toast-danger', '.toast-warning', '.toast-info', '.toast-icon',
    '.glass-card', '.glass-card[data-click]:hover', 'a.glass-card:hover', '.glass-card.is-clickable:hover',
    '.chip', '.badge-pill', '.category-pill', '.event-status-badge', '.event-category-tag', '.chip-sm',
    '.chip-success', '.chip-warning', '.chip-danger', '.chip-info', '.chip-accent',
    '.badge-pill.status-accepted', '.badge-pill.status-pending', '.badge-pill.status-rejected', '.badge-pill.status-waitlisted',
    'button.chip.active', '.category-pill.active',
    '.skeleton', '.skeleton-text', '.skeleton-title', '.skeleton-img', '.skeleton-chip', '.skeleton-avatar', '.skeleton-card-body',
    '.empty-state', '.empty-state-icon', '.empty-state-title', '.empty-state-text',
    '.avatar', '.avatar-sm', '.avatar-lg', '.avatar-xl', '.avatar-initials', '.avatar-stack', '.avatar-more',
    '.date-tile', '.date-tile-weekday', '.date-tile-month', '.date-tile-day', '.date-tile.is-live',
    '.capacity', '.capacity-meter', '.capacity-text', '.capacity.is-low .capacity-text', '.capacity.is-full .capacity-text',
    '.data-table', '.data-table th', '.data-table td', '.data-table-sort', '.data-table-title', '.data-table-meta',
    '.data-table-actions', '.data-table-buttons', '.data-table tr.is-sub td', '.data-table tr.is-muted .data-table-title',
    '.data-table tr.is-sub.is-muted td:first-child',
    '.dropdown-menu', '.dropdown-item', '.dropdown-header', '.dropdown-item.is-danger',
    '.is-hidden:not(#no-such-id)', '.icon-lg', '.icon-xl', '.icon-2xl', '.cursor-pointer', '.glass-card.is-tinted'
];
// Selectors that moved into components.css or were dropped; style.css must not style them again
const MOVED = ['.btn-accent', '.btn-accent:hover', '.btn-discord', '.btn-discord:hover', '.btn-outline-light', '.btn-outline-light:hover', '.glass-modal', '.nav-link', '.nav-link.active',
    '.toast',
    '.glass-card', '.glass-card:hover', '.stat-card:hover', '.info-card:hover',
    '.badge-pill', '.badge-pill.status-accepted', '.category-pill', '.category-pill:hover', '.category-pill.active',
    '.event-status-draft', '.event-status-active', '.event-status-archived',
    '.skeleton', '.skeleton-text', '.skeleton-title', '.skeleton-img',
    // Old overview cards, dropped by D-04
    '.event-banner-placeholder', '.event-card-header-row', '.event-card-mini-progress', '.event-card-capacity-label',
    '.series-card', '.slot-chips', '.slot-chip', '.spots-warning', '.spots-full',
    // Replaced by the menu component (D-07)
    '.status-dropdown .dropdown-menu', '.status-dropdown .dropdown-item', '.status-dropdown .dropdown-item:hover',
    // Admin cards, replaced by the table (D-07)
    '.admin-event-card', '.admin-event-card .admin-actions', '.series-admin-date-item', '.series-admin-card', '.series-badge',
    '.event-banner', '.series-dates-header', '.event-date-info', '.event-date-info i'
];
// A colour written out: hex, rgb(), hsl() or a colour name (white-space is no colour)
const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|(?<![-\w])(white|black)(?![-\w])/;
const withoutImportant = (value) => value.replace(/\s*!important$/, '');
const describe = (rule, declaration) => `${rule.file}:${declaration.line} ${rule.selector} { ${declaration.property}: ${declaration.value} }`;
// Upper limits that only go down: lower the number when you remove some,
// never raise it. Before D-02 there were 57 !important in style.css.
// components.css has its own rule: !important only in the colour helpers.
// Inline styles in markup: a style attribute (also set through setAttribute) or a style element.
// The CSP forbids them (style-src 'self', style-src-attr 'none'), so the browser drops them silently.
const INLINE_STYLE = /\sstyle\s*=\s*["'`]|<style[\s>]|setAttribute\(\s*['"]style['"]/;
const IMPORTANT_BUDGET = 29;
// Emojis in index.html and the modules. Symbols are Bootstrap Icons (bi-*);
// lower the number when a page drops some, never raise it. Emojis that users
// type in (slot emojis) are data, not source, and do not count.
const EMOJI_BUDGET = 23;
const EMOJI = /\p{Extended_Pictographic}/gu;

test('index.html loads Bootstrap, the tokens and the DEMS styles in this order', () => {
    const hrefs = [...INDEX_HTML.matchAll(/<link[^>]+href="([^"]+\.css[^"]*)"/g)].map(match => match[1]);
    const positions = LOAD_ORDER.map(href => hrefs.indexOf(href));
    assert.ok(positions.every(position => position !== -1), `missing stylesheet link, found: ${hrefs.join(', ')}`);
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
});

test('only tokens.css defines :root variables', () => {
    assert.deepEqual(allRules().filter(rule => rule.selector === ':root').map(rule => `${rule.file}:${rule.line}`), []);
});

test('the logo font is only used by the logo', () => {
    const users = allRules().filter(rule => rule.declarations.some(declaration => declaration.value.includes('--font-logo'))).map(rule => rule.selector);
    assert.equal(users.length, 2, users.join(' | '));
    for (const selector of users) assert.match(selector, /\.(loading-logo|brand-text)$/);
    const sources = [INDEX_HTML, ...STYLED.map(readCss), ...frontendSources().map(entry => entry.source)];
    for (const source of sources) assert.doesNotMatch(source, /--font-display/);
});

test('no selector list is defined twice in the same context', () => {
    const seen = new Map();
    const duplicates = [];
    for (const rule of allRules()) {
        // Steps like "0%, 100%" repeat in every animation by design
        if (rule.context.includes('@keyframes')) continue;
        const key = `${rule.context} | ${rule.selector}`;
        const place = `${rule.file}:${rule.line}`;
        if (seen.has(key)) duplicates.push(`${rule.selector} (${seen.get(key)} and ${place})`);
        else seen.set(key, place);
    }
    assert.deepEqual(duplicates, []);
});

test('components.css defines every component selector', () => {
    const defined = selectorsOf('components.css');
    assert.deepEqual(COMPONENT_SELECTORS.filter(selector => !defined.has(selector)), []);
});

test('style.css does not style moved component selectors again', () => {
    const page = selectorsOf('style.css');
    assert.deepEqual(MOVED.filter(selector => page.has(selector)), []);
});

test('!important in components.css is limited to the colour helpers', () => {
    const offenders = rulesOf('components.css')
        .filter(rule => rule.declarations.some(declaration => /!important$/.test(declaration.value)))
        .filter(rule => !rule.selector.split(', ').every(selector => /^\.(text|bg|text-bg)-[a-z]+$/.test(selector)))
        .map(rule => rule.selector);
    assert.deepEqual(offenders, []);
});

test('the dead class glass-modal is gone', () => {
    for (const source of [INDEX_HTML, ...frontendSources().map(entry => entry.source)]) assert.doesNotMatch(source, /glass-modal/);
});

// Bootstrap classes that force light text or a dark surface; in the light scheme they would be unreadable
const DARK_ONLY_CLASS = /(?<![-\w])(navbar-dark|text-light|text-white|text-white-50|bg-dark|table-dark|btn-close-white)(?![-\w])/g;

test('no dark-only Bootstrap class is left in the markup or the modules', () => {
    const found = [{ file: 'index.html', source: INDEX_HTML }, ...frontendSources()].flatMap(({ file, source }) =>
        source.split(/\r?\n/).flatMap((line, index) => [...line.matchAll(DARK_ONLY_CLASS)].map(match => `${file}:${index + 1} ${match[1]}`)));
    assert.deepEqual(found, []);
});

test('colour values only live in tokens.css', () => {
    const raw = allRules().flatMap(rule => rule.declarations.filter(declaration => RAW_COLOR.test(declaration.value)).map(declaration => describe(rule, declaration)));
    assert.deepEqual(raw, []);
});

test('font sizes in px or rem only live in tokens.css', () => {
    const raw = allRules().flatMap(rule => rule.declarations
        .filter(declaration => declaration.property === 'font-size' && /\d(px|rem)\b/.test(declaration.value))
        .map(declaration => describe(rule, declaration)));
    assert.deepEqual(raw, []);
});

test('layers above local stacking use the z tokens', () => {
    const raw = allRules().flatMap(rule => rule.declarations
        .filter(declaration => declaration.property === 'z-index' && /^-?\d+$/.test(withoutImportant(declaration.value)) && Math.abs(Number(withoutImportant(declaration.value))) >= 10)
        .map(declaration => describe(rule, declaration)));
    assert.deepEqual(raw, []);
});

test('radii come from the radius tokens', () => {
    const raw = allRules().flatMap(rule => rule.declarations
        .filter(declaration => declaration.property.startsWith('border') && declaration.property.endsWith('radius') && /\dpx\b/.test(declaration.value))
        .map(declaration => describe(rule, declaration)));
    assert.deepEqual(raw, []);
});

test('no markup carries an inline style', () => {
    const sources = [
        { file: 'public/index.html', source: INDEX_HTML },
        ...frontendSources().map(entry => ({ file: `public/js/${entry.file}`, source: entry.source })),
        // The persona page of the dev mock mode is served under the same policy
        { file: 'dev/devAuth.js', source: fs.readFileSync(path.join(REPO_ROOT, 'dev', 'devAuth.js'), 'utf8') }
    ];
    const offenders = sources.flatMap(({ file, source }) => source.split('\n')
        .map((line, index) => ({ line, place: `${file}:${index + 1}` }))
        .filter(({ line }) => INLINE_STYLE.test(line))
        .map(({ place }) => place));
    assert.deepEqual(offenders, [], 'use a class; a value that is only known at runtime goes into a data attribute and is set with element.style.setProperty (core/ui.js applyStyleData)');
});

test('the number of emojis in the frontend matches its budget', () => {
    const count = [INDEX_HTML, ...frontendSources().map(entry => entry.source)]
        .reduce((sum, source) => sum + (source.match(EMOJI) || []).length, 0);
    assert.equal(count, EMOJI_BUDGET, `found ${count} emojis; lower EMOJI_BUDGET if you removed some, otherwise use a Bootstrap icon (bi-*)`);
});

test('the number of !important in style.css matches its budget', () => {
    const count = rulesOf('style.css').flatMap(rule => rule.declarations).filter(declaration => /!important$/.test(declaration.value)).length;
    assert.equal(count, IMPORTANT_BUDGET, `found ${count} !important; lower IMPORTANT_BUDGET if you removed some, otherwise fix the selector or the load order`);
});

test('every variable a stylesheet uses is a token or defined in the stylesheets', () => {
    const tokens = readTokens(readCss('tokens.css'));
    const declarations = allRules().flatMap(rule => rule.declarations.map(declaration => ({ rule, declaration })));
    // Component-level variables such as --btn-height or --toast-tone
    const local = new Set(declarations.map(({ declaration }) => declaration.property).filter(property => property.startsWith('--')));
    const unknown = declarations.flatMap(({ rule, declaration }) => [...declaration.value.matchAll(/var\(\s*(--[\w-]+)/g)]
        .map(match => match[1])
        // --bs-* belongs to Bootstrap
        .filter(name => !tokens.has(name) && !local.has(name) && !name.startsWith('--bs-'))
        .map(name => `${name} in ${describe(rule, declaration)}`));
    assert.deepEqual(unknown, []);
});
