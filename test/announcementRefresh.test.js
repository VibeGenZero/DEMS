const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAnnouncementRefresher } = require('../utils/announcementRefresh');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

test('changes in a burst lead to one refresh per event', async () => {
    const calls = [];
    const refresher = createAnnouncementRefresher({ refresh: async (eventId) => calls.push(eventId), delayMs: 20 });
    refresher.notify('e1');
    refresher.notify('e1');
    refresher.notify('e2');
    refresher.notify('e1');
    await sleep(80);
    assert.deepEqual(calls.sort(), ['e1', 'e2']);
});

test('flush runs pending refreshes at once', async () => {
    const calls = [];
    const refresher = createAnnouncementRefresher({ refresh: async (eventId) => calls.push(eventId), delayMs: 30 });
    refresher.notify('e1');
    await refresher.flush();
    assert.deepEqual(calls, ['e1']);
    await sleep(60);
    assert.deepEqual(calls, ['e1']);
});

test('a failing refresh is logged, not thrown', async () => {
    const original = console.error;
    const logged = [];
    console.error = (...args) => logged.push(args.join(' '));
    try {
        const refresher = createAnnouncementRefresher({ refresh: async () => { throw new Error('Discord weg'); }, delayMs: 10 });
        refresher.notify('e1');
        await refresher.flush();
    } finally {
        console.error = original;
    }
    assert.ok(logged.some(line => line.includes('Discord weg')));
});

test('calls without an event ID are ignored', async () => {
    const calls = [];
    const refresher = createAnnouncementRefresher({ refresh: async (eventId) => calls.push(eventId), delayMs: 10 });
    refresher.notify('');
    refresher.notify(undefined);
    await refresher.flush();
    assert.deepEqual(calls, []);
});
