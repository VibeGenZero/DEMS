/**
 * Shared helpers for the node:test suites.
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const vm = require('vm');

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
 * @returns {Object} -> `{ request(path, options), send(method, path, body), cookie(name) }`.
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

    return { request, send, cookie: (name) => cookies.get(name) };
}

/**
 * Discord interaction double that records every answer in call order.
 * `answered` resolves with the first answer that is not a defer.
 *
 * @param {Object} options -> `{ kind: 'button'|'select'|'command', customId, userId, commandName, eventOption, values, roles }`.
 * @returns {Object} -> The fake interaction.
 */
function createFakeInteraction({ kind, customId, userId, commandName, eventOption, values = [], roles = null }) {
    const calls = [];
    let resolveAnswered;
    const answered = new Promise(resolve => { resolveAnswered = resolve; });
    const interaction = {
        customId, commandName, values, calls, answered,
        user: { id: userId, username: userId, globalName: userId },
        member: roles ? { roles, displayName: userId } : null,
        deferred: false,
        replied: false,
        options: { getString: () => eventOption },
        isAutocomplete: () => false,
        isModalSubmit: () => false,
        isStringSelectMenu: () => kind === 'select',
        isButton: () => kind === 'button',
        isChatInputCommand: () => kind === 'command',
        async deferUpdate() { calls.push(['deferUpdate']); interaction.deferred = true; },
        async deferReply(payload) { calls.push(['deferReply', payload]); interaction.deferred = true; },
        async update(payload) { calls.push(['update', payload]); interaction.replied = true; resolveAnswered(); },
        async reply(payload) { calls.push(['reply', payload]); interaction.replied = true; resolveAnswered(); },
        async editReply(payload) { calls.push(['editReply', payload]); resolveAnswered(); }
    };
    return interaction;
}

/**
 * Emit an interaction on the bot client and wait for its first answer.
 *
 * @param {Object} client -> The discord.js client of bot.js.
 * @param {Object} interaction -> Result of createFakeInteraction().
 * @param {number} [timeoutMs] -> Give up after this time.
 * @returns {Promise<void>}
 */
async function dispatchInteraction(client, interaction, timeoutMs = 3000) {
    client.emit('interactionCreate', interaction);
    await Promise.race([
        interaction.answered,
        new Promise((_, reject) => setTimeout(() => reject(new Error('no answer')), timeoutMs))
    ]);
}

/**
 * Register a fake element for every `id="…"` in an HTML string.
 *
 * @param {Map<string, Object>} registry -> Elements reachable through getElementById.
 * @param {string} html -> HTML source.
 */
function registerHtmlIds(registry, html) {
    for (const [tag, id] of html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)) {
        registry.set(id, createFakeElement(registry, id, /display:\s*none/.test(tag) ? 'none' : ''));
    }
}

/**
 * Element double with the few properties app.js touches. Assigning
 * innerHTML registers the ids it contains, like a real DOM would.
 *
 * @param {Map<string, Object>} registry -> Elements reachable through getElementById.
 * @param {string} [id] -> Element id.
 * @param {string} [display] -> Initial style.display.
 * @returns {Object} -> The fake element.
 */
function createFakeElement(registry, id = '', display = '') {
    const classes = new Set();
    const register = (child) => { if (child.id) registry.set(child.id, child); return child; };
    let html = '';
    return {
        id, textContent: '', className: '', value: '', disabled: false,
        style: { display }, dataset: {},
        get innerHTML() { return html; },
        set innerHTML(value) { html = String(value); registerHtmlIds(registry, html); },
        classList: {
            add: (...names) => names.forEach(name => classes.add(name)),
            remove: (...names) => names.forEach(name => classes.delete(name)),
            toggle: (name, force = !classes.has(name)) => (force ? classes.add(name) : classes.delete(name), force),
            contains: (name) => classes.has(name)
        },
        addEventListener() {},
        removeEventListener() {},
        setAttribute() {},
        getAttribute: () => null,
        appendChild: register,
        insertAdjacentElement: (_position, child) => register(child),
        querySelector: () => null,
        querySelectorAll: () => []
    };
}

/**
 * Load public/js/app.js into a node:vm context with a fake DOM built from
 * the ids in public/index.html. `fetch` answers from `routes`: a value is
 * sent as JSON body, a function may return a value or a promise of one,
 * unknown URLs answer 404; every call is recorded in `requests`. Toasts are
 * recorded instead of shown, so a test can assert that no error was swallowed
 * by a catch block. document listeners are recorded; fire(type) runs them,
 * e.g. fire('DOMContentLoaded') for the whole startup.
 *
 * @param {Object<string, *>} routes -> URL → JSON body or () => body.
 * @param {Object} [options] -> Harness options.
 * @param {Object<string, string>} [options.storage] -> Initial localStorage entries.
 * @returns {Object} -> `{ app, element, toasts, requests, location, fire }`: app exposes showEventDetail, showProfileSection, logout, getErrorMessage, editEvent, loadAdminEvents, getCurrentUser, setCurrentUser and setCsrfToken, element(id) returns the fake element or null, toasts lists the shown messages, requests the fetch calls `{ url, method, headers }`, location is window.location, fire(type) runs the recorded document listeners.
 */
function loadFrontendApp(routes, { storage = {} } = {}) {
    const registry = new Map();
    registerHtmlIds(registry, fs.readFileSync(path.join(REPO_ROOT, 'public', 'index.html'), 'utf8'));
    const toasts = [];
    const requests = [];
    const container = createFakeElement(registry);
    const listeners = [];
    const document = {
        getElementById: (id) => registry.get(id) || null,
        createElement: () => createFakeElement(registry),
        querySelector: () => container,
        querySelectorAll: () => [],
        addEventListener: (type, listener) => listeners.push({ type, listener })
    };
    const createStorage = (initial) => {
        const items = new Map(Object.entries(initial));
        return {
            getItem: (key) => (items.has(key) ? items.get(key) : null),
            setItem: (key, value) => items.set(key, String(value)),
            removeItem: (key) => items.delete(key)
        };
    };
    const fetch = async (url, options = {}) => {
        requests.push({ url, method: options.method || 'GET', headers: options.headers || {} });
        if (!(url in routes)) return { ok: false, status: 404, json: async () => ({ error: 'Nicht gefunden' }) };
        const route = routes[url];
        const body = typeof route === 'function' ? await route() : route;
        return { ok: true, status: 200, json: async () => body };
    };
    const noop = () => {};
    const context = vm.createContext({
        document, fetch, console,
        location: { hash: '', search: '' },
        history: { replaceState: noop, pushState: noop },
        addEventListener: noop,
        localStorage: createStorage(storage),
        sessionStorage: createStorage({}),
        URLSearchParams,
        setTimeout: noop, clearTimeout: noop, setInterval: () => 0, clearInterval: noop,
        gsap: { from: noop, to: noop, fromTo: noop, set: noop },
        marked: { parse: (text) => text },
        DOMPurify: { sanitize: (text) => text },
        bootstrap: {
            Toast: class {
                constructor(toastEl) { this.toastEl = toastEl; }
                show() { toasts.push(registry.get('toast-message').textContent); }
            },
            Modal: class {
                show() {}
                hide() {}
                static getOrCreateInstance() { return { show: noop, hide: noop }; }
                static getInstance() { return null; }
            }
        },
        // Event wizard widgets
        EasyMDE: class {
            constructor() { this.text = ''; this.codemirror = { refresh: noop }; }
            value(text) { if (text === undefined) return this.text; this.text = text; }
        },
        flatpickr: () => ({ setDate: noop, clear: noop, selectedDates: [] })
    });
    context.window = context;
    const source = fs.readFileSync(path.join(REPO_ROOT, 'public', 'js', 'app.js'), 'utf8');
    vm.runInContext(`${source}
;globalThis.__app = { showEventDetail, showProfileSection, logout, getErrorMessage, editEvent, loadAdminEvents, getCurrentUser: () => currentUser, setCurrentUser: (user) => { currentUser = user; }, setCsrfToken: (token) => { csrfToken = token; } };`, context, { filename: 'app.js' });
    const fire = (type) => listeners.filter(entry => entry.type === type).forEach(entry => entry.listener({ type }));
    return { app: context.__app, element: (id) => registry.get(id) || null, toasts, requests, location: context.location, fire };
}

module.exports = {
    REPO_ROOT,
    createTempDir,
    repoPath,
    cleanEnv,
    runNode,
    parseLastLine,
    startServer,
    createClient,
    createFakeInteraction,
    dispatchInteraction,
    loadFrontendApp
};
