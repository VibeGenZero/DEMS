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

test('initials skip brackets and other punctuation in Discord names', async () => {
    const { initialsOf } = await loadComponents();
    assert.equal(initialsOf('Mori (Admin)'), 'MA');
    assert.equal(initialsOf('DEMS Bot (Mock)#0000'), 'DB');
    assert.equal(initialsOf('[GER] Lyonel'), 'GL');
    assert.equal(initialsOf('- Mara -'), 'M');
    assert.equal(initialsOf('2fast 4you'), '24');
    for (const nothing of ['()', '-- ..']) assert.equal(initialsOf(nothing), '?');
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

/** Element double with a class list and an inline display, as showElement() needs it. */
function hiddenElement(display = '') {
    const classes = new Set(['row', 'is-hidden']);
    return {
        classes,
        style: { display },
        classList: { remove: (name) => classes.delete(name), contains: (name) => classes.has(name) }
    };
}

test('showElement shows an element that started hidden, in its own display type', async () => {
    const { ui } = await loadUi();
    const element = hiddenElement();
    ui.showElement(element);
    // Clearing the inline value alone would leave the start state .is-hidden in charge
    assert.deepEqual([...element.classes], ['row']);
    assert.equal(element.style.display, '');

    const hiddenAgain = hiddenElement('none');
    ui.showElement(hiddenAgain);
    assert.equal(hiddenAgain.style.display, '');
});

test('toggleElement hides with an inline display and shows through showElement', async () => {
    const { ui } = await loadUi();
    const element = hiddenElement();
    ui.toggleElement(element, false);
    assert.equal(element.style.display, 'none');
    ui.toggleElement(element, true);
    assert.equal(element.style.display, '');
    assert.equal(element.classes.has('is-hidden'), false);
    // Anything truthy or falsy decides, like the conditions at the call sites
    ui.toggleElement(element, 0);
    assert.equal(element.style.display, 'none');
});

test('applyStyleData sets runtime values through the CSSOM and ignores what is no colour or number', async () => {
    const { ui } = await loadUi();
    const element = (dataset) => ({ dataset, style: {} });
    const elements = [
        element({ styleColor: '#22c55e', styleGlow: '#22c55e' }),
        element({ styleBorderColor: '#abc', styleBackground: '#A1B2C3', styleWidth: '42' }),
        // Nothing here is a hex colour; a glow needs six digits, because it appends an alpha value
        element({ styleColor: 'red; background:url(x)', styleBorderColor: 'var(--x)', styleBackground: '#12', styleGlow: '#abc', styleWidth: '150' }),
        element({ styleWidth: '-5' }),
        element({ styleWidth: 'viel' })
    ];
    let selector = '';
    ui.applyStyleData({ querySelectorAll: (query) => { selector = query; return elements; } });
    for (const name of ['color', 'border-color', 'background', 'glow', 'width']) assert.ok(selector.includes(`[data-style-${name}]`), name);
    assert.deepEqual(elements.map(entry => ({ ...entry.style })), [
        { color: '#22c55e', textShadow: '0 0 20px #22c55e40' },
        { borderColor: '#abc', backgroundColor: '#A1B2C3', width: '42%' },
        { width: '100%' },
        { width: '0%' },
        { width: '0%' }
    ]);
});

test('hexColor reads a Discord role colour as number or as text', async () => {
    const { ui } = await loadUi();
    assert.equal(ui.hexColor(0xef4444), '#ef4444');
    assert.equal(ui.hexColor(0x00ff00), '#00ff00');
    assert.equal(ui.hexColor('#A855F7'), '#A855F7');
    assert.equal(ui.hexColor('#abc'), '#abc');
    // 0 is Discord's "no colour"; everything else that is no colour gives none either
    for (const value of [0, '', null, undefined, 'red', '#12', '##ef4444', -1, 0x1000000, 1.5, {}]) {
        assert.equal(ui.hexColor(value), '', String(value));
    }
});

test('rendered Markdown loses style attributes and style elements before the browser parses it', async () => {
    const sanitizerOptions = [];
    const context = vm.createContext({
        console,
        // Like marked: every token passes walkTokens, raw HTML arrives as type "html"
        marked: {
            parse: (text, options) => {
                const tokens = [
                    { type: 'html', text: '<span class="x" style="color:red" title=\'a\'>' },
                    { type: 'text', text: 'schreibe style="color:red" in den Text' },
                    { type: 'html', text: '</span><style media="all">' },
                    { type: 'html', text: "<p STYLE='position:fixed' id=a style=color:blue>" }
                ];
                tokens.forEach(options.walkTokens);
                return tokens.map(token => token.text).join('|');
            }
        },
        DOMPurify: { sanitize: (html, options) => { sanitizerOptions.push(options); return html; } }
    });
    const ui = (await loadFrontendModules(path.join(CORE_DIR, 'ui.js'), context)).get('ui.js');
    // DOMPurify parses before it filters, and the browser reports each style it meets while
    // parsing: so the HTML tokens lose their styles first. Text that only mentions style="…" stays.
    assert.equal(ui.renderMarkdownSafe('x'), '<span class="x" title=\'a\'>|schreibe style="color:red" in den Text|</span>|<p id=a>');
    // The sanitizer stays the filter that decides; copied, because the options belong to the vm context
    assert.deepEqual(JSON.parse(JSON.stringify(sanitizerOptions)), [{ FORBID_ATTR: ['style'], FORBID_TAGS: ['style'] }]);
});
