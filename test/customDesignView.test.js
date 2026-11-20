const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadFrontendApp, loadFrontendModules, REPO_ROOT } = require('./helpers');
const { DEFAULTS, EMPTY_SOURCE } = require('../plugins/custom-design/rules');

const SAVER_PATH = path.join(REPO_ROOT, 'plugins', 'custom-design', 'assets', 'saver.js');
const VIEW_PATH = path.join(REPO_ROOT, 'plugins', 'custom-design', 'assets', 'view.js');
const CLIENT_PATH = path.join(REPO_ROOT, 'plugins', 'custom-design', 'client.js');

const ADMIN = { id: 'u-admin', username: 'mori', displayName: 'Mori', avatar: '', roles: [], isAdmin: true };
const MEMBER = { id: 'u-member', username: 'tom', displayName: 'Tom', avatar: '', roles: [], isAdmin: false };

const ENTRY = {
    id: 'custom-design',
    name: 'Design anpassen',
    version: '1.0.0',
    official: true,
    permissions: ['theme'],
    client: '/plugins/custom-design/client.js?v=1.0.0',
    css: '/plugins/custom-design/client.css?v=1.0.0',
};

async function loadModules() {
    const harness = await loadFrontendApp({});
    const saverMods = await loadFrontendModules(SAVER_PATH, harness.window);
    const viewMods = await loadFrontendModules(VIEW_PATH, harness.window);
    const helpers = harness.app.createPluginUi(ENTRY).helpers;
    return {
        saver: saverMods.get('saver.js'),
        view: viewMods.get('view.js'),
        helpers,
        harness,
    };
}

function makeFakeTimers() {
    let nextId = 1;
    const timers = new Map();
    return {
        setTimer(fn, delay) {
            const id = nextId++;
            timers.set(id, { fn, delay });
            return id;
        },
        clearTimer(id) {
            timers.delete(id);
        },
        runAll() {
            const entries = [...timers.entries()];
            timers.clear();
            for (const [, { fn }] of entries) fn();
        },
        count() {
            return timers.size;
        },
    };
}

function baseModel(overrides = {}) {
    return {
        tab: 'tokens',
        source: structuredClone(EMPTY_SOURCE),
        defaults: DEFAULTS,
        warnings: [],
        draftError: '',
        saveState: 'idle',
        previewOn: false,
        standardMode: false,
        ...overrides,
    };
}

test('createDraftSaver: schedule debounces to one save with the latest source', async () => {
    const { saver } = await loadModules();
    const timers = makeFakeTimers();
    const saved = [];
    const ds = saver.createDraftSaver({
        save: async (src) => {
            saved.push(src);
            return { draft: src };
        },
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer,
    });

    ds.schedule({ a: 1 });
    ds.schedule({ a: 2 });
    assert.equal(ds.pending(), true);
    assert.equal(timers.count(), 1);
    assert.equal(saved.length, 0);

    timers.runAll();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(saved, [{ a: 2 }]);
    assert.equal(ds.pending(), false);
});

test('createDraftSaver: flush saves the latest source at once', async () => {
    const { saver } = await loadModules();
    const timers = makeFakeTimers();
    const saved = [];
    const ds = saver.createDraftSaver({
        save: async (src) => {
            saved.push(src);
            return { draft: src };
        },
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer,
    });

    ds.schedule({ step: 'a' });
    ds.schedule({ step: 'b' });
    const res = await ds.flush();
    assert.deepEqual(saved, [{ step: 'b' }]);
    assert.deepEqual(res, { draft: { step: 'b' } });
    assert.equal(timers.count(), 0);
    assert.equal(ds.pending(), false);
});

test('createDraftSaver: flush waits for a running save, then saves what came after', async () => {
    const { saver } = await loadModules();
    const timers = makeFakeTimers();
    const saved = [];
    let releaseFirst;
    const firstGate = new Promise(resolve => {
        releaseFirst = resolve;
    });

    const ds = saver.createDraftSaver({
        save: async (src) => {
            saved.push(src);
            if (saved.length === 1) await firstGate;
            return { draft: src };
        },
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer,
    });

    ds.schedule({ step: 1 });
    timers.runAll();
    assert.deepEqual(saved, [{ step: 1 }]);

    // Schedule another change while the first save is still in flight
    ds.schedule({ step: 2 });
    const flushPromise = ds.flush();
    releaseFirst();
    const res = await flushPromise;

    assert.deepEqual(saved, [{ step: 1 }, { step: 2 }]);
    assert.deepEqual(res, { draft: { step: 2 } });
    assert.equal(ds.pending(), false);
});

test('createDraftSaver: flush with nothing pending resolves null', async () => {
    const { saver } = await loadModules();
    const ds = saver.createDraftSaver({
        save: async () => ({ ok: true }),
    });
    assert.equal(ds.pending(), false);
    assert.equal(await ds.flush(), null);
});

test('renderDesignPage: both schemes per colour field with the default shown for empty values', async () => {
    const { view, helpers } = await loadModules();
    const source = structuredClone(EMPTY_SOURCE);
    source.tokens.dark.accent = '#123456';
    const html = view.renderDesignPage(baseModel({ source }), helpers);

    // Custom dark accent uses #123456 in both picker and hex field
    assert.match(html, /id="cd-color-dark-accent"[^>]*value="#123456"/);
    assert.match(html, /id="cd-hex-dark-accent"[^>]*value="#123456"/);

    // Empty light accent shows default (#7c3aed) in picker and empty value in hex field
    assert.match(html, /id="cd-color-light-accent"[^>]*value="#7c3aed"/);
    assert.match(html, /id="cd-hex-light-accent"[^>]*value=""/);
});

test('renderDesignPage: warnings are listed as escaped text', async () => {
    const { view, helpers } = await loadModules();
    const html = view.renderDesignPage(
        baseModel({
            warnings: [
                {
                    scheme: 'light',
                    text: '--text-muted',
                    surface: '--bg-card',
                    ratio: 1.9,
                    message: 'Hell: <script>alert(1)</script> hat 1,9 : 1',
                },
            ],
        }),
        helpers
    );
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    assert.match(html, /Hell: &lt;script&gt;alert\(1\)&lt;\/script&gt; hat 1,9 : 1/);
});

test('renderDesignPage: draft error disables publish and standard mode disables preview with info line', async () => {
    const { view, helpers } = await loadModules();
    const withError = view.renderDesignPage(
        baseModel({
            draftError: 'Zeile 1: @import ist nicht erlaubt.',
        }),
        helpers
    );
    assert.match(withError, /id="cd-publish-btn"[^>]*disabled/);
    assert.match(withError, /Zeile 1: @import ist nicht erlaubt\./);

    const inStandard = view.renderDesignPage(
        baseModel({
            standardMode: true,
        }),
        helpers
    );
    assert.match(inStandard, /id="cd-preview-btn"[^>]*disabled/);
    assert.match(inStandard, /Eigenes Design ist in diesem Tab ausgeschaltet\./);
    assert.match(
        inStandard,
        /Notausgang: Mit \?design=standard in der Adresse lädt DEMS ohne eigenes Design\./
    );
});

test('renderDesignPage: values are escaped and every action is a registered p:custom-design: name', async () => {
    const { view, helpers, harness } = await loadModules();
    const source = structuredClone(EMPTY_SOURCE);
    source.css = '</textarea><b>';
    const html = view.renderDesignPage(baseModel({ source }), helpers);

    assert.doesNotMatch(html, /<\/textarea><b>/);
    assert.match(html, /&lt;\/textarea&gt;&lt;b&gt;/);

    const clientMods = await loadFrontendModules(CLIENT_PATH, harness.window);
    harness.state.currentUser = ADMIN;
    harness.app.mountPluginModule(ENTRY, clientMods.get('client.js'));
    const registered = harness.app.actionNames();

    const actionAttrs = [...html.matchAll(/data-(?:click|change|input)="([^"]+)"/g)].map(
        m => m[1]
    );
    assert.equal(actionAttrs.length > 0, true);
    for (const action of actionAttrs) {
        assert.match(action, /^p:custom-design:[A-Za-z][A-Za-z0-9]{0,39}$/);
        assert.equal(registered.includes(action), true, `Action ${action} not registered`);
    }
});

test('client.js registers no page for non-admins and handles preview, publish, discard and reset for admins', async () => {
    // Non-admin gets no page
    const memberHarness = await loadFrontendApp({});
    memberHarness.state.currentUser = MEMBER;
    const memberMods = await loadFrontendModules(CLIENT_PATH, memberHarness.window);
    memberHarness.app.mountPluginModule(ENTRY, memberMods.get('client.js'));
    assert.equal(memberHarness.element('nav-p-custom-design'), null);

    // Admin flow
    let draftDoc = null;
    let publishedDoc = null;
    let publishCssCalls = 0;

    const harness = await loadFrontendApp({
        '/api/plugins/custom-design/': () => ({
            published: publishedDoc,
            draft: draftDoc,
            defaults: DEFAULTS,
            warnings: [],
        }),
        '/api/plugins/custom-design/draft': (options) => {
            if (options.method === 'DELETE') {
                draftDoc = null;
                return { success: true };
            }
            const body = JSON.parse(options.body);
            draftDoc = { ...body, error: '' };
            return { draft: draftDoc, warnings: [] };
        },
        '/api/plugins/custom-design/publish': () => {
            publishedDoc = { ...draftDoc };
            draftDoc = null;
            return { published: publishedDoc };
        },
        '/api/plugins/custom-design/publish-css': () => {
            publishCssCalls += 1;
            publishedDoc = { ...draftDoc };
            draftDoc = null;
            return { published: publishedDoc };
        },
        '/api/plugins/custom-design/reset': () => {
            draftDoc = null;
            publishedDoc = null;
            return { success: true };
        },
    });
    harness.state.currentUser = ADMIN;
    harness.state.csrfToken = 'test-csrf';

    // Auto-confirm password modal and confirm dialog
    const origGetOrCreate = harness.window.bootstrap.Modal.getOrCreateInstance;
    harness.window.bootstrap.Modal.getOrCreateInstance = (element) => {
        if (element === harness.element('passwordModal')) {
            const close = () => {
                element.dispatch('hide.bs.modal');
                element.dispatch('hidden.bs.modal');
            };
            return {
                show() {
                    harness.element('password-modal-input').value = 'dev';
                    harness.element('password-modal-ok').onclick();
                },
                hide: close,
            };
        }
        if (element === harness.element('confirmModal')) {
            const close = () => {
                element.dispatch('hide.bs.modal');
                element.dispatch('hidden.bs.modal');
            };
            return {
                show() {
                    harness.element('confirm-modal-ok').onclick();
                },
                hide: close,
            };
        }
        return origGetOrCreate.call(harness.window.bootstrap.Modal, element);
    };

    const clientMods = await loadFrontendModules(CLIENT_PATH, harness.window);
    harness.app.mountPluginModule(ENTRY, clientMods.get('client.js'));

    harness.location.hash = '#p/custom-design';
    await harness.app.handleRoute();
    assert.match(harness.element('cd-page').innerHTML, /Farben &amp; Formen/);

    // Change corners and preview (flushes draft and enables preview)
    await harness.app.runAction('p:custom-design:setCorners', {
        dataset: { corners: 'round' },
        value: 'round',
    });
    await harness.app.runAction('p:custom-design:preview', {});
    assert.equal(draftDoc.corners, 'round');
    assert.match(harness.element('custom-theme').href, /^\/theme-preview\.css\?v=\d+$/);

    // Publish without CSS change calls /publish
    await harness.app.runAction('p:custom-design:publish', {});
    assert.equal(publishedDoc.corners, 'round');
    assert.equal(publishCssCalls, 0);
    assert.ok(harness.toasts.includes('Design veröffentlicht.'));

    // Edit CSS and publish -> calls /publish-css with password
    await harness.app.runAction('p:custom-design:editCss', { value: '.a {}' });
    await harness.app.runAction('p:custom-design:publish', {});
    assert.equal(publishCssCalls, 1);
    assert.equal(publishedDoc.css, '.a {}');

    // Discard draft
    await harness.app.runAction('p:custom-design:setCorners', {
        dataset: { corners: 'square' },
        value: 'square',
    });
    await harness.app.runAction('p:custom-design:discard', {});
    assert.equal(draftDoc, null);
    assert.ok(harness.toasts.includes('Entwurf verworfen.'));

    // Reset to default
    await harness.app.runAction('p:custom-design:reset', {});
    assert.equal(publishedDoc, null);
    assert.ok(harness.toasts.includes('Design auf Standard zurückgesetzt.'));
});
