/**
 * Update check: asks the public GitHub releases of DEMS whether a newer
 * version than the running one exists, shortly after start and then every
 * 12 hours, and keeps the answer in memory for the admin "System" view
 * (GET /api/admin/system/update-status).
 *
 * The request is an anonymous GET with a generic User-Agent; it carries
 * nothing about the installation. Off with UPDATE_CHECK=false, in dev mock
 * mode and on `edge` images (their package.json version is stale between
 * releases). UPDATE_CHECK_REPO points a fork at its own releases.
 */
const { parseVersion, compareVersions, isPrerelease } = require('./semver');

const DEFAULT_REPO = 'VibeGenZero/DEMS';
const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;
const FIRST_CHECK_MS = 30 * 1000;
const INTERVAL_MS = 12 * 60 * 60 * 1000;
const TIMEOUT_MS = 5000;

/**
 * Pick the newest release above the running version.
 *
 * @param {Array} releases -> GitHub release objects (`tag_name`, `html_url`, `draft`).
 * @param {string} current -> Running version.
 * @returns {{ version: string, url: string|null }|null} -> null if nothing newer.
 */
function selectLatestRelease(releases, current) {
    const allowPre = isPrerelease(current);
    let best = null;
    for (const release of Array.isArray(releases) ? releases : []) {
        if (!release || typeof release !== 'object' || release.draft) continue;
        if (!parseVersion(release.tag_name)) continue;
        const version = release.tag_name.replace(/^v/, '');
        if (!allowPre && isPrerelease(version)) continue;
        if (compareVersions(version, current) <= 0) continue;
        if (best && compareVersions(version, best.version) <= 0) continue;
        const url = typeof release.html_url === 'string' && release.html_url.startsWith('https://github.com/') ? release.html_url : null;
        best = { version, url };
    }
    return best;
}

function disabledReason(env, mockMode) {
    if (mockMode) return 'mock';
    if (env.UPDATE_CHECK === 'false') return 'disabled';
    if (env.DEMS_CHANNEL === 'edge') return 'edge';
    if (env.UPDATE_CHECK_REPO && !REPO_PATTERN.test(env.UPDATE_CHECK_REPO)) return 'invalid-repo';
    return null;
}

/**
 * @param {Object} options -> `{ currentVersion, env, mockMode, fetchImpl, now, log }`.
 * @returns {{ start: Function, stop: Function, checkNow: Function, getStatus: Function }}
 */
function createUpdateChecker({ currentVersion, env = process.env, mockMode = false, fetchImpl = fetch, now = () => new Date(), log = console }) {
    const reason = disabledReason(env, mockMode);
    const repo = env.UPDATE_CHECK_REPO || DEFAULT_REPO;
    const url = `https://api.github.com/repos/${repo}/releases?per_page=30`;
    const timers = { first: null, interval: null };
    let latest = null;
    let checkedAt = null;

    async function checkNow() {
        if (reason) return;
        try {
            const res = await fetchImpl(url, {
                headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'DEMS-update-check' },
                signal: AbortSignal.timeout(TIMEOUT_MS)
            });
            if (!res.ok) throw new Error(`GitHub antwortet mit ${res.status}`);
            const releases = await res.json();
            if (!Array.isArray(releases)) throw new Error('GitHub-Antwort ist keine Release-Liste');
            latest = selectLatestRelease(releases, currentVersion);
            checkedAt = now().toISOString();
        } catch (err) {
            log.warn(`⚠️ Update-Prüfung fehlgeschlagen: ${err.message}`);
        }
    }

    function start() {
        if (reason || timers.first) return;
        timers.first = setTimeout(() => {
            checkNow();
            timers.interval = setInterval(checkNow, INTERVAL_MS);
            timers.interval.unref?.();
        }, FIRST_CHECK_MS);
        timers.first.unref?.();
    }

    function stop() {
        clearTimeout(timers.first);
        clearInterval(timers.interval);
        timers.first = null;
        timers.interval = null;
    }

    function getStatus() {
        const updateAvailable = Boolean(latest);
        return {
            enabled: !reason,
            reason,
            current: currentVersion,
            latest: latest ? latest.version : null,
            updateAvailable,
            switchToLatest: updateAvailable && isPrerelease(currentVersion) && !isPrerelease(latest.version),
            releaseUrl: latest ? latest.url : null,
            checkedAt,
            channel: env.DEMS_CHANNEL || null,
            commit: env.DEMS_COMMIT ? String(env.DEMS_COMMIT).slice(0, 7) : null
        };
    }

    return { start, stop, checkNow, getStatus };
}

// ── Module singleton for server.js and the admin route ─────────────────
let instance = null;

/**
 * Start the check of this process (server.js).
 *
 * @param {Object} options -> `{ mockMode }`.
 */
function startUpdateCheck({ mockMode = false } = {}) {
    if (instance) return;
    instance = createUpdateChecker({ currentVersion: require('../package.json').version, mockMode });
    instance.start();
}

function stopUpdateCheck() {
    if (instance) instance.stop();
}

/**
 * @returns {Object} -> The current status; a neutral "off" status before start.
 */
function getUpdateStatus() {
    if (instance) return instance.getStatus();
    return {
        enabled: false, reason: null, current: require('../package.json').version, latest: null,
        updateAvailable: false, switchToLatest: false, releaseUrl: null, checkedAt: null, channel: null, commit: null
    };
}

module.exports = { selectLatestRelease, createUpdateChecker, startUpdateCheck, stopUpdateCheck, getUpdateStatus };
