const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');
const { REPO_ROOT } = require('./helpers');
const { checkRelease, releaseNotes, channelOf } = require('../scripts/release');

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
    const notes = releaseNotes({ updates, version: '3.0.0-rc.2', image: 'moritakahashi/dems' });
    assert.ok(notes.indexOf('### Erstens') < notes.indexOf('### Zweitens'));
    assert.ok(notes.indexOf('### Erstens') >= 0);
    assert.match(notes, /Eins/);
    assert.doesNotMatch(notes, /Alt/);
    assert.match(notes, /docker pull moritakahashi\/dems:3\.0\.0-rc\.2/);
    assert.match(notes, /moritakahashi\/dems:beta/);

    const final = releaseNotes({ updates: files('3.0.0').updates, version: '3.0.0', image: 'moritakahashi/dems' });
    assert.match(final, /moritakahashi\/dems:latest/);
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
