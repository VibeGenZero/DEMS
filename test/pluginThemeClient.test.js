const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadFrontendApp, isHidden } = require('./helpers');

const ADMIN = { id: 'u-admin', username: 'mori', displayName: 'Mori', avatar: '', roles: [], isAdmin: true };
const MEMBER = { id: 'u-member', username: 'mia', displayName: 'Mia', avatar: '', roles: [], isAdmin: false };

const THEME_ENTRY = {
    id: 'custom-design',
    name: 'Design anpassen',
    version: '1.0.0',
    official: true,
    permissions: ['theme'],
    client: '/plugins/custom-design/client.js?v=1.0.0',
    css: ''
};

async function openApp(routes = {}, user = ADMIN, { passwordAnswer = 'dev' } = {}) {
    const harness = await loadFrontendApp(routes);
    harness.state.currentUser = user;
    harness.state.csrfToken = 'test-token';

    const origGetOrCreate = harness.window.bootstrap.Modal.getOrCreateInstance;
    harness.window.bootstrap.Modal.getOrCreateInstance = (element) => {
        if (element !== harness.element('passwordModal')) {
            return origGetOrCreate.call(harness.window.bootstrap.Modal, element);
        }
        const close = () => {
            element.dispatch('hide.bs.modal');
            element.dispatch('hidden.bs.modal');
        };
        return {
            show() {
                if (passwordAnswer !== null) {
                    harness.element('password-modal-input').value = passwordAnswer;
                    harness.element('password-modal-ok').onclick();
                } else {
                    close();
                }
            },
            hide: close
        };
    };

    return harness;
}

function mount(harness, entry = THEME_ENTRY) {
    let received = null;
    harness.app.mountPluginModule(entry, { register: (ui) => { received = ui; } });
    return received;
}

test('showPreview swaps the theme link, increments v on each call and shows the preview bar; hidePreview restores theme.css', async () => {
    const harness = await openApp();
    const ui = mount(harness);
    const link = harness.element('custom-theme');
    const bar = harness.element('design-preview-bar');

    assert.ok(isHidden(bar));
    ui.theme.showPreview();
    assert.equal(link.href, '/theme-preview.css?v=1');
    assert.equal(isHidden(bar), false);

    ui.theme.showPreview();
    assert.equal(link.href, '/theme-preview.css?v=2');

    ui.theme.hidePreview();
    assert.equal(link.href, '/theme.css');
    assert.ok(isHidden(bar));

    // The preview bar button action ends the preview too
    ui.theme.showPreview();
    assert.equal(isHidden(bar), false);
    await harness.app.runAction('endDesignPreview', {});
    assert.equal(link.href, '/theme.css');
    assert.ok(isHidden(bar));

    ui.theme.reload();
    assert.match(link.href, /^\/theme\.css\?v=\d+$/);
});

test('standard mode keeps theme.css unchanged and reports isStandardMode() === true', async () => {
    const harness = await openApp();
    const ui = mount(harness);
    const link = harness.element('custom-theme');
    link.href = '/theme.css';

    assert.equal(ui.theme.isStandardMode(), false);
    harness.root.setAttribute('data-design', 'standard');
    assert.equal(ui.theme.isStandardMode(), true);

    ui.theme.showPreview();
    assert.equal(link.href, '/theme.css');
    assert.ok(isHidden(harness.element('design-preview-bar')));
});

test('members cannot preview and plugins without the theme permission cannot use ui.theme', async () => {
    const memberHarness = await openApp({}, MEMBER);
    const memberUi = mount(memberHarness);
    assert.throws(() => memberUi.theme.showPreview(), /for admins only/);

    const noPermHarness = await openApp();
    const noPermUi = mount(noPermHarness, { ...THEME_ENTRY, permissions: [] });
    for (const fn of ['showPreview', 'hidePreview', 'reload', 'isStandardMode']) {
        assert.throws(() => noPermUi.theme[fn](), /permission theme/, fn);
    }
});

test('ui.api with password opens the core dialog and sends the typed password without exposing it to the plugin', async () => {
    let sentBody = null;
    const harness = await openApp({
        '/api/plugins/custom-design/publish-css': (options) => {
            sentBody = JSON.parse(options.body);
            return { published: true };
        }
    }, ADMIN, { passwordAnswer: 'secret-reset-pw' });
    const ui = mount(harness);

    const callerBody = { x: 1 };
    const res = await ui.api.post('/publish-css', callerBody, { password: true });
    assert.deepEqual(res, { published: true });
    assert.deepEqual(sentBody, { x: 1, password: 'secret-reset-pw' });
    assert.deepEqual(callerBody, { x: 1 }, 'caller object is not mutated with the password');
    assert.equal(harness.element('password-modal-input').value, '', 'password input is cleared');
    assert.throws(() => ui.api.get('/x', undefined, { password: true }), /mutating method/);
});

test('a cancelled password dialog rejects with Abgebrochen. and sends no request', async () => {
    const harness = await openApp({}, ADMIN, { passwordAnswer: null });
    const ui = mount(harness);
    await assert.rejects(
        ui.api.post('/publish-css', { x: 1 }, { password: true }),
        { message: 'Abgebrochen.' }
    );
    assert.equal(harness.requests.filter(r => r.url.includes('/publish-css')).length, 0);
});

test('logout ends the design preview', async () => {
    const harness = await openApp();
    const ui = mount(harness);
    ui.theme.showPreview();
    assert.equal(isHidden(harness.element('design-preview-bar')), false);

    harness.app.showLoggedOut();
    assert.equal(harness.element('custom-theme').href, '/theme.css');
    assert.ok(isHidden(harness.element('design-preview-bar')));
});
