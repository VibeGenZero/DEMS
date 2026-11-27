'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PERMISSIONS } = require('../plugin-sdk/manifest');
const { HOOK_NAMES } = require('../plugin-sdk/permissionScan');
const { FILE_START, FILE_END } = require('../scripts/studio/ai/answer');
const {
  loadKnowledge, buildPrompt, estimateTokens, PromptError, FILE_TEXT_CAP, MAX_TURNS, MAX_ERRORS
} = require('../scripts/studio/ai/prompt');

const REPO_ROOT = path.join(__dirname, '..');
const GUIDE_PATH = path.join(REPO_ROOT, 'scripts', 'studio', 'ai', 'sdk-guide.md');
const knowledge = { guide: 'GUIDE-TEXT', types: 'declare namespace DemsPlugin {}' };
const BIG = 1000000;

const build = (over = {}) => buildPrompt({
  knowledge, files: [], history: [], message: 'Bau mir ein Plugin.', errors: [], contextTokens: BIG, maxTokens: 1000, ...over
});
const last = (prompt) => prompt.messages[prompt.messages.length - 1];

test('the constants follow the spec', () => {
  assert.equal(FILE_TEXT_CAP, 200 * 1024);
  assert.equal(MAX_TURNS, 10);
  assert.equal(MAX_ERRORS, 20);
  assert.equal(estimateTokens('abcd'), 2);
  assert.equal(estimateTokens(''), 0);
});

test('sdk-guide.md mentions every permission and hook', () => {
  const guide = fs.readFileSync(GUIDE_PATH, 'utf8');
  for (const permission of Object.keys(PERMISSIONS)) assert.ok(guide.includes(permission), `permission ${permission} missing`);
  for (const hook of HOOK_NAMES) assert.ok(guide.includes(hook), `hook ${hook} missing`);
  assert.ok(fs.statSync(GUIDE_PATH).size <= 12 * 1024, 'guide larger than 12 kB');
});

test('loadKnowledge reads the guide and the type description at call time', () => {
  const real = loadKnowledge(REPO_ROOT);
  assert.equal(real.guide, fs.readFileSync(GUIDE_PATH, 'utf8'));
  assert.equal(real.types, fs.readFileSync(path.join(REPO_ROOT, 'plugin-sdk', 'types', 'dems-plugin.d.ts'), 'utf8'));

  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'dems-prompt-'));
  try {
    fs.mkdirSync(path.join(root, 'scripts', 'studio', 'ai'), { recursive: true });
    fs.mkdirSync(path.join(root, 'plugin-sdk', 'types'), { recursive: true });
    fs.writeFileSync(path.join(root, 'scripts', 'studio', 'ai', 'sdk-guide.md'), 'eins');
    fs.writeFileSync(path.join(root, 'plugin-sdk', 'types', 'dems-plugin.d.ts'), 'typ');
    assert.deepEqual(loadKnowledge(root), { guide: 'eins', types: 'typ' });
    fs.writeFileSync(path.join(root, 'scripts', 'studio', 'ai', 'sdk-guide.md'), 'zwei');
    assert.equal(loadKnowledge(root).guide, 'zwei');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the real SDK knowledge fits the Ollama defaults with room for files', () => {
  const prompt = build({ knowledge: loadKnowledge(REPO_ROOT), contextTokens: 32768, maxTokens: 8192 });
  assert.ok(estimateTokens(prompt.system) < (32768 - 8192) / 2, `system uses ${estimateTokens(prompt.system)} tokens`);
});

test('system contains the guide, the types and both markers', () => {
  const prompt = build();
  assert.ok(prompt.system.includes('GUIDE-TEXT'));
  assert.ok(prompt.system.includes('declare namespace DemsPlugin {}'));
  assert.ok(prompt.system.includes(FILE_START.trim()));
  assert.ok(prompt.system.includes(FILE_END));
  assert.ok(prompt.system.indexOf('GUIDE-TEXT') < prompt.system.indexOf('declare namespace DemsPlugin'));
  assert.deepEqual(prompt.omitted, { turns: 0, files: [], errors: 0 });
});

test('files and message go into the last user message, message last', () => {
  const prompt = build({
    files: [
      { path: 'plugin.json', content: '{ "id": "demo" }', open: false },
      { path: 'server.js', content: 'const x = "```";\n', open: true }
    ],
    errors: ['server.js:3: Unbekannter Hook „event.foo“.'],
    message: 'Füge eine Route hinzu.'
  });
  const final = last(prompt);
  assert.equal(final.role, 'user');
  assert.ok(final.text.includes('### plugin.json'));
  assert.ok(final.text.includes('{ "id": "demo" }'));
  assert.ok(final.text.includes('### server.js'));
  assert.ok(final.text.includes('Aktuelle Fehler:'));
  assert.ok(final.text.includes('server.js:3: Unbekannter Hook „event.foo“.'));
  assert.ok(final.text.trimEnd().endsWith('Füge eine Route hinzu.'));
  // A fence inside the content must not close the code block early
  assert.ok(final.text.includes('````'));
  assert.ok(final.text.indexOf('Aktuelle Fehler:') < final.text.lastIndexOf('Füge eine Route hinzu.'));
});

test('without errors the user message has no error section', () => {
  assert.ok(!last(build()).text.includes('Aktuelle Fehler:'));
});

test('history keeps the last 10 turns and compacts file blocks of assistant turns', () => {
  const history = [];
  for (let i = 0; i < 14; i++) {
    history.push(i % 2 === 0
      ? { role: 'user', text: `Frage ${i}` }
      : { role: 'assistant', text: `Antwort ${i}\n${FILE_START}server.js\nconst geheim = ${i};\n${FILE_END}\nFertig.` });
  }
  const prompt = build({ history });
  const kept = prompt.messages.slice(0, -1);
  assert.equal(kept.length, MAX_TURNS);
  assert.equal(kept[0].text, 'Frage 4');
  assert.equal(kept[0].role, 'user');
  assert.equal(prompt.omitted.turns, 4);
  for (const turn of kept.filter((entry) => entry.role === 'assistant')) {
    assert.ok(turn.text.includes('[Dateien: server.js]'));
    assert.ok(!turn.text.includes('const geheim'));
  }
});

test('a history cut never starts with an assistant turn', () => {
  const history = [{ role: 'assistant', text: 'Hallo' }, { role: 'user', text: 'Frage' }, { role: 'assistant', text: 'Antwort' }];
  const prompt = build({ history });
  assert.equal(prompt.messages[0].role, 'user');
  assert.equal(prompt.omitted.turns, 1);
});

test('files beyond 200 kB are listed by name only', () => {
  const prompt = build({
    files: [
      { path: 'small.js', content: 'klein();\n', open: false },
      { path: 'huge.js', content: 'x'.repeat(150 * 1024), open: false },
      { path: 'large.js', content: 'y'.repeat(120 * 1024), open: false }
    ]
  });
  const final = last(prompt).text;
  assert.deepEqual(prompt.omitted.files, ['huge.js']);
  assert.ok(final.includes('### small.js'));
  assert.ok(final.includes('### large.js'));
  assert.ok(!final.includes('### huge.js'));
  assert.ok(!final.includes('x'.repeat(1000)));
  assert.match(final, /Nicht mitgeschickt: huge\.js/);
});

test('budget cuts history before closed files before errors', () => {
  const system = build().system;
  const open = { path: 'server.js', content: 'offen();\n'.repeat(50), open: true };
  const closed = { path: 'big.js', content: 'z'.repeat(30000), open: false };
  const errors = Array.from({ length: 8 }, (_, i) => `Fehler ${i}`);
  const history = Array.from({ length: 4 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: 'h'.repeat(3000) }));
  const maxTokens = 100;

  // Room for everything but the history: only turns are cut
  const roomy = estimateTokens(system) + 12000 + 2000;
  const first = build({ files: [open, closed], errors, history, contextTokens: roomy + maxTokens, maxTokens });
  assert.ok(first.omitted.turns > 0);
  assert.deepEqual(first.omitted.files, []);
  assert.equal(first.omitted.errors, 0);

  // Room for system + the open file + a few errors only: history and the closed file go, errors stay
  const tight = estimateTokens(system) + 1000;
  const second = build({ files: [open, closed], errors, history, contextTokens: tight + maxTokens, maxTokens });
  assert.equal(second.omitted.turns, 4);
  assert.deepEqual(second.omitted.files, ['big.js']);
  assert.equal(second.omitted.errors, 0);
  assert.ok(last(second).text.includes('### server.js'));
  assert.ok(last(second).text.includes('Fehler 7'));
  assert.match(last(second).text, /Nicht mitgeschickt: big\.js/);

  // Long error lines: beyond the first 5 they go last
  const longErrors = errors.map((line) => `${line} ${'e'.repeat(300)}`);
  const third = build({ files: [open, closed], errors: longErrors, history, contextTokens: tight + maxTokens, maxTokens });
  assert.equal(third.omitted.turns, 4);
  assert.deepEqual(third.omitted.files, ['big.js']);
  assert.equal(third.omitted.errors, 3);
  assert.ok(last(third).text.includes('Fehler 4'));
  assert.ok(!last(third).text.includes('Fehler 5'));
  assert.ok(last(third).text.includes('### server.js'));
});

test('more than 20 errors are capped', () => {
  const errors = Array.from({ length: 25 }, (_, i) => `Fehler Nummer ${i}`);
  const prompt = build({ errors });
  assert.equal(prompt.omitted.errors, 5);
  assert.ok(last(prompt).text.includes('Fehler Nummer 19'));
  assert.ok(!last(prompt).text.includes('Fehler Nummer 20'));
});

test('refuses when guide and types do not fit', () => {
  const huge = { guide: 'g'.repeat(30000), types: 't'.repeat(30000) };
  assert.throws(
    () => build({ knowledge: huge, contextTokens: 16000, maxTokens: 8192 }),
    (err) => err instanceof PromptError && err.code === 'context_too_small'
      && err.message === 'Die Kontextlänge reicht nicht für das SDK-Wissen. Erhöhe sie in den KI-Einstellungen (und in Ollama).'
  );
});
