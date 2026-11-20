const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { builtinModules } = require('module');
const { createTempDir, REPO_ROOT } = require('./helpers');
const { parseRules, readCss, readTokens, RAW_VALUE_CHECKS } = require('./cssSource');

// Rules for official plugins (plugins/<id>/): their client code may only use `ui`,
// their server code only Node built-ins and its own files. Custom plugins get the
// same rules in the how-to; nothing checks them.

const OFFICIAL_DIR = path.join(REPO_ROOT, 'plugins');
const INLINE_HANDLER = /\son[a-z]+\s*=\s*["']/i;
const INLINE_STYLE = /\sstyle\s*=\s*["'`]|<style[\s>]|setAttribute\(\s*['"]style['"]/;
const ACTION_ATTRIBUTE = /data-(?:click|change|input)="([^"]*)"/g;
const ACTION_NAME = /^[A-Za-z][A-Za-z0-9]{0,39}$/;
const EMOJI = /\p{Extended_Pictographic}/u;
const STATIC_IMPORT = /\b(?:import|export)\s+(?:[^'"`;]*?\sfrom\s+)?['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*([^)]*)\)/g;
const REQUIRE = /\brequire\s*\(\s*([^)]*)\)/g;
const LITERAL = /^(['"`])([^'"`$]*)\1$/;
const BUILTINS = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));

const lineOf = (source, index) => source.slice(0, index).split('\n').length;
const exists = (file) => fs.existsSync(file) && fs.statSync(file).isFile();
const inside = (dir, file) => file === dir || file.startsWith(dir + path.sep);

/** Plugin folders below `root`, each with its id (the folder name). */
function pluginFolders(root) {
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => ({ id: entry.name, dir: path.join(root, entry.name) }));
}

// Files the browser can load from /plugins/<id>/: the manifest's client (served as client.js) and assets/<name>.js
const SERVED_ASSET = /^assets\/[A-Za-z0-9_-]+\.js$/;

/**
 * Read plugin.json and the entry file a field names.
 *
 * @returns {{ manifest: Object|null, problems: string[] }}
 */
function readManifest(dir, id) {
    const file = path.join(dir, 'plugin.json');
    if (!exists(file)) return { manifest: null, problems: [`${id}/plugin.json is missing`] };
    try {
        return { manifest: JSON.parse(fs.readFileSync(file, 'utf8')), problems: [] };
    } catch (err) {
        return { manifest: null, problems: [`${id}/plugin.json is no JSON: ${err.message}`] };
    }
}

/** The file a manifest field (`client`, `server`) names; a problem when it is missing or outside the folder. */
function manifestEntry(dir, id, manifest, field, problems) {
    if (!manifest || manifest[field] === undefined) return null;
    const value = manifest[field];
    const file = typeof value === 'string' && value !== '' ? path.resolve(dir, value) : null;
    if (!file || !inside(dir, file) || !exists(file)) {
        problems.push(`${id}/plugin.json ${field} "${String(value)}" is missing or outside the plugin`);
        return null;
    }
    return file;
}

/** Specifiers of every import in a module source; a computed dynamic import is reported as null. */
function importsOf(source) {
    const found = [...source.matchAll(STATIC_IMPORT)].map(match => ({ specifier: match[1], index: match.index }));
    for (const match of source.matchAll(DYNAMIC_IMPORT)) {
        const literal = match[1].trim().match(LITERAL);
        found.push({ specifier: literal ? literal[2] : null, index: match.index });
    }
    return found;
}

/**
 * Keys of the object literals passed to `ui.actions.register(...)` (or
 * `actions.register`) in a source: the top-level keys only, shorthand and
 * methods included.
 */
function registeredActions(source) {
    const names = new Set();
    for (const match of source.matchAll(/\bactions\.register\s*\(\s*\{/g)) {
        const body = objectBody(source, match.index + match[0].length - 1);
        for (const entry of splitTopLevel(body)) {
            const key = entry.match(/^\s*(?:async\s+)?(['"]?)([A-Za-z_$][\w$]*)\1\s*(?:[:(]|$)/);
            if (key) names.add(key[2]);
        }
    }
    return names;
}

// Text between the brace at `start` and its partner; strings are skipped
function objectBody(source, start) {
    let depth = 0;
    let quote = null;
    for (let i = start; i < source.length; i++) {
        const char = source[i];
        if (quote) {
            if (char === '\\') i++;
            else if (char === quote) quote = null;
        } else if (char === '"' || char === "'" || char === '`') {
            quote = char;
        } else if ('{(['.includes(char)) {
            depth++;
        } else if ('})]'.includes(char)) {
            depth--;
            if (depth === 0) return source.slice(start + 1, i);
        }
    }
    return source.slice(start + 1);
}

// Split at the commas that are not nested in brackets or strings
function splitTopLevel(body) {
    const parts = [];
    let depth = 0;
    let quote = null;
    let last = 0;
    for (let i = 0; i < body.length; i++) {
        const char = body[i];
        if (quote) {
            if (char === '\\') i++;
            else if (char === quote) quote = null;
        } else if (char === '"' || char === "'" || char === '`') {
            quote = char;
        } else if ('{(['.includes(char)) {
            depth++;
        } else if ('})]'.includes(char)) {
            depth--;
        } else if (char === ',' && depth === 0) {
            parts.push(body.slice(last, i));
            last = i + 1;
        }
    }
    parts.push(body.slice(last));
    return parts;
}

/**
 * Client scripts of a plugin: the manifest's client, every assets/*.js and
 * every file they import. The client is served as /plugins/<id>/client.js,
 * so its imports resolve from there, not from where it lies in the folder.
 *
 * @returns {Array<{ file: string, source: string }>}
 */
function collectClientScripts(dir, id, entry, problems) {
    const assets = path.join(dir, 'assets');
    const queue = [
        ...(entry ? [{ file: entry, served: path.join(dir, 'client.js') }] : []),
        ...(fs.existsSync(assets) ? fs.readdirSync(assets).filter(name => name.endsWith('.js')).map(name => ({ file: path.join(assets, name), served: path.join(assets, name) })) : [])
    ].filter(item => exists(item.file));
    const seen = new Set(queue.map(item => item.file));
    const scripts = [];
    while (queue.length > 0) {
        const { file, served } = queue.shift();
        const source = fs.readFileSync(file, 'utf8');
        const name = path.relative(dir, file).split(path.sep).join('/');
        scripts.push({ file, name, source });
        for (const { specifier, index } of importsOf(source)) {
            const place = `${id}/${name}:${lineOf(source, index)}`;
            if (specifier === null) {
                problems.push(`${place} imports a computed path`);
                continue;
            }
            if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
                problems.push(`${place} imports "${specifier}" (only relative paths inside the plugin)`);
                continue;
            }
            const target = path.resolve(path.dirname(served), specifier.split('?')[0]);
            const relative = path.relative(dir, target).split(path.sep).join('/');
            if (!inside(dir, target)) {
                problems.push(`${place} imports "${specifier}" from outside the plugin`);
            } else if (relative !== 'client.js' && !SERVED_ASSET.test(relative)) {
                problems.push(`${place} imports "${specifier}", which /plugins/${id}/ does not serve (client.js, assets/<name>.js)`);
            } else {
                const real = relative === 'client.js' ? entry : target;
                if (real && exists(real) && !seen.has(real)) {
                    seen.add(real);
                    queue.push({ file: real, served: target });
                }
            }
        }
    }
    return scripts;
}

/** Problems of the client scripts: imports, inline handlers and styles, action names, emojis. */
function checkClientScripts(dir, id, entry) {
    const problems = [];
    const scripts = collectClientScripts(dir, id, entry, problems);
    const registered = new Set(scripts.flatMap(({ source }) => [...registeredActions(source)]));
    for (const { name, source } of scripts) {
        source.split('\n').forEach((line, index) => {
            const place = `${id}/${name}:${index + 1}`;
            if (INLINE_HANDLER.test(line)) problems.push(`${place} has an inline event handler`);
            if (INLINE_STYLE.test(line)) problems.push(`${place} has an inline style`);
            if (EMOJI.test(line)) problems.push(`${place} has an emoji (use a Bootstrap icon)`);
        });
        for (const match of source.matchAll(ACTION_ATTRIBUTE)) {
            const place = `${id}/${name}:${lineOf(source, match.index)}`;
            const parts = match[1].split(':');
            if (parts.length !== 3 || parts[0] !== 'p' || parts[1] !== id || !ACTION_NAME.test(parts[2])) {
                problems.push(`${place} action "${match[1]}" is not p:${id}:<name>`);
            } else if (!registered.has(parts[2])) {
                problems.push(`${place} action "${match[1]}" is not passed to ui.actions.register`);
            }
        }
    }
    return problems;
}

/** Problems of client.css: raw values and variables that are no token. */
function checkClientCss(dir, id) {
    const file = path.join(dir, 'client.css');
    if (!exists(file)) return [];
    const rules = parseRules(fs.readFileSync(file, 'utf8'));
    const tokens = readTokens(readCss('tokens.css'));
    const local = new Set(rules.flatMap(rule => rule.declarations.map(declaration => declaration.property)).filter(property => property.startsWith('--')));
    const problems = [];
    for (const rule of rules) {
        for (const declaration of rule.declarations) {
            const place = `${id}/client.css:${declaration.line} ${rule.selector} { ${declaration.property}: ${declaration.value} }`;
            for (const [kind, isRaw] of Object.entries(RAW_VALUE_CHECKS)) {
                if (isRaw(declaration)) problems.push(`${place} raw ${kind} value (use a token)`);
            }
            for (const [, name] of declaration.value.matchAll(/var\(\s*(--[\w-]+)/g)) {
                if (!tokens.has(name) && !local.has(name) && !name.startsWith('--bs-')) problems.push(`${place} unknown variable ${name}`);
            }
        }
    }
    return problems;
}

// A required relative file as Node resolves it (file, .js, .json, folder/index.js)
function resolveLocal(from, specifier) {
    const base = path.resolve(path.dirname(from), specifier);
    return [base, `${base}.js`, `${base}.json`, path.join(base, 'index.js')].find(exists) || null;
}

/** Problems of the manifest's server file and every file it requires: only Node built-ins and files inside the plugin. */
function checkServerFiles(dir, id, entry) {
    const problems = [];
    const queue = entry ? [entry] : [];
    const seen = new Set(queue);
    while (queue.length > 0) {
        const file = queue.shift();
        if (!file.endsWith('.js')) continue;
        const source = fs.readFileSync(file, 'utf8');
        const name = path.relative(dir, file).split(path.sep).join('/');
        const calls = [...source.matchAll(REQUIRE), ...source.matchAll(DYNAMIC_IMPORT)];
        for (const match of calls) {
            const place = `${id}/${name}:${lineOf(source, match.index)}`;
            const literal = match[1].trim().match(LITERAL);
            if (!literal) {
                problems.push(`${place} loads a computed path`);
                continue;
            }
            const specifier = literal[2];
            if (BUILTINS.has(specifier)) continue;
            if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
                problems.push(`${place} loads "${specifier}" (only Node built-ins and files of the plugin)`);
                continue;
            }
            const target = resolveLocal(file, specifier);
            if (!target || !inside(dir, target)) {
                problems.push(`${place} loads "${specifier}" from outside the plugin`);
            } else if (!seen.has(target)) {
                seen.add(target);
                queue.push(target);
            }
        }
    }
    return problems;
}

/** Every problem of one plugin folder. */
function checkPlugin({ id, dir }) {
    const { manifest, problems } = readManifest(dir, id);
    const client = manifestEntry(dir, id, manifest, 'client', problems);
    const server = manifestEntry(dir, id, manifest, 'server', problems);
    problems.push(
        ...checkClientScripts(dir, id, client),
        ...checkClientCss(dir, id),
        ...checkServerFiles(dir, id, server)
    );
    if (fs.existsSync(path.join(dir, 'node_modules'))) problems.push(`${id}/node_modules must not exist (official plugins have no dependencies)`);
    return problems;
}

test('every official plugin follows the client and server rules', () => {
    // Zero folders until the first official plugin lands; the fixtures below prove the checks
    for (const folder of pluginFolders(OFFICIAL_DIR)) assert.deepEqual(checkPlugin(folder), [], folder.id);
});

/** A plugin folder in a temp dir with the given files ({ 'assets/x.js': '…' }). */
function writePlugin(id, files) {
    const root = createTempDir('plugin-guard');
    const dir = path.join(root, id);
    for (const [name, content] of Object.entries(files)) {
        const file = path.join(dir, name);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        if (content !== null) fs.writeFileSync(file, content);
    }
    return { root, folder: { id, dir } };
}

test('a plugin that follows the rules passes', (t) => {
    const { root, folder } = writePlugin('good-plugin', {
        'plugin.json': JSON.stringify({ id: 'good-plugin', client: 'client.js', server: 'server.js' }),
        'client.js': [
            "import { view } from './assets/view.js';",
            'export function register(ui) {',
            "    ui.actions.register({ submit: () => {}, 'withdraw': () => {}, async reload() {} });",
            "    ui.addPage({ access: 'member', title: 'Gut', render: (el) => { el.innerHTML = view(); } });",
            '}'
        ].join('\n'),
        'assets/view.js': [
            "import { label } from './labels.js';",
            'export const view = () => `<button data-click="p:good-plugin:submit">${label}</button><a data-click="p:good-plugin:withdraw"></a><b data-change="p:good-plugin:reload"></b>`;'
        ].join('\n'),
        'assets/labels.js': "export const label = 'Senden';",
        'client.css': '.good { color: var(--accent-text); padding: var(--space-12); z-index: 1; }',
        'server.js': "const fs = require('node:fs');\nconst path = require('path');\nconst rules = require('./rules');\nmodule.exports = { register() {} };",
        'rules.js': "const data = require('./data.json');\nmodule.exports = {};",
        'data.json': '{}'
    });
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    assert.deepEqual(checkPlugin(folder), []);
});

test('each check fires on a plugin that breaks it', (t) => {
    const { root, folder } = writePlugin('bad-plugin', {
        'plugin.json': JSON.stringify({ id: 'bad-plugin', client: 'client.js', server: 'server.js' }),
        'client.js': [
            "import { escapeHtml } from '/js/core/ui.js';",
            "import { x } from '../other/x.js';",
            'const late = import(url);',
            'export function register(ui) {',
            '    ui.actions.register({ go: () => {} });',
            '    const a = `<button onclick="go()">x</button>`;',
            '    const b = `<p style="color: red">x</p>`;',
            '    const c = `<style>p {}</style>`;',
            '    const d = `<a data-click="p:other:go"></a><a data-click="p:bad-plugin:missing"></a><a data-click="p:bad-plugin:go"></a>`;',
            "    ui.helpers.showToast('Fertig \u{1F389}');",
            '}'
        ].join('\n'),
        'client.css': '.bad { color: #fff; font-size: 12px; z-index: 100; border-radius: 4px; margin: var(--no-such-token); }',
        'server.js': "const express = require('express');\nconst db = require('../../firebaseAdmin');\nconst lib = require('./lib');\nconst dyn = require(name);",
        'lib.js': "const _ = require('lodash');",
        'node_modules/x/index.js': ''
    });
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const problems = checkPlugin(folder).join('\n');
    const expected = [
        /client\.js:1 imports "\/js\/core\/ui\.js"/,
        /client\.js:2 imports "\.\.\/other\/x\.js" from outside the plugin/,
        /client\.js:3 imports a computed path/,
        /client\.js:6 has an inline event handler/,
        /client\.js:7 has an inline style/,
        /client\.js:8 has an inline style/,
        /client\.js:9 action "p:other:go" is not p:bad-plugin:<name>/,
        /client\.js:9 action "p:bad-plugin:missing" is not passed to ui\.actions\.register/,
        /client\.js:10 has an emoji/,
        /raw colour value/, /raw fontSize value/, /raw zIndex value/, /raw radius value/,
        /unknown variable --no-such-token/,
        /server\.js:1 loads "express"/,
        /server\.js:2 loads "\.\.\/\.\.\/firebaseAdmin" from outside the plugin/,
        /server\.js:4 loads a computed path/,
        /lib\.js:1 loads "lodash"/,
        /node_modules must not exist/
    ];
    for (const pattern of expected) assert.match(problems, pattern);
    assert.doesNotMatch(problems, /p:bad-plugin:go/);
});

test('the checks start from the files the manifest names', (t) => {
    // The client is served as /plugins/<id>/client.js wherever it lies, so its imports resolve from the root
    const { root, folder } = writePlugin('moved-plugin', {
        'plugin.json': JSON.stringify({ id: 'moved-plugin', client: 'web/main.js', server: 'index.js' }),
        'web/main.js': [
            "import { view } from './assets/view.js';",
            "import { other } from '../assets/view.js';",
            "import { local } from './web/helper.js';",
            'const a = `<button onclick="go()">x</button>`;'
        ].join('\n'),
        'web/helper.js': '',
        'assets/view.js': 'const b = `<p style="color: red">x</p>`;',
        'index.js': "const express = require('express');\nconst lib = require('./lib/db');",
        'lib/db.js': "const db = require('../../../firebaseAdmin');"
    });
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const problems = checkPlugin(folder).join('\n');
    for (const pattern of [
        /web\/main\.js:2 imports "\.\.\/assets\/view\.js" from outside the plugin/,
        /web\/main\.js:3 imports "\.\/web\/helper\.js", which \/plugins\/moved-plugin\/ does not serve/,
        /web\/main\.js:4 has an inline event handler/,
        /assets\/view\.js:1 has an inline style/,
        /index\.js:1 loads "express"/,
        /lib\/db\.js:1 loads "\.\.\/\.\.\/\.\.\/firebaseAdmin" from outside the plugin/
    ]) assert.match(problems, pattern);
});

test('a manifest entry outside the folder and a missing manifest are problems', (t) => {
    const { root, folder } = writePlugin('outside-plugin', {
        'plugin.json': JSON.stringify({ id: 'outside-plugin', client: '../other/client.js', server: 'nope.js' }),
        '../other/client.js': 'export function register() {}'
    });
    const { root: bareRoot, folder: bare } = writePlugin('bare-plugin', { 'client.js': '' });
    t.after(() => {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(bareRoot, { recursive: true, force: true });
    });
    const problems = checkPlugin(folder).join('\n');
    assert.match(problems, /plugin\.json client "\.\.\/other\/client\.js" is missing or outside the plugin/);
    assert.match(problems, /plugin\.json server "nope\.js" is missing or outside the plugin/);
    assert.deepEqual(checkPlugin(bare), ['bare-plugin/plugin.json is missing']);
});
