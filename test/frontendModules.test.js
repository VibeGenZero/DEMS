const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { frontendSources, REPO_ROOT } = require('./helpers');
const { maskJsSource, lineDepths, codeIdentifiers } = require('./jsSource');

// Code that may run on import besides import/export declarations
const ALLOWED_TOP_LEVEL = [/^registerActions\(/];
const MAIN_TOP_LEVEL = [/^document\.addEventListener\(/, /^initActions\(/];
const MAX_MODULE_LINES = 550;

test('app.js is gone and index.html loads the entry module', () => {
    assert.equal(fs.existsSync(path.join(REPO_ROOT, 'public', 'js', 'app.js')), false);
    const html = fs.readFileSync(path.join(REPO_ROOT, 'public', 'index.html'), 'utf8');
    assert.match(html, /<script type="module" src="\/js\/main\.js"><\/script>/);
    assert.doesNotMatch(html, /\/js\/app\.js/);
});

test('every module stays small and runs no code on import', () => {
    const sources = frontendSources();
    assert.ok(sources.length >= 25, `only ${sources.length} modules`);
    for (const { file, source } of sources) {
        const text = source.replace(/\r\n/g, '\n');
        const lines = text.split('\n');
        assert.ok(lines.length <= MAX_MODULE_LINES, `${file} has ${lines.length} lines`);
        const maskedText = maskJsSource(text);
        const masked = maskedText.split('\n');
        const depths = lineDepths(maskedText);
        const allowed = file === 'main.js' ? [...ALLOWED_TOP_LEVEL, ...MAIN_TOP_LEVEL] : ALLOWED_TOP_LEVEL;
        masked.forEach((line, i) => {
            if (depths[i] !== 0 || !/^\S/.test(line) || /^[}\])]/.test(line)) return;
            // Declarations are fine; module-private helpers need no export
            if (/^(import|export|const|let|function|async function) /.test(line)) return;
            assert.ok(allowed.some(pattern => pattern.test(line)), `${file}:${i + 1} runs code on import: ${line.trim()}`);
        });
    }
});

test('shared values are only used through state', () => {
    const sources = frontendSources();
    const stateFile = sources.find(entry => entry.file === 'core/state.js').source.replace(/\r\n/g, '\n');
    const stateNames = [...stateFile.matchAll(/^ {4}([\w$]+):/gm)].map(match => match[1]);
    assert.ok(stateNames.includes('currentUser'), 'state.js lists its fields');
    for (const { file, source } of sources) {
        if (file === 'core/state.js') continue;
        const text = source.replace(/\r\n/g, '\n');
        const masked = maskJsSource(text);
        for (const ref of codeIdentifiers(masked)) {
            if (!stateNames.includes(ref.name)) continue;
            const line = masked.slice(0, ref.index).split('\n').length;
            assert.fail(`${file}:${line} uses ${ref.name} without state.`);
        }
    }
});

test('no local binding hides the imported state', () => {
    // A parameter or variable named `state` turns every `state.x` in its scope into a property of that value
    const BINDINGS = [/function\s*[\w$]*\s*\(([^)]*)\)/g, /\(([^()]*)\)\s*=>/g, /(?<![\w$.])([\w$]+)\s*=>/g, /\b(?:const|let|var)\s+([^=;]+?)\s*=/g, /catch\s*\(([^)]*)\)/g];
    for (const { file, source } of frontendSources()) {
        const text = source.replace(/\r\n/g, '\n');
        if (!/^import \{ state \} from/m.test(text)) continue;
        const masked = maskJsSource(text);
        for (const pattern of BINDINGS) {
            for (const match of masked.matchAll(pattern)) {
                if (!/(?<![\w$.])state(?![\w$])/.test(match[1])) continue;
                const line = masked.slice(0, match.index).split('\n').length;
                assert.fail(`${file}:${line} declares a local "state": ${match[0].trim()}`);
            }
        }
    }
});
