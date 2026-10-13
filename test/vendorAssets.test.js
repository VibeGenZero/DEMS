const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const VENDOR_DIR = path.join(PUBLIC_DIR, 'vendor');
const FONTS_CSS = path.join(VENDOR_DIR, 'fonts', 'fonts.css');

const isExternal = (ref) => /^(https?:)?\/\//i.test(ref);
const stripQuery = (ref) => ref.replace(/[?#].*$/, '');

/**
 * src/href of every <script> and <link> tag in an HTML document.
 *
 * @param {string} html -> HTML source.
 * @returns {string[]} -> Referenced URLs in document order.
 */
function assetReferences(html) {
    const tags = html.match(/<(?:script|link)\b[^>]*>/gi) || [];
    return tags
        .map(tag => (tag.match(/\b(?:src|href)\s*=\s*"([^"]*)"/i) || [])[1])
        .filter(Boolean);
}

/**
 * All .css files below `dir`.
 *
 * @param {string} dir -> Absolute directory path.
 * @returns {string[]} -> Absolute file paths.
 */
function listStylesheets(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) return listStylesheets(fullPath);
        return entry.name.endsWith('.css') ? [fullPath] : [];
    });
}

const indexReferences = () => assetReferences(fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8'));

test('index.html loads no script, stylesheet or font from another host', () => {
    assert.deepEqual(indexReferences().filter(isExternal), []);
});

test('every local asset referenced by index.html exists', () => {
    const missing = indexReferences()
        .filter(ref => ref.startsWith('/') && !isExternal(ref))
        .filter(ref => !fs.existsSync(path.join(PUBLIC_DIR, stripQuery(ref))));

    assert.deepEqual(missing, []);
});

test('every url() in the vendored stylesheets points to a bundled file', () => {
    const broken = listStylesheets(VENDOR_DIR).flatMap(stylesheet => {
        const css = fs.readFileSync(stylesheet, 'utf8');
        const refs = [...css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map(match => match[1]);
        return refs
            .filter(ref => !ref.startsWith('data:'))
            .filter(ref => isExternal(ref) || !fs.existsSync(path.join(path.dirname(stylesheet), stripQuery(ref))))
            .map(ref => `${path.relative(PUBLIC_DIR, stylesheet)} -> ${ref}`);
    });

    assert.deepEqual(broken, []);
});

test('the fonts used by style.css are bundled', () => {
    assert.ok(fs.existsSync(FONTS_CSS), 'public/vendor/fonts/fonts.css is missing');
    const fontsCss = fs.readFileSync(FONTS_CSS, 'utf8');

    for (const family of ['Inter', 'UnifrakturCook']) {
        assert.match(fontsCss, new RegExp(`font-family:\\s*'${family}'`), family);
    }
    assert.ok(indexReferences().includes('/vendor/fonts/fonts.css'), 'index.html does not load fonts.css');
});

test('every badge icon exists in the Bootstrap Icons font', () => {
    const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'user.js'), 'utf8');
    const css = fs.readFileSync(path.join(VENDOR_DIR, 'bootstrap-icons', 'bootstrap-icons.css'), 'utf8');
    const icons = [...new Set([...route.matchAll(/icon: '(bi-[a-z0-9-]+)'/g)].map(match => match[1]))];
    assert.ok(icons.length >= 8, `found only ${icons.join(', ')}`);
    assert.deepEqual(icons.filter(icon => !css.includes(`.${icon}::before`)), []);
});
