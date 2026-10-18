const { test } = require('node:test');
const assert = require('node:assert/strict');
const { stripComments, parseRules, readTokens, readSchemeTokens } = require('./cssSource');

test('comments are blanked and keep their lines', () => {
    assert.equal(stripComments('a /* x { */ b\n/* two\nlines */c'), 'a           b\n      \n        c');
});

test('rules carry selector list, context, declarations and lines', () => {
    const rules = parseRules([
        'a{color:red}',
        '/* .ghost { color: blue; } */',
        '@media (max-width: 1px) {',
        '  .b ,',
        '  .c { margin: 0; padding : 1px  2px }',
        '}',
        '.d {}'
    ].join('\n'));
    assert.deepEqual(rules, [
        { selector: 'a', context: '', declarations: [{ property: 'color', value: 'red', line: 1 }], line: 1 },
        { selector: '.b, .c', context: '@media (max-width: 1px)', declarations: [{ property: 'margin', value: '0', line: 5 }, { property: 'padding', value: '1px 2px', line: 5 }], line: 4 },
        { selector: '.d', context: '', declarations: [], line: 7 }
    ]);
});

test('keyframe steps belong to their animation', () => {
    const rules = parseRules('@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }\n.x { animation: pulse 1s; }');
    assert.deepEqual(rules.map(rule => [rule.context, rule.selector]), [['@keyframes pulse', '0%, 100%'], ['@keyframes pulse', '50%'], ['', '.x']]);
});

test('tokens are the custom properties of :root', () => {
    const tokens = readTokens(':root { --a: #fff; --b: 0 0 0 3px var(--a); color: red; }\n.x { --c: 1; }');
    assert.deepEqual([...tokens], [['--a', '#fff'], ['--b', '0 0 0 3px var(--a)']]);
});

test('scheme tokens overlay the light rule on the dark ones and skip other selectors', () => {
    const css = ':root { --size: 1rem; }\n:root, [data-bs-theme="dark"] { --bg: #000; --text: #fff; }\n'
        + '[data-bs-theme="light"] { --bg: #fff; }\n:root.is-theme-switching { --size: 0; }\n@media (min-width: 1px) { :root { --bg: red; } }';
    assert.deepEqual([...readSchemeTokens(css, 'dark')], [['--size', '1rem'], ['--bg', '#000'], ['--text', '#fff']]);
    assert.deepEqual([...readSchemeTokens(css, 'light')], [['--size', '1rem'], ['--bg', '#fff'], ['--text', '#fff']]);
    assert.deepEqual([...readTokens(css)], [...readSchemeTokens(css, 'dark')]);
});
