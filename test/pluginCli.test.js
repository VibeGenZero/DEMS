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

function fakeSpawn(calls, onChild) {
    const { EventEmitter } = require('events');
    return (cmd, args, opts) => {
        const child = new EventEmitter();
        child.kill = (signal) => { child.killed = signal; };
        calls.push({ cmd, args, opts });
        onChild(child);
        return child;
    };
}

test('prepareDev removes a leftover real directory in data/dev-plugins', async () => {
    const folder = await scaffold();
    const repoRoot = devRepo();
    const leftover = path.join(repoRoot, 'data', 'dev-plugins', 'alt');
    fs.mkdirSync(leftover, { recursive: true });
    fs.writeFileSync(path.join(leftover, 'x.txt'), 'x');
    prepareDev(folder, { repoRoot, env: {} });
    assert.deepEqual(fs.readdirSync(path.join(repoRoot, 'data', 'dev-plugins')).sort(), ['demo-plugin', 'nodemon.json']);
});

test('dev spawns nodemon from the injected repo root and leaves the real data/dev-plugins alone', async () => {
    const folder = await scaffold();
    const repoRoot = devRepo();
    const real = path.join(__dirname, '..', 'data', 'dev-plugins');
    const before = fs.existsSync(real) ? fs.statSync(real).mtimeMs + ':' + fs.readdirSync(real).join(',') : null;
    const calls = [];
    const spawn = fakeSpawn(calls, (child) => setImmediate(() => child.emit('exit', 0, null)));
    const code = await main(['dev', folder], { cwd: process.cwd(), stdin: null, stdout: sink(), stderr: sink(), env: {}, isTTY: false, spawn, repoRoot });
    assert.equal(code, 0);
    assert.equal(calls.length, 1);
    const dir = path.join(repoRoot, 'data', 'dev-plugins');
    assert.equal(calls[0].cmd, process.execPath);
    assert.deepEqual(calls[0].args, [path.join(repoRoot, 'node_modules', 'nodemon', 'bin', 'nodemon.js'), '--config', path.join(dir, 'nodemon.json'), path.join(repoRoot, 'dev', 'start.js')]);
    assert.equal(calls[0].opts.env.PLUGINS_DEV_ID, 'demo-plugin');
    assert.equal(calls[0].opts.env.PLUGINS_DIR, dir);
    const after = fs.existsSync(real) ? fs.statSync(real).mtimeMs + ':' + fs.readdirSync(real).join(',') : null;
    assert.equal(after, before);
});

test('dev returns 1 when the child was killed by a signal and releases the signal handlers', async () => {
    const folder = await scaffold();
    const counts = { SIGINT: process.listenerCount('SIGINT'), SIGTERM: process.listenerCount('SIGTERM') };
    const spawn = fakeSpawn([], (child) => setImmediate(() => child.emit('exit', null, 'SIGTERM')));
    const code = await main(['dev', folder], { cwd: process.cwd(), stdin: null, stdout: sink(), stderr: sink(), env: {}, isTTY: false, spawn, repoRoot: devRepo() });
    assert.equal(code, 1);
    assert.equal(process.listenerCount('SIGINT'), counts.SIGINT);
    assert.equal(process.listenerCount('SIGTERM'), counts.SIGTERM);
});

test('dev forwards SIGINT to the child', async () => {
    const folder = await scaffold();
    let kid;
    const spawn = fakeSpawn([], (child) => {
        kid = child;
        setImmediate(() => {
            process.emit('SIGINT');
            child.emit('exit', 0, null);
        });
    });
    const code = await main(['dev', folder], { cwd: process.cwd(), stdin: null, stdout: sink(), stderr: sink(), env: {}, isTTY: false, spawn, repoRoot: devRepo() });
    assert.equal(code, 0);
    assert.equal(kid.killed, 'SIGINT');
});

test('build and check skip .git, .gitignore, LICENSE and node_modules and say so', async () => {
    const cwd = tmp();
    await run(['new', 'demo-plugin'], cwd);
    const dir = path.join(cwd, 'demo-plugin');
    fs.mkdirSync(path.join(dir, '.git'));
    fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/main');
    fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/');
    fs.writeFileSync(path.join(dir, 'LICENSE'), 'MIT');
    fs.mkdirSync(path.join(dir, 'node_modules'));
    fs.writeFileSync(path.join(dir, 'node_modules', 'x.js'), 'x');
    const lines = ['übersprungen: .git', 'übersprungen: .gitignore', 'übersprungen: LICENSE', 'übersprungen: node_modules'];

    const checked = await run(['check', 'demo-plugin'], cwd);
    assert.equal(checked.code, 0, checked.err);
    for (const line of lines) assert.ok(checked.out.split('\n').includes(line), line);

    const built = await run(['build', 'demo-plugin', '--yes'], cwd);
    assert.equal(built.code, 0, built.err);
    for (const line of lines) assert.equal(built.out.split('\n').filter((l) => l === line).length, 1, line);
    const names = require('../plugin-sdk/zip').readZip(fs.readFileSync(path.join(cwd, 'demo-plugin-0.1.0.dems'))).map((e) => e.name).sort();
    assert.deepEqual(names, ['client.css', 'client.js', 'plugin.json', 'server.js']);
});

test('build still stops on a file with a disallowed extension', async () => {
    const cwd = tmp();
    await run(['new', 'demo-plugin'], cwd);
    fs.writeFileSync(path.join(cwd, 'demo-plugin', 'index.html'), '<p>');
    const built = await run(['build', 'demo-plugin', '--yes'], cwd);
    assert.equal(built.code, 1);
    assert.match(built.err, /Nicht erlaubte Datei: index\.html/);
    assert.ok(!fs.existsSync(path.join(cwd, 'demo-plugin-0.1.0.dems')));
});

test('the CLI resolves folders against the directory npm run was started in', () => {
    // `npm run` switches to the repo root; npm keeps the caller's directory in INIT_CWD
    const { invocationCwd } = require('../scripts/plugin');
    assert.equal(invocationCwd({ INIT_CWD: '/home/me/plugins' }, '/app'), '/home/me/plugins');
    assert.equal(invocationCwd({}, '/app'), '/app');
    assert.equal(invocationCwd({ INIT_CWD: '' }, '/app'), '/app');
});

test('studio refuses NODE_ENV=production', async () => {
    const res = await run(['studio'], tmp(), { env: { NODE_ENV: 'production' } });
    assert.equal(res.code, 1);
    assert.match(res.err, /plugin studio läuft nicht mit NODE_ENV=production\./);
});

test('help lists studio', async () => {
    const res = await run(['help'], tmp());
    assert.match(res.out, /studio \[--port 3100\]\s+Plugin-Studio im Browser öffnen/);
});

function studioIo(extra) {
    const stdout = sink();
    const stderr = sink();
    return { io: { cwd: tmp(), stdin: Readable.from([]), stdout, stderr, env: {}, isTTY: false, ...extra }, stderr };
}

test('studio checks NODE_ENV before it loads the module (the image has no scripts/studio)', async () => {
    const { io, stderr } = studioIo({ env: { NODE_ENV: 'production' }, loadStudio: () => { throw new Error('geladen'); } });
    assert.equal(await main(['studio'], io), 1);
    assert.match(stderr.text(), /plugin studio läuft nicht mit NODE_ENV=production\./);
});

test('studio without the module says so', async () => {
    const missing = () => { throw Object.assign(new Error("Cannot find module './studio'\nRequire stack:\n- x"), { code: 'MODULE_NOT_FOUND' }); };
    const { io, stderr } = studioIo({ loadStudio: missing });
    assert.equal(await main(['studio'], io), 1);
    assert.match(stderr.text(), /Das Plugin-Studio ist in dieser Installation nicht enthalten\./);
});

test('studio rejects an empty or bad --port', async () => {
    for (const port of ['', 'abc', '-1', '70000']) {
        const { io, stderr } = studioIo({ loadStudio: () => { throw new Error('nicht erreichbar'); } });
        assert.equal(await main(['studio', '--port', port], io), 1, port);
        assert.match(stderr.text(), /Ungültiger Port: /, port);
    }
});
