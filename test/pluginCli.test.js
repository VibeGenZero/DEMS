const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable, Writable } = require('stream');
const { main } = require('../scripts/plugin');

function sink() {
    const chunks = [];
    const stream = new Writable({ write(chunk, enc, cb) { chunks.push(String(chunk)); cb(); } });
    stream.text = () => chunks.join('');
    return stream;
}

async function run(args, cwd, { answers = '', isTTY = false, env = {} } = {}) {
    const stdout = sink();
    const stderr = sink();
    const stdin = Readable.from(answers ? [answers] : []);
    const code = await main(args, { cwd, stdin, stdout, stderr, env, isTTY });
    return { code, out: stdout.text(), err: stderr.text() };
}

function tmp() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'dems-cli-'));
}

test('new scaffolds a plugin that builds', async () => {
    const cwd = tmp();
    const created = await run(['new', 'demo-plugin'], cwd);
    assert.equal(created.code, 0, created.err);
    for (const f of ['plugin.json', 'server.js', 'client.js', 'client.css']) {
        assert.ok(fs.existsSync(path.join(cwd, 'demo-plugin', f)), f);
    }
    const built = await run(['build', 'demo-plugin', '--yes'], cwd);
    assert.equal(built.code, 0, built.err);
    assert.match(built.out, /Gebaut: /);
    assert.ok(fs.existsSync(path.join(cwd, 'demo-plugin-0.1.0.dems')));
});

test('new refuses a bad id and an existing folder', async () => {
    const cwd = tmp();
    const bad = await run(['new', 'Bad'], cwd);
    assert.equal(bad.code, 1);
    assert.match(bad.err, /Die ID ist nicht erlaubt: Bad/);
    await run(['new', 'demo-plugin'], cwd);
    const again = await run(['new', 'demo-plugin'], cwd);
    assert.equal(again.code, 1);
});

test('new honours --dir', async () => {
    const cwd = tmp();
    const r = await run(['new', 'demo-plugin', '--dir', 'sub'], cwd);
    assert.equal(r.code, 0, r.err);
    assert.ok(fs.existsSync(path.join(cwd, 'sub', 'demo-plugin', 'plugin.json')));
});

function addUsage(cwd) {
    const file = path.join(cwd, 'demo-plugin', 'server.js');
    fs.appendFileSync(file, "\nasync function more(ctx) { return ctx.events.list({ upcoming: true }); }\nmodule.exports.more = more;\n");
}

test('check reports a missing permission and writes nothing', async () => {
    const cwd = tmp();
    await run(['new', 'demo-plugin'], cwd);
    addUsage(cwd);
    const before = fs.readFileSync(path.join(cwd, 'demo-plugin', 'plugin.json'), 'utf8');
    const r = await run(['check', 'demo-plugin'], cwd);
    assert.equal(r.code, 0);
    assert.match(r.out, /\+ events:read/);
    assert.equal(fs.readFileSync(path.join(cwd, 'demo-plugin', 'plugin.json'), 'utf8'), before);
});

test('check exits 1 on errors', async () => {
    const cwd = tmp();
    await run(['new', 'demo-plugin'], cwd);
    fs.writeFileSync(path.join(cwd, 'demo-plugin', 'plugin.json'), '{ nope');
    const r = await run(['check', 'demo-plugin'], cwd);
    assert.equal(r.code, 1);
    assert.match(r.err, /kein gültiges JSON/);
});

test('build without --yes in a non-interactive shell stops', async () => {
    const cwd = tmp();
    await run(['new', 'demo-plugin'], cwd);
    addUsage(cwd);
    const file = path.join(cwd, 'demo-plugin', 'plugin.json');
    const before = fs.readFileSync(file, 'utf8');
    const r = await run(['build', 'demo-plugin'], cwd);
    assert.equal(r.code, 1);
    assert.match(r.err, /Nicht interaktiv: mit --yes bestätigen\./);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('build --yes updates plugin.json', async () => {
    const cwd = tmp();
    await run(['new', 'demo-plugin'], cwd);
    addUsage(cwd);
    const r = await run(['build', 'demo-plugin', '--yes'], cwd);
    assert.equal(r.code, 0, r.err);
    assert.ok(JSON.parse(fs.readFileSync(path.join(cwd, 'demo-plugin', 'plugin.json'), 'utf8')).permissions.includes('events:read'));
});

test('build asks on a TTY and n keeps the old manifest', async () => {
    const cwd = tmp();
    await run(['new', 'demo-plugin'], cwd);
    addUsage(cwd);
    const file = path.join(cwd, 'demo-plugin', 'plugin.json');
    const before = fs.readFileSync(file, 'utf8');
    const r = await run(['build', 'demo-plugin'], cwd, { isTTY: true, answers: 'n\n' });
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /plugin\.json aktualisieren\? \(j\/n\)/);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    assert.ok(fs.existsSync(path.join(cwd, 'demo-plugin-0.1.0.dems')));
});

test('build --out writes to the named file', async () => {
    const cwd = tmp();
    await run(['new', 'demo-plugin'], cwd);
    const r = await run(['build', 'demo-plugin', '--yes', '--out', 'x.dems'], cwd);
    assert.equal(r.code, 0, r.err);
    assert.ok(fs.existsSync(path.join(cwd, 'x.dems')));
});

test('install, then refuse a second install without --force', async () => {
    const cwd = tmp();
    const plugins = path.join(cwd, 'plugins-dir');
    await run(['new', 'demo-plugin'], cwd);
    await run(['build', 'demo-plugin', '--yes'], cwd);
    const first = await run(['install', 'demo-plugin-0.1.0.dems', '--plugins-dir', plugins], cwd);
    assert.equal(first.code, 0, first.err);
    assert.match(first.out, /Installiert: demo-plugin 0\.1\.0\. DEMS neu starten/);
    assert.ok(fs.existsSync(path.join(plugins, 'demo-plugin', 'plugin.json')));
    const second = await run(['install', 'demo-plugin-0.1.0.dems', '--plugins-dir', plugins], cwd);
    assert.equal(second.code, 1);
    const forced = await run(['install', 'demo-plugin-0.1.0.dems', '--force', '--plugins-dir', plugins], cwd);
    assert.equal(forced.code, 0, forced.err);
});

test('install uses PLUGINS_DIR from env', async () => {
    const cwd = tmp();
    const plugins = path.join(cwd, 'env-dir');
    await run(['new', 'demo-plugin'], cwd);
    await run(['build', 'demo-plugin', '--yes'], cwd);
    const r = await run(['install', 'demo-plugin-0.1.0.dems'], cwd, { env: { PLUGINS_DIR: plugins } });
    assert.equal(r.code, 0, r.err);
    assert.ok(fs.existsSync(path.join(plugins, 'demo-plugin')));
});

test('help and unknown commands', async () => {
    const cwd = tmp();
    const help = await run(['help'], cwd);
    assert.equal(help.code, 0);
    assert.match(help.out, /Verwendung/);
    assert.equal((await run([], cwd)).code, 0);
    const bad = await run(['nope'], cwd);
    assert.equal(bad.code, 1);
    assert.match(bad.err, /Unbekannter Befehl: nope/);
});

test('a fresh scaffold needs no change', async () => {
    const cwd = tmp();
    await run(['new', 'demo-plugin'], cwd);
    const file = path.join(cwd, 'demo-plugin', 'plugin.json');
    const before = fs.readFileSync(file);
    const checked = await run(['check', 'demo-plugin'], cwd);
    assert.equal(checked.code, 0, checked.err);
    assert.doesNotMatch(checked.out, /^\+ /m);
    assert.doesNotMatch(checked.out, /Warnung/);
    assert.equal(checked.err, '');
    const built = await run(['build', 'demo-plugin', '--yes'], cwd);
    assert.equal(built.code, 0, built.err);
    assert.deepEqual(fs.readFileSync(file), before);
});

test('build writes the package next to the plugin folder', async () => {
    const cwd = tmp();
    await run(['new', 'demo-plugin'], cwd);
    const inside = path.join(cwd, 'demo-plugin');
    const first = await run(['build', '.', '--yes'], inside);
    assert.equal(first.code, 0, first.err);
    assert.ok(fs.existsSync(path.join(cwd, 'demo-plugin-0.1.0.dems')));
    assert.ok(!fs.existsSync(path.join(inside, 'demo-plugin-0.1.0.dems')));
    const second = await run(['build', '.', '--yes'], inside);
    assert.equal(second.code, 0, second.err);
});

async function packed() {
    const cwd = tmp();
    const plugins = path.join(cwd, 'plugins-dir');
    await run(['new', 'demo-plugin'], cwd);
    await run(['build', 'demo-plugin', '--yes'], cwd);
    await run(['install', 'demo-plugin-0.1.0.dems', '--plugins-dir', plugins], cwd);
    return { cwd, plugins };
}

test('install asks on a TTY before replacing: j replaces', async () => {
    const { cwd, plugins } = await packed();
    const r = await run(['install', 'demo-plugin-0.1.0.dems', '--plugins-dir', plugins], cwd, { isTTY: true, answers: 'j\n' });
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /demo-plugin 0\.1\.0 ersetzen durch 0\.1\.0\? \(j\/n\)/);
    assert.match(r.out, /Installiert: demo-plugin/);
});

test('install asks on a TTY before replacing: n aborts', async () => {
    const { cwd, plugins } = await packed();
    const r = await run(['install', 'demo-plugin-0.1.0.dems', '--plugins-dir', plugins], cwd, { isTTY: true, answers: 'n\n' });
    assert.equal(r.code, 1);
    assert.match(r.out, /Abgebrochen\./);
});

test('an unexpected error is reported without a stack', async () => {
    const r = await main(['check', 'x'], { cwd: tmp(), stdin: null, stdout: null, stderr: sink(), env: {}, isTTY: false });
    assert.equal(r, 1);
});

test('an unexpected error prints Unerwarteter Fehler', async () => {
    const stderr = sink();
    const code = await main(['help'], { cwd: tmp(), stdin: null, stdout: { write() { throw new Error('kaputt'); } }, stderr, env: {}, isTTY: false });
    assert.equal(code, 1);
    assert.match(stderr.text(), /Unerwarteter Fehler: kaputt/);
    assert.doesNotMatch(stderr.text(), /\n\s+at /);
});

// ---- dev ----
const { prepareDev } = require('../scripts/plugin');

function devRepo(officialIds = []) {
    const repoRoot = tmp();
    fs.mkdirSync(path.join(repoRoot, 'plugins'));
    for (const id of officialIds) {
        fs.mkdirSync(path.join(repoRoot, 'plugins', id));
        fs.writeFileSync(path.join(repoRoot, 'plugins', id, 'plugin.json'), '{}');
    }
    return repoRoot;
}

async function scaffold(id = 'demo-plugin') {
    const cwd = tmp();
    const r = await run(['new', id], cwd);
    assert.equal(r.code, 0, r.err);
    return path.join(cwd, id);
}

test('prepareDev refuses NODE_ENV=production', async () => {
    const folder = await scaffold();
    assert.throws(() => prepareDev(folder, { repoRoot: devRepo(), env: { NODE_ENV: 'production' } }),
        /plugin dev läuft nicht mit NODE_ENV=production\./);
});

test('prepareDev refuses a folder without a valid plugin.json', () => {
    const folder = path.join(tmp(), 'demo-plugin');
    fs.mkdirSync(folder);
    assert.throws(() => prepareDev(folder, { repoRoot: devRepo(), env: {} }), /plugin\.json/);
    fs.writeFileSync(path.join(folder, 'plugin.json'), '{ kaputt');
    assert.throws(() => prepareDev(folder, { repoRoot: devRepo(), env: {} }), /plugin\.json/);
});

test('prepareDev refuses a folder name that differs from the id', async () => {
    const folder = await scaffold();
    const other = path.join(path.dirname(folder), 'anderer-name');
    fs.renameSync(folder, other);
    assert.throws(() => prepareDev(other, { repoRoot: devRepo(), env: {} }),
        /Der Ordnername muss der Plugin-ID entsprechen\./);
});

test('prepareDev refuses an official id', async () => {
    const folder = await scaffold();
    assert.throws(() => prepareDev(folder, { repoRoot: devRepo(['demo-plugin']), env: {} }),
        /Offizielle Plugins entwickelst du direkt mit npm run dev:mock\./);
});

test('prepareDev links only the plugin, writes the nodemon config and returns the env', async () => {
    const folder = await scaffold();
    const repoRoot = devRepo();
    const result = prepareDev(folder, { repoRoot, env: { KEEP: '1' } });
    const dir = path.join(repoRoot, 'data', 'dev-plugins');
    assert.deepEqual(fs.readdirSync(dir).sort(), ['demo-plugin', 'nodemon.json']);
    assert.equal(fs.realpathSync(path.join(dir, 'demo-plugin')), fs.realpathSync(folder));
    assert.equal(result.linkDir, dir);
    assert.equal(result.configPath, path.join(dir, 'nodemon.json'));
    assert.deepEqual(JSON.parse(fs.readFileSync(result.configPath, 'utf8')),
        { watch: [path.resolve(folder)], ext: 'js,json,css', ignore: [] });
    assert.equal(result.env.PLUGINS_DIR, dir);
    assert.equal(result.env.PLUGINS_DEV_ID, 'demo-plugin');
    assert.equal(result.env.KEEP, '1');
});

test('a second prepareDev leaves the source folder untouched', async () => {
    const folder = await scaffold();
    const repoRoot = devRepo();
    prepareDev(folder, { repoRoot, env: {} });
    prepareDev(folder, { repoRoot, env: {} });
    for (const f of ['plugin.json', 'server.js', 'client.js', 'client.css']) {
        assert.ok(fs.existsSync(path.join(folder, f)), f);
    }
    assert.deepEqual(fs.readdirSync(path.join(repoRoot, 'data', 'dev-plugins')).sort(), ['demo-plugin', 'nodemon.json']);
});

test('dev spawns nodemon with the prepared env and returns its exit code', async () => {
    const folder = await scaffold();
    const calls = [];
    const { EventEmitter } = require('events');
    const spawn = (cmd, args, opts) => {
        const child = new EventEmitter();
        calls.push({ cmd, args, opts });
        setImmediate(() => child.emit('exit', 0, null));
        return child;
    };
    const stdout = sink();
    const code = await main(['dev', folder], { cwd: process.cwd(), stdin: null, stdout, stderr: sink(), env: {}, isTTY: false, spawn });
    assert.equal(code, 0);
    assert.equal(calls.length, 1);
    const repo = path.join(__dirname, '..');
    assert.equal(calls[0].cmd, process.execPath);
    assert.equal(calls[0].args[0], path.join(repo, 'node_modules', 'nodemon', 'bin', 'nodemon.js'));
    assert.equal(calls[0].args[1], '--config');
    assert.equal(calls[0].args[2], path.join(repo, 'data', 'dev-plugins', 'nodemon.json'));
    assert.equal(calls[0].args[3], path.join(repo, 'dev', 'start.js'));
    assert.equal(calls[0].opts.env.PLUGINS_DEV_ID, 'demo-plugin');
    assert.equal(calls[0].opts.env.PLUGINS_DIR, path.join(repo, 'data', 'dev-plugins'));
});
