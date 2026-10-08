const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');

// Generated, vendored or local-only content
const SKIPPED_DIRS = new Set(['.git', 'node_modules', 'data', path.join('public', 'vendor')]);

// The old long form of the product name, also split by HTML tags ("Event<br>Management");
// "Discord" may only describe the integration
const OLD_PRODUCT_NAME = /discord(?:[\s_-]|<[^>]*>)*event(?:[\s_-]|<[^>]*>)*management/i;

/**
 * Collect all files below `dir`, skipping SKIPPED_DIRS.
 *
 * @param {string} dir -> Absolute directory path.
 * @returns {string[]} -> Absolute file paths.
 */
function listFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            return SKIPPED_DIRS.has(path.relative(REPO_ROOT, fullPath)) ? [] : listFiles(fullPath);
        }
        return entry.isFile() ? [fullPath] : [];
    });
}

test('the old product name containing "Discord" appears nowhere in the repository', () => {
    const offenders = listFiles(REPO_ROOT).filter(file => {
        const content = fs.readFileSync(file);
        return !content.includes(0) && OLD_PRODUCT_NAME.test(content.toString('utf8'));
    });

    assert.deepEqual(offenders.map(file => path.relative(REPO_ROOT, file)), []);
});
