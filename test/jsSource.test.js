const { test } = require('node:test');
const assert = require('node:assert/strict');
const { maskJsSource, lineDepths, codeIdentifiers } = require('./jsSource');

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

test('code identifiers skip property names and object keys', () => {
    const names = codeIdentifiers(maskJsSource('const o = { key: value, other }; o.prop(call());')).map(ref => ref.name);
    assert.deepEqual(names, ['const', 'o', 'value', 'other', 'o', 'call']);
});
