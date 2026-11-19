const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadFrontendApp, httpAnswer, isHidden, REPO_ROOT } = require('./helpers');

// Plugin clients in the browser: public/js/core/plugins.js and the `ui` object

const HTML = fs.readFileSync(path.join(REPO_ROOT, 'public', 'index.html'), 'utf8');

const ADMIN = { id: 'u-admin', username: 'mori', displayName: 'Mori', avatar: '', roles: [], isAdmin: true };
const MEMBER = { id: 'u-member', username: 'mia', displayName: 'Mia', avatar: '', roles: [], isAdmin: false };

const ENTRY = {
    id: 'test', name: 'Test', version: '1.0.0', official: true, permissions: ['events:draft'],
    client: '/plugins/test/client.js?v=1.0.0', css: ''
};

async function openApp(routes = {}, user = ADMIN) {
    const harness = await loadFrontendApp({ '/api/admin/roles': [], ...routes });
    harness.state.currentUser = user;
    harness.state.csrfToken = 'test-token';
    return harness;
}

/** Show a route like the browser does after a hash change. */
async function go(harness, hash) {
    harness.location.hash = '#' + hash;
    await harness.app.handleRoute();
}

/** Mount a fake client whose register() receives `ui`; returns that ui. */
function mount(harness, register, entry = ENTRY) {
    let received = null;
    harness.app.mountPluginModule(entry, { register: (ui) => { received = ui; return register(ui); } });
    return received;
}

const recordingPage = (calls, extra = {}) => ({
    access: 'member',
    title: 'Testseite',
    render: (container, param) => { calls.push(param); container.innerHTML = '<p>Inhalt</p>'; },
    tab: { label: 'Test', icon: 'bi-star' },
    ...extra
});

test('the markup has the shared plugin section', () => {
    assert.match(HTML, /<section id="plugin-section" class="app-section is-hidden">/);
    assert.match(HTML, /id="plugin-root"/);
});

test('a page with a tab adds a navbar link to #p/<id> before the admin links', async () => {
    const harness = await openApp();
    mount(harness, (ui) => ui.addPage(recordingPage([])));
    const tab = harness.element('nav-p-test');
    assert.ok(tab, 'no tab element');
    assert.match(tab.innerHTML, /href="#p\/test"/);
    assert.match(tab.innerHTML, /data-section="p-test-section"/);
    assert.match(tab.innerHTML, /<i class="bi bi-star me-1"><\/i>Test/);
});

test('the tab label is escaped and the icon must be a Bootstrap icon', async () => {
    const harness = await openApp();
    mount(harness, (ui) => ui.addPage(recordingPage([], { tab: { label: '<b>x</b>', icon: 'bi-star' } })));
    assert.match(harness.element('nav-p-test').innerHTML, /&lt;b&gt;x&lt;\/b&gt;/);

    const other = await openApp();
    let error = null;
    mount(other, (ui) => {
        try { ui.addPage(recordingPage([], { tab: { label: 'X', icon: 'star" onclick="x' } })); } catch (err) { error = err; }
    });
    assert.ok(error, 'a bad icon is refused');
    assert.equal(other.element('nav-p-test'), null);
});

test('routing #p/test/abc renders the page with the parameter', async () => {
    const harness = await openApp();
    const calls = [];
    mount(harness, (ui) => ui.addPage(recordingPage(calls)));
    await go(harness, 'p/test/abc');
    assert.deepEqual(calls, ['abc']);
    assert.equal(harness.element('plugin-section').style.display, 'block');
    await go(harness, 'p/test/a/b');
    assert.deepEqual(calls, ['abc', 'a/b']);
    await go(harness, 'p/test');
    assert.deepEqual(calls, ['abc', 'a/b', '']);
});

test('an unknown plugin page and an admin page for a member lead to #events', async () => {
    const harness = await openApp({}, MEMBER);
    await go(harness, 'p/nope');
    assert.equal(harness.location.hash, '#events');

    const calls = [];
    mount(harness, (ui) => ui.addPage(recordingPage(calls, { access: 'admin' })));
    // An admin tab is not shown to a member at all
    assert.equal(harness.element('nav-p-test'), null);
    await go(harness, 'p/test');
    assert.equal(harness.location.hash, '#events');
    assert.deepEqual(calls, []);
});

test('a page that throws while rendering shows an empty state', async () => {
    const harness = await openApp();
    let shownIn = null;
    mount(harness, (ui) => ui.addPage(recordingPage([], { render: (container) => { shownIn = container; throw new Error('kaputt'); } })));
    const errors = [];
    const original = console.error;
    console.error = (...args) => errors.push(args.join(' '));
    try {
        await go(harness, 'p/test');
    } finally {
        console.error = original;
    }
    assert.ok(errors.some(line => line.includes('kaputt')));
    assert.match(shownIn.innerHTML, /class="empty-state"/);
    assert.match(shownIn.innerHTML, /Plugin-Seite konnte nicht geladen werden/);
    assert.match(shownIn.innerHTML, /bi-exclamation-triangle/);
});

test('leave() runs when another route is shown', async () => {
    const harness = await openApp({ '/api/events': [] });
    let left = 0;
    mount(harness, (ui) => ui.addPage(recordingPage([], { leave: () => { left++; } })));
    await go(harness, 'p/test');
    await go(harness, 'p/test/x');
    assert.equal(left, 0);
    await go(harness, 'info');
    assert.equal(left, 1);
});

test('leave() also runs when the page of another plugin is shown', async () => {
    const harness = await openApp();
    let left = 0;
    mount(harness, (ui) => ui.addPage(recordingPage([], { leave: () => { left++; } })));
    const calls = [];
    mount(harness, (ui) => ui.addPage(recordingPage(calls, { tab: undefined })), { ...ENTRY, id: 'other', name: 'Other' });
    await go(harness, 'p/test');
    await go(harness, 'p/other/1');
    assert.equal(left, 1);
    assert.deepEqual(calls, ['1']);
});

test('a second page of the same plugin is refused', async () => {
    const harness = await openApp();
    let error = null;
    mount(harness, (ui) => {
        ui.addPage(recordingPage([]));
        try { ui.addPage(recordingPage([])); } catch (err) { error = err; }
    });
    assert.ok(error);
});

test('ui.actions.register makes p:<id>:<name> run, bad and repeated names throw', async () => {
    const harness = await openApp();
    let ran = 0;
    const ui = mount(harness, (ui) => ui.actions.register({ go: () => { ran++; } }));
    assert.ok(harness.app.actionNames().includes('p:test:go'));
    await harness.app.runAction('p:test:go', {});
    assert.equal(ran, 1);
    assert.throws(() => ui.actions.register({ go: () => {} }));
    assert.throws(() => ui.actions.register({ 'a:b': () => {} }));
    assert.throws(() => ui.actions.register({ x: 'keine Funktion' }));
});

test('ui.api sends JSON with the CSRF token below /api/plugins/<id>', async () => {
    const harness = await openApp({ '/api/plugins/test/x': (options) => ({ echo: JSON.parse(options.body) }) });
    const ui = mount(harness, () => {});
    const answer = await ui.api.post('/x', { a: 1 });
    assert.deepEqual(answer, { echo: { a: 1 } });
    const request = harness.requests.find(entry => entry.url === '/api/plugins/test/x');
    assert.equal(request.method, 'POST');
    assert.equal(request.headers['X-CSRF-TOKEN'], 'test-token');
    assert.equal(request.headers['Content-Type'], 'application/json');
});

test('ui.api rejects with the German error of the answer', async () => {
    const harness = await openApp({
        '/api/plugins/test/x': httpAnswer(400, { error: 'Titel fehlt.' }),
        '/api/plugins/test/y': httpAnswer(500, {})
    });
    const ui = mount(harness, () => {});
    await assert.rejects(ui.api.put('/x', {}), { message: 'Titel fehlt.' });
    await assert.rejects(ui.api.delete('/y'), { message: 'Unbekannter Fehler.' });
});

test('ui.api refuses paths that could leave the plugin', async () => {
    const harness = await openApp();
    const ui = mount(harness, () => {});
    for (const bad of ['x', '/../admin', '//evil', '/a/%2e%2e/b', '/a\\b', 42]) {
        assert.throws(() => ui.api.get(bad), undefined, String(bad));
    }
    assert.equal(harness.requests.filter(entry => entry.url.startsWith('/api/plugins')).length, 0);
});

test('ui gives plain frozen copies of the plugin and the user and exactly the eleven helpers', async () => {
    const harness = await openApp();
    const ui = mount(harness, () => {});
    assert.deepEqual({ ...ui.plugin }, { id: 'test', name: 'Test', version: '1.0.0', official: true });
    assert.deepEqual({ ...ui.user }, { id: 'u-admin', name: 'Mori', avatar: '', isAdmin: true });
    assert.deepEqual(Object.keys(ui.helpers).sort(), [
        'applyStyleData', 'avatar', 'emptyState', 'escapeHtml', 'markdownPreview', 'relativeDay',
        'renderMarkdownSafe', 'showConfirmDialog', 'showElement', 'showToast', 'toggleElement'
    ]);
    for (const value of [ui, ui.helpers, ui.user, ui.plugin]) assert.ok(Object.isFrozen(value));
    ui.user.isAdmin = false;
    assert.equal(ui.user.isAdmin, true);
});

test('ui.navigate goes to the page of the plugin', async () => {
    const harness = await openApp();
    const ui = mount(harness, () => {});
    ui.navigate('abc');
    assert.equal(harness.location.hash, '#p/test/abc');
    ui.navigate();
    assert.equal(harness.location.hash, '#p/test');
});

test('ui.openEventEditor is refused for members and without events:draft', async () => {
    const member = await openApp({}, MEMBER);
    const memberUi = mount(member, () => {});
    assert.throws(() => memberUi.openEventEditor({ prefill: { title: 'X' }, ref: 'r1' }));
    assert.notEqual(member.location.hash, '#event-editor/new');

    const admin = await openApp();
    const noDraft = mount(admin, () => {}, { ...ENTRY, permissions: [] });
    assert.throws(() => noDraft.openEventEditor({ prefill: { title: 'X' }, ref: 'r1' }));
});

test('ui.openEventEditor opens a fresh editor whose new event carries the plugin origin', async () => {
    const harness = await openApp({ '/api/admin/events': { id: 'neu' } });
    const ui = mount(harness, () => {});
    await ui.openEventEditor({ prefill: { title: 'Idee', pluginOrigin: { plugin: 'fremd', ref: 'x' }, fromPoll: { pollId: 'p1', optionId: 'o1' } }, ref: 'r1' });
    assert.equal(harness.location.hash, '#event-editor/new');
    assert.equal(harness.element('event-title').value, 'Idee');
    harness.element('event-status').value = 'draft';
    await harness.app.saveEvent();
    const create = harness.requests.find(entry => entry.method === 'POST' && entry.url === '/api/admin/events');
    assert.deepEqual(JSON.parse(create.body).pluginOrigin, { plugin: 'test', ref: 'r1' });
    // A plugin cannot decide a poll
    assert.ok(!('fromPoll' in JSON.parse(create.body)));
    assert.equal(harness.state.pendingPluginOrigin, null);
});

test('an event started without a plugin sends no pluginOrigin, never null', async () => {
    const harness = await openApp({ '/api/admin/events': { id: 'neu' } });
    const ui = mount(harness, () => {});
    await ui.openEventEditor({ prefill: { title: 'Idee' }, ref: 'r1' });
    // Leaving and starting a new event drops the origin
    await go(harness, 'admin');
    await harness.app.handleRoute();
    await harness.app.runAction('showCreateEvent', {});
    harness.element('event-title').value = 'Raidnacht';
    harness.element('event-status').value = 'draft';
    await harness.app.saveEvent();
    const create = harness.requests.find(entry => entry.method === 'POST' && entry.url === '/api/admin/events');
    assert.ok(!('pluginOrigin' in JSON.parse(create.body)), create.body);
});

test('loadPlugins mounts every client once, adds its stylesheet and survives a broken one', async () => {
    const entries = [
        { ...ENTRY, id: 'kaputt', name: 'Kaputt', client: '/plugins/kaputt/client.js?v=1' },
        { ...ENTRY, css: '/plugins/test/client.css?v=1.0.0' }
    ];
    const harness = await openApp({ '/api/plugins': entries });
    const imported = [];
    const modules = {
        '/plugins/kaputt/client.js?v=1': { register: () => { throw new Error('register kaputt'); } },
        '/plugins/test/client.js?v=1.0.0': { register: (ui) => ui.addPage(recordingPage([])) }
    };
    const original = console.error;
    console.error = () => {};
    try {
        await harness.app.loadPlugins({ importModule: async (url) => { imported.push(url); return modules[url]; } });
        await harness.app.loadPlugins({ importModule: async (url) => { imported.push(url); return modules[url]; } });
    } finally {
        console.error = original;
    }
    assert.deepEqual(imported.sort(), Object.keys(modules).sort());
    assert.equal(harness.requests.filter(entry => entry.url === '/api/plugins').length, 1);
    assert.ok(harness.element('nav-p-test'), 'the working plugin has its tab');
    assert.ok(harness.toasts.includes('Plugin „Kaputt“ konnte nicht geladen werden.'), harness.toasts.join(' | '));
    // The app keeps working
    await go(harness, 'p/test');
    assert.equal(harness.element('plugin-section').style.display, 'block');
});

test('a broken plugin is only reported to admins', async () => {
    const entries = [{ ...ENTRY, id: 'kaputt', name: 'Kaputt', client: '/plugins/kaputt/client.js?v=1' }];
    const harness = await openApp({ '/api/plugins': entries }, MEMBER);
    const original = console.error;
    console.error = () => {};
    try {
        await harness.app.loadPlugins({ importModule: async () => ({ register: () => { throw new Error('x'); } }) });
    } finally {
        console.error = original;
    }
    assert.deepEqual(harness.toasts, []);
});

test('a client outside its own plugin folder is not imported', async () => {
    const entries = [{ ...ENTRY, client: '/js/main.js' }];
    const harness = await openApp({ '/api/plugins': entries });
    const imported = [];
    const original = console.error;
    console.error = () => {};
    try {
        await harness.app.loadPlugins({ importModule: async (url) => { imported.push(url); return {}; } });
    } finally {
        console.error = original;
    }
    assert.deepEqual(imported, []);
    assert.ok(harness.toasts.includes('Plugin „Test“ konnte nicht geladen werden.'));
});

test('a deep link waits for the plugins that are still loading', async () => {
    let release;
    const answer = new Promise(resolve => { release = resolve; });
    const harness = await openApp({ '/api/plugins': () => answer });
    const calls = [];
    const loading = harness.app.loadPlugins({ importModule: async () => ({ register: (ui) => ui.addPage(recordingPage(calls)) }) });
    harness.location.hash = '#p/test/abc';
    const shown = harness.app.handleRoute();
    release([ENTRY]);
    await loading;
    await shown;
    assert.deepEqual(calls, ['abc']);
    assert.equal(harness.location.hash, '#p/test/abc');
});

test('setTabBadge shows a count and 0 hides it', async () => {
    const harness = await openApp();
    const ui = mount(harness, (ui) => ui.addPage(recordingPage([])));
    const badge = harness.element('nav-p-test-badge');
    assert.ok(isHidden(badge));
    ui.setTabBadge(3);
    assert.equal(badge.textContent, '3');
    assert.ok(!isHidden(badge));
    ui.setTabBadge(0);
    assert.ok(isHidden(badge));
});

test('the logout removes the plugin tabs', async () => {
    const harness = await openApp();
    mount(harness, (ui) => ui.addPage(recordingPage([])));
    assert.ok(harness.element('nav-p-test'));
    harness.app.showLoggedOut();
    assert.equal(harness.element('nav-p-test'), null);
});

const POLICY = { markdown: '# Datenschutz', version: 3, updatedAt: '2026-11-09T10:00:00.000Z' };
const flush = async () => {
    for (let i = 0; i < 3; i++) await new Promise(resolve => setImmediate(resolve));
};
const pluginListCalls = (harness) => harness.requests.filter(entry => entry.url === '/api/plugins').length;

test('the boot loads the plugins after the login when no consent is pending', async () => {
    const harness = await loadFrontendApp({ '/api/csrf-token': { token: 't' }, '/auth/me': { ...MEMBER }, '/api/plugins': [] });
    await harness.app.finishLoading();
    await flush();
    assert.equal(pluginListCalls(harness), 1);
});

test('with a pending privacy consent the plugins load only once it is accepted', async () => {
    const harness = await loadFrontendApp({
        '/api/csrf-token': { token: 't' },
        '/auth/me': { ...MEMBER, privacyRequired: true, privacyVersion: 3 },
        '/api/privacy': POLICY,
        '/api/user/privacy/accept': { success: true, version: 3 },
        // Behind the privacy gate, like the server
        '/api/plugins': () => (harness.state.currentUser.privacyRequired
            ? httpAnswer(403, { error: 'Bitte akzeptiere zuerst die Datenschutzerklärung.', privacyRequired: true })
            : [ENTRY])
    });
    const booting = harness.app.finishLoading();
    await flush();
    assert.equal(pluginListCalls(harness), 0, 'no plugin request before the consent');
    await harness.app.runAction('acceptPrivacy', {});
    await booting;
    await flush();
    assert.equal(pluginListCalls(harness), 1);
});

test('a failed plugin list is asked again by the next loadPlugins', async () => {
    let calls = 0;
    const harness = await openApp({ '/api/plugins': () => (++calls === 1 ? httpAnswer(500, { error: 'x' }) : [ENTRY]) });
    const importModule = async () => ({ register: (ui) => ui.addPage(recordingPage([])) });
    await harness.app.loadPlugins({ importModule });
    assert.equal(harness.element('nav-p-test'), null);
    await harness.app.loadPlugins({ importModule });
    assert.equal(calls, 2);
    assert.ok(harness.element('nav-p-test'));
    // Loaded once: no third request
    await harness.app.loadPlugins({ importModule });
    assert.equal(calls, 2);
});

test('a broken plugin after a slow one is no unhandled rejection', async () => {
    const entries = [ENTRY, { ...ENTRY, id: 'fremd', name: 'Fremd', client: '/js/main.js' }];
    const harness = await openApp({ '/api/plugins': entries });
    const unhandled = [];
    const onUnhandled = (reason) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    const original = console.error;
    console.error = () => {};
    try {
        await harness.app.loadPlugins({
            importModule: async () => {
                // The first import is still pending while the second one fails
                await flush();
                return { register: (ui) => ui.addPage(recordingPage([])) };
            }
        });
        await flush();
    } finally {
        console.error = original;
        process.off('unhandledRejection', onUnhandled);
    }
    assert.deepEqual(unhandled, []);
    assert.ok(harness.element('nav-p-test'));
    assert.ok(harness.toasts.includes('Plugin „Fremd“ konnte nicht geladen werden.'));
});
