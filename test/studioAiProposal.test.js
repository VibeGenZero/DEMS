'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { checkSet, evaluate, needsRepair, repairMessage } = require('../scripts/studio/ai/proposal');

const PLUGIN = path.join(__dirname, '..', 'plugins', 'event-feedback');

// An in-memory copy of an official plugin (text files only)
function load() {
  const map = new Map();
  const walk = (rel) => {
    for (const entry of fs.readdirSync(path.join(PLUGIN, rel), { withFileTypes: true })) {
      const name = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(name);
      else map.set(name, fs.readFileSync(path.join(PLUGIN, name), 'utf8').replace(/\r\n/g, '\n'));
    }
  };
  walk('');
  return map;
}
const withManifest = (map, patch) => {
  const next = new Map(map);
  next.set('plugin.json', JSON.stringify({ ...JSON.parse(map.get('plugin.json')), ...patch }, null, 2));
  return next;
};

test('a clean change has no problems and lists only changed files', () => {
  const current = load();
  const result = evaluate({ current, proposed: [
    { path: 'client.css', content: `${current.get('client.css')}\n/* tweak */` },
    { path: 'rules.js', content: current.get('rules.js') }
  ] });
  assert.deepEqual(checkSet(current), []);
  assert.deepEqual(result.newProblems, []);
  assert.deepEqual(result.dropped, []);
  assert.deepEqual(result.files.map((f) => f.path), ['client.css']);
  assert.equal(result.files[0].isNew, false);
  assert.equal(result.files[0].before, current.get('client.css'));
  assert.equal(needsRepair(result), false);
});

test('a new file is marked isNew with an empty before', () => {
  const result = evaluate({ current: load(), proposed: [{ path: 'notes.md', content: 'hi' }] });
  assert.deepEqual(result.files, [{ path: 'notes.md', before: '', after: 'hi', isNew: true }]);
});

test('a new ctx.discord.sendDM without discord:dm is a new problem', () => {
  const current = withManifest(load(), { permissions: ['events:read'] });
  current.set('server.js', 'module.exports = {};\n');
  const server = 'module.exports = (ctx) => { ctx.discord.sendDM("1", "hi"); };\n';
  const result = evaluate({ current, proposed: [{ path: 'server.js', content: server }] });
  assert.ok(result.newProblems.some((p) => p.message.includes('discord:dm')), JSON.stringify(result.newProblems));
  assert.ok(result.permissionChanges.added.includes('discord:dm'));
  assert.equal(needsRepair(result), true);
});

test('an SDK-1.1 permission without sdk 1.1 is a problem', () => {
  const current = withManifest(load(), { sdk: 1, permissions: [] });
  const problems = checkSet(withManifest(current, { permissions: ['discord:dm'] }));
  assert.ok(problems.some((p) => p.message.includes('1.1')), JSON.stringify(problems));
  const result = evaluate({ current: withManifest(load(), { sdk: 1, permissions: ['discord:dm'] }), proposed: [{ path: 'notes.md', content: 'x' }] });
  assert.equal(result.permissionChanges.sdk, 1.1);
});

test('a syntax error in server.js is found and the code does not run', () => {
  delete globalThis.__ran;
  const current = load();
  current.set('server.js', 'globalThis.__ran = true; (');
  const problems = checkSet(current);
  const p = problems.find((x) => x.file === 'server.js');
  assert.ok(p, JSON.stringify(problems));
  assert.match(p.message, /server\.js/);
  assert.equal(globalThis.__ran, undefined);
});

test('a client file does not run either', () => {
  const marker = path.join(require('node:os').tmpdir(), `dems-proposal-${process.pid}.txt`);
  const current = load();
  current.set('client.js', `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x'); export const a = ;`);
  const problems = checkSet(current);
  assert.ok(problems.some((x) => x.file === 'client.js'));
  assert.equal(fs.existsSync(marker), false);
});

test('an ES module client file with import/export passes the syntax check', () => {
  const current = load();
  current.set('assets/view.js', 'import { a } from "./other.js";\nexport const b = a + 1;\nawait Promise.resolve();\n');
  current.set('assets/other.js', 'export const a = 1;\n');
  assert.deepEqual(checkSet(current).filter((p) => p.file.endsWith('.js')), []);
});

test('an error that existed before is old, not new', () => {
  const current = load();
  current.set('server.js', 'module.exports = (;');
  const result = evaluate({ current, proposed: [{ path: 'client.css', content: 'a{}' }] });
  assert.ok(result.oldProblems.length > 0);
  assert.deepEqual(result.newProblems, []);
  assert.equal(needsRepair(result), false);
});

test('problem keys are stable across runs', () => {
  const current = load();
  current.set('server.js', 'module.exports = (;');
  assert.deepEqual(checkSet(current).map((p) => p.key), checkSet(new Map(current)).map((p) => p.key));
});

test('an invalid manifest is a problem', () => {
  const current = load();
  current.set('plugin.json', '{ not json');
  const problems = checkSet(current);
  assert.ok(problems.some((p) => p.file === 'plugin.json'));
});

test('../x.js, /abs.js, index.html, assets/logo.png are dropped with a reason', () => {
  const result = evaluate({ current: load(), proposed: [
    { path: '../x.js', content: '1' },
    { path: '/abs.js', content: '1' },
    { path: 'index.html', content: '<p>' },
    { path: 'assets/logo.png', content: 'PNG' },
    { path: 'a/../b.js', content: '1' }
  ] });
  assert.deepEqual(result.dropped.map((d) => d.path), ['../x.js', '/abs.js', 'index.html', 'assets/logo.png', 'a/../b.js']);
  assert.ok(result.dropped.every((d) => typeof d.reason === 'string' && d.reason.length > 0));
  assert.match(result.dropped[3].reason, /Bild|Binär|binär/);
  assert.deepEqual(result.files, []);
});

test('an oversized file is dropped', () => {
  const result = evaluate({ current: load(), proposed: [{ path: 'big.md', content: 'x'.repeat(2097153) }] });
  assert.equal(result.dropped.length, 1);
  assert.match(result.dropped[0].reason, /groß/);
});

test('repairMessage names each new problem and each dropped file', () => {
  const current = load();
  const result = evaluate({ current, proposed: [
    { path: 'server.js', content: 'module.exports = (;' },
    { path: 'index.html', content: 'x' }
  ] });
  const text = repairMessage(result);
  assert.match(text, /^Bitte korrigiere:/);
  assert.ok(result.newProblems.length > 0);
  for (const p of result.newProblems) assert.ok(text.includes(p.message));
  assert.ok(text.includes('index.html'));
});
