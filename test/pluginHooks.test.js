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
    hooks.setHookTimeoutMs(hooks.DEFAULT_HOOK_TIMEOUT_MS);
    console.error = originalError;
    console.warn = originalWarn;
});

test('HOOK_NAMES, EVENT_HOOKS and REGISTRATION_HOOKS list the SDK 1.1 hooks', () => {
    assert.deepEqual(hooks.HOOK_NAMES, [
        'event.created', 'event.published', 'event.updated', 'event.ended',
        'event.cancelled', 'event.deleted', 'member.deleted', 'registration.checkedIn'
    ]);
    assert.deepEqual(hooks.EVENT_HOOKS, hooks.HOOK_NAMES.filter(name => name.startsWith('event.')));
    assert.deepEqual(hooks.REGISTRATION_HOOKS, ['registration.checkedIn']);
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

test('a handler that never settles is reported after the timeout and the queue goes on', { timeout: 2000 }, async () => {
    const reported = [];
    const seen = [];
    hooks.setHookTimeoutMs(30);
    hooks.setHookErrorReporter((pluginId, message) => reported.push([pluginId, message]));
    hooks.onHook('alpha', 'event.created', () => new Promise(() => {}));
    hooks.onHook('alpha', 'event.published', () => { seen.push('published'); });
    hooks.emitHook('event.created', { event: { id: 'e1' } });
    hooks.emitHook('event.published', { event: { id: 'e1' } });
    await hooks.whenHooksIdle();
    assert.deepEqual(seen, ['published']);
    assert.deepEqual(reported, [['alpha', 'Hook event.created hat nicht innerhalb von 0,03 s geantwortet.']]);
    assert.ok(errors.some(line => line.includes('[plugin:alpha]')));
});

test('a plugin registers at most MAX_HANDLERS_PER_HOOK handlers per hook', () => {
    assert.equal(hooks.MAX_HANDLERS_PER_HOOK, 20);
    for (let i = 0; i < 20; i++) hooks.onHook('alpha', 'event.created', () => {});
    assert.throws(() => hooks.onHook('alpha', 'event.created', () => {}),
        { message: 'Hook event.created: höchstens 20 Handler pro Plugin.' });
    // the limit counts per hook name and per plugin
    hooks.onHook('alpha', 'event.published', () => {});
    hooks.onHook('beta', 'event.created', () => {});
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

// Studio events
const studioEvents = require('../dev/studioEvents');

async function withStudio(fn) {
    const sent = [];
    const saved = { PLUGIN_STUDIO: process.env.PLUGIN_STUDIO, DEV_MOCK: process.env.DEV_MOCK };
    process.env.PLUGIN_STUDIO = '1';
    process.env.DEV_MOCK = 'true';
    studioEvents.setSender(message => sent.push(message));
    try {
        await fn(sent);
    } finally {
        studioEvents.setSender(null);
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
}

test('studio: a handler emits a hook event, a throwing one also an error event', async () => {
    hooks.onHook('alpha', 'event.created', () => {});
    hooks.onHook('beta', 'event.created', () => { throw new Error('kaputt'); });
    await withStudio(async (sent) => {
        hooks.emitHook('event.created', { event: { id: 'e1', title: 'Raid' } });
        await hooks.whenHooksIdle();
        const ok = sent.find(message => message.type === 'hook' && message.pluginId === 'alpha');
        assert.deepEqual(ok.data, { name: 'event.created', summary: 'Raid', ok: true, error: '' });
        const bad = sent.find(message => message.type === 'hook' && message.pluginId === 'beta');
        assert.deepEqual(bad.data, { name: 'event.created', summary: 'Raid', ok: false, error: 'kaputt' });
        const error = sent.find(message => message.type === 'error' && message.pluginId === 'beta');
        assert.deepEqual(error.data, { message: 'kaputt', where: 'hook:event.created' });
    });
});

test('studio: a hook without an event summarises by the registration id', async () => {
    hooks.onHook('alpha', 'registration.checkedIn', () => {});
    await withStudio(async (sent) => {
        hooks.emitHook('registration.checkedIn', { registration: { id: 'r7' } });
        await hooks.whenHooksIdle();
        assert.equal(sent.find(message => message.type === 'hook').data.summary, 'r7');
    });
});

test('studio: a failing hook handler reports file and line of the plugin folder', async () => {
    const fs = require('fs');
    const path = require('path');
    const { createTempDir } = require('./helpers');
    const dir = fs.mkdtempSync(path.join(createTempDir('hook-frame'), 'p-'));
    const file = path.join(dir, 'handler.js');
    fs.writeFileSync(file, 'module.exports = () => {\n    throw new Error("im Hook");\n};\n');
    hooks.setHookDirResolver(id => (id === 'gamma' ? dir : ''));
    hooks.onHook('gamma', 'event.created', require(file));
    try {
        await withStudio(async (sent) => {
            hooks.emitHook('event.created', { event: { id: 'e1', title: 'Raid' } });
            await hooks.whenHooksIdle();
            const error = sent.find(message => message.type === 'error' && message.pluginId === 'gamma');
            assert.deepEqual(error.data, { message: 'im Hook', where: 'hook:event.created', file: 'handler.js', line: 2 });
            const hook = sent.find(message => message.type === 'hook' && message.pluginId === 'gamma');
            assert.equal(hook.data.file, 'handler.js');
            assert.equal(hook.data.line, 2);
        });
    } finally {
        hooks.setHookDirResolver(null);
        hooks.clearHooks('gamma');
    }
});
