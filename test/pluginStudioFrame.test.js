const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createTempDir } = require('./helpers');
const { pluginFrame } = require('../plugin-sdk/studio');

function pluginDir() {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(createTempDir('studio-frame'), 'p-')));
    fs.mkdirSync(path.join(dir, 'lib'));
    return dir;
}

test('pluginFrame finds the first stack line inside the plugin folder', () => {
    const dir = pluginDir();
    const err = new Error('drin');
    err.stack = [
        'Error: drin',
        '    at helper (node:internal/x:1:1)',
        `    at work (${path.join(dir, 'lib', 'a.js')}:7:13)`,
        `    at ${path.join(dir, 'server.js')}:2:1`
    ].join('\n');
    assert.deepEqual(pluginFrame(err, dir), { file: 'lib/a.js', line: 7 });
});

test('pluginFrame reads the header line Node puts in front of a SyntaxError', () => {
    const dir = pluginDir();
    const file = path.join(dir, 'server.js');
    fs.writeFileSync(file, "module.exports = {\n    register() {}\n    oops here\n};\n");
    let err;
    try {
        require(file);
    } catch (caught) {
        err = caught;
    }
    assert.ok(err instanceof SyntaxError, String(err));
    assert.deepEqual(pluginFrame(err, dir), { file: 'server.js', line: 3 });
});

test('pluginFrame ignores frames outside the folder and bad input', () => {
    const dir = pluginDir();
    const outside = new Error('x');
    outside.stack = `Error: x\n    at f (${path.join(path.dirname(dir), 'other.js')}:1:1)`;
    assert.deepEqual(pluginFrame(outside, dir), {});
    const sibling = new Error('x');
    sibling.stack = `Error: x\n    at f (${dir}-zwei${path.sep}a.js:1:1)`;
    assert.deepEqual(pluginFrame(sibling, dir), {}, 'a sibling folder with the same prefix is outside');
    assert.deepEqual(pluginFrame(null, dir), {});
    assert.deepEqual(pluginFrame(new Error('x'), ''), {});
    assert.deepEqual(pluginFrame({ stack: 42 }, dir), {});
});

test('pluginFrame compares the folder case-insensitively on Windows', { skip: process.platform !== 'win32' }, () => {
    const dir = pluginDir();
    const err = new Error('x');
    err.stack = `Error: x\n    at f (${path.join(dir.toUpperCase(), 'server.js')}:4:2)`;
    assert.deepEqual(pluginFrame(err, dir), { file: 'server.js', line: 4 });
});
