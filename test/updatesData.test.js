const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO_ROOT } = require('./helpers');

// Read fresh, so the test sees the file and not a cached require
const data = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'updates.json'), 'utf8'));
// SemVer order: major.minor.patch first; a release is newer than its pre-releases;
// pre-release parts compare one by one, numbers as numbers ("beta.10" > "beta.9"),
// words alphabetically ("rc" > "beta").
const split = (version) => {
    const [core, ...suffix] = version.split('-');
    return { core: core.split('.').map(Number), pre: suffix.length ? suffix.join('-').split('.') : [] };
};
const compareParts = (x, y) => {
    const [numX, numY] = [/^\d+$/.test(x), /^\d+$/.test(y)];
    if (numX && numY) return Number(x) - Number(y);
    if (numX !== numY) return numX ? -1 : 1;
    return x < y ? -1 : x > y ? 1 : 0;
};
const newer = (a, b) => {
    const [x, y] = [split(a), split(b)];
    for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] > y.core[i];
    if (!x.pre.length || !y.pre.length) return !x.pre.length && y.pre.length > 0;
    for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
        if (x.pre[i] === undefined) return false;
        if (y.pre[i] === undefined) return true;
        const diff = compareParts(x.pre[i], y.pre[i]);
        if (diff) return diff > 0;
    }
    return false;
};

test('versions order like SemVer, pre-releases included', () => {
    assert.ok(newer('3.0.0-rc.1', '3.0.0-beta.3'));
    assert.ok(newer('3.0.0-beta.10', '3.0.0-beta.9'));
    assert.ok(newer('3.0.0', '3.0.0-rc.1'));
    assert.ok(newer('3.0.0-beta.1', '2.6.0'));
    assert.ok(!newer('3.0.0-beta.3', '3.0.0-rc.1'));
    assert.ok(!newer('3.0.0-rc.1', '3.0.0-rc.1'));
});

test('the release notes are a list of releases, newest first', () => {
    assert.ok(Array.isArray(data.releases) && data.releases.length > 0, 'releases list');
    assert.equal(data.version, data.releases[0].version, 'top-level version is the newest release');
    assert.equal(data.releases[0].version, '3.0.0-rc.1', 'newest release is the release candidate');
    for (let i = 1; i < data.releases.length; i++) {
        assert.ok(newer(data.releases[i - 1].version, data.releases[i].version),
            `${data.releases[i - 1].version} must be newer than ${data.releases[i].version}`);
    }
});

test('every release has a version, a date and entries with title and text', () => {
    for (const release of data.releases) {
        assert.match(release.version, /^\d+\.\d+\.\d+(-[\w.+-]+)?$/, release.version);
        assert.match(release.date, /^\d{4}-\d{2}-\d{2}$/, `${release.version} date`);
        assert.ok(Array.isArray(release.news) && release.news.length > 0, `${release.version} has entries`);
        for (const entry of release.news) {
            assert.equal(typeof entry.title, 'string');
            assert.ok(entry.title.trim(), `${release.version}: empty title`);
            assert.equal(typeof entry.content, 'string');
            assert.ok(entry.content.trim(), `${release.version}: empty text`);
            if ('highlight' in entry) assert.equal(typeof entry.highlight, 'boolean');
        }
        assert.ok(release.news.filter(entry => entry.highlight).length <= 3, `${release.version}: at most 3 highlights`);
    }
});

test('the history from 1.1.0 to 3.0.0-beta.3 is kept; the folded 2.7.0 is not', () => {
    const versions = data.releases.map(release => release.version);
    for (const version of ['3.0.0-beta.3', '2.6.0', '2.5.1', '2.5.0', '2.4.0', '2.3.1', '2.3.0', '2.2.0', '2.1.0', '2.0.1', '2.0.0', '1.1.0']) {
        assert.ok(versions.includes(version), `missing ${version}`);
    }
    assert.ok(!versions.includes('2.7.0'));
});

test('the current release marks its top features', () => {
    const highlights = data.releases[0].news.filter(entry => entry.highlight);
    assert.ok(highlights.length >= 1 && highlights.length <= 3);
});
