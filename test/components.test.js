const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadFrontendApp, loadFrontendModules, REPO_ROOT } = require('./helpers');

const CORE_DIR = path.join(REPO_ROOT, 'public', 'js', 'core');
const INDEX_HTML = fs.readFileSync(path.join(REPO_ROOT, 'public', 'index.html'), 'utf8');

/**
 * Load core/ui.js with a document that only knows `elements` (id -> element double).
 *
 * @param {Object<string, Object>} elements -> Elements reachable through getElementById.
 * @returns {Promise<{ ui: Object, shown: Object[] }>} -> Module exports and the toast elements Bootstrap was asked to show.
 */
async function loadUi(elements = {}) {
    const shown = [];
    const context = vm.createContext({
        document: { getElementById: (id) => elements[id] || null },
        gsap: { fromTo() {}, to() {} },
        bootstrap: {
            Toast: class {
                constructor(element) { this.element = element; }
                show() { shown.push(this.element); }
            }
        }
    });
    const ui = (await loadFrontendModules(path.join(CORE_DIR, 'ui.js'), context)).get('ui.js');
    return { ui, shown };
}

const toastElements = () => ({ 'app-toast': { className: '' }, 'toast-icon': { className: '' }, 'toast-message': { textContent: '' } });

test('a toast carries its type as class and icon', async () => {
    const icons = { success: 'bi-check-circle-fill', danger: 'bi-x-circle-fill', warning: 'bi-exclamation-triangle-fill', info: 'bi-info-circle-fill' };
    for (const [type, icon] of Object.entries(icons)) {
        const elements = toastElements();
        const { ui, shown } = await loadUi(elements);
        ui.showToast('Gespeichert', type);
        assert.equal(elements['app-toast'].className, `toast toast-${type}`);
        assert.equal(elements['toast-icon'].className, `toast-icon bi ${icon} ms-3`);
        assert.equal(elements['toast-message'].textContent, 'Gespeichert');
        assert.equal(shown.length, 1);
    }
});

test('an unknown type shows an info toast', async () => {
    for (const type of ['error', undefined, '', 'constructor', 'toString']) {
        const elements = toastElements();
        const { ui, shown } = await loadUi(elements);
        ui.showToast('Hinweis', type);
        assert.equal(elements['app-toast'].className, 'toast toast-info', String(type));
        assert.equal(elements['toast-icon'].className, 'toast-icon bi bi-info-circle-fill ms-3', String(type));
        assert.equal(shown.length, 1);
    }
});

test('a cached page without the icon element still shows the toast', async () => {
    const elements = toastElements();
    delete elements['toast-icon'];
    const { ui, shown } = await loadUi(elements);
    ui.showToast('Hinweis', 'warning');
    assert.equal(elements['app-toast'].className, 'toast toast-warning');
    assert.equal(shown.length, 1);
});

test('index.html carries the toast icon element', () => {
    assert.match(INDEX_HTML, /<i id="toast-icon" class="toast-icon bi bi-info-circle-fill ms-3"><\/i>/);
    assert.match(INDEX_HTML, /<div id="app-toast" class="toast toast-info" role="alert">/);
});

const loadComponents = async () => (await loadFrontendModules(path.join(CORE_DIR, 'components.js'), vm.createContext({}))).get('components.js');

test('initials come from the first two words', async () => {
    const { initialsOf } = await loadComponents();
    assert.equal(initialsOf('Lyonel Berzen'), 'LB');
    assert.equal(initialsOf('moritz'), 'M');
    assert.equal(initialsOf('  anna   maria  schmidt '), 'AM');
    assert.equal(initialsOf('élan vital'), 'ÉV');
    assert.equal(initialsOf('🦊 Fuchs'), '🦊F');
    for (const empty of ['', '   ', undefined, null]) assert.equal(initialsOf(empty), '?');
});

test('an avatar is an image with an initials fallback, or an initials tile', async () => {
    const { avatar } = await loadComponents();
    assert.equal(
        avatar({ url: 'https://cdn.example/a.png', name: 'Lyonel Berzen', size: 'lg' }),
        '<img class="avatar avatar-lg" src="https://cdn.example/a.png" alt="Lyonel Berzen" title="Lyonel Berzen" data-fallback="initials" data-initials="LB">'
    );
    assert.equal(avatar({ name: 'Lyonel Berzen' }), '<span class="avatar avatar-initials" title="Lyonel Berzen">LB</span>');
    assert.equal(avatar({ url: '   ', name: 'Mo', size: 'sm' }), '<span class="avatar avatar-sm avatar-initials" title="Mo">M</span>');
    // An unknown size is ignored, missing arguments give the placeholder tile
    assert.equal(avatar({ name: 'A', size: 'huge' }), '<span class="avatar avatar-initials" title="A">A</span>');
    assert.equal(avatar(), '<span class="avatar avatar-initials" title="">?</span>');
});

test('a display name cannot break out of the avatar markup', async () => {
    const { avatar } = await loadComponents();
    for (const name of ['"><script>alert(1)</script>', 'x" onerror="alert(1)', "y' onload='alert(1)", '<img src=x>']) {
        for (const html of [avatar({ name }), avatar({ url: 'https://cdn.example/a.png', name })]) {
            assert.doesNotMatch(html, /<script|<img src=x|" onerror="|' onload='/, name);
            // Exactly one element: the only "<" opens it (the tile also closes with "</span>")
            assert.equal(html.match(/</g).length, html.startsWith('<span') ? 2 : 1, html);
        }
    }
    assert.match(avatar({ url: 'https://cdn.example/a.png?x="><b>', name: 'A' }), /src="https:\/\/cdn\.example\/a\.png\?x=&quot;&gt;&lt;b&gt;"/);
});

test('an empty state shows icon, title, optional text and optional action', async () => {
    const { emptyState } = await loadComponents();
    const button = '<button type="button" class="btn btn-secondary btn-sm" data-click="hide" data-target="x">Aktualisieren</button>';
    assert.equal(
        emptyState({ icon: 'calendar-x', title: 'Noch keine Events', text: 'Sobald ein Event geplant ist, erscheint es hier.', action: button }),
        '<div class="empty-state"><div class="empty-state-icon"><i class="bi bi-calendar-x"></i></div><h3 class="empty-state-title">Noch keine Events</h3><p class="empty-state-text">Sobald ein Event geplant ist, erscheint es hier.</p>' + button + '</div>'
    );
    assert.equal(emptyState({ title: 'Leer' }), '<div class="empty-state"><div class="empty-state-icon"><i class="bi bi-inbox"></i></div><h3 class="empty-state-title">Leer</h3></div>');
});

test('an empty state escapes its texts and ignores an odd icon name', async () => {
    const { emptyState } = await loadComponents();
    const html = emptyState({ icon: 'x"><script>', title: '<b>Titel</b>', text: 'A & B <i>' });
    assert.match(html, /<i class="bi bi-inbox"><\/i>/);
    assert.match(html, /&lt;b&gt;Titel&lt;\/b&gt;/);
    assert.match(html, /A &amp; B &lt;i&gt;/);
    assert.doesNotMatch(html, /<script|<b>/);
    assert.equal(emptyState({ title: undefined }), '<div class="empty-state"><div class="empty-state-icon"><i class="bi bi-inbox"></i></div><h3 class="empty-state-title"></h3></div>');
});

test('the confirm dialog shows a red button unless told otherwise', async () => {
    const { app, dialogs } = await loadFrontendApp({});
    assert.equal(await app.showConfirmDialog('Eintragen?', 'Eintragen', { danger: false }), true);
    assert.equal(await app.showConfirmDialog('Löschen?', 'Löschen'), true);
    assert.deepEqual(dialogs, [
        { text: 'Eintragen?', label: 'Eintragen', danger: false },
        { text: 'Löschen?', label: 'Löschen', danger: true }
    ]);
});

test('a dismissed confirm dialog answers no', async () => {
    const { app, dialogs } = await loadFrontendApp({}, { confirm: false });
    assert.equal(await app.showConfirmDialog('Löschen?', 'Löschen'), false);
    assert.equal(dialogs.length, 1);
});

test('a confirm click that Bootstrap ignores does not turn a later dismissal into a yes', async () => {
    // Bootstrap ignores hide() while the dialog fades in: the click is lost, the dialog stays open
    const { app, dialogs } = await loadFrontendApp({}, { confirm: 'too-early' });
    assert.equal(await app.showConfirmDialog('Löschen?', 'Löschen'), false);
    assert.equal(dialogs.length, 1);
});
