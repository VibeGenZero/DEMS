const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadFrontendApp, frontendSources, REPO_ROOT } = require('./helpers');

const MEMBER = { id: 'u-member', username: 'member', roles: [], isAdmin: false };

test('the logout posts the CSRF token and then leaves for the start page', async () => {
    const { app, requests, location, toasts, state } = await loadFrontendApp({ '/auth/logout': { success: true } });
    state.currentUser = MEMBER;
    state.csrfToken = 'test-token';

    await app.logout();

    const call = requests.find(request => request.url === '/auth/logout');
    assert.equal(call?.method, 'POST');
    assert.equal(call.headers['X-CSRF-TOKEN'], 'test-token');
    assert.equal(location.href, '/');
    assert.deepEqual(toasts, []);
});

test('a refused logout stays on the page and says so', async () => {
    const { app, location, toasts, state } = await loadFrontendApp({});
    state.currentUser = MEMBER;

    await app.logout();

    assert.equal(location.href, undefined);
    assert.deepEqual(toasts, ['Abmelden fehlgeschlagen. Bitte lade die Seite neu und versuche es erneut.']);
});

test('a refused OAuth state gets its own German message', async () => {
    const { app } = await loadFrontendApp({});
    assert.equal(app.getErrorMessage('invalid_state'), 'Die Anmeldung ist abgelaufen oder wurde nicht in diesem Browser gestartet. Bitte melde dich erneut an.');
});

test('nothing logs out by navigating to /auth/logout any more', () => {
    const html = fs.readFileSync(path.join(REPO_ROOT, 'public', 'index.html'), 'utf8');
    const appJs = frontendSources().map(entry => entry.source).join('\n');
    assert.doesNotMatch(html, /href="\/auth\/logout"/);
    assert.doesNotMatch(appJs, /location\.href\s*=\s*'\/auth\/logout'/);
});
