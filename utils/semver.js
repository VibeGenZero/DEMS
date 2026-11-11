/**
 * SemVer order for DEMS versions (package.json, updates.json, git tags,
 * GitHub releases): MAJOR.MINOR.PATCH, optionally "-<pre-release>".
 * A release is newer than its pre-releases; pre-release parts compare one by
 * one, numbers as numbers ("beta.10" > "beta.9"), numbers before words, words
 * alphabetically ("rc" > "beta"), a shorter list of equal parts is older.
 */

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

/**
 * Split a version into its parts.
 *
 * @param {string} version -> e.g. "3.0.0-rc.1"; a leading "v" is allowed.
 * @returns {{ core: number[], pre: string[] }|null} -> null if it is no version.
 */
function parseVersion(version) {
    const match = typeof version === 'string' ? VERSION_PATTERN.exec(version) : null;
    if (!match) return null;
    return {
        core: [Number(match[1]), Number(match[2]), Number(match[3])],
        pre: match[4] ? match[4].split('.') : []
    };
}

function comparePreParts(x, y) {
    const numX = /^\d+$/.test(x);
    const numY = /^\d+$/.test(y);
    if (numX && numY) return Number(x) - Number(y);
    if (numX !== numY) return numX ? -1 : 1;
    return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * Compare two versions.
 *
 * @param {string} a -> Version.
 * @param {string} b -> Version.
 * @returns {number} -> Negative if a is older, 0 if equal, positive if a is newer.
 * @throws {TypeError} -> If either is no version.
 */
function compareVersions(a, b) {
    const x = parseVersion(a);
    const y = parseVersion(b);
    if (!x || !y) throw new TypeError(`Not a version: ${!x ? a : b}`);
    for (let i = 0; i < 3; i++) {
        if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i];
    }
    if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length;
    for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
        if (x.pre[i] === undefined) return -1;
        if (y.pre[i] === undefined) return 1;
        const diff = comparePreParts(x.pre[i], y.pre[i]);
        if (diff) return diff;
    }
    return 0;
}

/**
 * @param {string} version -> Version.
 * @returns {boolean} -> True for a pre-release such as "3.0.0-rc.1".
 */
function isPrerelease(version) {
    const parsed = parseVersion(version);
    return Boolean(parsed && parsed.pre.length);
}

module.exports = { parseVersion, compareVersions, isPrerelease };
