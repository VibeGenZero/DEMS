const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');
const { REPO_ROOT } = require('./helpers');
const { checkRelease, releaseNotes, channelOf, pendingRelease, parseTagList } = require('../scripts/release');

// The publish job (.github/workflows/ci.yml) runs scripts/release.js on a tag
const files = (version, releases = [version]) => ({
    pkg: { version },
    lock: { version, packages: { '': { version } } },
    updates: {
        version,
        releases: releases.map(v => ({ version: v, news: [{ title: `Titel ${v}`, content: `Text ${v}` }] }))
    }
});

test('a tag that matches every version file passes', () => {
    assert.deepEqual(checkRelease({ tag: '3.0.0', ...files('3.0.0') }), []);
});

test('each version file that differs from the tag is named', () => {
    const base = files('3.0.0');
    const pkgOff = checkRelease({ ...base, tag: '3.0.1', updates: files('3.0.1').updates, lock: files('3.0.1').lock });
    assert.equal(pkgOff.length, 1);
    assert.match(pkgOff[0], /package\.json.*3\.0\.0.*3\.0\.1/);

    const lockOff = checkRelease({ ...files('3.0.1'), tag: '3.0.1', lock: { version: '3.0.1', packages: { '': { version: '3.0.0' } } } });
    assert.equal(lockOff.length, 1);
    assert.match(lockOff[0], /package-lock\.json/);

    const updatesOff = checkRelease({ ...files('3.0.1'), tag: '3.0.1', updates: { version: '3.0.0', releases: [{ version: '3.0.0', news: [] }] } });
    assert.ok(updatesOff.some(message => /updates\.json.*3\.0\.0.*3\.0\.1/.test(message)), updatesOff.join('\n'));
    assert.ok(updatesOff.some(message => /updates\.json.*no release entry.*3\.0\.1/.test(message)), updatesOff.join('\n'));
});

test('a tag that is no bare version is refused', () => {
    for (const tag of ['v3.0.0', 'latest', '3.0']) {
        const problems = checkRelease({ tag, ...files('3.0.0') });
        assert.ok(problems.some(message => /not a version/.test(message)), `${tag}: ${problems.join('\n')}`);
    }
});

test('the channel is latest for a release and beta for a pre-release', () => {
    assert.equal(channelOf('3.0.0'), 'latest');
    assert.equal(channelOf('3.0.0-rc.2'), 'beta');
});

test('the release notes list the news of the version and the pull commands', () => {
    const updates = {
        version: '3.0.0-rc.2',
        releases: [
            { version: '3.0.0-rc.2', news: [{ title: 'Erstens', content: 'Eins' }, { title: 'Zweitens', content: 'Zwei' }] },
            { version: '3.0.0-rc.1', news: [{ title: 'Alt', content: 'Alt' }] }
        ]
    };
    const images = ['moritakahashi/dems', 'ghcr.io/vibegenzero/dems'];
    const notes = releaseNotes({ updates, version: '3.0.0-rc.2', images });
    assert.ok(notes.indexOf('### Erstens') < notes.indexOf('### Zweitens'));
    assert.ok(notes.indexOf('### Erstens') >= 0);
    assert.match(notes, /Eins/);
    assert.doesNotMatch(notes, /Alt/);
    assert.match(notes, /docker pull moritakahashi\/dems:3\.0\.0-rc\.2/);
    assert.match(notes, /moritakahashi\/dems:beta/);
    // GitHub Packages carries the same tags as Docker Hub
    assert.match(notes, /docker pull ghcr\.io\/vibegenzero\/dems:3\.0\.0-rc\.2/);
    assert.match(notes, /ghcr\.io\/vibegenzero\/dems:beta/);

    const final = releaseNotes({ updates: files('3.0.0').updates, version: '3.0.0', images });
    assert.match(final, /moritakahashi\/dems:latest/);
    assert.match(final, /ghcr\.io\/vibegenzero\/dems:latest/);
});

test('the command line release notes name Docker Hub and GitHub Packages', () => {
    const { version } = require('../package.json');
    const notes = runCli('notes', version).stdout;
    assert.match(notes, new RegExp(`docker pull moritakahashi/dems:${version.replace(/\./g, '\\.')}`));
    assert.match(notes, new RegExp(`docker pull ghcr\\.io/vibegenzero/dems:${version.replace(/\./g, '\\.')}`));
});

const runCli = (...args) => spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'release.js'), ...args], { cwd: REPO_ROOT, encoding: 'utf8' });

test('the command line fails on a wrong tag and passes on the current version', () => {
    const wrong = runCli('check', '0.0.0-nope');
    assert.equal(wrong.status, 1);
    assert.match(wrong.stderr, /package\.json/);

    const { version } = require('../package.json');
    const right = runCli('check', version);
    assert.equal(right.status, 0, right.stderr);
    assert.equal(runCli('channel', version).stdout.trim(), channelOf(version));
    assert.match(runCli('notes', version).stdout, new RegExp(`dems:${version.replace(/\./g, '\\.')}`));
});

// A push to main whose package.json names a version without a tag is the release
test('a version newer than every tag is pending, a tagged or older one is not', () => {
    const tags = ['3.1.0', '3.2.0', '3.0.0-beta.3'];
    assert.equal(pendingRelease({ version: '3.3.0', tags }), '3.3.0');
    assert.equal(pendingRelease({ version: '3.3.0-rc.1', tags }), '3.3.0-rc.1');
    assert.equal(pendingRelease({ version: '3.2.0', tags }), null, 'already tagged');
    assert.equal(pendingRelease({ version: '3.1.5', tags }), null, 'older than the newest tag');
    assert.equal(pendingRelease({ version: '3.2.0-rc.1', tags }), null, 'pre-release of a released version');
});

test('tags that are no versions are ignored, a version that is no tag name never releases', () => {
    assert.equal(pendingRelease({ version: '1.0.0', tags: ['latest', 'nightly', 'v0.9'] }), '1.0.0');
    assert.equal(pendingRelease({ version: '1.0.0', tags: [] }), '1.0.0');
    assert.equal(pendingRelease({ version: 'v4.0.0', tags: ['3.2.0'] }), null, 'tags carry no "v"');
    assert.equal(pendingRelease({ version: undefined, tags: [] }), null);
});

test('the tag list is read from git ls-remote output or plain names', () => {
    const output = [
        '180f387e4a1903f3108deff7abd9260cc7636050\trefs/tags/3.2.0',
        '44b059156d633ab7a728c484731ab4d377bc0c8e\trefs/tags/3.0.0-beta.3^{}',
        '3.1.0',
        ''
    ].join('\n');
    assert.deepEqual(parseTagList(output), ['3.2.0', '3.0.0-beta.3', '3.1.0']);
});

test('the command line prints the pending version from a tag list on stdin', () => {
    const { version } = require('../package.json');
    const pending = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'release.js'), 'pending'], { cwd: REPO_ROOT, encoding: 'utf8', input: 'abc\trefs/tags/0.0.1\n' });
    assert.equal(pending.status, 0, pending.stderr);
    assert.equal(pending.stdout.trim(), version);

    const tagged = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'release.js'), 'pending'], { cwd: REPO_ROOT, encoding: 'utf8', input: `abc\trefs/tags/${version}\n` });
    assert.equal(tagged.status, 0, tagged.stderr);
    assert.equal(tagged.stdout, '');
});
