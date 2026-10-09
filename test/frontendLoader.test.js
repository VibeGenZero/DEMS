const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const { loadFrontendModules, REPO_ROOT } = require('./helpers');

const FIXTURES = path.join(__dirname, 'fixtures', 'frontend-modules');

test('every load builds new module instances in its own context', async () => {
    const first = await loadFrontendModules(path.join(FIXTURES, 'main.js'), vm.createContext({ document: { title: 'A' } }));
    const second = await loadFrontendModules(path.join(FIXTURES, 'main.js'), vm.createContext({ document: { title: 'B' } }));
    first.get('main.js').bump();
    first.get('main.js').bump();
    assert.equal(first.get('main.js').bump(), 3);
    assert.equal(second.get('main.js').bump(), 1);
    assert.equal(second.get('main.js').pageTitle(), 'B');
    assert.deepEqual([...first.keys()].sort(), ['counter.js', 'main.js']);
});

test('an import of a name the other module does not export fails the load', async () => {
    await assert.rejects(loadFrontendModules(path.join(FIXTURES, 'broken.js'), vm.createContext({})), /missing/);
});

test('without the vm modules flag the loader says how to run the tests', () => {
    const script = `require(${JSON.stringify(path.join(REPO_ROOT, 'test', 'helpers.js'))})
        .loadFrontendModules(${JSON.stringify(path.join(FIXTURES, 'main.js'))}, require('vm').createContext({}))
        .catch(err => { console.error(err.message); process.exit(3); });`;
    const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
    assert.equal(result.status, 3);
    assert.match(result.stderr, /--experimental-vm-modules.*npm test/);
});
