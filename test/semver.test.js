const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseVersion, compareVersions, isPrerelease } = require('../utils/semver');

test('versions order like SemVer, pre-releases included', () => {
    assert.ok(compareVersions('3.0.0-rc.1', '3.0.0-beta.3') > 0);
    assert.ok(compareVersions('3.0.0-beta.10', '3.0.0-beta.9') > 0);
    assert.ok(compareVersions('3.0.0', '3.0.0-rc.1') > 0);
    assert.ok(compareVersions('3.0.0-beta.1', '2.6.0') > 0);
    assert.ok(compareVersions('3.0.0-beta.3', '3.0.0-rc.1') <= 0);
    assert.equal(compareVersions('3.0.0-rc.1', '3.0.0-rc.1'), 0);
    assert.ok(compareVersions('3.0.0-beta', '3.0.0-beta.1') < 0);
    assert.ok(compareVersions('3.0.0-beta.2', '3.0.0-beta.x') < 0, 'numbers come before words');
    assert.ok(compareVersions('3.10.0', '3.9.0') > 0, 'core parts compare as numbers');
});

test('parseVersion accepts MAJOR.MINOR.PATCH with an optional v and pre-release', () => {
    assert.deepEqual(parseVersion('v3.0.0'), { core: [3, 0, 0], pre: [] });
    assert.deepEqual(parseVersion('3.0.0-rc.1'), { core: [3, 0, 0], pre: ['rc', '1'] });
    assert.equal(parseVersion('latest'), null);
    assert.equal(parseVersion('3.0'), null);
    assert.equal(parseVersion('3.0.0-'), null);
    assert.equal(parseVersion(undefined), null);
});

test('isPrerelease tells pre-releases from releases', () => {
    assert.equal(isPrerelease('3.0.0-rc.1'), true);
    assert.equal(isPrerelease('3.0.0'), false);
});

test('compareVersions refuses a version it cannot read', () => {
    assert.throws(() => compareVersions('nightly', '3.0.0'), TypeError);
});
