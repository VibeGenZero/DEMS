const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REPO_ROOT } = require('./helpers');

// Read fresh, so the test sees the file and not a cached require
const data = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'updates.json'), 'utf8'));
const parts = (version) => version.split('.').map(Number);
const newer = (a, b) => {
    const [x, y] = [parts(a), parts(b)];
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
    return false;
};

test('the release notes are a list of releases, newest first', () => {
    assert.ok(Array.isArray(data.releases) && data.releases.length > 0, 'releases list');
    assert.equal(data.version, data.releases[0].version, 'top-level version is the newest release');
    for (let i = 1; i < data.releases.length; i++) {
        assert.ok(newer(data.releases[i - 1].version, data.releases[i].version),
            `${data.releases[i - 1].version} must be newer than ${data.releases[i].version}`);
    }
});

test('every release has a version, a date and entries with title and text', () => {
    for (const release of data.releases) {
        assert.match(release.version, /^\d+\.\d+\.\d+$/, release.version);
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

test('the history from 1.1.0 to 2.6.0 is kept; the folded 2.7.0 is not', () => {
    const versions = data.releases.map(release => release.version);
    for (const version of ['2.6.0', '2.5.1', '2.5.0', '2.4.0', '2.3.1', '2.3.0', '2.2.0', '2.1.0', '2.0.1', '2.0.0', '1.1.0']) {
        assert.ok(versions.includes(version), `missing ${version}`);
    }
    assert.ok(!versions.includes('2.7.0'));
});

test('the current release marks its top features', () => {
    const highlights = data.releases[0].news.filter(entry => entry.highlight);
    assert.ok(highlights.length >= 1 && highlights.length <= 3);
});
