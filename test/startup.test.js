const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadFrontendApp, frontendSources, isHidden, REPO_ROOT } = require('./helpers');

// setImmediate runs after the microtask queue is drained
const settle = () => new Promise(resolve => setImmediate(resolve));

const MEMBER = { id: '200000000000000003', username: 'tom', displayName: 'Tom', avatar: '', roles: [], isAdmin: false };

/**
 * Routes the startup reads; /auth/me answers through `me`.
 *
 * @param {Function} me -> Route function for /auth/me.
 * @returns {Object} -> Routes for loadFrontendApp().
 */
const startupRoutes = (me) => ({
    '/api/csrf-token': { token: 'csrf' },
    '/api/server-info': { serverName: 'DEMS', guildId: '1', debugMode: false },
    '/api/maintenance/status': { active: false },
    '/api/updates': { version: '9.9.9', date: '2026-10-01', news: [] },
    '/api/events?upcoming=1&limit=100': { data: [], meta: { total: 0, page: 1, limit: 100, totalPages: 0 } },
    '/auth/me': me
});

// A boot within the last 24 h skips the boot animation -> straight into finishLoading()
const RECENT_BOOT = { dems_boot_ts: String(Date.now()) };

test('the startup asks the server once who is logged in', async () => {
    const { fire, requests } = await loadFrontendApp(startupRoutes(() => MEMBER), { storage: RECENT_BOOT });
    fire('DOMContentLoaded');
    await settle();

    // /auth/me clears isNewUser on its first read -> a second request would swallow the welcome dialog
    assert.equal(requests.filter(request => request.url === '/auth/me').length, 1);
});

test('a logged-in user stays logged in whatever answer arrives last', async () => {
    let releaseFirstAnswer;
    const firstAnswerHeld = new Promise(resolve => { releaseFirstAnswer = resolve; });
    let calls = 0;
    const { element, fire, state } = await loadFrontendApp(startupRoutes(() => (++calls === 1 ? firstAnswerHeld.then(() => MEMBER) : MEMBER)), { storage: RECENT_BOOT });

    fire('DOMContentLoaded');
    await settle();
    releaseFirstAnswer();
    await settle();

    assert.equal(state.currentUser?.username, 'tom');
    assert.equal(element('user-info').style.display, 'flex');
    // The events link appears with the login; the only login button sits in the login card
    assert.equal(isHidden(element('nav-events')), false);
});

test('showUserData exists once, the unused user data modal is gone', () => {
    const appJs = frontendSources().map(entry => entry.source).join('\n');
    const html = fs.readFileSync(path.join(REPO_ROOT, 'public', 'index.html'), 'utf8');
    assert.equal(appJs.match(/function showUserData\b/g).length, 1);
    assert.doesNotMatch(html, /id="userDataModal"/);
    assert.doesNotMatch(appJs, /setupEventListeners/);
});
