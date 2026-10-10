const { test } = require('node:test');
const assert = require('node:assert/strict');
const { stripComments, parseRules, readTokens } = require('./cssSource');

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
