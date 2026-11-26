const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createTempDir, loadFrontendApp, REPO_ROOT } = require('./helpers');

// Drift test: plugin-sdk/types/dems-plugin.d.ts must describe exactly what the
// real `ctx` (plugin-sdk/context.js) and `ui` (public/js/core/plugins.js) offer.

const tmpDir = createTempDir('plugin-types');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
delete process.env.DEV_MOCK;
process.env.SQLITE_PATH = path.join(tmpDir, 'plugin-types.sqlite');

const { createContext } = require('../plugin-sdk/context');
const { createMessageLimiter } = require('../plugin-sdk/discord');
const { PERMISSIONS } = require('../plugin-sdk/manifest');
const { scanSource } = require('../plugin-sdk/permissionScan');

const DTS = fs.readFileSync(path.join(REPO_ROOT, 'plugin-sdk', 'types', 'dems-plugin.d.ts'), 'utf8');

/**
 * Minimal .d.ts reader. Limits: it understands only `interface Name { ... }`
 * blocks whose members stand on their own line (`name(...)`, `name?:`, `name:`),
 * one member per line start; comments (lines starting with `/**`, `*`, `//`) are
 * skipped, braces are counted per line, so a member's inline `{ ... }` type must
 * be closed on the same line. A member whose type is another interface of the
 * file (`log: Logger;`) expands to `log.<member>`. `@permission` tags are read
 * from the JSDoc block right above a member.
 */
function parseInterfaces(source) {
    const interfaces = {};
    let current = null;
    let depth = 0;
    let tag = null;
    for (const line of source.split(/\r?\n/)) {
        const text = line.trim();
        if (text.startsWith('/**') || text.startsWith('*') || text.startsWith('//')) {
            const match = /@permission\s+(\S+)/.exec(text);
            if (match) tag = match[1];
            continue;
        }
        const start = /^(?:export\s+)?interface\s+(\w+)/.exec(text);
        if (!current && start) {
            current = interfaces[start[1]] = {};
            depth = 0;
        } else if (current && depth === 1) {
            const member = /^(?:readonly\s+)?(\w+)\??\s*(\(|:\s*([\w.]+)\s*;)/.exec(text);
            if (member) current[member[1]] = { type: member[3] || null, permission: tag };
        }
        if (current) {
            for (const char of text) {
                if (char === '{') depth++;
                if (char === '}') depth--;
            }
            if (depth === 0) current = null;
        }
        tag = null;
    }
    return interfaces;
}

/** Member paths two levels deep of a root interface, with their @permission tags. */
function declaredPaths(interfaces, rootName) {
    const paths = new Map();
    for (const [name, member] of Object.entries(interfaces[rootName])) {
        const nested = member.type && interfaces[member.type];
        if (!nested) {
            paths.set(name, member.permission);
            continue;
        }
        for (const [sub, inner] of Object.entries(nested)) paths.set(`${name}.${sub}`, inner.permission);
    }
    return paths;
}

function realPaths(object) {
    const paths = new Set();
    for (const [name, value] of Object.entries(object)) {
        if (name.startsWith('_')) continue;
        if (value !== null && typeof value === 'object') {
            for (const sub of Object.keys(value)) if (!sub.startsWith('_')) paths.add(`${name}.${sub}`);
        } else {
            paths.add(name);
        }
    }
    return paths;
}

function serverContext() {
    const manifest = {
        id: 'alpha', name: 'Alpha', version: '1.2.3', sdk: 1.1, description: '', author: '',
        server: 'server.js', client: '', css: '', permissions: [], settings: []
    };
    const host = {
        limiter: createMessageLimiter(), recordCollection: async () => {}, routes: [], disableCallbacks: [],
        isRegistering: () => true, setProfileProvider: () => {}
    };
    return createContext({ entry: { id: 'alpha', dir: tmpDir, official: false, manifest }, host });
}

async function clientUi() {
    const harness = await loadFrontendApp({ '/api/admin/roles': [] });
    harness.state.currentUser = { id: 'u1', username: 'mori', displayName: 'Mori', avatar: '', roles: [], isAdmin: true };
    let received = null;
    harness.app.mountPluginModule(
        { id: 'test', name: 'Test', version: '1.0.0', official: true, permissions: [], client: '/plugins/test/client.js', css: '' },
        { register: ui => { received = ui; } }
    );
    return received;
}

const interfaces = parseInterfaces(DTS);

function diff(a, b) {
    return [...a].filter(item => !b.has(item)).sort();
}

test('the .d.ts declares DemsServerContext and DemsClientUi as global aliases', () => {
    assert.match(DTS, /type DemsServerContext = DemsPlugin\.ServerContext;/);
    assert.match(DTS, /type DemsClientUi = DemsPlugin\.ClientUi;/);
    assert.ok(interfaces.ServerContext && interfaces.ClientUi);
});

test('ServerContext lists exactly the members of the real ctx', () => {
    const declared = new Set(declaredPaths(interfaces, 'ServerContext').keys());
    const real = realPaths(serverContext());
    assert.deepEqual(diff(real, declared), [], 'in ctx but not in the .d.ts');
    assert.deepEqual(diff(declared, real), [], 'in the .d.ts but not in ctx');
});

test('ClientUi lists exactly the members of the real ui', async () => {
    const declared = new Set(declaredPaths(interfaces, 'ClientUi').keys());
    const real = realPaths(await clientUi());
    assert.deepEqual(diff(real, declared), [], 'in ui but not in the .d.ts');
    assert.deepEqual(diff(declared, real), [], 'in the .d.ts but not in ui');
});

/** The permission the scanner derives for `<receiver>.<path>(...)` (null when none). */
function scannerPermission(receiver, memberPath) {
    const call = `${receiver}.${memberPath}(${memberPath === 'hooks.on' ? "'event.created'" : ''});`;
    const { permissions } = scanSource(call, { file: 'x.js', kind: receiver === 'ui' ? 'client' : 'server' });
    const found = [...permissions];
    return found.length ? found[0] : null;
}

for (const [root, receiver] of [['ServerContext', 'ctx'], ['ClientUi', 'ui']]) {
    test(`@permission tags of ${root} are known and agree with the scanner`, () => {
        for (const [memberPath, tag] of declaredPaths(interfaces, root)) {
            if (tag) assert.ok(Object.hasOwn(PERMISSIONS, tag), `${memberPath}: unknown permission ${tag}`);
            // hooks.on depends on the hook name: documented in text, no tag
            if (memberPath === 'hooks.on') continue;
            assert.equal(tag, scannerPermission(receiver, memberPath), `${root} ${memberPath}`);
        }
    });
}
