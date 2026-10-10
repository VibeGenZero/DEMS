const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadFrontendModules, REPO_ROOT } = require('./helpers');

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

test('skeleton cards use component classes, no style attributes', async () => {
    const { ui } = await loadUi();
    const container = { innerHTML: '' };
    ui.renderSkeletonEvents(container, 2);
    assert.equal(container.innerHTML.match(/skeleton-img/g).length, 2);
    assert.equal(container.innerHTML.match(/skeleton-chip/g).length, 4);
    assert.match(container.innerHTML, /class="skeleton skeleton-text is-short"/);
    assert.doesNotMatch(container.innerHTML, /style=/);
});
