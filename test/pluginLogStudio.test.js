const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const studioEvents = require('../dev/studioEvents');
const { createContext } = require('../plugin-sdk/context');

const saved = { PLUGIN_STUDIO: process.env.PLUGIN_STUDIO, DEV_MOCK: process.env.DEV_MOCK };

afterEach(() => {
    studioEvents.setSender(null);
    for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
});

function makeCtx() {
    const entry = {
        id: 'alpha', official: false,
        manifest: { id: 'alpha', permissions: [], settings: [] }
    };
    return createContext({ entry, host: { limiter: {}, recordCollection: async () => {}, routes: [], disableCallbacks: [] } });
}

test('ctx.log emits log events with joined args and still writes to the console', (t) => {
    process.env.PLUGIN_STUDIO = '1';
    process.env.DEV_MOCK = 'true';
    const events = [];
    studioEvents.setSender(message => events.push(message));
    const warn = t.mock.method(console, 'warn', () => {});
    t.mock.method(console, 'log', () => {});
    t.mock.method(console, 'error', () => {});
    const { log } = makeCtx();
    log.warn('x');
    log.info('a', 2, { k: 1 });
    log.error('boom');
    assert.equal(warn.mock.callCount(), 1);
    assert.deepEqual(events.map(event => event.data), [
        { level: 'warn', text: 'x' },
        { level: 'info', text: 'a 2 {"k":1}' },
        { level: 'error', text: 'boom' }
    ]);
    assert.equal(events[0].pluginId, 'alpha');
});
