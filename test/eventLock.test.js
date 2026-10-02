const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withEventLock } = require('../utils/eventLock');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

test('work for the same event runs one after another', async () => {
    const steps = [];
    await Promise.all([
        withEventLock('event-a', async () => { steps.push('first-start'); await sleep(30); steps.push('first-end'); }),
        withEventLock('event-a', async () => { steps.push('second-start'); steps.push('second-end'); })
    ]);
    assert.deepEqual(steps, ['first-start', 'first-end', 'second-start', 'second-end']);
});

test('different events do not wait for each other', async () => {
    const steps = [];
    await Promise.all([
        withEventLock('event-b', async () => { await sleep(40); steps.push('b'); }),
        withEventLock('event-c', async () => { steps.push('c'); })
    ]);
    assert.deepEqual(steps, ['c', 'b']);
});

test('a failing task passes its error on and releases the lock', async () => {
    const failing = withEventLock('event-d', async () => { throw new Error('kaputt'); });
    const next = withEventLock('event-d', async () => 'weiter');
    await assert.rejects(failing, /kaputt/);
    assert.equal(await next, 'weiter');
});
