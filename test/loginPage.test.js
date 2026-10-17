const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadFrontendApp, isHidden } = require('./helpers');

// Login page of D-12: no way into the events and one login button while
// logged out; the card shows the Discord server with its icon or initials.

const MEMBER = { id: '200000000000000003', username: 'tom', displayName: 'Tom', avatar: '', roles: [], isAdmin: false };

test('logged out, the navbar offers the logo and Info only', async () => {
    const { app, state, element } = await loadFrontendApp({});
    app.showLoggedOut();
    assert.ok(isHidden(element('nav-events')));
    assert.ok(isHidden(element('user-info')));
    // The navbar no longer has a login button of its own
    assert.equal(element('login-btn-container'), null);

    state.currentUser = MEMBER;
    app.showLoggedIn();
    assert.equal(isHidden(element('nav-events')), false);
    app.showLoggedOut();
    assert.ok(isHidden(element('nav-events')));
});

test('the server name reaches navbar and login card as text', async () => {
    const { app, state, element } = await loadFrontendApp({});
    state.serverName = '<img src=x onerror=alert(1)> Raid & Co';
    app.updateServerNameInUI();
    for (const id of ['nav-brand-name', 'login-server-name', 'login-server-ref']) {
        assert.equal(element(id).textContent, '<img src=x onerror=alert(1)> Raid & Co', id);
    }
    assert.equal(element('login-server-icon').innerHTML, app.avatar({ name: state.serverName, size: 'xl' }));
    assert.doesNotMatch(element('login-server-icon').innerHTML, /<img src=x/);
});

test('the login card shows the icon of the Discord server, or its initials', async () => {
    const withIcon = await loadFrontendApp({ '/api/server-info': { serverName: 'Raid & Co', iconUrl: 'https://cdn.example/icon.png', guildId: '1', debugMode: false } });
    await withIcon.app.loadServerInfo();
    assert.equal(withIcon.element('login-server-icon').innerHTML, withIcon.app.avatar({ url: 'https://cdn.example/icon.png', name: 'Raid & Co', size: 'xl' }));

    const withoutIcon = await loadFrontendApp({ '/api/server-info': { serverName: 'DEMS Dev Server', iconUrl: null, guildId: '1', debugMode: false } });
    await withoutIcon.app.loadServerInfo();
    assert.equal(withoutIcon.element('login-server-icon').innerHTML, '<span class="avatar avatar-xl avatar-initials" title="DEMS Dev Server">DD</span>');
});

test('the styleguide link of the debug mode waits for the login as well', async () => {
    const { app, state, element } = await loadFrontendApp({ '/api/server-info': { serverName: 'DEMS', iconUrl: null, guildId: '1', debugMode: true } });
    await app.loadServerInfo();
    app.showLoggedOut();
    assert.ok(isHidden(element('nav-debug')));

    state.currentUser = MEMBER;
    app.showLoggedIn();
    assert.equal(isHidden(element('nav-debug')), false);
});
