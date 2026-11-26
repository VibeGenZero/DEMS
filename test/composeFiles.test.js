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

test('compose.yaml publishes DEMS on localhost only, unless DEMS_BIND says otherwise', () => {
    // A port open to the world lets clients skip the TLS proxy (security report 2026-11)
    const compose = read('compose.yaml');
    assert.match(compose, /- "\$\{DEMS_BIND:-127\.0\.0\.1\}:\$\{DEMS_PORT:-3000\}:3000"/);
    assert.doesNotMatch(compose, /- "\$\{DEMS_PORT:-3000\}:3000"/);
    assert.match(read('.env.example'), /^# DEMS_BIND=127\.0\.0\.1$/m);
});

test('the runtime image keeps its code read-only for the node user, only /app/data is its own', () => {
    // A process that could rewrite /app/plugins would turn any code execution into an
    // "official" plugin that runs without confirmation (plugin security report 2026-11)
    const dockerfile = read('Dockerfile');
    const start = dockerfile.indexOf(' AS runtime');
    assert.ok(start > 0, 'runtime stage');
    const runtime = dockerfile.slice(start);
    assert.doesNotMatch(runtime, /--chown/);
    assert.match(runtime, /^COPY --from=deps \/app\/node_modules \.\/node_modules$/m);
    assert.match(runtime, /^COPY \. \.$/m);
    assert.match(runtime, /^RUN mkdir -p \/app\/data && chown node:node \/app\/data$/m);
    assert.ok(runtime.indexOf('chown node:node /app/data') < runtime.indexOf('USER node'));
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

test('installs that built from source learn how to keep doing so', () => {
    assert.match(read('README.md'), /Bisher aus dem Quellcode gebaut\?.*compose\.build\.yaml/);
    assert.match(read('docs/wiki/ops/docker.md'), /built from source before.*compose\.build\.yaml/i);
});

test('the deployment example follows DEMS_TAG like compose.yaml', () => {
    const deployment = read('docs/wiki/ops/deployment.md');
    assert.match(deployment, /image: moritakahashi\/dems:\$\{DEMS_TAG:-latest\}/);
    assert.doesNotMatch(deployment, /image: moritakahashi\/dems:latest/);
});

test('the image keeps the plugin CLI, so operators can install a .dems on the server', () => {
    // howto/write-plugin.md and ops/docker.md document `npm run plugin -- install` in the container
    const lines = read('.dockerignore').split(/\r?\n/).map((l) => l.trim());
    assert.ok(lines.includes('scripts/'), 'the other scripts stay out of the image');
    assert.ok(lines.indexOf('!scripts/plugin.js') > lines.indexOf('scripts/'), 're-included after scripts/');
    assert.match(read('package.json'), /"plugin": "node scripts\/plugin\.js"/);
    // the CLI may only need the SDK and Node built-ins at top level
    const requires = [...read('scripts/plugin.js').matchAll(/^const .*require\('([^']+)'\)/gm)].map((m) => m[1]);
    for (const spec of requires) assert.ok(!spec.startsWith('.') || spec.startsWith('../plugin-sdk/'), spec);
    assert.match(read('docs/wiki/ops/docker.md'), /docker compose exec dems npm run plugin -- install \/app\/data\/[^ ]+\.dems/);
});
