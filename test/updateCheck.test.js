const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectLatestRelease, createUpdateChecker } = require('../utils/updateCheck');

const release = (tag, extra = {}) => ({ tag_name: tag, html_url: `https://github.com/VibeGenZero/DEMS/releases/tag/${tag}`, draft: false, ...extra });

// A fetch stand-in: answers in order, records every call
function fakeFetch(...answers) {
    const calls = [];
    const fetchImpl = async (url, options) => {
        calls.push({ url, options });
        const answer = answers.length > 1 ? answers.shift() : answers[0];
        if (answer instanceof Error) throw answer;
        if (typeof answer === 'function') return answer();
        return { ok: true, status: 200, json: async () => answer };
    };
    return { fetchImpl, calls };
}

const NOW = new Date('2026-11-11T10:00:00.000Z');
const quietLog = () => {
    const warnings = [];
    return { warn: (...args) => warnings.push(args.join(' ')), warnings };
};
const checker = (currentVersion, fetchStub, extra = {}) => createUpdateChecker({
    currentVersion, env: {}, fetchImpl: fetchStub.fetchImpl, now: () => NOW, log: quietLog(), ...extra
});

test('the newest release above the running version wins; drafts, non-versions and pre-releases of a release install do not count', () => {
    const list = [release('3.0.0-rc.2'), release('3.0.0'), release('v3.0.1'), release('latest'), release('3.1.0', { draft: true }), release('2.6.0')];
    assert.deepEqual(selectLatestRelease(list, '3.0.0'), { version: '3.0.1', url: 'https://github.com/VibeGenZero/DEMS/releases/tag/v3.0.1' });
    assert.equal(selectLatestRelease([release('3.0.1-beta.1')], '3.0.0'), null);
    assert.equal(selectLatestRelease(list, '3.0.1'), null);
    assert.equal(selectLatestRelease([null, 'x', {}], '3.0.0'), null);
});

test('a pre-release install also hears about newer pre-releases', () => {
    assert.equal(selectLatestRelease([release('3.0.0-rc.2')], '3.0.0-rc.1').version, '3.0.0-rc.2');
    assert.equal(selectLatestRelease([release('3.0.0-rc.2'), release('3.0.0')], '3.0.0-rc.1').version, '3.0.0');
});

test('only a GitHub https link is passed on as release link', () => {
    assert.equal(selectLatestRelease([release('3.0.1', { html_url: 'javascript:alert(1)' })], '3.0.0').url, null);
    assert.equal(selectLatestRelease([release('3.0.1', { html_url: 'https://evil.example/x' })], '3.0.0').url, null);
    assert.equal(selectLatestRelease([release('3.0.1', { html_url: 42 })], '3.0.0').url, null);
});

test('a check asks the public releases of the repository and reports a newer version', async () => {
    const stub = fakeFetch([release('3.0.1')]);
    const check = checker('3.0.0', stub);
    await check.checkNow();
    const status = check.getStatus();
    assert.equal(status.enabled, true);
    assert.equal(status.reason, null);
    assert.equal(status.current, '3.0.0');
    assert.equal(status.latest, '3.0.1');
    assert.equal(status.updateAvailable, true);
    assert.equal(status.switchToLatest, false);
    assert.equal(status.releaseUrl, 'https://github.com/VibeGenZero/DEMS/releases/tag/3.0.1');
    assert.equal(status.checkedAt, NOW.toISOString());
    assert.equal(stub.calls.length, 1);
    assert.equal(stub.calls[0].url, 'https://api.github.com/repos/VibeGenZero/DEMS/releases?per_page=30');
    assert.equal(stub.calls[0].options.headers['User-Agent'], 'DEMS-update-check');
    assert.equal(stub.calls[0].options.headers.Accept, 'application/vnd.github+json');
    assert.ok(stub.calls[0].options.signal, 'the request has a timeout');
});

test('up to date: checked, nothing newer', async () => {
    const check = checker('3.0.1', fakeFetch([release('3.0.1'), release('3.0.0')]));
    await check.checkNow();
    const status = check.getStatus();
    assert.equal(status.updateAvailable, false);
    assert.equal(status.latest, null);
    assert.equal(status.checkedAt, NOW.toISOString());
});

test('a pre-release install told about a final release has to switch to latest', async () => {
    const final = checker('3.0.0-rc.1', fakeFetch([release('3.0.0')]));
    await final.checkNow();
    assert.equal(final.getStatus().switchToLatest, true);

    const pre = checker('3.0.0-rc.1', fakeFetch([release('3.0.0-rc.2')]));
    await pre.checkNow();
    assert.equal(pre.getStatus().updateAvailable, true);
    assert.equal(pre.getStatus().switchToLatest, false);
});

test('a failed check keeps the last good answer and warns once per failure', async () => {
    const log = quietLog();
    const stub = fakeFetch(
        [release('3.0.1')],
        () => ({ ok: false, status: 403, json: async () => ({ message: 'rate limit' }) }),
        new Error('getaddrinfo ENOTFOUND'),
        () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token'); } }),
        { message: 'Not Found' }
    );
    const check = checker('3.0.0', stub, { log });
    await check.checkNow();
    const good = check.getStatus();
    for (let i = 0; i < 4; i++) await check.checkNow();
    assert.deepEqual(check.getStatus(), good);
    assert.equal(log.warnings.length, 4);
    assert.equal(stub.calls.length, 5);
});

test('switched off, edge, mock mode or an invalid repo: no request at all', async () => {
    const cases = [
        [{ env: { UPDATE_CHECK: 'false' } }, 'disabled'],
        [{ env: { DEMS_CHANNEL: 'edge', DEMS_COMMIT: 'abcdef1234567' } }, 'edge'],
        [{ mockMode: true }, 'mock'],
        [{ env: { UPDATE_CHECK_REPO: 'a/b/c' } }, 'invalid-repo']
    ];
    for (const [options, reason] of cases) {
        const stub = fakeFetch([release('9.9.9')]);
        const check = checker('3.0.0', stub, options);
        check.start();
        await check.checkNow();
        check.stop();
        const status = check.getStatus();
        assert.equal(status.enabled, false, reason);
        assert.equal(status.reason, reason);
        assert.equal(status.updateAvailable, false, reason);
        assert.equal(stub.calls.length, 0, reason);
    }
    const edge = checker('3.0.0', fakeFetch([]), { env: { DEMS_CHANNEL: 'edge', DEMS_COMMIT: 'abcdef1234567' } });
    assert.equal(edge.getStatus().commit, 'abcdef1');
    assert.equal(edge.getStatus().channel, 'edge');
});

test('a fork can point the check at its own releases', async () => {
    const stub = fakeFetch([]);
    const check = checker('3.0.0', stub, { env: { UPDATE_CHECK_REPO: 'someone/fork' } });
    await check.checkNow();
    assert.equal(stub.calls[0].url, 'https://api.github.com/repos/someone/fork/releases?per_page=30');
});

test('servers started by the test helpers never ask GitHub unless a test says so', () => {
    const { cleanEnv } = require('./helpers');
    assert.equal(cleanEnv().UPDATE_CHECK, 'false');
    assert.equal(cleanEnv({ UPDATE_CHECK: 'true' }).UPDATE_CHECK, 'true');
});

test('start schedules the first check and stop clears it', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const stub = fakeFetch([release('3.0.1')]);
    const check = checker('3.0.0', stub);
    check.start();
    t.mock.timers.tick(29_999);
    assert.equal(stub.calls.length, 0);
    t.mock.timers.tick(1);
    assert.equal(stub.calls.length, 1);
    t.mock.timers.tick(12 * 60 * 60 * 1000);
    assert.equal(stub.calls.length, 2);
    check.stop();
    t.mock.timers.tick(12 * 60 * 60 * 1000);
    assert.equal(stub.calls.length, 2);
});
