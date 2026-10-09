const { test } = require('node:test');
const assert = require('node:assert/strict');
const { maskJsSource, lineDepths, codeIdentifiers, findMissingImports } = require('./jsSource');

test('strings, comments and template text are blanked, positions stay', () => {
    const source = "const a = 'x(y)'; // call(z)\nconst b = `t ${f(1)} u`; /* g() */";
    const masked = maskJsSource(source);
    assert.equal(masked.length, source.length);
    assert.equal(masked, "const a = '    ';           \nconst b = `  ${f(1)}  `;          ");
});

test('a slash after a value divides, after an operator it starts a regex', () => {
    assert.equal(maskJsSource("x = a / b / c; y = s.replace(/'/g, '');"), "x = a / b / c; y = s.replace(/ /g, '');");
});

test('templates nest inside template expressions', () => {
    assert.equal(maskJsSource('`a ${`b ${c} d`} e`'), '`  ${`  ${c}  `}  `');
});

test('line depth counts braces and open template literals', () => {
    const masked = maskJsSource('function f() {\n  return `\nx`;\n}\nconst y = 1;');
    assert.deepEqual(lineDepths(masked), [0, 1, 2, 1, 0]);
});

test('a spread operand is code, a property after . or ?. is not', () => {
    const names = codeIdentifiers(maskJsSource('f(...list); g({ ...opts }); a?.b; c.d;')).map(ref => ref.name);
    assert.deepEqual(names, ['f', 'list', 'g', 'opts', 'a', 'c']);
});

test('code identifiers skip property names and object keys', () => {
    const names = codeIdentifiers(maskJsSource('const o = { key: value, other }; o.prop(call());')).map(ref => ref.name);
    assert.deepEqual(names, ['const', 'o', 'value', 'other', 'o', 'call']);
});

test('a module that uses an export of another module without importing it is reported', () => {
    const sources = [
        { file: 'a.js', source: 'export function helper() {}\nexport const LIMIT = 5;\n' },
        { file: 'b.js', source: "import { helper } from './a.js';\nexport function ok() { return helper(); }\n" },
        // A reference (no call) and a constant: both need the import
        { file: 'c.js', source: "export function bad(btn) { btn.addEventListener('click', helper); return LIMIT; }\n" },
        // Own declarations with the same names hide the exports
        { file: 'd.js', source: 'export function shadow(helper) { return helper(); }\nexport function local() { const LIMIT = 1; return LIMIT; }\n' }
    ];
    assert.deepEqual(findMissingImports(sources).map(entry => `${entry.file}:${entry.name}`), ['c.js:helper', 'c.js:LIMIT']);
});
