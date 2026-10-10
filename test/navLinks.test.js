const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const vm = require('vm');
const { loadFrontendModules, REPO_ROOT } = require('./helpers');

const ROUTER_FILE = path.join(REPO_ROOT, 'public', 'js', 'core', 'router.js');

/**
 * Link double with a class list and a data-section attribute.
 */
function fakeLink(section, classes) {
    const set = new Set(classes);
    return {
        classes: set,
        classList: { add: (name) => set.add(name), remove: (name) => set.delete(name) },
        getAttribute: (name) => (name === 'data-section' ? section : null)
    };
}

// The tabs component (.nav.nav-pills) uses .nav-link too; a route change must
// only touch the links of the navbar
test('a route change marks the navbar link of the page and leaves tab links alone', async () => {
    const eventsLink = fakeLink('events-section', []);
    const profileLink = fakeLink('profile-section', ['active']);
    const tabLink = fakeLink(null, ['active']);
    const noop = () => {};
    const storage = { getItem: () => null, setItem: noop, removeItem: noop };
    const document = {
        getElementById: () => ({ style: {} }),
        addEventListener: noop,
        querySelector: () => null,
        // Answers like a page with a navbar and one tab outside of it
        querySelectorAll: (selector) => {
            if (selector === '#main-navbar .nav-link') return [eventsLink, profileLink];
            if (selector === '.nav-link') return [eventsLink, profileLink, tabLink];
            return [];
        }
    };
    const context = vm.createContext({
        document, console, location: { hash: '#events', search: '' }, history: { replaceState: noop, pushState: noop },
        localStorage: storage, sessionStorage: storage,
        setTimeout: noop, clearTimeout: noop, setInterval: () => 0, clearInterval: noop
    });
    context.window = context;
    const router = (await loadFrontendModules(ROUTER_FILE, context)).get('router.js');

    router.handleRoute();

    assert.deepEqual([...eventsLink.classes], ['active']);
    assert.deepEqual([...profileLink.classes], []);
    assert.deepEqual([...tabLink.classes], ['active'], 'the tab lost its active class');
});
