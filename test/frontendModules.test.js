const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { frontendSources, REPO_ROOT } = require('./helpers');
const { maskJsSource, lineDepths } = require('./jsSource');

// Code that may run on import besides import/export declarations
const ALLOWED_TOP_LEVEL = [/^registerActions\(/, /^Object\.assign\(window, /];
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
