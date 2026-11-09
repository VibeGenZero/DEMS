const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadFrontendApp, httpAnswer, isHidden, REPO_ROOT } = require('./helpers');

// #138: public privacy page, the "Datenschutz" links and the consent dialog (public/js/pages/privacy.js)
const SOURCE = fs.readFileSync(path.join(REPO_ROOT, 'public', 'js', 'pages', 'privacy.js'), 'utf8');
const HTML = fs.readFileSync(path.join(REPO_ROOT, 'public', 'index.html'), 'utf8');
const POLICY = { markdown: '# Datenschutz\n\nText', version: 3, updatedAt: '2026-11-09T10:00:00.000Z' };
const MEMBER = { id: 'u1', username: 'tom', displayName: 'Tom', avatar: '', isAdmin: false };

test('the links and the dialog start hidden, the dialog cannot be dismissed', () => {
    for (const id of ['login-privacy-link', 'info-privacy-link', 'privacy-section']) {
        assert.match(HTML, new RegExp(`<[^>]*id="${id}"[^>]*class="[^"]*is-hidden|<[^>]*class="[^"]*is-hidden[^"]*"[^>]*id="${id}"`), id);
    }
    assert.match(HTML, /<div class="modal fade" id="privacyConsentModal"[^>]*data-bs-backdrop="static" data-bs-keyboard="false"/);
    assert.match(HTML, /<a [^>]*id="login-privacy-link"[^>]*href="#privacy"|<a [^>]*href="#privacy"[^>]*id="login-privacy-link"/);
});

test('with a policy the login page and the info page link to it', async () => {
    const { app, element } = await loadFrontendApp({ '/api/privacy': POLICY });
    await app.loadPrivacyLinks();
    assert.equal(isHidden(element('login-privacy-link')), false);
    assert.equal(isHidden(element('info-privacy-link')), false);
});

test('without a policy the links stay hidden', async () => {
    const { app, element } = await loadFrontendApp({ '/api/privacy': httpAnswer(404, { error: 'Es gibt keine Datenschutzerklärung.' }) });
    await app.loadPrivacyLinks();
    assert.equal(isHidden(element('login-privacy-link')), true);
    assert.equal(isHidden(element('info-privacy-link')), true);
});

test('#privacy is public and renders the policy as safe Markdown', async () => {
    const { app, element, location } = await loadFrontendApp({ '/api/privacy': POLICY });
    location.hash = '#privacy';
    await app.handleRoute();
    await app.showPrivacySection();
    assert.equal(element('privacy-section').style.display, 'block');
    assert.match(element('privacy-content').innerHTML, /# Datenschutz/);
    assert.match(element('privacy-updated').textContent, /09\.11\.2026/);
    assert.match(SOURCE, /renderMarkdownSafe\(policy\.markdown\)/);
    const router = fs.readFileSync(path.join(REPO_ROOT, 'public', 'js', 'core', 'router.js'), 'utf8');
    assert.match(router, /route !== 'privacy'/);
});

test('a member who has to accept sees only the dialog until they accept', async () => {
    const { app, state, element, requests } = await loadFrontendApp({
        '/api/csrf-token': { token: 't' },
        '/auth/me': { ...MEMBER, privacyRequired: true, privacyVersion: 3 },
        '/api/privacy': POLICY,
        '/api/user/privacy/accept': { success: true, version: 3 }
    });
    const booting = app.finishLoading();
    // The boot waits in the dialog: no route is shown before the consent
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    assert.match(element('privacy-consent-text').innerHTML, /# Datenschutz/);
    assert.ok(!requests.some(request => request.url.startsWith('/api/events')));

    await app.runAction('acceptPrivacy', {});
    await booting;
    const accept = requests.find(request => request.url === '/api/user/privacy/accept');
    assert.equal(accept.method, 'POST');
    assert.deepEqual(JSON.parse(accept.body), { version: 3 });
    assert.equal(state.currentUser.privacyRequired, false);
});

test('declining logs out', async () => {
    const { app, requests } = await loadFrontendApp({ '/auth/logout': { success: true }, '/api/privacy': POLICY });
    await app.runAction('declinePrivacy', {});
    assert.ok(requests.some(request => request.url === '/auth/logout' && request.method === 'POST'));
});

test('a newer version during the visit opens the dialog again', async () => {
    let version = 3;
    const { app, state, element, toasts } = await loadFrontendApp({
        '/api/privacy': () => ({ ...POLICY, version }),
        '/api/user/privacy/accept': () => httpAnswer(409, { error: 'Es gibt eine neue Fassung der Datenschutzerklärung. Bitte lies sie und stimme erneut zu.', version: 4 })
    });
    state.currentUser = { ...MEMBER, privacyRequired: false };
    const waiting = app.requirePrivacyConsent();
    await new Promise(resolve => setImmediate(resolve));
    version = 4;
    await app.runAction('acceptPrivacy', {});
    assert.deepEqual(toasts, ['Es gibt eine neue Fassung der Datenschutzerklärung. Bitte lies sie und stimme erneut zu.']);
    assert.match(element('privacy-consent-version').textContent, /4/);
    void waiting;
});

test('an API answer with privacyRequired opens the dialog', async () => {
    const { app, state, element } = await loadFrontendApp({
        '/api/privacy': POLICY,
        // Any API call of any module, here the maintenance check
        '/api/maintenance/status': httpAnswer(403, { error: 'Bitte akzeptiere zuerst die Datenschutzerklärung.', privacyRequired: true })
    });
    state.currentUser = { ...MEMBER, privacyRequired: false };
    app.watchPrivacyAnswers();
    await app.checkMaintenanceStatus();
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    assert.match(element('privacy-consent-text').innerHTML, /# Datenschutz/);
    assert.equal(state.currentUser.privacyRequired, true);

    const main = fs.readFileSync(path.join(REPO_ROOT, 'public', 'js', 'main.js'), 'utf8');
    assert.match(main, /watchPrivacyAnswers\(\)/);
});

test('the module names its actions literally and keeps no inline style', () => {
    for (const name of ['acceptPrivacy', 'declinePrivacy']) {
        assert.ok(HTML.includes(`data-click="${name}"`), name);
        assert.match(SOURCE, new RegExp(`\\b${name}[,:\\s]`));
    }
    assert.doesNotMatch(SOURCE, /style="|\bon[a-z]+="/);
});
