const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir } = require('./helpers');

// toPluginEvent loads utils/eventUtils.js (and with it firebaseAdmin.js):
// own, empty SQLite database; the empty cwd keeps a local .env out
const tmpDir = createTempDir('plugin-hooks');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.SQLITE_PATH = path.join(tmpDir, 'plugin-hooks.sqlite');

const hooks = require('../plugin-sdk/hooks');

const PLUGINS = ['alpha', 'beta'];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

let errors;
let warnings;
let originalError;
let originalWarn;

beforeEach(() => {
    errors = [];
    warnings = [];
    originalError = console.error;
    originalWarn = console.warn;
    console.error = (...args) => errors.push(args.map(String).join(' '));
    console.warn = (...args) => warnings.push(args.map(String).join(' '));
});

afterEach(async () => {
    await hooks.whenHooksIdle();
    for (const id of PLUGINS) hooks.clearHooks(id);
    hooks.setHookGate(null);
    hooks.setHookErrorReporter(null);
    hooks.setSlowHookMs(10000);
    console.error = originalError;
    console.warn = originalWarn;
});

test('HOOK_NAMES and EVENT_HOOKS list the SDK 1.0 hooks', () => {
    assert.deepEqual(hooks.HOOK_NAMES, [
        'event.created', 'event.published', 'event.updated', 'event.ended',
        'event.cancelled', 'event.deleted', 'member.deleted'
    ]);
    assert.deepEqual(hooks.EVENT_HOOKS, hooks.HOOK_NAMES.filter(name => name.startsWith('event.')));
});

test('onHook and emitHook throw on an unknown hook name', () => {
    assert.throws(() => hooks.onHook('alpha', 'event.exploded', () => {}));
    assert.throws(() => hooks.emitHook('event.exploded', {}));
});

test('emitHook never runs handlers synchronously', async () => {
    const seen = [];
    hooks.onHook('alpha', 'event.created', () => { seen.push('ran'); });
    hooks.emitHook('event.created', { event: { id: 'e1' } });
    assert.deepEqual(seen, []);
    await hooks.whenHooksIdle();
    assert.deepEqual(seen, ['ran']);
});

test('one plugin sees its hooks in emission order, even behind a slow handler', async () => {
    const seen = [];
    hooks.onHook('alpha', 'event.created', async () => { await wait(50); seen.push('created'); });
    hooks.onHook('alpha', 'event.published', () => { seen.push('published'); });
    hooks.emitHook('event.created', { event: { id: 'e1' } });
    hooks.emitHook('event.published', { event: { id: 'e1' } });
    await hooks.whenHooksIdle();
    assert.deepEqual(seen, ['created', 'published']);
});

test('a slow handler of one plugin does not delay another plugin', async () => {
    let alphaDone = false;
    let betaRanBeforeAlpha = null;
    hooks.onHook('alpha', 'event.created', async () => { await wait(200); alphaDone = true; });
    hooks.onHook('beta', 'event.created', () => { betaRanBeforeAlpha = !alphaDone; });
    hooks.emitHook('event.created', { event: { id: 'e1' } });
    await wait(50);
    assert.equal(betaRanBeforeAlpha, true);
    await hooks.whenHooksIdle();
    assert.equal(alphaDone, true);
});

test('a throwing handler is logged and reported, the next handler still runs', async () => {
    const reported = [];
    const seen = [];
    hooks.setHookErrorReporter((pluginId, message) => reported.push([pluginId, message]));
    hooks.onHook('alpha', 'event.created', () => { throw new Error('kaputt'); });
    hooks.onHook('alpha', 'event.updated', async () => { throw new Error('auch kaputt'); });
    hooks.onHook('alpha', 'event.deleted', () => { seen.push('deleted'); });
    hooks.emitHook('event.created', { event: { id: 'e1' } });
    hooks.emitHook('event.updated', { event: { id: 'e1' }, changed: ['title'] });
    hooks.emitHook('event.deleted', { eventId: 'e1', origin: null });
    await hooks.whenHooksIdle();
    assert.deepEqual(reported, [['alpha', 'kaputt'], ['alpha', 'auch kaputt']]);
    assert.deepEqual(seen, ['deleted']);
    assert.equal(errors.length, 2);
    assert.ok(errors.every(line => line.includes('[plugin:alpha]')));
});

test('a throwing error reporter does not break the queue', async () => {
    const seen = [];
    hooks.setHookErrorReporter(() => { throw new Error('reporter kaputt'); });
    hooks.onHook('alpha', 'event.created', () => { throw new Error('kaputt'); });
    hooks.onHook('alpha', 'event.deleted', () => { seen.push('deleted'); });
    hooks.emitHook('event.created', { event: { id: 'e1' } });
    hooks.emitHook('event.deleted', { eventId: 'e1', origin: null });
    await hooks.whenHooksIdle();
    assert.deepEqual(seen, ['deleted']);
});

test('switching a plugin off drops its queued handlers (gate checked before each run)', async () => {
    let enabled = true;
    const seen = [];
    hooks.setHookGate(pluginId => pluginId !== 'alpha' || enabled);
    hooks.onHook('alpha', 'event.created', async () => {
        seen.push('first started');
        enabled = false;
        await wait(20);
    });
    hooks.onHook('alpha', 'event.published', () => { seen.push('second'); });
    hooks.onHook('beta', 'event.published', () => { seen.push('beta'); });
    hooks.emitHook('event.created', { event: { id: 'e1' } });
    hooks.emitHook('event.published', { event: { id: 'e1' } });
    await hooks.whenHooksIdle();
    assert.deepEqual(seen.sort(), ['beta', 'first started']);
});

test('clearHooks removes handlers and drops already queued ones', async () => {
    const seen = [];
    hooks.onHook('alpha', 'event.created', () => { seen.push('ran'); });
    hooks.emitHook('event.created', { event: { id: 'e1' } });
    hooks.clearHooks('alpha');
    hooks.emitHook('event.created', { event: { id: 'e2' } });
    await hooks.whenHooksIdle();
    assert.deepEqual(seen, []);
});

test('every handler gets its own copy of the payload', async () => {
    const payload = { event: { id: 'e1', title: 'Raid' } };
    let betaTitle = null;
    hooks.onHook('alpha', 'event.created', ({ event }) => { event.title = 'geändert'; });
    hooks.onHook('beta', 'event.created', async ({ event }) => { await wait(10); betaTitle = event.title; });
    hooks.emitHook('event.created', payload);
    payload.event.title = 'später geändert';
    await hooks.whenHooksIdle();
    assert.equal(betaTitle, 'Raid');
    assert.equal(payload.event.title, 'später geändert');
});

test('whenHooksIdle waits for handlers queued while waiting', async () => {
    const seen = [];
    hooks.onHook('alpha', 'event.created', async () => {
        await wait(10);
        hooks.emitHook('event.published', { event: { id: 'e1' } });
    });
    hooks.onHook('alpha', 'event.published', async () => { await wait(10); seen.push('published'); });
    hooks.emitHook('event.created', { event: { id: 'e1' } });
    await hooks.whenHooksIdle();
    assert.deepEqual(seen, ['published']);
});

test('a handler slower than the threshold logs a warning', async () => {
    hooks.setSlowHookMs(20);
    hooks.onHook('alpha', 'event.created', async () => { await wait(60); });
    hooks.onHook('beta', 'event.created', () => {});
    hooks.emitHook('event.created', { event: { id: 'e1' } });
    await hooks.whenHooksIdle();
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /\[plugin:alpha\] Hook event\.created braucht länger als/);
});

test('toPluginEvent drops checkinCode and aiNotes and keeps origin', () => {
    const origin = { plugin: 'event-submissions', ref: 's1' };
    const event = hooks.toPluginEvent('e1', {
        title: 'Raid', status: 'active', checkinCode: 'GEHEIM', aiNotes: 'intern', origin
    });
    assert.deepEqual(event, { id: 'e1', title: 'Raid', status: 'active', origin });
    assert.equal(hooks.toPluginEvent('e2', { title: 'Ohne' }).origin, null);
});

const STATUS_CASES = [
    ['draft → active', { status: 'draft' }, { status: 'active' }, ['event.published']],
    ['new → active', null, { status: 'active' }, ['event.published']],
    ['new → draft', null, { status: 'draft' }, []],
    ['active → active', { status: 'active' }, { status: 'active' }, []],
    ['no status (active) → active', {}, { status: 'active' }, []],
    ['archived → active', { status: 'archived' }, { status: 'active' }, []],
    ['active → archived', { status: 'active' }, { status: 'archived' }, ['event.ended']],
    ['archived → archived', { status: 'archived' }, { status: 'archived' }, []],
    ['active → cancelled', { status: 'active' }, { status: 'cancelled' }, ['event.cancelled']],
    ['cancelled → cancelled', { status: 'cancelled' }, { status: 'cancelled' }, []]
];

for (const [label, before, after, expected] of STATUS_CASES) {
    test(`emitEventStatusChange: ${label}`, async () => {
        const seen = [];
        for (const name of ['event.published', 'event.ended', 'event.cancelled']) {
            hooks.onHook('alpha', name, payload => seen.push([name, payload]));
        }
        hooks.emitEventStatusChange({
            eventId: 'e1',
            before,
            after: { title: 'Raid', checkinCode: 'GEHEIM', ...after }
        });
        await hooks.whenHooksIdle();
        assert.deepEqual(seen.map(([name]) => name), expected);
        for (const [, payload] of seen) {
            assert.deepEqual(payload, { event: { id: 'e1', title: 'Raid', ...after, origin: null } });
        }
    });
}
