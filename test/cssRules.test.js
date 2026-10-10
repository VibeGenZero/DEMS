const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { frontendSources, REPO_ROOT } = require('./helpers');
const { readCss, parseRules } = require('./cssSource');

const CSS_DIR = path.join(REPO_ROOT, 'public', 'css');
const INDEX_HTML = fs.readFileSync(path.join(REPO_ROOT, 'public', 'index.html'), 'utf8');
// Stylesheets that build on the tokens and must not contain raw values
const STYLED = ['components.css', 'style.css'].filter(name => fs.existsSync(path.join(CSS_DIR, name)));
// Stylesheets in the order index.html must load them
const LOAD_ORDER = ['/vendor/bootstrap/bootstrap.min.css', '/css/tokens.css?v=3', '/css/style.css?v=3'];

const rulesOf = (name) => parseRules(readCss(name)).map(rule => ({ ...rule, file: name }));
const allRules = () => STYLED.flatMap(rulesOf);

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
