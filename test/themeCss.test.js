const { test } = require('node:test');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const {
    MAX_THEME_CSS,
    ALLOWED_FUNCTIONS,
    ALLOWED_AT_RULES,
    checkThemeCss
} = require('../plugin-sdk/themeCss');

const ok = css => assert.deepEqual(checkThemeCss(css), { ok: true });
const bad = (css, line, message) => assert.deepEqual(checkThemeCss(css), { ok: false, line, message });

test('plain sheets with allowed functions and at-rules pass', () => {
    ok(':root { --accent: #123456; }\n.card:not(.x):nth-child(2n+1) { border-radius: calc(var(--radius) * 2); }');
    ok('@media (min-width: 600px) { .a { color: color-mix(in srgb, red 50%, blue); } }');
    ok('@keyframes spin { to { transform: rotate(1turn); } }');
    ok('.a::before { content: "url(nicht geladen) → Neu"; } /* Ümlaut */');
    ok('');
});

test('functions that can load something are refused with their line', () => {
    bad('.a {}\n.b { background: url(https://x.test/a.png); }', 2,
        'Zeile 2: url() ist nicht erlaubt – eigene Bilder und Schriften können nicht eingebunden werden.');
    bad('.b { background: URL(x); }', 1,
        'Zeile 1: url() ist nicht erlaubt – eigene Bilder und Schriften können nicht eingebunden werden.');
    bad('.b { background: image-set("a.png" 1x); }', 1, 'Zeile 1: image-set() ist nicht erlaubt.');
    for (const name of ['src', 'attr', 'env', 'image', 'cross-fade', 'element', 'paint', 'expression']) {
        assert.equal(checkThemeCss(`.b { x: ${name}(a); }`).ok, false, name);
    }
});

test('backslashes are refused anywhere', () => {
    bad('.b { background: \\75 rl(x); }', 1, 'Zeile 1: Backslashes (\\) sind nicht erlaubt.');
    bad('.b { content: "\\"" }', 1, 'Zeile 1: Backslashes (\\) sind nicht erlaubt.');
});

test('only the allowed at-rules pass', () => {
    bad('@import "x.css";', 1, 'Zeile 1: @import ist nicht erlaubt.');
    bad('\n@font-face { font-family: x; }', 2, 'Zeile 2: @font-face ist nicht erlaubt.');
    for (const rule of ['charset', 'namespace', 'page', '-webkit-keyframes']) {
        assert.equal(checkThemeCss(`@${rule} x {}`).ok, false, rule);
    }
});

test('comments and strings are handled before the checks', () => {
    ok('.a { color: u/**/rl(x); }');
    bad('.a {}\n/* offen', 2, 'Zeile 2: Ein Kommentar (/* … */) wird nicht geschlossen.');
    bad('.a { content: "offen\n}', 1, 'Zeile 1: Ein Text in Anführungszeichen wird nicht geschlossen.');
});

test('braces and parentheses must balance', () => {
    bad('.a { color: red;', 1, 'Zeile 1: Die Klammern { } passen nicht zusammen.');
    bad('.a { color: red; } }', 1, 'Zeile 1: Die Klammern { } passen nicht zusammen.');
    bad('.a { width: calc(1px + 2px; }', 1, 'Zeile 1: Die Klammern ( ) passen nicht zusammen.');
});

test('size and type limits', () => {
    assert.equal(MAX_THEME_CSS, 50000);
    bad('a'.repeat(50001), null, 'Das CSS ist zu lang (höchstens 50 000 Zeichen).');
    bad(42, null, 'Das CSS muss Text sein.');
});

test('a 50 000 character sheet is checked in under 100 ms', () => {
    const sheet = '.a { color: var(--accent); }\n'.repeat(1700).slice(0, 50000);
    const start = performance.now();
    assert.deepEqual(checkThemeCss(sheet), { ok: true });
    assert.ok(performance.now() - start < 100);
});

test('the allow-list is pinned', () => {
    const expectedFunctions = [
        'var', 'calc', 'min', 'max', 'clamp', 'rgb', 'rgba', 'hsl', 'hsla', 'hwb',
        'lab', 'lch', 'oklab', 'oklch', 'color', 'color-mix', 'linear-gradient',
        'radial-gradient', 'conic-gradient', 'repeating-linear-gradient',
        'repeating-radial-gradient', 'repeating-conic-gradient', 'cubic-bezier', 'steps',
        'counter', 'counters', 'minmax', 'repeat', 'fit-content',
        'translate', 'translatex', 'translatey', 'translate3d', 'rotate',
        'scale', 'scalex', 'scaley', 'skew', 'skewx', 'skewy', 'matrix', 'perspective',
        'blur', 'brightness', 'contrast', 'drop-shadow', 'grayscale',
        'hue-rotate', 'invert', 'opacity', 'saturate', 'sepia',
        'not', 'is', 'where', 'has', 'nth-child', 'nth-last-child',
        'nth-of-type', 'nth-last-of-type', 'lang', 'dir'
    ].sort();
    assert.deepEqual([...ALLOWED_FUNCTIONS].sort(), expectedFunctions);
    assert.deepEqual([...ALLOWED_AT_RULES].sort(), ['container', 'keyframes', 'layer', 'media', 'supports']);
});
