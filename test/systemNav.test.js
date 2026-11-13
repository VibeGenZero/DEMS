const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadFrontendApp } = require('./helpers');

// Categories of the admin page "System" (#system/<category>) and the leave guard of the router

const SETTINGS = [
    { key: 'DISCORD_CLIENT_ID', group: 'discord', secret: false, value: '123456789012345678', isSet: true, source: 'db', locked: false, applies: 'live' },
    { key: 'SERVER_NAME', group: 'server', secret: false, value: 'Gilde', isSet: true, source: 'db', locked: false, applies: 'live' },
    { key: 'ADMIN_RESET_PASSWORD', group: 'security', secret: true, value: null, isSet: true, source: 'env', locked: true, applies: 'live' }
];

async function openApp(options = {}) {
    const harness = await loadFrontendApp({ '/api/admin/system/settings': { settings: SETTINGS } }, options);
    harness.state.currentUser = { id: 'a', isAdmin: true };
    return harness;
}

/** Show a route like the browser does after a hash change. */
async function go(harness, hash) {
    harness.location.hash = '#' + hash;
    await harness.app.handleRoute();
}

test('a leave guard that answers false keeps the page and restores the address', async () => {
    const harness = await openApp();
    await go(harness, 'system');
    harness.app.setLeaveGuard(() => false);
    await go(harness, 'event/abc');
    assert.equal(harness.element('system-section').style.display, 'block');
    assert.notEqual(harness.element('event-detail-section').style.display, 'block');
    assert.equal(harness.location.hash, '#system');
});

test('a leave guard that answers true lets the navigation through and is asked with the next route', async () => {
    const harness = await openApp();
    await go(harness, 'system');
    const asked = [];
    // Copied field by field: the object comes from the module realm of the harness
    harness.app.setLeaveGuard((next) => { asked.push([next.route, next.param]); return true; });
    await go(harness, 'event/abc');
    assert.deepEqual(asked, [['event', 'abc']]);
    assert.equal(harness.location.hash, '#event/abc');

    // The guard is used up: the next change is not asked again
    await go(harness, 'info');
    assert.equal(asked.length, 1);
});

test('a guard may answer later, like a confirm dialog', async () => {
    const harness = await openApp();
    await go(harness, 'system');
    harness.app.setLeaveGuard(() => Promise.resolve(false));
    await go(harness, 'info');
    assert.equal(harness.location.hash, '#system');
    assert.equal(harness.element('system-section').style.display, 'block');
});

test('setLeaveGuard(null) removes the guard', async () => {
    const harness = await openApp();
    await go(harness, 'system');
    let asked = 0;
    harness.app.setLeaveGuard(() => { asked++; return false; });
    harness.app.setLeaveGuard(null);
    await go(harness, 'info');
    assert.equal(asked, 0);
    assert.equal(harness.location.hash, '#info');
});
