const test = require('node:test');
const assert = require('node:assert/strict');
const { tokenize } = require('../plugin-sdk/tokenize');
const fs = require('node:fs');
const path = require('node:path');

const values = (code) => tokenize(code).map((t) => t.value);
const names = (code) => tokenize(code).filter((t) => t.type === 'name').map((t) => t.value);

test('tokenizes a member chain into names and punctuation', () => {
  assert.deepEqual(values('ctx.events.list()'), ['ctx', '.', 'events', '.', 'list', '(', ')']);
});

test('comments produce no tokens', () => {
  assert.deepEqual(tokenize('// ctx.discord.sendDM'), []);
  assert.deepEqual(tokenize('/* ctx.x */'), []);
  assert.deepEqual(tokenize('/* a\nb */ x').map((t) => [t.value, t.line]), [['x', 2]]);
});

test('string literals yield one string token with the unquoted text', () => {
  const t = tokenize("'ctx.discord.sendDM'");
  assert.equal(t.length, 1);
  assert.equal(t[0].type, 'string');
  assert.equal(t[0].value, 'ctx.discord.sendDM');
  assert.deepEqual(tokenize('require("fs")').map((x) => x.type), ['name', 'punct', 'string', 'punct']);
});

test('import specifiers are string tokens', () => {
  const s = tokenize("import x from './a.js'; import('./b.js')").filter((t) => t.type === 'string');
  assert.deepEqual(s.map((t) => t.value), ['./a.js', './b.js']);
});

test('escaped quotes do not end a string', () => {
  assert.deepEqual(tokenize('"a\\"b" x').map((t) => t.value), ['a\\"b', 'x']);
});

test('template literal expressions are tokenized as code', () => {
  const n = names('`a ${ctx.events.list()} b`');
  for (const w of ['ctx', 'events', 'list']) assert.ok(n.includes(w));
  assert.ok(!n.includes('a') && !n.includes('b'));
});

test('nested templates are tokenized', () => {
  assert.ok(names('`${`${ctx.theme.x}`}`').includes('theme'));
});

test('braces inside template expressions are balanced', () => {
  const n = names('`${ {a: 1}.a } ${ctx.z}` + after');
  assert.ok(n.includes('z') && n.includes('after'));
});

test('template literal without ${ is one string token with raw text', () => {
  const t = tokenize('`./c.js`');
  assert.deepEqual(t.map((x) => [x.type, x.value]), [['string', './c.js']]);
});

test('regex literals are skipped, division is not', () => {
  const n = names('x = /ctx\\.discord/g; y = a / b / c');
  assert.ok(!n.includes('discord') && !n.includes('g'));
  for (const w of ['a', 'b', 'c']) assert.ok(n.includes(w));
  assert.ok(!names('return /ctx.discord/').includes('discord'));
  assert.ok(!names('x = /[/]discord/').includes('discord'));
});

test('numbers are number tokens', () => {
  assert.deepEqual(tokenize('x = 1.5e3 + 0x1F').filter((t) => t.type === 'number').map((t) => t.value), ['1.5e3', '0x1F']);
});

test('line numbers are 1-based and CRLF counts once', () => {
  assert.deepEqual(tokenize('a\r\nb\nc').map((t) => t.line), [1, 2, 3]);
});

test('division after postfix ++/-- does not start a regex', () => {
  const n = names('i++ / 2; ctx.discord.sendDM(); y / 3');
  for (const w of ['ctx', 'discord', 'sendDM', 'y']) assert.ok(n.includes(w));
  assert.ok(names('i-- / 2; ctx.a(); y / 3').includes('ctx'));
});

test('backslash + CRLF inside a string continues the string', () => {
  const t = tokenize('"a\\\r\nb"; ctx.q');
  assert.deepEqual(t.map((x) => x.type), ['string', 'punct', 'name', 'punct', 'name']);
  assert.equal(t[4].line, 2);
});

test('backslash-newline in a template keeps line numbers right', () => {
  assert.equal(tokenize('`a\\\n${z}`').find((t) => t.value === 'z').line, 2);
  assert.equal(tokenize('`a\\\n\n${z}`').find((t) => t.value === 'z').line, 3);
});

test('an unterminated regex does not swallow the newline', () => {
  const t = tokenize('x = /abc\nctx');
  assert.equal(t.find((x) => x.value === 'ctx').line, 2);
});

test('keywords used as property names do not start a regex', () => {
  const n = names('a.in / 2; ctx.x(); b / 3');
  assert.ok(n.includes('ctx') && n.includes('x'));
});

test('identifiers up to U+FFFF still tokenize as names', () => {
  assert.deepEqual(names('const ä￯ = 1'), ['const', 'ä￯']);
});

test('SDK, CLI and route sources spell BOM, noncharacters and controls as escapes', () => {
  // A raw U+FEFF or U+FFFF is invisible in an editor and easy to break by accident
  const root = path.join(__dirname, '..');
  const files = [
    ...fs.readdirSync(path.join(root, 'plugin-sdk')).filter((f) => f.endsWith('.js')).map((f) => `plugin-sdk/${f}`),
    ...fs.readdirSync(path.join(root, 'routes')).filter((f) => f.endsWith('.js')).map((f) => `routes/${f}`),
    'scripts/plugin.js',
  ];
  const raw = /[﻿￾￿\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
  const hits = files.filter((f) => raw.test(fs.readFileSync(path.join(root, f), 'utf8')));
  assert.deepEqual(hits, []);
});
