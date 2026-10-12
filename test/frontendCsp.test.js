const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadFrontendApp, frontendSources, REPO_ROOT } = require('./helpers');
const { findMissingImports } = require('./jsSource');

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

test('a module that uses an export of another module imports it', () => {
    // Calls, references (addEventListener('click', fn)) and constants alike: a missing
    // import only fails at runtime, on the path that uses it
    const missing = findMissingImports(frontendSources())
        .map(entry => `${entry.file}:${entry.line} uses ${entry.name} from ${entry.from} without importing it`);
    assert.deepEqual(missing, []);
});

test('no module shows an element by clearing its inline display', () => {
    // What starts hidden carries the class .is-hidden; with style.display = '' the class
    // would stay in charge and the element hidden. showElement() and toggleElement() handle both.
    const clearing = /\.style\.display\s*=\s*(?:''|""|[^;]*\?\s*(?:''|"")\s*:|[^;]*:\s*(?:''|"")\s*;)/;
    const offenders = frontendSources()
        .filter(({ file }) => file !== 'core/ui.js')
        .flatMap(({ file, source }) => source.split('\n')
            .map((line, index) => ({ line, place: `public/js/${file}:${index + 1}` }))
            .filter(({ line }) => clearing.test(line))
            .map(({ place }) => place));
    assert.deepEqual(offenders, [], 'use showElement() or toggleElement() from core/ui.js');
});
