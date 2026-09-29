/**
 * Shared helpers for the node:test suites.
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');

// Variables that would leak the developer's own setup into a test process
const LEAKING_PREFIXES = ['DISCORD_', 'FIREBASE_', 'DEV_'];
const LEAKING_KEYS = ['NODE_ENV', 'SQLITE_PATH', 'SESSION_SECRET', 'ADMIN_RESET_PASSWORD', 'PORT', 'BASE_URL', 'DEBUG_MODE'];

const SERVER_START_TIMEOUT_MS = 20000;
const POLL_INTERVAL_MS = 100;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Create an empty temporary directory.
 *
 * @param {string} prefix -> Name part of the directory.
 * @returns {string} -> Absolute path of the new directory.
 */
function createTempDir(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), `dems-${prefix}-`));
}

/**
 * Absolute path inside the repository as a JavaScript string literal,
 * ready to be embedded in a snippet passed to runNode().
 *
 * @param {string} relativePath -> Path relative to the repository root.
 * @returns {string} -> Quoted absolute path.
 */
function repoPath(relativePath) {
    return JSON.stringify(path.join(REPO_ROOT, relativePath));
}

/**
 * Copy of process.env without DEMS settings, merged with `env`.
 *
 * @param {Object} env -> Variables the test wants to set.
 * @returns {Object} -> Environment for a child process.
 */
function cleanEnv(env = {}) {
    const base = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
        !LEAKING_KEYS.includes(key) && !LEAKING_PREFIXES.some(prefix => key.startsWith(prefix))));
    return { ...base, ...env };
}

/**
 * Run a JavaScript snippet in a fresh Node process.
 *
 * The process runs in an empty temp directory, so dotenv finds no .env file
 * and the developer's own configuration cannot influence the result.
 *
 * @param {string} code -> JavaScript to run with `node -e`.
 * @param {Object} env -> Variables to set for the process.
 * @returns {Object} -> spawnSync result with `status`, `stdout`, `stderr`.
 */
function runNode(code, env = {}) {
    return spawnSync(process.execPath, ['-e', code], {
        cwd: createTempDir('run'),
        env: cleanEnv(env),
        encoding: 'utf8',
        timeout: 30000
    });
}

/**
 * Parse the last line of a process output as JSON.
 *
 * @param {string} output -> stdout of a process.
 * @returns {*} -> Parsed value.
 */
function parseLastLine(output) {
    return JSON.parse(output.trim().split('\n').pop());
}

/**
 * Ask the OS for a free TCP port.
 *
 * @returns {Promise<number>} -> Port number.
 */
function getFreePort() {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.unref();
        probe.on('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const { port } = probe.address();
            probe.close(() => resolve(port));
        });
    });
}

/**
 * Start server.js or dev/start.js as a child process.
 *
 * Resolves once GET /healthz answers. Like runNode(), the process runs in an
 * empty temp directory so a local .env cannot interfere.
 *
 * @param {string} entry -> Entry file relative to the repository root.
 * @param {Object} env -> Extra environment variables.
 * @returns {Promise<Object>} -> `{ baseUrl, output(), waitForOutput(text), stop() }`.
 */
async function startServer(entry, env = {}) {
    const port = await getFreePort();
    const child = spawn(process.execPath, [path.join(REPO_ROOT, entry)], {
        cwd: createTempDir('server'),
        env: cleanEnv({ PORT: String(port), ...env })
    });

    let output = '';
    let exitCode = null;
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('exit', code => { exitCode = code; });

    const baseUrl = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
    for (;;) {
        if (exitCode !== null) {
            throw new Error(`Server beendet mit Code ${exitCode}:\n${output}`);
        }
        if (Date.now() > deadline) {
            child.kill();
            throw new Error(`Server nicht erreichbar:\n${output}`);
        }
        try {
            if ((await fetch(`${baseUrl}/healthz`)).ok) break;
        } catch {
            // not listening yet
        }
        await sleep(POLL_INTERVAL_MS);
    }

    return {
        baseUrl,
        output: () => output,
        async waitForOutput(text, timeoutMs = 3000) {
            const waitUntil = Date.now() + timeoutMs;
            while (!output.includes(text)) {
                if (Date.now() > waitUntil) {
                    throw new Error(`"${text}" nicht in der Server-Ausgabe:\n${output}`);
                }
                await sleep(50);
            }
        },
        stop: () => new Promise(resolve => {
            if (exitCode !== null) return resolve();
            child.once('exit', () => resolve());
            child.kill();
        })
    };
}

/**
 * Minimal HTTP client with a cookie jar -> behaves like one browser.
 *
 * @param {string} baseUrl -> Base URL of the server.
 * @returns {Object} -> `{ request(path, options), send(method, path, body) }`.
 */
function createClient(baseUrl) {
    const cookies = new Map();

    async function request(pathname, options = {}) {
        const headers = { ...(options.headers || {}) };
        if (cookies.size > 0) {
            headers.cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
        }
        const res = await fetch(baseUrl + pathname, { redirect: 'manual', ...options, headers });
        for (const setCookie of res.headers.getSetCookie()) {
            const [pair] = setCookie.split(';');
            const separator = pair.indexOf('=');
            cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
        }
        return res;
    }

    /** Send a JSON request carrying the CSRF token of the current session. */
    async function send(method, pathname, body) {
        const { token } = await (await request('/api/csrf-token')).json();
        return request(pathname, {
            method,
            headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': token },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
    }

    return { request, send };
}

module.exports = {
    REPO_ROOT,
    createTempDir,
    repoPath,
    cleanEnv,
    runNode,
    parseLastLine,
    startServer,
    createClient
};
