const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');

// Third-party builds we do not edit
const SKIPPED_PREFIXES = ['public/vendor/'];

// The old long form of the product name, also split by HTML tags ("Event<br>Management");
// "Discord" may only describe the integration
const OLD_PRODUCT_NAME = /discord(?:[\s_-]|<[^>]*>)*event(?:[\s_-]|<[^>]*>)*management/i;

/**
 * Files tracked by git. Untracked files are not part of the repository and may
 * legitimately contain the old name: CI keeps its npm cache and logs in the checkout,
 * and those logs carry the GitLab project path.
 *
 * @returns {string[]} -> Paths relative to the repository root, with forward slashes.
 */
function listTrackedFiles() {
    return execFileSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, encoding: 'utf8' })
        .split('\0')
        .filter(Boolean)
        .filter(file => !SKIPPED_PREFIXES.some(prefix => file.startsWith(prefix)))
        .filter(file => fs.existsSync(path.join(REPO_ROOT, file)));
}

test('the old product name containing "Discord" appears nowhere in the repository', () => {
    const offenders = listTrackedFiles().filter(file => {
        const content = fs.readFileSync(path.join(REPO_ROOT, file));
        return !content.includes(0) && OLD_PRODUCT_NAME.test(content.toString('utf8'));
    });

    assert.deepEqual(offenders, []);
});
