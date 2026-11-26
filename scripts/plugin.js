/**
 * Plugin CLI: `npm run plugin -- <command>`.
 *
 * Commands: new, check, build, install, dev, help. `main` takes injected streams
 * so tests run it without a terminal; it never touches `process` itself.
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline/promises');
const childProcess = require('child_process');
const { PackageError } = require('../plugin-sdk/errors');
const { ID_PATTERN, validateManifest } = require('../plugin-sdk/manifest');
const { analyzePlugin, writeManifest, packPlugin, installPackage, checkPackage } = require('../plugin-sdk/package');
const { formatWarning } = require('../plugin-sdk/permissionScan');

const REPO = path.join(__dirname, '..');

const USAGE = `Verwendung: npm run plugin -- <Befehl>

Befehle:
  new <id> [--dir <Ordner>]   Neues Plugin-Gerüst anlegen
  check <Ordner>              Manifest mit dem Code abgleichen (schreibt nichts)
  build <Ordner> [--yes] [--out <Datei>]
                              plugin.json abgleichen und ein .dems-Paket bauen
  install <Datei.dems> [--force] [--plugins-dir <Ordner>]
                              Paket in den Plugin-Ordner installieren
  dev <Ordner>                Plugin im Mock-Modus starten, bei Änderungen neu starten
  help                        Diese Hilfe

Die Erkennung der Berechtigungen ist eine Hilfe, keine Sicherheitsprüfung.
`;

const SERVER_JS = `// Server side: CommonJS, only Node built-ins and own files.
module.exports = {
    async register(ctx) {
        ctx.routes.get('/hello', { access: 'member' }, async ({ user }) => {
            return { message: 'Hallo ' + user.name + '!' };
        });
    }
};
`;

const CLIENT_JS = `// Browser side: ES module, only own files.
export function register(ui) {
    const { escapeHtml } = ui.helpers;

    ui.addPage({
        access: 'member',
        title: 'Mein Plugin',
        tab: { label: 'Mein Plugin', icon: 'bi-puzzle' },
        async render(container) {
            const { message } = await ui.api.get('/hello');
            container.innerHTML = '<div class="card"><p class="plugin-hello">' + escapeHtml(message) + '</p></div>';
        }
    });
}
`;

const CLIENT_CSS = `.plugin-hello {
    margin: 0;
}
`;

/** Split argv into positionals and flags; `valueFlags` take the next argument. */
function parseArgs(args, valueFlags = []) {
    const positional = [];
    const flags = {};
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (!arg.startsWith('--')) {
            positional.push(arg);
        } else if (valueFlags.includes(arg)) {
            if (i + 1 >= args.length) throw new PackageError(`Zu ${arg} fehlt ein Wert.`);
            flags[arg.slice(2)] = args[++i];
        } else {
            flags[arg.slice(2)] = true;
        }
    }
    return { positional, flags };
}

function scaffoldFiles(id) {
    const manifest = {
        id,
        name: id,
        version: '0.1.0',
        sdk: 1.1,
        description: 'Neues DEMS-Plugin.',
        author: 'Unbekannt',
        server: 'server.js',
        client: 'client.js',
        permissions: [],
        settings: []
    };
    return {
        'plugin.json': `${JSON.stringify(manifest, null, 2)}\n`,
        'server.js': SERVER_JS,
        'client.js': CLIENT_JS,
        'client.css': CLIENT_CSS
    };
}

function cmdNew(args, io) {
    const { positional, flags } = parseArgs(args, ['--dir']);
    const id = positional[0];
    if (!id) throw new PackageError('Bitte eine Plugin-ID angeben: new <id>');
    if (!ID_PATTERN.test(id)) throw new PackageError(`Die ID ist nicht erlaubt: ${id}`);
    const parent = path.resolve(io.cwd, typeof flags.dir === 'string' ? flags.dir : '.');
    const target = path.join(parent, id);
    if (fs.existsSync(target)) throw new PackageError(`Der Ordner existiert schon: ${target}`);
    fs.mkdirSync(target, { recursive: true });
    for (const [name, content] of Object.entries(scaffoldFiles(id))) {
        fs.writeFileSync(path.join(target, name), content);
    }
    io.stdout.write(`Angelegt: ${target}\n`);
    return 0;
}

/** Print the comparison; returns the analysis. */
function report(analysis, io) {
    for (const name of analysis.skipped) io.stdout.write(`übersprungen: ${name}\n`);
    for (const message of analysis.errors) io.stderr.write(`Fehler: ${message}\n`);
    for (const p of analysis.missing) io.stdout.write(`+ ${p}\n`);
    for (const p of analysis.unused) io.stdout.write(`? ${p} (nicht mehr gefunden)\n`);
    if (analysis.sdk !== analysis.raw.sdk) io.stdout.write(`sdk: ${analysis.raw.sdk} -> ${analysis.sdk}\n`);
    for (const w of analysis.warnings) io.stdout.write(`Warnung: ${formatWarning(w)}\n`);
    return analysis;
}

function requireFolder(args, io, command) {
    const { positional, flags } = parseArgs(args, ['--out']);
    if (!positional[0]) throw new PackageError(`Bitte einen Ordner angeben: ${command} <Ordner>`);
    return { dir: path.resolve(io.cwd, positional[0]), flags };
}

function cmdCheck(args, io) {
    const { dir } = requireFolder(args, io, 'check');
    const analysis = report(analyzePlugin(dir), io);
    return analysis.errors.length ? 1 : 0;
}

/** Ask a yes/no question on the injected stdin; „j“ or „y“ means yes. */
async function confirm(question, io) {
    const rl = readline.createInterface({ input: io.stdin, output: io.stdout, terminal: false });
    try {
        io.stdout.write(question);
        const answer = await new Promise((resolve) => {
            rl.once('close', () => resolve(''));
            rl.once('line', resolve);
        });
        return /^\s*(j|ja|y|yes)\s*$/i.test(answer);
    } finally {
        rl.close();
    }
}

async function cmdBuild(args, io) {
    const { dir, flags } = requireFolder(args, io, 'build');
    const analysis = report(analyzePlugin(dir), io);
    if (analysis.errors.length) return 1;
    if (analysis.changed) {
        let update = flags.yes === true;
        if (!update) {
            if (!io.isTTY) throw new PackageError('Nicht interaktiv: mit --yes bestätigen.');
            update = await confirm('plugin.json aktualisieren? (j/n) ', io);
        }
        if (update) {
            writeManifest(dir, analysis.nextRaw);
        } else {
            io.stderr.write('Warnung: plugin.json passt nicht zum Code und bleibt unverändert.\n');
        }
    }
    const { buffer, fileName } = packPlugin(dir);
    const out = typeof flags.out === 'string' ? path.resolve(io.cwd, flags.out) : path.join(path.dirname(dir), fileName);
    fs.writeFileSync(out, buffer);
    io.stdout.write(`Gebaut: ${out} (${countEntries(buffer)} Dateien, ${(buffer.length / 1024).toFixed(1)} KB)\n`);
    return 0;
}

function countEntries(buffer) {
    return require('../plugin-sdk/zip').readZip(buffer).length;
}

function officialIds(root = REPO) {
    const dir = path.join(root, 'plugins');
    if (!fs.existsSync(dir)) return new Set();
    return new Set(fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'plugin.json')))
        .map((e) => e.name));
}

function readVersion(dir) {
    try {
        return JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8').replace(/^\uFEFF/, '')).version || '?';
    } catch {
        return '?';
    }
}

async function cmdInstall(args, io) {
    const { positional, flags } = parseArgs(args, ['--plugins-dir']);
    if (!positional[0]) throw new PackageError('Bitte ein Paket angeben: install <Datei.dems>');
    const file = path.resolve(io.cwd, positional[0]);
    let buffer;
    try {
        buffer = fs.readFileSync(file);
    } catch {
        throw new PackageError(`Die Datei kann nicht gelesen werden: ${file}`);
    }
    const customDir = path.resolve(io.cwd, typeof flags['plugins-dir'] === 'string'
        ? flags['plugins-dir']
        : io.env.PLUGINS_DIR || path.join(REPO, 'data', 'plugins'));
    fs.mkdirSync(customDir, { recursive: true });
    const options = { officialIds: officialIds(), customDir, replace: flags.force === true };

    if (!options.replace) {
        const check = checkPackage(buffer, options);
        if (check.ok && check.exists) {
            if (!io.isTTY) throw new PackageError('Das Plugin ist schon installiert. Mit --force ersetzen.');
            const ask = `${check.manifest.id} ${check.installedVersion || '?'} ersetzen durch ${check.manifest.version}? (j/n) `;
            if (!(await confirm(ask, io))) {
                io.stdout.write('Abgebrochen.\n');
                return 1;
            }
            options.replace = true;
        }
    }
    const { id } = await installPackage(buffer, options);
    io.stdout.write(`Installiert: ${id} ${readVersion(path.join(customDir, id))}. DEMS neu starten, damit das Plugin erscheint.\n`);
    return 0;
}

/** Remove everything in `dir` without ever following a link into its target. */
function clearDevDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
    for (const name of fs.readdirSync(dir)) {
        const entry = path.join(dir, name);
        if (fs.lstatSync(entry).isSymbolicLink()) {
            try {
                fs.unlinkSync(entry);
            } catch {
                fs.rmdirSync(entry); // Windows junction: removes the link, not the target
            }
        } else {
            fs.rmSync(entry, { recursive: true, force: true }); // our own scratch file or folder, lstat showed it is no link
        }
    }
}

/**
 * Prepare `<repo>/data/dev-plugins/` with a link to the plugin folder and a nodemon config.
 *
 * @param {string} folder -> Plugin folder under development.
 * @param {{ repoRoot?: string, env?: object }} options
 * @returns {{ linkDir: string, configPath: string, env: object }}
 */
function prepareDev(folder, { repoRoot = REPO, env = process.env } = {}) {
    if (env.NODE_ENV === 'production') throw new PackageError('plugin dev läuft nicht mit NODE_ENV=production.');
    const abs = path.resolve(folder);
    let raw;
    try {
        raw = JSON.parse(fs.readFileSync(path.join(abs, 'plugin.json'), 'utf8').replace(/^\uFEFF/, ''));
    } catch {
        throw new PackageError('Im Ordner fehlt eine gültige plugin.json.');
    }
    const checked = validateManifest(raw, raw && raw.id, { fileExists: (rel) => fs.existsSync(path.join(abs, rel)) });
    if (!checked.ok) throw new PackageError(`plugin.json ist ungültig: ${checked.reason}`);
    const id = checked.manifest.id;
    if (path.basename(abs) !== id) throw new PackageError('Der Ordnername muss der Plugin-ID entsprechen.');
    if (officialIds(repoRoot).has(id)) throw new PackageError('Offizielle Plugins entwickelst du direkt mit npm run dev:mock.');

    const linkDir = path.join(repoRoot, 'data', 'dev-plugins');
    clearDevDir(linkDir);
    fs.symlinkSync(abs, path.join(linkDir, id), 'junction');
    const configPath = path.join(linkDir, 'nodemon.json');
    fs.writeFileSync(configPath, `${JSON.stringify({ watch: [abs], ext: 'js,json,css', ignore: [] }, null, 2)}
`);
    return { linkDir, configPath, env: { ...env, PLUGINS_DIR: linkDir, PLUGINS_DEV_ID: id } };
}

/** Run DEMS in mock mode under nodemon with the one plugin mounted. */
function cmdDev(args, io) {
    const { positional } = parseArgs(args);
    if (!positional[0]) throw new PackageError('Bitte einen Ordner angeben: dev <Ordner>');
    const repoRoot = io.repoRoot || REPO;
    const { configPath, env } = prepareDev(path.resolve(io.cwd, positional[0]), { repoRoot, env: io.env });
    io.stdout.write(`Plugin ${env.PLUGINS_DEV_ID} läuft im Mock-Modus auf http://localhost:${env.PORT || 3000} (Strg+C beendet).\n`);
    const spawn = io.spawn || childProcess.spawn;
    const nodemon = path.join(repoRoot, 'node_modules', 'nodemon', 'bin', 'nodemon.js');
    const child = spawn(process.execPath, [nodemon, '--config', configPath, path.join(repoRoot, 'dev', 'start.js')], { env, stdio: 'inherit' });
    const forward = (signal) => () => child.kill(signal);
    const handlers = { SIGINT: forward('SIGINT'), SIGTERM: forward('SIGTERM') };
    for (const [signal, handler] of Object.entries(handlers)) process.on(signal, handler);
    const release = () => {
        for (const [signal, handler] of Object.entries(handlers)) process.removeListener(signal, handler);
    };
    return new Promise((resolve) => {
        child.once('error', (err) => {
            release();
            io.stderr.write(`Start fehlgeschlagen: ${err.message}\n`);
            resolve(1);
        });
        child.once('exit', (code, signal) => {
            release();
            resolve(signal || code === null ? 1 : code);
        });
    });
}

/** Command table: add new commands here (each `(args, io) => code | Promise<code>`). */
const COMMANDS = {
    new: cmdNew,
    check: cmdCheck,
    build: cmdBuild,
    install: cmdInstall,
    dev: cmdDev,
    help: (args, io) => {
        io.stdout.write(USAGE);
        return 0;
    }
};

/**
 * @param {string[]} argv -> Arguments after the script name.
 * @param {{ cwd: string, stdin: object, stdout: object, stderr: object, env: object, isTTY: boolean }} io
 * @returns {Promise<number>} -> Exit code.
 */
async function main(argv, io) {
    const [command, ...args] = argv;
    try {
        if (!command) return COMMANDS.help(args, io);
        const handler = Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : null;
        if (!handler) throw new PackageError(`Unbekannter Befehl: ${command}`);
        return await handler(args, io);
    } catch (err) {
        if (err instanceof PackageError) io.stderr.write(`${err.message}\n`);
        else io.stderr.write(`Unerwarteter Fehler: ${err && err.message ? err.message : err}\n`);
        return 1;
    }
}

/**
 * `npm run` starts the script in the repo root; npm keeps the caller's directory in INIT_CWD.
 *
 * @param {object} env -> Environment of the process.
 * @param {string} cwd -> Working directory of the process.
 * @returns {string} -> Directory that relative folders and files are resolved against.
 */
function invocationCwd(env, cwd) {
    return env.INIT_CWD || cwd;
}

if (require.main === module) {
    main(process.argv.slice(2), {
        cwd: invocationCwd(process.env, process.cwd()),
        stdin: process.stdin,
        stdout: process.stdout,
        stderr: process.stderr,
        env: process.env,
        isTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY)
    }).then((code) => {
        process.exitCode = code;
    });
}

module.exports = { main, COMMANDS, parseArgs, prepareDev, invocationCwd };
