const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  scanSource, scanPlugin, comparePermissions, requiredSdk, formatWarning,
} = require('../plugin-sdk/permissionScan');
const { PERMISSIONS } = require('../plugin-sdk/manifest');
const { HOOK_NAMES } = require('../plugin-sdk/hooks');
const { readPluginSourcesSync } = require('../plugin-sdk/files');

const scan = (code, kind = 'server') => scanSource(code, { file: 'server.js', kind });
const perms = (code, kind) => [...scan(code, kind).permissions].sort();

test('permission rules', () => {
  const rows = [
    ['ctx.events.get(1)', ['events:read']],
    ['ctx.events.list()', ['events:read']],
    ["ctx.hooks.on('event.created', f)", ['events:read']],
    ["ctx.hooks.on('registration.checkedIn', f)", ['registrations:read']],
    ["ctx.hooks.on('member.deleted', f)", []],
    ['ui.openEventEditor({})', ['events:draft']],
    ['ctx.members.get(1)', ['members:read']],
    ['ctx.members.search(q)', ['members:read']],
    ['ctx.registrations.list(1)', ['registrations:read']],
    ['ctx.discord.sendDM(1, "x")', ['discord:dm']],
    ['ctx.discord.sendChannelMessage(1, "x")', ['discord:channel']],
    ['ctx.discord.listRoles()', ['discord:roles']],
    ['ctx.discord.addRole(1, 2)', ['discord:roles']],
    ['ctx.discord.removeRole(1, 2)', ['discord:roles']],
    ['ctx.theme.set({})', ['theme']],
    ['ui.theme.apply()', ['theme']],
  ];
  for (const [code, expected] of rows) {
    const r = scan(code);
    assert.deepEqual([...r.permissions].sort(), expected, code);
    assert.deepEqual(r.warnings, [], code);
  }
});

test('network detection on the server only', () => {
  assert.deepEqual(perms('fetch(url)', 'server'), ['network']);
  assert.deepEqual(perms('fetch(url)', 'client'), []);
  assert.deepEqual(perms('this.fetch(x)', 'server'), []);
  assert.deepEqual(perms('new WebSocket(u)', 'server'), ['network']);
  assert.deepEqual(perms('x.WebSocket', 'server'), []);
  assert.deepEqual(perms("require('node:https')", 'server'), ['network']);
  assert.deepEqual(perms("const n = require('net')", 'server'), ['network']);
  assert.deepEqual(perms("import h from 'http'", 'server'), ['network']);
  assert.deepEqual(perms("import('node:tls')", 'server'), ['network']);
  assert.deepEqual(perms("require('node:https')", 'client'), []);
  assert.deepEqual(perms("require('fs')", 'server'), []);
});

test('warning rows with exact message and line', () => {
  const w = (code) => scan(`\n${code}`).warnings;
  assert.deepEqual(w('ctx[name]'), [{ file: 'server.js', line: 2, message: 'Dynamischer Zugriff auf ctx – Berechtigung nicht erkennbar.' }]);
  assert.equal(w('ui[name]')[0].message, 'Dynamischer Zugriff auf ui – Berechtigung nicht erkennbar.');
  assert.equal(w('ctx.discord[m](1)')[0].message, 'Dynamischer Zugriff auf ctx.discord – Berechtigung nicht erkennbar.');
  assert.deepEqual(w('use(ctx.events)'), [{ file: 'server.js', line: 2, message: 'ctx.events wird weitergegeben – Berechtigung nicht erkennbar.' }]);
  assert.equal(w('const e = ctx.hooks;')[0].message, 'ctx.hooks wird weitergegeben – Berechtigung nicht erkennbar.');
  assert.equal(w('const c = ctx;')[0].message, 'ctx wird umbenannt oder zerlegt – Berechtigung nicht erkennbar.');
  assert.equal(w('const { events } = ctx;')[0].message, 'ctx wird umbenannt oder zerlegt – Berechtigung nicht erkennbar.');
  assert.equal(w('const u = ui;')[0].message, 'ui wird umbenannt oder zerlegt – Berechtigung nicht erkennbar.');
  assert.equal(w('ctx.hooks.on(name, f)')[0].message, 'Hook-Name ist kein fester Text – Berechtigung nicht erkennbar.');
  assert.equal(w("ctx.hooks.on('a' + b, f)")[0].message, 'Hook-Name ist kein fester Text – Berechtigung nicht erkennbar.');
  assert.deepEqual(w("ctx.hooks.on('event.nope', f)"), [{ file: 'server.js', line: 2, message: 'Unbekannter Hook „event.nope“.' }]);
  assert.equal(w('require(p)')[0].message, 'require/import mit berechnetem Pfad – nicht prüfbar.');
  assert.equal(w('import(`./a${x}.js`)')[0].message, 'require/import mit berechnetem Pfad – nicht prüfbar.');
});

test('comparisons are not renames', () => {
  for (const code of ['a === ctx', 'a == ctx', 'a => ctx', 'a >= ctx', 'a != ctx']) {
    assert.deepEqual(scan(code).warnings, [], code);
  }
});

test('passing ctx as argument and member lookalikes yield nothing', () => {
  for (const code of ['createEngine(ctx)', 'this.ctx.discord.sendDM()', 'x.ui.theme.y']) {
    const r = scan(code);
    assert.equal(r.permissions.size, 0, code);
    assert.deepEqual(r.warnings, [], code);
  }
});

test('imports lists literal relative specifiers', () => {
  const r = scan("require('./a'); import x from './b.js'; import('../c.js'); require('fs'); import 'pkg';");
  assert.deepEqual(r.imports, ['./a', './b.js', '../c.js']);
});

test('CRLF keeps line numbers', () => {
  const r = scan('a\r\nb\r\nctx[x]');
  assert.equal(r.warnings[0].line, 3);
});

test('formatWarning', () => {
  assert.equal(formatWarning({ file: 'a.js', line: 3, message: 'm' }), 'a.js:3: m');
});

test('requiredSdk', () => {
  assert.equal(requiredSdk(['discord:roles'], 1), 1.1);
  assert.equal(requiredSdk(['events:read'], 1.1), 1.1);
  assert.equal(requiredSdk([], 1), 1);
});

test('comparePermissions', () => {
  assert.deepEqual(comparePermissions(['a', 'b'], ['b', 'c']), { missing: ['c'], unused: ['a'] });
});

test('scanPlugin resolves client files through imports', () => {
  const sources = new Map([
    ['server.js', "ctx.events.list(); fetch('x'); require('./lib')"],
    ['lib.js', "fetch('y')"],
    ['client.js', "import { a } from './util'; fetch('z'); ctx.discord.listRoles()"],
    ['util.js', "fetch('w'); ctx.theme.x"],
    ['assets/extra.js', "fetch('v')"],
  ]);
  const r = scanPlugin(sources, { server: 'server.js', client: 'client.js' });
  assert.deepEqual(r.permissions, ['events:read', 'network', 'theme', 'discord:roles']);
  assert.deepEqual(r.warnings, []);
});

test('hook list matches plugin-sdk/hooks', () => {
  const { HOOK_NAMES: scanned } = require('../plugin-sdk/permissionScan');
  assert.deepEqual(scanned, HOOK_NAMES);
});

test('guard: official plugins scan to their manifest', () => {
  const order = Object.keys(PERMISSIONS);
  for (const name of ['badges', 'custom-design', 'event-feedback', 'event-submissions']) {
    const dir = path.join(__dirname, '..', 'plugins', name);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8'));
    const { sources } = readPluginSourcesSync(dir);
    const r = scanPlugin(sources, manifest);
    assert.deepEqual(r.warnings, [], name);
    assert.deepEqual(r.permissions, order.filter((p) => manifest.permissions.includes(p)), name);
    assert.equal(requiredSdk(r.permissions, 1), manifest.sdk, name);
  }
});

test('optional chaining behaves like plain member access', () => {
  const rows = [
    ['ctx?.events.get(1)', ['events:read']],
    ['ctx.events?.get(1)', ['events:read']],
    ['ctx?.discord?.sendDM(1, "x")', ['discord:dm']],
    ["ctx.hooks?.on('event.created', f)", ['events:read']],
    ['ctx?.theme.x', ['theme']],
    ['ui?.openEventEditor({})', ['events:draft']],
  ];
  for (const [code, expected] of rows) {
    const r = scan(code);
    assert.deepEqual([...r.permissions].sort(), expected, code);
    assert.deepEqual(r.warnings, [], code);
  }
});

test('compound assignments before ctx/ui are aliases', () => {
  for (const code of ['x ??= ctx', 'x ||= ctx', 'x &&= ctx', 'x += ctx']) {
    assert.equal(scan(code).warnings[0].message, 'ctx wird umbenannt oder zerlegt – Berechtigung nicht erkennbar.', code);
  }
  for (const code of ['a !== ctx', 'a <= ctx', 'a === ctx', 'a => ctx']) {
    assert.deepEqual(scan(code).warnings, [], code);
  }
});

test('scanPlugin normalises a leading ./ in manifest.client', () => {
  const sources = new Map([['server.js', ''], ['client.js', 'fetch(x)']]);
  const r = scanPlugin(sources, { server: './server.js', client: './client.js' });
  assert.deepEqual(r.permissions, []);
});
