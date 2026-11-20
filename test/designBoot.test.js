const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { REPO_ROOT } = require('./helpers');

const DESIGN_BOOT_PATH = path.join(REPO_ROOT, 'public', 'design-boot.js');
const INDEX_HTML = fs.readFileSync(path.join(REPO_ROOT, 'public', 'index.html'), 'utf8');

function runDesignBoot({ search = '', hash = '' } = {}) {
    const script = fs.readFileSync(DESIGN_BOOT_PATH, 'utf8');
    const attributes = new Map();
    const link = { disabled: false };
    const context = vm.createContext({
        location: { search, hash },
        document: {
            getElementById: (id) => (id === 'custom-theme' ? link : null),
            documentElement: {
                setAttribute: (name, value) => attributes.set(name, value)
            }
        }
    });
    context.window = context;
    vm.runInContext(script, context);
    return { disabled: link.disabled, dataDesign: attributes.get('data-design') ?? null };
}

test('design=standard in search or hash disables the custom theme and marks the document', () => {
    for (const loc of [
        { search: '?design=standard' },
        { hash: '#admin?design=standard' },
        { search: '?x=1&design=standard' },
        { search: '?design=standard&x=1' },
        { hash: '#p/custom-design?x=1&design=standard' }
    ]) {
        assert.deepEqual(runDesignBoot(loc), { disabled: true, dataDesign: 'standard' }, JSON.stringify(loc));
    }

    for (const loc of [
        {},
        { search: '?design=standardx' },
        { search: '?xdesign=standard' },
        { hash: '#admin?design=standardx' },
        { hash: '#design=standard' }
    ]) {
        assert.deepEqual(runDesignBoot(loc), { disabled: false, dataDesign: null }, JSON.stringify(loc));
    }
});

test('index.html links theme.css last and runs design-boot right after it', () => {
    const head = INDEX_HTML.slice(0, INDEX_HTML.indexOf('</head>'));
    const styleIdx = head.indexOf('/css/style.css');
    const themeIdx = head.indexOf('<link rel="stylesheet" href="/theme.css" id="custom-theme">');
    const bootIdx = head.indexOf('<script src="/design-boot.js"></script>');
    const iconIdx = head.indexOf('<link rel="icon"');

    assert.ok(themeIdx > styleIdx, 'custom-theme link must come after style.css');
    assert.ok(bootIdx > themeIdx, 'design-boot.js must come after custom-theme');
    assert.ok(iconIdx > bootIdx, 'design-boot.js must sit before the icon link');

    const stylesheets = [...head.matchAll(/<link[^>]+rel="stylesheet"[^>]*>/g)].map(m => m[0]);
    assert.match(stylesheets.at(-1), /id="custom-theme"/, 'custom-theme must be the last stylesheet in <head>');
});
