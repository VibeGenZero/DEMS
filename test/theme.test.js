const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadFrontendApp, REPO_ROOT } = require('./helpers');

const BOOT_SCRIPT = fs.readFileSync(path.join(REPO_ROOT, 'public', 'theme-boot.js'), 'utf8');
const INDEX_HTML = fs.readFileSync(path.join(REPO_ROOT, 'public', 'index.html'), 'utf8');
const RECENT_BOOT = { dems_boot_ts: String(Date.now()) };

const scheme = (root) => root.getAttribute('data-bs-theme');

test('normalizeThemeChoice keeps the three choices and turns anything else into system', async () => {
    const { app } = await loadFrontendApp({});
    for (const choice of ['light', 'dark', 'system']) assert.equal(app.normalizeThemeChoice(choice), choice);
    for (const value of ['blue', '', 'LIGHT', null, undefined, 1]) assert.equal(app.normalizeThemeChoice(value), 'system', String(value));
});

test('resolveTheme follows the choice and the system only for system', async () => {
    const { app } = await loadFrontendApp({});
    assert.equal(app.resolveTheme('light', false), 'light');
    assert.equal(app.resolveTheme('light', true), 'light');
    assert.equal(app.resolveTheme('dark', false), 'dark');
    assert.equal(app.resolveTheme('dark', true), 'dark');
    assert.equal(app.resolveTheme('system', false), 'dark');
    assert.equal(app.resolveTheme('system', true), 'light');
});

test('theme falls back to system when storage throws', async () => {
    const { app, root } = await loadFrontendApp({}, { storage: 'throws', prefersLight: true });
    assert.equal(app.readThemeChoice(), 'system');
    app.initTheme();
    assert.equal(scheme(root), 'light');
    assert.doesNotThrow(() => app.setThemeChoice('dark'));
    assert.equal(scheme(root), 'dark');
});

test('initTheme applies the stored choice and disables the dark date picker in light', async () => {
    const light = await loadFrontendApp({}, { storage: { dems_theme: 'light' } });
    light.app.initTheme();
    assert.equal(scheme(light.root), 'light');
    assert.equal(light.element('flatpickr-dark-css').disabled, true);

    const dark = await loadFrontendApp({}, { storage: { dems_theme: 'dark' }, prefersLight: true });
    dark.app.initTheme();
    assert.equal(scheme(dark.root), 'dark');
    assert.equal(dark.element('flatpickr-dark-css').disabled, false);
});

test('the startup applies the stored scheme', async () => {
    const { root, fire } = await loadFrontendApp({}, { storage: { ...RECENT_BOOT, dems_theme: 'light' } });
    fire('DOMContentLoaded');
    assert.equal(scheme(root), 'light');
});

test('system follows a live change', async () => {
    const { app, root, setSystemLight } = await loadFrontendApp({});
    app.initTheme();
    assert.equal(scheme(root), 'dark');
    setSystemLight(true);
    assert.equal(scheme(root), 'light');
    setSystemLight(false);
    assert.equal(scheme(root), 'dark');
});

test('an explicit choice ignores a system change', async () => {
    const { app, root, setSystemLight } = await loadFrontendApp({}, { storage: { dems_theme: 'dark' } });
    app.initTheme();
    setSystemLight(true);
    assert.equal(scheme(root), 'dark');
});

test('a choice is stored and applied at once', async () => {
    const { app, root } = await loadFrontendApp({});
    app.initTheme();
    app.setThemeChoice('light');
    assert.equal(scheme(root), 'light');
    assert.equal(app.readThemeChoice(), 'light');
    app.setThemeChoice('nonsense');
    assert.equal(app.readThemeChoice(), 'system');
});

test('applying a scheme marks the switch and clears it on the next frames', async () => {
    const waiting = await loadFrontendApp({});
    waiting.app.applyTheme('light');
    assert.equal(waiting.root.classList.contains('is-theme-switching'), true);

    const done = await loadFrontendApp({}, { animationFrames: true });
    done.app.applyTheme('light');
    assert.equal(done.root.classList.contains('is-theme-switching'), false);
    assert.equal(scheme(done.root), 'light');
});

test('onThemeChange listeners hear every applied scheme', async () => {
    const { app } = await loadFrontendApp({});
    const heard = [];
    app.onThemeChange(value => heard.push(value));
    app.applyTheme('light');
    app.applyTheme('dark');
    assert.deepEqual(heard, ['light', 'dark']);
});

/**
 * Run public/theme-boot.js like the browser does before the first paint.
 *
 * @param {string|null|'throws'} stored -> Value of localStorage.dems_theme; 'throws' blocks the storage.
 * @param {boolean} prefersLight -> Answer of prefers-color-scheme: light.
 * @returns {string|null} -> data-bs-theme the script set on <html>.
 */
function runBootScript(stored, prefersLight) {
    const attributes = new Map();
    const context = vm.createContext({
        localStorage: {
            getItem: (key) => {
                if (stored === 'throws') throw new Error('SecurityError');
                return key === 'dems_theme' ? stored : null;
            }
        },
        matchMedia: (query) => ({ matches: /prefers-color-scheme:\s*light/.test(query) ? prefersLight : !prefersLight }),
        document: { documentElement: { setAttribute: (name, value) => attributes.set(name, value) } }
    });
    context.window = context;
    vm.runInContext(BOOT_SCRIPT, context);
    return attributes.get('data-bs-theme') ?? null;
}

test('boot script and module resolve the same scheme', async () => {
    const { app } = await loadFrontendApp({});
    for (const stored of ['light', 'dark', 'system', 'blue', null, 'throws']) {
        for (const prefersLight of [true, false]) {
            const expected = app.resolveTheme(app.normalizeThemeChoice(stored === 'throws' ? null : stored), prefersLight);
            assert.equal(runBootScript(stored, prefersLight), expected, `${stored} / light system: ${prefersLight}`);
        }
    }
});

test('index.html loads the boot script before the first stylesheet', () => {
    const head = INDEX_HTML.slice(0, INDEX_HTML.indexOf('</head>'));
    const script = head.indexOf('<script src="/theme-boot.js"></script>');
    const firstStylesheet = head.search(/<link[^>]+\.css/);
    assert.ok(script !== -1, 'the boot script is not in <head>');
    assert.ok(script < firstStylesheet, 'the boot script comes after a stylesheet');
    assert.match(INDEX_HTML, /<link[^>]*id="flatpickr-dark-css"[^>]*href="\/vendor\/flatpickr\/dark\.css"|<link[^>]*href="\/vendor\/flatpickr\/dark\.css"[^>]*id="flatpickr-dark-css"/);
});

const MEMBER = { id: 'u-member', username: 'tom', displayName: 'Tom', avatar: '', roles: [], isAdmin: false };
// The settings card of the profile, up to the debug card that follows it
const SETTINGS_CARD = INDEX_HTML.slice(INDEX_HTML.indexOf('id="account-settings-card"'), INDEX_HTML.indexOf('<!-- Debug Card'));
const THEME_RADIOS = [...SETTINGS_CARD.matchAll(/<input[^>]*name="theme-choice"[^>]*>/g)].map(match => match[0]);

test('the profile offers light, dark and system as one radio group', () => {
    assert.equal(SETTINGS_CARD.match(/role="radiogroup"/g)?.length, 1);
    assert.equal(THEME_RADIOS.length, 3);
    THEME_RADIOS.forEach((radio, index) => {
        const value = ['light', 'dark', 'system'][index];
        assert.match(radio, /type="radio"/);
        assert.match(radio, new RegExp(`value="${value}"`));
        assert.match(radio, new RegExp(`id="theme-choice-${value}"`));
        assert.match(radio, /data-change="setThemeChoice"/);
    });
    for (const text of ['Darstellung', 'Gilt nur in diesem Browser.', '>Hell<', '>Dunkel<', '>System<']) assert.ok(SETTINGS_CARD.includes(text), text);
    assert.ok(SETTINGS_CARD.indexOf('Darstellung') < SETTINGS_CARD.indexOf('accept-invitations-toggle'), 'Darstellung is not the first row');
});

test('each preview tile carries its own scheme', () => {
    const previews = [...SETTINGS_CARD.matchAll(/<label class="theme-choice-option"[\s\S]*?<\/label>/g)].map(match => match[0]);
    assert.equal(previews.length, 3);
    assert.match(previews[0], /class="theme-choice-preview"[^>]*data-bs-theme="light"/);
    assert.match(previews[1], /class="theme-choice-preview"[^>]*data-bs-theme="dark"/);
    assert.match(previews[2], /class="theme-choice-half"[^>]*data-bs-theme="light"[\s\S]*class="theme-choice-half"[^>]*data-bs-theme="dark"/);
});

test('opening the profile marks the stored choice', async () => {
    const { app, state, element } = await loadFrontendApp({ '/api/user/profile': {} }, { storage: { dems_theme: 'dark' } });
    state.currentUser = MEMBER;
    await app.showProfileSection();
    assert.equal(element('theme-choice-dark').checked, true);
    assert.equal(element('theme-choice-light').checked, false);
    assert.equal(element('theme-choice-system').checked, false);
});
