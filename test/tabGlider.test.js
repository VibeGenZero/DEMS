const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const vm = require('vm');
const { loadFrontendModules, REPO_ROOT } = require('./helpers');

async function loadGlider() {
    const modules = await loadFrontendModules(path.join(REPO_ROOT, 'public', 'js', 'core', 'tab-glider.js'), vm.createContext({}));
    return modules.get('tab-glider.js');
}

const plain = (value) => JSON.parse(JSON.stringify(value));

test('the navbar marker sits centered under the link', async () => {
    const { markerBox } = await loadGlider();
    assert.deepEqual(plain(markerBox({ left: 100 }, { left: 300, width: 90 }, 30)), { x: 230, width: 30 });
});

test('a tab glider takes the full tab width', async () => {
    const { markerBox } = await loadGlider();
    assert.deepEqual(plain(markerBox({ left: 100 }, { left: 300, width: 90 })), { x: 200, width: 90 });
});
