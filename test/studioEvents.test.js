const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const studio = require('../dev/studioEvents');

let sent;
const saved = {};

beforeEach(() => {
    sent = [];
    for (const key of ['PLUGIN_STUDIO', 'DEV_MOCK', 'NODE_ENV']) saved[key] = process.env[key];
    delete process.env.PLUGIN_STUDIO;
    delete process.env.DEV_MOCK;
    delete process.env.NODE_ENV;
    studio.setSender(message => sent.push(message));
});

afterEach(() => {
    studio.setSender(null);
    for (const key of Object.keys(saved)) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
    }
});

function activate() {
    process.env.PLUGIN_STUDIO = '1';
    process.env.DEV_MOCK = 'true';
}

test('without the studio environment nothing is sent', () => {
    assert.equal(studio.isActive(), false);
    studio.emit('log', 'alpha', { level: 'info', text: 'x' });
    process.env.PLUGIN_STUDIO = '1';
    studio.emit('log', 'alpha', { level: 'info', text: 'x' });
    assert.equal(sent.length, 0, 'mock mode is missing');
});

test('never active with NODE_ENV=production', () => {
    activate();
    process.env.NODE_ENV = 'production';
    assert.equal(studio.isActive(), false);
    studio.emit('log', 'alpha', { level: 'info', text: 'x' });
    assert.equal(sent.length, 0);
});

test('an active emit sends one message with the exact shape', () => {
    activate();
    assert.equal(studio.isActive(), true);
    studio.emit('log', 'alpha', { level: 'warn', text: 'x' });
    assert.equal(sent.length, 1);
    const { at, ...rest } = sent[0];
    assert.deepEqual(rest, { studio: true, type: 'log', pluginId: 'alpha', data: { level: 'warn', text: 'x' } });
    assert.equal(new Date(at).toISOString(), at);
});

test('long strings are cut at 10 240 characters plus an ellipsis', () => {
    activate();
    studio.emit('dm', 'alpha', { text: 'a'.repeat(20000), nested: { more: 'b'.repeat(10240) } });
    assert.equal(sent[0].data.text, `${'a'.repeat(10240)}\u2026`);
    assert.equal(sent[0].data.nested.more, 'b'.repeat(10240));
});

test('a throwing sender does not throw out of emit', () => {
    activate();
    studio.setSender(() => { throw new Error('channel closed'); });
    assert.doesNotThrow(() => studio.emit('log', 'alpha', { level: 'info', text: 'x' }));
});
