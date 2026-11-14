const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO_ROOT } = require('./helpers');

// The publish job of .github/workflows/ci.yml (docs/wiki/ops/ci.md)
// Line endings as in the repository, also on a Windows checkout (core.autocrlf)
const CI = fs.readFileSync(path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8').replace(/\r\n/g, '\n');
const publishJob = () => {
    const start = CI.indexOf('\n  publish:');
    assert.ok(start > 0, 'publish job exists');
    const next = CI.slice(start + 1).search(/\n {2}[a-z-]+:\n/);
    return next < 0 ? CI.slice(start) : CI.slice(start, start + 1 + next);
};

test('publish runs only after green tests and image check, on pushes to main and tags', () => {
    const job = publishJob();
    assert.match(job, /needs: \[test, docker-build\]/);
    assert.match(job, /if: github\.event_name == 'push' && \(github\.ref == 'refs\/heads\/main' \|\| startsWith\(github\.ref, 'refs\/tags\/'\)\)/);
});

test('only the publish job may write, the workflow stays read-only', () => {
    assert.match(CI, /^permissions:\n {2}contents: read$/m);
    assert.equal(CI.split('contents: write').length - 1, 1);
    assert.match(publishJob(), /contents: write/);
});

test('a tag is checked against the version files before anything is pushed', () => {
    const job = publishJob();
    const check = job.indexOf('scripts/release.js check');
    assert.ok(check > 0);
    assert.ok(check < job.indexOf('docker/build-push-action'), 'check before push');
});

test('main publishes edge and the commit, never latest or beta', () => {
    const job = publishJob();
    assert.match(job, /\$IMAGE:edge/);
    assert.doesNotMatch(job, /\$IMAGE:latest|\$IMAGE:beta/, 'latest/beta only come from the release script channel');
});

test('edge and release builds of one commit never share a tag', () => {
    // main and the tag of the same commit run in parallel; a shared sha tag would go to the last one
    const job = publishJob();
    const mainBranch = job.slice(job.indexOf('else'), job.indexOf('fi', job.indexOf('else')));
    assert.match(mainBranch, /tags="\$IMAGE:edge,\$IMAGE:edge-\$short"/);
    assert.doesNotMatch(mainBranch, /sha-/);
    assert.match(job, /tags="\$IMAGE:\$version,\$IMAGE:sha-\$short,\$IMAGE:\$channel"/);
});

test('the image is multi-arch, labelled with its source and knows its channel', () => {
    const job = publishJob();
    assert.match(job, /platforms: linux\/amd64,linux\/arm64/);
    assert.match(job, /target: runtime/);
    assert.match(job, /DEMS_CHANNEL=/);
    assert.match(job, /DEMS_COMMIT=\$\{\{ github\.sha \}\}/);
    assert.match(job, /org\.opencontainers\.image\.source=https:\/\/github\.com\/VibeGenZero\/DEMS/);
    assert.match(job, /org\.opencontainers\.image\.revision=/);
});

test('without Docker Hub secrets the job skips with a notice instead of failing', () => {
    const job = publishJob();
    assert.match(job, /secrets\.DOCKERHUB_TOKEN/);
    assert.match(job, /secrets\.DOCKERHUB_USERNAME/);
    assert.match(job, /::notice::/);
});

test('a tag creates the GitHub release from updates.json unless one exists', () => {
    const job = publishJob();
    assert.match(job, /gh release view/);
    assert.match(job, /scripts\/release\.js notes/);
    assert.match(job, /gh release create "\$TAG" --verify-tag/);
    assert.match(job, /--prerelease/);
});
