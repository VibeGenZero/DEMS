'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAnswerParser, compactTurn, AnswerError, FILE_START, FILE_END } = require('../scripts/studio/ai/answer');

const TWO = [
  'Ich baue zwei Dateien.',
  '<<<DATEI server.js',
  'const a = 1;',
  '',
  'module.exports = a;',
  '>>>DATEI',
  'Dazwischen ein Satz.',
  '<<<DATEI client.js',
  'console.log(2);',
  '>>>DATEI',
  'Fertig.',
  ''
].join('\n');

const feedAll = (text, size) => {
  const p = createAnswerParser();
  let streamed = '';
  const writing = [];
  for (let i = 0; i < text.length; i += size) {
    const r = p.push(text.slice(i, i + size));
    streamed += r.text;
    writing.push(r.writing);
  }
  return { ...p.end(), streamed, writing };
};

test('exports the markers', () => {
  assert.equal(FILE_START, '<<<DATEI ');
  assert.equal(FILE_END, '>>>DATEI');
});

test('plain reply without blocks', () => {
  const p = createAnswerParser();
  const r = p.push('Hallo, das ist nur Text.\nZweite Zeile.');
  assert.equal(r.writing, null);
  const out = p.end();
  assert.deepEqual(out.files, []);
  assert.equal(out.reply, 'Hallo, das ist nur Text.\nZweite Zeile.');
});

test('two blocks and text around them', () => {
  const p = createAnswerParser();
  p.push(TWO);
  const out = p.end();
  assert.equal(out.reply, 'Ich baue zwei Dateien.\nDazwischen ein Satz.\nFertig.');
  assert.deepEqual(out.files, [
    { path: 'server.js', content: 'const a = 1;\n\nmodule.exports = a;\n' },
    { path: 'client.js', content: 'console.log(2);\n' }
  ]);
});

test('markers split across chunks: one character at a time equals one chunk', () => {
  const whole = createAnswerParser();
  whole.push(TWO);
  const expected = whole.end();
  const r = feedAll(TWO, 1);
  assert.equal(r.reply, expected.reply);
  assert.deepEqual(r.files, expected.files);
  assert.ok(!r.streamed.includes('<<<'));
  assert.ok(!r.streamed.includes('>>>'));
  assert.ok(!r.streamed.includes('const'));
  assert.ok(!r.streamed.includes('console'));
  assert.equal(r.streamed.trim(), 'Ich baue zwei Dateien.\nDazwischen ein Satz.\nFertig.');
  assert.ok(r.writing.includes('server.js'));
  assert.ok(r.writing.includes('client.js'));
  assert.equal(r.writing[r.writing.length - 1], null);
});

test('writing is the open block path while inside it', () => {
  const p = createAnswerParser();
  assert.equal(p.push('Text\n<<<DATEI server.js\nconst a').writing, 'server.js');
  assert.equal(p.push(' = 1;\n').writing, 'server.js');
  assert.equal(p.push('>>>DATEI\n').writing, null);
});

test('unterminated block throws incomplete', () => {
  const p = createAnswerParser();
  p.push('Text\n<<<DATEI server.js\nconst a = 1;\n');
  assert.throws(() => p.end(), (e) => e instanceof AnswerError && e.code === 'incomplete');
});

test('a marker in the middle of a line is ordinary text', () => {
  const p = createAnswerParser();
  const r = p.push('Schreibe <<<DATEI x.js und >>>DATEI an den Anfang.\n');
  assert.equal(r.writing, null);
  const out = p.end();
  assert.deepEqual(out.files, []);
  assert.equal(out.reply, 'Schreibe <<<DATEI x.js und >>>DATEI an den Anfang.');
});

test('end marker without trailing newline closes the block', () => {
  const p = createAnswerParser();
  p.push('<<<DATEI a.js\nx\n>>>DATEI');
  assert.deepEqual(p.end().files, [{ path: 'a.js', content: 'x\n' }]);
});

test('CRLF line endings are tolerated', () => {
  const crlf = TWO.replace(/\n/g, '\r\n');
  for (const size of [1, 7, crlf.length]) {
    const r = feedAll(crlf, size);
    assert.equal(r.reply, 'Ich baue zwei Dateien.\nDazwischen ein Satz.\nFertig.');
    assert.equal(r.files[0].content, 'const a = 1;\n\nmodule.exports = a;\n');
    assert.equal(r.files[1].path, 'client.js');
  }
});

test('a later block for the same path wins', () => {
  const p = createAnswerParser();
  p.push('<<<DATEI a.js\none\n>>>DATEI\n<<<DATEI b.js\nb\n>>>DATEI\n<<<DATEI a.js\ntwo\n>>>DATEI\n');
  const files = p.end().files;
  assert.equal(files.length, 2);
  assert.equal(files.find((f) => f.path === 'a.js').content, 'two\n');
});

test('compactTurn replaces each run of blocks with one line', () => {
  assert.equal(
    compactTurn(TWO),
    'Ich baue zwei Dateien.\n[Dateien: server.js]\nDazwischen ein Satz.\n[Dateien: client.js]\nFertig.\n'
  );
});

test('compactTurn merges adjacent blocks into one run', () => {
  const text = 'Hier:\n<<<DATEI server.js\na\n>>>DATEI\n\n<<<DATEI client.js\nb\n>>>DATEI\nEnde.';
  assert.equal(compactTurn(text), 'Hier:\n[Dateien: server.js, client.js]\nEnde.');
});

test('compactTurn leaves text without blocks alone', () => {
  assert.equal(compactTurn('nur Text'), 'nur Text');
});
