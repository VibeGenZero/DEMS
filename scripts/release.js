#!/usr/bin/env node
/**
 * Release helper for the publish job in .github/workflows/ci.yml.
 *
 *   node scripts/release.js check <tag>    exit 1 unless the tag matches every version file
 *   node scripts/release.js channel <tag>  prints "latest" (release) or "beta" (pre-release)
 *   node scripts/release.js notes <tag>    prints the GitHub release notes (Markdown)
 *   git ls-remote --tags --refs origin | node scripts/release.js pending
 *                                          prints package.json's version when it still
 *                                          needs its release (no tag, newer than every
 *                                          tag), else nothing
 *
 * A tag is the bare version without "v" (docs/wiki/ops/deployment.md).
 */
const fs = require('fs');
const path = require('path');
const { isPrerelease, compareVersions } = require('../utils/semver');

// Docker Hub and GitHub Packages carry the same tags (.github/workflows/ci.yml)
const IMAGES = ['moritakahashi/dems', 'ghcr.io/vibegenzero/dems'];
const TAG_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;

/**
 * Compare a git tag with the version files.
 *
 * @param {Object} input -> `{ tag, pkg, lock, updates }`: the tag and the parsed
 *   package.json, package-lock.json and updates.json.
 * @returns {string[]} -> One message per problem; empty when the tag fits.
 */
function checkRelease({ tag, pkg, lock, updates }) {
    if (!TAG_PATTERN.test(String(tag))) {
        return [`Tag "${tag}" is not a version (expected e.g. 3.0.0 or 3.0.0-rc.2, without "v").`];
    }
    const problems = [];
    const expect = (file, actual) => {
        if (actual !== tag) problems.push(`${file} has version ${actual}, the tag is ${tag}.`);
    };
    expect('package.json', pkg && pkg.version);
    expect('package-lock.json', lock && lock.version);
    expect('package-lock.json (packages[""])', lock && lock.packages && lock.packages[''] && lock.packages[''].version);
    expect('updates.json', updates && updates.version);
    const releases = (updates && Array.isArray(updates.releases)) ? updates.releases : [];
    if (!releases.some(release => release && release.version === tag)) {
        problems.push(`updates.json has no release entry for ${tag}.`);
    }
    return problems;
}

/**
 * Whether a push to main carries a new release: package.json's version has no
 * tag yet and is newer than every version tag. Merging a version bump thereby
 * publishes the release without anyone pushing a tag by hand.
 *
 * @param {Object} input -> `{ version, tags }`: package.json's version and the tag names.
 * @returns {string|null} -> The version to release, or null.
 */
function pendingRelease({ version, tags }) {
    if (!TAG_PATTERN.test(String(version))) return null;
    const versions = (tags || []).filter(tag => TAG_PATTERN.test(tag));
    if (versions.some(tag => compareVersions(tag, version) >= 0)) return null;
    return version;
}

/**
 * @param {string} text -> `git ls-remote --tags` output ("<sha>\trefs/tags/<name>") or one name per line.
 * @returns {string[]} -> Unique tag names (a peeled "^{}" line counts as its tag).
 */
function parseTagList(text) {
    const names = String(text || '')
        .split(/\r?\n/)
        .map(line => line.trim().split(/\s+/).pop())
        .filter(Boolean)
        .map(ref => ref.replace(/^refs\/tags\//, '').replace(/\^\{\}$/, ''));
    return [...new Set(names)];
}

/**
 * @param {string} version -> Release version.
 * @returns {'latest'|'beta'} -> Moving Docker tag of that version.
 */
function channelOf(version) {
    return isPrerelease(version) ? 'beta' : 'latest';
}

/**
 * Release notes for GitHub: the news of the version, then the pull commands.
 *
 * @param {Object} input -> `{ updates, version, images }`: images = registry names, Docker Hub first.
 * @returns {string} -> Markdown.
 */
function releaseNotes({ updates, version, images }) {
    const release = (updates.releases || []).find(entry => entry.version === version) || { news: [] };
    const news = (release.news || []).map(entry => `### ${entry.title}\n\n${entry.content}`);
    const pulls = images.flatMap(image => [
        `docker pull ${image}:${version}`,
        `docker pull ${image}:${channelOf(version)}`
    ]);
    const docker = ['### Docker', '', '```bash', ...pulls, '```'].join('\n');
    return [...news, docker].join('\n\n') + '\n';
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
}

function main([command, tag]) {
    if (command === 'pending') {
        const tags = parseTagList(fs.readFileSync(0, 'utf8'));
        const version = pendingRelease({ version: readJson('package.json').version, tags });
        if (version) process.stdout.write(`${version}\n`);
        return 0;
    }
    if (!tag || !['check', 'channel', 'notes'].includes(command)) {
        console.error('Usage: node scripts/release.js check|channel|notes <tag>, or pending with the tag list on stdin');
        return 2;
    }
    if (command === 'channel') {
        process.stdout.write(`${channelOf(tag)}\n`);
        return 0;
    }
    const updates = readJson('updates.json');
    if (command === 'notes') {
        process.stdout.write(releaseNotes({ updates, version: tag, images: IMAGES }));
        return 0;
    }
    const problems = checkRelease({ tag, pkg: readJson('package.json'), lock: readJson('package-lock.json'), updates });
    for (const problem of problems) console.error(problem);
    return problems.length ? 1 : 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { checkRelease, channelOf, releaseNotes, pendingRelease, parseTagList };
