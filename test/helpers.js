/**
 * Shared helpers for the node:test suites.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');

// Variables that would leak the developer's own setup into a test process
const LEAKING_PREFIXES = ['DISCORD_', 'FIREBASE_', 'DEV_'];
const LEAKING_KEYS = ['NODE_ENV', 'SQLITE_PATH', 'SESSION_SECRET', 'ADMIN_RESET_PASSWORD', 'PORT', 'BASE_URL', 'DEBUG_MODE'];

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

module.exports = { REPO_ROOT, createTempDir, repoPath, cleanEnv, runNode, parseLastLine };
