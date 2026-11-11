const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO_ROOT } = require('./helpers');

// Operators install from the published image; building from source is the override
const read = (file) => fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');

test('compose.yaml runs the published image, without a build', () => {
    const compose = read('compose.yaml');
    assert.match(compose, /image: moritakahashi\/dems:\$\{DEMS_TAG:-latest\}/);
    assert.doesNotMatch(compose, /^\s+build:/m);
});

test('compose.build.yaml builds the runtime stage from source', () => {
    const build = read('compose.build.yaml');
    assert.match(build, /context: \./);
    assert.match(build, /target: runtime/);
});

test('CI health-checks the image built from the branch, not the published one', () => {
    for (const file of ['.github/workflows/ci.yml', '.gitlab-ci.yml']) {
        const calls = read(file).match(/docker compose -f compose\.yaml\b.*/g) || [];
        assert.ok(calls.length > 0, file);
        for (const call of calls) assert.match(call, /^docker compose -f compose\.yaml -f compose\.build\.yaml /, `${file}: ${call}`);
    }
});

test('the README updates by pulling the image', () => {
    const readme = read('README.md');
    assert.match(readme, /docker compose pull && docker compose up -d/);
    assert.doesNotMatch(readme, /git pull && docker compose up -d --build/);
});
