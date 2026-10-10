const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const vm = require('vm');
const { loadFrontendModules, REPO_ROOT } = require('./helpers');

const CONTRAST_FILE = path.join(REPO_ROOT, 'public', 'js', 'core', 'contrast.js');
const load = async () => (await loadFrontendModules(CONTRAST_FILE, vm.createContext({}))).get('contrast.js');
const round2 = (value) => Math.round(value * 100) / 100;

test('hex, rgb, rgba and transparent are parsed', async () => {
    const { parseColor } = await load();
    // Objects from the vm context have another prototype, so spread before comparing
    assert.deepEqual({ ...parseColor('#fff') }, { r: 255, g: 255, b: 255, a: 1 });
    assert.deepEqual({ ...parseColor('#8F8f9a') }, { r: 143, g: 143, b: 154, a: 1 });
    assert.deepEqual({ ...parseColor('rgb(10, 10, 15)') }, { r: 10, g: 10, b: 15, a: 1 });
    assert.deepEqual({ ...parseColor(' rgba(139, 92, 246, 0.15) ') }, { r: 139, g: 92, b: 246, a: 0.15 });
    assert.deepEqual({ ...parseColor('transparent') }, { r: 0, g: 0, b: 0, a: 0 });
});

test('values that are no plain colour give null', async () => {
    const { parseColor } = await load();
    for (const value of ['var(--accent)', '#12345', 'rgb(1, 2)', 'violet', '', undefined, null]) {
        assert.equal(parseColor(value), null, String(value));
    }
});

test('a translucent colour is laid over an opaque one', async () => {
    const { parseColor, composite } = await load();
    const mixed = composite(parseColor('rgba(255, 255, 255, 0.06)'), parseColor('#16161f'));
    assert.deepEqual({ r: Math.round(mixed.r), g: Math.round(mixed.g), b: Math.round(mixed.b), a: mixed.a }, { r: 36, g: 36, b: 44, a: 1 });
});

test('contrast follows WCAG and does not depend on the order', async () => {
    const { parseColor, contrastRatio } = await load();
    const ratio = (a, b) => round2(contrastRatio(parseColor(a), parseColor(b)));
    assert.equal(ratio('#ffffff', '#000000'), 21);
    assert.equal(ratio('#000000', '#ffffff'), 21);
    assert.equal(ratio('#e4e4e7', '#16161f'), 14.16);
    assert.equal(ratio('#71717a', '#16161f'), 3.72);
    assert.equal(ratio('#ffffff', '#7c3aed'), 5.7);
});
