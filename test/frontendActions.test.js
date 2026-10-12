const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const vm = require('vm');
const { loadFrontendModules, REPO_ROOT } = require('./helpers');

const ACTIONS_FILE = path.join(REPO_ROOT, 'public', 'js', 'core', 'actions.js');

/**
 * Element double: attributes, dataset (data-* in camelCase), parent chain for closest().
 */
function fakeElement(tag, attributes = {}, children = []) {
    const dataset = {};
    for (const [name, value] of Object.entries(attributes)) {
        if (name.startsWith('data-')) dataset[name.slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase())] = value;
    }
    const element = {
        tagName: tag.toUpperCase(), attributes, dataset, parent: null, style: {}, replacement: null,
        title: attributes.title || '', checked: attributes.checked === 'checked', complete: false, naturalWidth: 0,
        getAttribute: (name) => (name in attributes ? attributes[name] : null),
        closest(selector) {
            const name = selector.slice(1, -1);
            for (let node = this; node; node = node.parent) if (name in node.attributes) return node;
            return null;
        },
        replaceWith(node) { this.replacement = node; }
    };
    for (const child of children) child.parent = element;
    return element;
}

/**
 * Load core/actions.js alone with a recording document and console.
 */
async function loadActions({ elements = {}, images = [] } = {}) {
    const listeners = [];
    const errors = [];
    const document = {
        addEventListener: (type, listener, capture) => listeners.push({ type, listener, capture: !!capture }),
        getElementById: (id) => elements[id] || null,
        querySelectorAll: (selector) => (selector === 'img[data-fallback]' ? images : []),
        createElement: (tag) => ({ tagName: tag.toUpperCase(), className: '', title: '', textContent: '' })
    };
    const context = vm.createContext({ document, console: { error: (...args) => errors.push(args.map(String).join(' ')) } });
    const actions = (await loadFrontendModules(ACTIONS_FILE, context)).get('actions.js');
    const dispatch = (type, target) => {
        const event = { type, target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
        for (const entry of listeners.filter(l => l.type === type)) entry.listener(event);
        return event;
    };
    return { actions, document, errors, dispatch, listeners };
}

// initActions always gets the document of the vm context returned by loadActions()
test('the nearest element with an action handles the click, the outer one does not', async () => {
    const { actions, document, dispatch } = await loadActions();
    const calls = [];
    actions.registerActions({ openCard: (el) => calls.push(['card', el.dataset.id]), openDate: (el) => calls.push(['date', el.dataset.id]) });
    actions.initActions(document);
    const icon = fakeElement('i');
    const date = fakeElement('a', { 'data-click': 'openDate', 'data-id': 'd1' }, [icon]);
    fakeElement('div', { 'data-click': 'openCard', 'data-id': 'c1' }, [date]);

    const event = dispatch('click', icon);
    await Promise.resolve();
    assert.deepEqual(calls, [['date', 'd1']]);
    assert.equal(event.defaultPrevented, true, 'a link with an action does not jump to #');
});

test('buttons and checkboxes keep their default behaviour', async () => {
    const { actions, document, dispatch } = await loadActions();
    actions.registerActions({ save: () => {}, toggle: () => {} });
    actions.initActions(document);
    assert.equal(dispatch('click', fakeElement('button', { 'data-click': 'save' })).defaultPrevented, false);
    assert.equal(dispatch('click', fakeElement('input', { 'data-click': 'toggle', type: 'checkbox' })).defaultPrevented, false);
});

test('change and input events use their own attributes', async () => {
    const { actions, document, dispatch } = await loadActions();
    const calls = [];
    actions.registerActions({ pick: (el) => calls.push(['pick', el.value]), typed: () => calls.push(['typed']) });
    actions.initActions(document);
    const select = fakeElement('select', { 'data-change': 'pick' });
    select.value = 'b';
    dispatch('change', select);
    dispatch('input', fakeElement('input', { 'data-input': 'typed' }));
    dispatch('click', select);   // no data-click: nothing happens
    assert.deepEqual(calls, [['pick', 'b'], ['typed']]);
});

test('an unknown action and a failing action are reported, not thrown', async () => {
    const { actions, document, dispatch, errors } = await loadActions();
    actions.registerActions({ broken: () => { throw new Error('kaputt'); }, rejects: async () => { throw new Error('später kaputt'); } });
    actions.initActions(document);
    dispatch('click', fakeElement('button', { 'data-click': 'nope' }));
    dispatch('click', fakeElement('button', { 'data-click': 'broken' }));
    dispatch('click', fakeElement('button', { 'data-click': 'rejects' }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(errors.length, 3);
    assert.match(errors[0], /Unknown action "nope"/);
    assert.match(errors[1], /Action "broken" failed.*kaputt/);
    assert.match(errors[2], /Action "rejects" failed.*später kaputt/);
});

test('an action name can only be registered once', async () => {
    const { actions } = await loadActions();
    actions.registerActions({ once: () => {} });
    assert.throws(() => actions.registerActions({ once: () => {} }), /Action "once" is registered twice/);
    assert.ok(actions.actionNames().includes('once'));
});

test('runAction calls the handler with element and event', async () => {
    const { actions } = await loadActions();
    const seen = [];
    actions.registerActions({ track: (el, event) => seen.push([el.dataset.id, event.type]) });
    await actions.runAction('track', fakeElement('button', { 'data-id': '7' }), { type: 'click' });
    assert.deepEqual(seen, [['7', 'click']]);
});

test('built-in actions show, hide and scroll to their target', async () => {
    // The target starts hidden through the class .is-hidden, as in index.html
    const classes = new Set(['mt-2', 'is-hidden']);
    const options = { style: { display: '' }, classList: { remove: (name) => classes.delete(name) } };
    const log = { style: { display: '' } };
    let scrolled = null;
    const area = { scrollIntoView: (opts) => { scrolled = opts; } };
    const { actions } = await loadActions({ elements: { options, log, area } });
    const box = fakeElement('input', { 'data-change': 'toggleVisible', 'data-target': 'options' });
    box.checked = true;
    await actions.runAction('toggleVisible', box);
    assert.equal(options.style.display, '');
    assert.deepEqual([...classes], ['mt-2']);
    box.checked = false;
    await actions.runAction('toggleVisible', box);
    assert.equal(options.style.display, 'none');
    await actions.runAction('hide', fakeElement('button', { 'data-target': 'log' }));
    assert.equal(log.style.display, 'none');
    await actions.runAction('scrollTo', fakeElement('button', { 'data-target': 'area' }));
    assert.deepEqual({ ...scrolled }, { behavior: 'smooth' });
});

test('broken images fall back: hide, invisible, initials', async () => {
    const { actions, document, listeners } = await loadActions();
    actions.initActions(document);
    const onError = listeners.find(l => l.type === 'error');
    assert.equal(onError.capture, true, 'error events do not bubble, the listener must capture');
    const hide = fakeElement('img', { 'data-fallback': 'hide' });
    const invisible = fakeElement('img', { 'data-fallback': 'invisible' });
    const initials = fakeElement('img', { 'data-fallback': 'initials', 'data-initials': 'X', title: "X'+(globalThis.pwned=1)+'" });
    for (const target of [hide, invisible, initials]) onError.listener({ type: 'error', target });
    assert.equal(hide.style.display, 'none');
    assert.equal(invisible.style.visibility, 'hidden');
    assert.deepEqual({ ...initials.replacement }, { tagName: 'DIV', className: 'participant-avatar-placeholder', title: "X'+(globalThis.pwned=1)+'", textContent: 'X' });
});

test('a broken avatar image becomes an initials tile of the same size', async () => {
    const { actions, document, listeners } = await loadActions();
    actions.initActions(document);
    const onError = listeners.find(l => l.type === 'error');
    for (const classes of ['avatar', 'avatar avatar-lg', 'me-2 avatar avatar-sm']) {
        const image = fakeElement('img', { 'data-fallback': 'initials', 'data-initials': 'LB', title: 'Lyonel Berzen' });
        image.className = classes;
        onError.listener({ type: 'error', target: image });
        assert.deepEqual({ ...image.replacement }, { tagName: 'SPAN', className: `${classes} avatar-initials`, title: 'Lyonel Berzen', textContent: 'LB' });
    }
    // A class that only contains the word is no avatar
    const legacy = fakeElement('img', { 'data-fallback': 'initials', 'data-initials': 'X', title: 'X' });
    legacy.className = 'participant-avatar';
    onError.listener({ type: 'error', target: legacy });
    assert.equal(legacy.replacement.className, 'participant-avatar-placeholder');
});

test('images that failed before the modules ran get their fallback at start', async () => {
    const failed = fakeElement('img', { 'data-fallback': 'hide', src: '' });
    failed.complete = true;
    const loading = fakeElement('img', { 'data-fallback': 'hide', src: '/a.png' });
    const loaded = fakeElement('img', { 'data-fallback': 'hide', src: '/b.png' });
    loaded.complete = true;
    loaded.naturalWidth = 32;
    const { actions, document } = await loadActions({ images: [failed, loading, loaded] });
    actions.initActions(document);
    assert.equal(failed.style.display, 'none');
    assert.equal(loading.style.display, undefined);
    assert.equal(loaded.style.display, undefined);
});
