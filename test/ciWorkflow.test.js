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
    assert.equal(CI.split('packages: write').length - 1, 1);
    assert.match(publishJob(), /contents: write\n {6}packages: write/);
});

test('a tag is checked against the version files before anything is pushed', () => {
    const job = publishJob();
    const check = job.indexOf('scripts/release.js check');
    assert.ok(check > 0);
    assert.ok(check < job.indexOf('docker/build-push-action'), 'check before push');
});

test('main publishes edge and the commit, never latest or beta', () => {
    const job = publishJob();
    assert.match(job, /edge=\$\(image_tags edge "edge-\$short"\)/);
    assert.doesNotMatch(job, /image_tags[^\n]*(latest|beta)/, 'latest/beta only come from the release script channel');
});

test('edge and release builds of one commit never share a tag', () => {
    // main and the tag of the same commit can run in parallel; a shared sha tag would go to the last one
    const job = publishJob();
    assert.doesNotMatch(job.match(/edge=\$\(image_tags[^\n]*/)[0], /sha-/);
    assert.match(job, /tags=\$\(image_tags "\$version" "sha-\$short" "\$channel"\)/);
});

test('every tag goes to GitHub Packages, and to Docker Hub when its secret exists', () => {
    const job = publishJob();
    // Lower-case owner/repo: ghcr.io/vibegenzero/dems here, the fork's own package in a fork
    assert.match(job, /ghcr="ghcr\.io\/\$\{GITHUB_REPOSITORY,,\}"/);
    assert.match(job, /images="\$ghcr"/);
    assert.match(job, /if \[ "\$DOCKERHUB" = true \]; then images="\$IMAGE \$ghcr"; fi/);
    assert.match(job, /DOCKERHUB: \$\{\{ steps\.secrets\.outputs\.ok \}\}/);
    assert.ok(job.indexOf('id: secrets') < job.indexOf('id: meta'), 'the secret check decides the image list');

    const login = job.slice(job.indexOf('registry: ghcr.io') - 200, job.indexOf('registry: ghcr.io') + 200);
    assert.match(login, /docker\/login-action/);
    assert.match(login, /username: \$\{\{ github\.actor \}\}/);
    assert.match(login, /password: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
});

test('a merged version bump on main is the release, found through the tag list', () => {
    const job = publishJob();
    const pending = job.indexOf('git ls-remote --tags --refs origin | node scripts/release.js pending');
    assert.ok(pending > 0, 'main asks the release script for a version without a tag');
    assert.ok(pending < job.indexOf('scripts/release.js check'), 'the found version is checked like a tag');
    assert.match(job, /echo "release=\$release"/);
});

test('a release commit of main also moves edge, built with the edge channel', () => {
    const job = publishJob();
    const step = job.slice(job.indexOf('name: Build and push the edge image'));
    assert.ok(job.includes('name: Build and push the edge image'));
    assert.match(step, /if: steps\.meta\.outputs\.release == 'true' && github\.ref_type == 'branch'/);
    assert.match(step, /tags: \$\{\{ steps\.meta\.outputs\.edge \}\}/);
    assert.match(step, /DEMS_CHANNEL=edge/);
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

test('without Docker Hub secrets only the Docker Hub login is skipped, with a notice', () => {
    const job = publishJob();
    assert.match(job, /secrets\.DOCKERHUB_TOKEN/);
    assert.match(job, /secrets\.DOCKERHUB_USERNAME/);
    assert.match(job, /::notice::/);
    const dockerHubLogin = job.slice(job.indexOf('username: ${{ secrets.DOCKERHUB_USERNAME }}') - 120, job.indexOf('username: ${{ secrets.DOCKERHUB_USERNAME }}'));
    assert.match(dockerHubLogin, /if: steps\.secrets\.outputs\.ok == 'true'/);
    // Everything else runs for GitHub Packages
    assert.equal(job.split("steps.secrets.outputs.ok == 'true'").length - 1, 1);
});

test('a release creates the GitHub release from updates.json unless one exists', () => {
    const job = publishJob();
    const step = job.slice(job.indexOf('name: Create the GitHub release'));
    assert.match(step, /if: steps\.meta\.outputs\.release == 'true'/);
    assert.match(step, /TAG: \$\{\{ steps\.meta\.outputs\.version \}\}/);
    assert.match(step, /gh release view/);
    assert.match(step, /scripts\/release\.js notes/);
    // A pushed tag is verified; on main the release creates the tag on the built commit
    assert.match(step, /gh release create "\$TAG" --verify-tag/);
    assert.match(step, /gh release create "\$TAG" --target "\$GITHUB_SHA"/);
    assert.match(step, /--prerelease/);
});
