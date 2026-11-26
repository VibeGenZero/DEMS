'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const files = require('../scripts/studio/files');
const recent = require('../scripts/studio/recent');

let tmp, dir, linkOk = false;

function makePlugin(parent, id) {
  const root = path.join(parent, id);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'plugin.json'), JSON.stringify({
    id, name: id, version: '0.1.0', sdk: 1.1, description: 'x', author: 'y', server: 'server.js', client: 'client.js', permissions: [], settings: [],
  }));
  fs.writeFileSync(path.join(root, 'server.js'), 'module.exports = {};\n');
  fs.writeFileSync(path.join(root, 'client.js'), 'export {};\n');
  return root;
}

const refused = (fn, re = /Unerlaubter Pfad/) => assert.throws(fn, (e) => e instanceof files.StudioError && re.test(e.message) && !/[A-Za-z]:\\|\/tmp|Users/.test(e.message));

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-files-'));
  dir = files.openPlugin(makePlugin(tmp, 'demo-plugin')).dir;
  fs.mkdirSync(path.join(tmp, 'outside'));
  fs.writeFileSync(path.join(tmp, 'outside', 'secret.js'), 'secret');
  try { fs.symlinkSync(path.join(tmp, 'outside'), path.join(dir, 'linked'), 'junction'); linkOk = true; } catch { linkOk = false; }
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('openPlugin returns id and version', () => {
  const p = files.openPlugin(path.join(tmp, 'demo-plugin'));
  assert.equal(p.id, 'demo-plugin');
  assert.equal(p.version, '0.1.0');
  assert.equal(p.manifest.name, 'demo-plugin');
});

test('openPlugin accepts backslashes on Windows', { skip: process.platform !== 'win32' && 'Windows only' }, () => {
  assert.equal(files.openPlugin(path.join(tmp, 'demo-plugin').replace(/\//g, '\\')).id, 'demo-plugin');
});

test('openPlugin explains a missing plugin.json, a bad folder and a bad id', () => {
  const empty = path.join(tmp, 'empty-one');
  fs.mkdirSync(empty);
  assert.throws(() => files.openPlugin(empty), /plugin\.json/);
  assert.throws(() => files.openPlugin(path.join(tmp, 'nope')), (e) => e.status === 404);
  const wrong = makePlugin(tmp, 'other-name');
  const raw = JSON.parse(fs.readFileSync(path.join(wrong, 'plugin.json'), 'utf8'));
  fs.writeFileSync(path.join(wrong, 'plugin.json'), JSON.stringify({ ...raw, id: 'different' }));
  assert.throws(() => files.openPlugin(wrong), /Ordnernamen/);
});

test('listFiles hides dot entries, node_modules and extension-less files', () => {
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.git', 'config.json'), '{}');
  fs.mkdirSync(path.join(dir, 'node_modules', 'x'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', 'x', 'i.js'), '');
  fs.writeFileSync(path.join(dir, 'LICENSE'), 'MIT');
  fs.writeFileSync(path.join(dir, '.hidden.js'), '');
  fs.writeFileSync(path.join(dir, 'index.html'), '<p>');
  const list = files.listFiles(dir);
  assert.deepEqual(list.map((f) => f.path), ['client.js', 'index.html', 'plugin.json', 'server.js']);
  assert.deepEqual(list.find((f) => f.path === 'index.html'), { path: 'index.html', size: 3, text: false, allowed: false });
  assert.ok(list.filter((f) => f.path !== 'index.html').every((f) => f.text && f.allowed && f.size > 0));
});

test('readFile and writeFile round-trip; writes are atomic and leave no temp file', () => {
  files.writeFile(dir, 'server.js', 'const a = 1;\n');
  assert.equal(files.readFile(dir, 'server.js'), 'const a = 1;\n');
  files.writeFile(dir, 'lib/util.js', 'x');
  assert.equal(files.readFile(dir, 'lib/util.js'), 'x');
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.tmp')), []);
  assert.ok(files.listFiles(dir).some((f) => f.path === 'lib/util.js'));
});

test('paths outside the folder or against the allow-list are refused', () => {
  for (const bad of ['../x', 'C:/x', '/etc/x', 'a\\b.js', 'server.js::$DATA', 'a/../server.js', '.git/config.json', 'node_modules/x.js', 'CON.js', 'x.js.']) {
    refused(() => files.readFile(dir, bad), /Pfad|Versteckte|node_modules|Nicht erlaubte/);
  }
  refused(() => files.writeFile(dir, 'index.html', 'x'), /Nicht erlaubte Datei/);
  refused(() => files.writeFile(dir, 'LICENSE', 'x'), /Nicht erlaubte Datei/);
});

test('a link inside the folder is never followed', { skip: !linkOk && 'no link permission' }, () => {
  refused(() => files.readFile(dir, 'linked/secret.js'));
  refused(() => files.writeFile(dir, 'linked/new.js', 'x'));
  refused(() => files.createFile(dir, 'linked/new.js'));
  assert.equal(fs.existsSync(path.join(tmp, 'outside', 'new.js')), false);
  assert.ok(!files.listFiles(dir).some((f) => f.path.startsWith('linked')));
});

test('a file link is refused too', { skip: process.platform === 'win32' && 'needs symlink permission on Windows' }, () => {
  fs.symlinkSync(path.join(tmp, 'outside', 'secret.js'), path.join(dir, 'ln.js'));
  refused(() => files.readFile(dir, 'ln.js'));
  refused(() => files.writeFile(dir, 'ln.js', 'x'));
  fs.rmSync(path.join(dir, 'ln.js'));
});

test('an 8.3 short name cannot open a dot file', { skip: process.platform !== 'win32' && 'Windows only' }, () => {
  fs.writeFileSync(path.join(dir, '.secret-config.json'), '{}');
  const short = require('node:child_process').execSync('cmd /c dir /x', { cwd: dir }).toString().split(/\r?\n/).find((l) => l.includes('.secret-config.json'));
  const m = short && short.match(/\s([A-Z0-9_~]+~\d(?:\.[A-Z0-9]+)?)\s+\.secret-config\.json/);
  if (!m) return; // short names disabled on this volume
  refused(() => files.readFile(dir, m[1].toLowerCase()), /Pfad|Versteckte|Nicht erlaubte/);
  refused(() => files.readFile(dir, m[1]), /Pfad|Versteckte|Nicht erlaubte/);
});

test('a 3 MB json is listed as not text and cannot be opened or written', () => {
  fs.writeFileSync(path.join(dir, 'data.json'), Buffer.alloc(3 * 1024 * 1024, 0x61));
  assert.equal(files.listFiles(dir).find((f) => f.path === 'data.json').text, false);
  assert.throws(() => files.readFile(dir, 'data.json'), /Kann nicht im Editor geöffnet werden/);
  assert.throws(() => files.writeFile(dir, 'big.json', 'a'.repeat(3 * 1024 * 1024)), /Datei zu groß/);
  fs.rmSync(path.join(dir, 'data.json'));
});

test('a non-UTF-8 file cannot be opened; writeBinary stores an asset', () => {
  files.writeBinary(dir, 'assets/icon.png', Buffer.from([0x89, 0x50, 0xff, 0xfe]));
  assert.equal(files.listFiles(dir).find((f) => f.path === 'assets/icon.png').text, false);
  assert.throws(() => files.readFile(dir, 'assets/icon.png'), /Kann nicht im Editor geöffnet werden/);
  assert.deepEqual(fs.readFileSync(path.join(dir, 'assets', 'icon.png')), Buffer.from([0x89, 0x50, 0xff, 0xfe]));
});

test('createFile, renameFile and deleteFile with their errors', () => {
  files.createFile(dir, 'a.js');
  assert.equal(files.readFile(dir, 'a.js'), '');
  assert.throws(() => files.createFile(dir, 'a.js'), (e) => e.status === 409 && /Die Datei gibt es schon/.test(e.message));
  files.writeFile(dir, 'b.js', 'b');
  assert.throws(() => files.renameFile(dir, 'a.js', 'b.js'), (e) => e.status === 409);
  assert.equal(files.readFile(dir, 'b.js'), 'b');
  files.renameFile(dir, 'a.js', 'c.js');
  assert.throws(() => files.readFile(dir, 'a.js'), (e) => e.status === 404 && /Datei nicht gefunden/.test(e.message));
  refused(() => files.renameFile(dir, 'c.js', 'c.html'), /Nicht erlaubte/);
  files.deleteFile(dir, 'c.js');
  assert.throws(() => files.deleteFile(dir, 'c.js'), (e) => e.status === 404);
});

test('recent.configDir follows the platform', () => {
  assert.equal(recent.configDir({ APPDATA: 'C:\\Users\\u\\AppData\\Roaming' }, 'win32'), path.win32.join('C:\\Users\\u\\AppData\\Roaming', 'dems-studio'));
  assert.equal(recent.configDir({ XDG_CONFIG_HOME: '/x/cfg', HOME: '/home/u' }, 'linux'), path.posix.join('/x/cfg', 'dems-studio'));
  assert.equal(recent.configDir({ HOME: '/home/u' }, 'linux'), path.posix.join('/home/u', '.config', 'dems-studio'));
});

test('recent keeps the newest 10, dedupes by folder and flags missing folders', () => {
  const cfg = path.join(tmp, 'cfg');
  assert.deepEqual(recent.load(cfg), []);
  for (let i = 0; i < 12; i++) {
    const d = path.join(tmp, `r${i}`);
    fs.mkdirSync(d, { recursive: true });
    recent.add(cfg, { dir: d, id: `plug-${i}`, name: `P${i}`, openedAt: new Date(2026, 0, 1 + i).toISOString() });
  }
  recent.add(cfg, { dir: path.join(tmp, 'r5'), id: 'plug-5', name: 'P5', openedAt: new Date(2026, 5, 1).toISOString() });
  let list = recent.load(cfg);
  assert.equal(list.length, 10);
  assert.equal(list[0].id, 'plug-5');
  assert.equal(list.filter((e) => e.id === 'plug-5').length, 1);
  assert.ok(list.every((e) => e.exists));
  fs.rmSync(path.join(tmp, 'r11'), { recursive: true });
  list = recent.load(cfg);
  assert.equal(list.find((e) => e.id === 'plug-11').exists, false);
  recent.remove(cfg, path.join(tmp, 'r11'));
  assert.ok(!recent.load(cfg).some((e) => e.id === 'plug-11'));
  assert.deepEqual(fs.readdirSync(cfg), ['recent.json']);
});

test('recent.load survives a corrupt file', () => {
  const cfg = path.join(tmp, 'cfg-bad');
  fs.mkdirSync(cfg);
  fs.writeFileSync(path.join(cfg, 'recent.json'), '{nope');
  assert.deepEqual(recent.load(cfg), []);
});

function fresh(id) {
  return files.openPlugin(makePlugin(tmp, id)).dir;
}

test('new files can be created in existing folders (write, create, upload, rename into)', () => {
  const d = fresh('fresh-one');
  files.writeFile(d, 'lib/a.js', 'a');
  files.writeFile(d, 'lib/b.js', 'b');
  files.createFile(d, 'lib/c.js');
  files.writeBinary(d, 'assets/one.png', Buffer.from([1, 2]));
  files.writeBinary(d, 'assets/two.png', Buffer.from([1, 2]));
  files.renameFile(d, 'server.js', 'lib/server.js');
  files.writeFile(d, 'lib/deep/x.js', 'x');
  assert.ok(files.listFiles(d).some((f) => f.path === 'lib/deep/x.js'));
  assert.equal(files.readFile(d, 'lib/server.js'), 'module.exports = {};\n');
});

test('a case-only rename changes the case on disk', () => {
  const d = fresh('fresh-case');
  files.writeFile(d, 'a.js', 'a');
  files.renameFile(d, 'a.js', 'A.JS');
  const names = files.listFiles(d).map((f) => f.path);
  assert.ok(names.includes('A.JS') && !names.includes('a.js'), names.join());
});

test('refused-but-safe files are listed, can be deleted and renamed out, never written to', () => {
  const d = fresh('fresh-refused');
  fs.writeFileSync(path.join(d, 'index.html'), '<p>');
  fs.mkdirSync(path.join(d, 'assets', 'sub'), { recursive: true });
  fs.writeFileSync(path.join(d, 'assets', 'sub', 'x.png'), 'p');
  fs.writeFileSync(path.join(d, 'LICENSE'), 'MIT');
  const list = files.listFiles(d);
  assert.equal(list.find((f) => f.path === 'assets/sub/x.png').allowed, false);
  assert.ok(!list.some((f) => f.path === 'LICENSE'));
  refused(() => files.deleteFile(d, 'LICENSE'), /Nicht erlaubte/);
  refused(() => files.writeFile(d, 'index.html', 'x'), /Nicht erlaubte/);
  refused(() => files.createFile(d, 'other.html'), /Nicht erlaubte/);
  refused(() => files.renameFile(d, 'server.js', 'server.html'), /Nicht erlaubte/);
  refused(() => files.deleteFile(d, '.git/x.js'), /Versteckte/);
  files.renameFile(d, 'index.html', 'index.txt');
  files.deleteFile(d, 'assets/sub/x.png');
  assert.ok(files.listFiles(d).some((f) => f.path === 'index.txt' && f.allowed));
  assert.ok(!files.listFiles(d).some((f) => f.path === 'assets/sub/x.png'));
});

test('a folder swapped for a link after open is refused', { skip: !linkOk && 'no link permission' }, () => {
  const d = fresh('fresh-swap');
  fs.renameSync(d, `${d}-moved`);
  fs.symlinkSync(path.join(tmp, 'outside'), d, 'junction');
  refused(() => files.writeFile(d, 'x.js', 'x'), /Ordner/);
  assert.equal(fs.existsSync(path.join(tmp, 'outside', 'x.js')), false);
  fs.rmSync(d);
});

test('OS litter names are refused for writes', () => {
  refused(() => files.writeFile(dir, '__MACOSX/x.js', 'x'));
  refused(() => files.writeFile(dir, 'a/.DS_Store', 'x'));
});

test('unexpected fs errors become German StudioErrors without paths', () => {
  const d = fresh('fresh-err');
  const orig = { rename: fs.renameSync, error: console.error };
  fs.renameSync = () => { throw Object.assign(new Error(`EACCES ${d}`), { code: 'EACCES' }); };
  console.error = () => {};
  try {
    assert.throws(() => files.writeFile(d, 'e.js', 'x'), (e) => e instanceof files.StudioError && e.status === 500 && /gespeichert/.test(e.message) && !e.message.includes(d));
    assert.deepEqual(fs.readdirSync(d).filter((n) => n.endsWith('.tmp')), []);
  } finally {
    fs.renameSync = orig.rename;
    console.error = orig.error;
  }
});

test('folder limits: file count and unpacked size', () => {
  const d = fresh('fresh-limit');
  for (let i = 0; i < 296; i++) fs.writeFileSync(path.join(d, `f${i}.js`), '');
  files.createFile(d, 'last.js');
  assert.throws(() => files.createFile(d, 'over.js'), /Das Plugin wird zu groß/);
  assert.throws(() => files.writeFile(d, 'over2.js', 'x'), /Das Plugin wird zu groß/);
  const b = fresh('fresh-bytes');
  for (let i = 0; i < 9; i++) fs.writeFileSync(path.join(b, `big${i}.json`), Buffer.alloc(2 * 1024 * 1024, 0x61));
  assert.throws(() => files.writeBinary(b, 'assets/z.png', Buffer.alloc(2 * 1024 * 1024)), /Das Plugin wird zu groß/);
  files.writeFile(b, 'small.js', 'x');
});

test('openPlugin refuses an oversized plugin.json', () => {
  const d = makePlugin(tmp, 'fresh-bigjson');
  fs.writeFileSync(path.join(d, 'plugin.json'), Buffer.alloc(3 * 1024 * 1024, 0x20));
  assert.throws(() => files.openPlugin(d), /zu groß/);
});
