const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadFrontendApp, frontendSources, REPO_ROOT } = require('./helpers');
const { maskJsSource, codeIdentifiers } = require('./jsSource');

const INDEX_HTML = fs.readFileSync(path.join(REPO_ROOT, 'public', 'index.html'), 'utf8');
const INLINE_HANDLER = /\son[a-z]+\s*=\s*["']/i;
const ACTION_ATTRIBUTE = /data-(?:click|change|input)="([^"]*)"/g;

test('no inline event handler is left in index.html or the modules', () => {
    assert.doesNotMatch(INDEX_HTML, INLINE_HANDLER);
    for (const { file, source } of frontendSources()) assert.doesNotMatch(source, INLINE_HANDLER, file);
});

test('every action named in the markup is registered and named literally', async () => {
    const { app } = await loadFrontendApp({});
    const registered = new Set(app.actionNames());
    const used = [INDEX_HTML, ...frontendSources().map(entry => entry.source)]
        .flatMap(text => [...text.matchAll(ACTION_ATTRIBUTE)].map(match => match[1]));
    assert.ok(used.length > 80, `only ${used.length} actions found`);
    for (const name of used) {
        assert.doesNotMatch(name, /\$\{/, `action name built at runtime: ${name}`);
        assert.ok(registered.has(name), `action "${name}" is not registered`);
    }
});

test('no module puts functions on window', () => {
    for (const { file, source } of frontendSources()) assert.doesNotMatch(source, /Object\.assign\(window/, file);
});

test('a module that calls a function of another module imports it', () => {
    const sources = frontendSources();
    const owner = new Map();
    for (const { file, source } of sources) {
        for (const match of source.matchAll(/^export (?:async )?function ([\w$]+)/gm)) owner.set(match[1], file);
    }
    for (const { file, source } of sources) {
        const text = source.replace(/\r\n/g, '\n');
        const imported = new Set([...text.matchAll(/^import \{([^}]*)\} from/gm)]
            .flatMap(match => match[1].split(',').map(name => name.trim()).filter(Boolean)));
        const masked = maskJsSource(text);
        for (const ref of codeIdentifiers(masked)) {
            const from = owner.get(ref.name);
            if (!from || from === file || !/^\s*\(/.test(masked.slice(ref.index + ref.name.length))) continue;
            assert.ok(imported.has(ref.name), `${file} calls ${ref.name}() from ${from} without importing it`);
        }
    }
});
