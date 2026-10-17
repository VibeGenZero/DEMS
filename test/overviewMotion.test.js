const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const vm = require('vm');
const { loadFrontendModules, REPO_ROOT } = require('./helpers');

async function loadOverviewMotion() {
    const modules = await loadFrontendModules(path.join(REPO_ROOT, 'public', 'js', 'events', 'overview-motion.js'), vm.createContext({}));
    return modules.get('overview-motion.js');
}

const plain = (value) => JSON.parse(JSON.stringify(value));

test('a filter change knows which cards leave, stay and enter', async () => {
    const { planFilterTransition } = await loadOverviewMotion();
    assert.deepEqual(plain(planFilterTransition(['a', 'b', 'c'], ['b', 'd'])), { leaving: ['a', 'c'], staying: ['b'], entering: ['d'] });
    assert.deepEqual(plain(planFilterTransition([], ['a'])), { leaving: [], staying: [], entering: ['a'] });
    assert.deepEqual(plain(planFilterTransition(['a'], [])), { leaving: ['a'], staying: [], entering: [] });
});

test('a staying card starts where it stood before', async () => {
    const { flipOffset } = await loadOverviewMotion();
    assert.deepEqual(plain(flipOffset({ left: 400, top: 120 }, { left: 20, top: 120 })), { x: 380, y: 0 });
    assert.deepEqual(plain(flipOffset({ left: 20, top: 500 }, { left: 20, top: 120 })), { x: 0, y: 380 });
});
