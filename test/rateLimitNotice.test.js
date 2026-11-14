const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadFrontendApp, httpAnswer } = require('./helpers');

// The general /api limiter refused: the page says so once, with the wait the
// server names, instead of silently doing nothing (core/rate-limit-notice.js).

const LIMITED = 'Zu viele Anfragen. Bitte warte etwa 4 Minuten und versuche es dann erneut.';

async function boot(routes) {
    const harness = await loadFrontendApp({
        '/api/csrf-token': { token: 't' },
        '/api/server-info': { serverName: 'G', ai: {} },
        '/api/setup/status': { required: false },
        '/auth/me': null,
        ...routes
    });
    await harness.app.finishLoading();
    return harness;
}

test('a refused /api request shows the server sentence once, not for every request', async () => {
    const harness = await boot({ '/api/polls': httpAnswer(429, { error: LIMITED }) });
    const before = harness.toasts.length;
    for (let i = 0; i < 3; i++) await harness.window.fetch('/api/polls');
    assert.deepEqual(harness.toasts.slice(before), [LIMITED]);
});

test('without a sentence of the server the notice says what happened in general', async () => {
    const harness = await boot({ '/api/polls': httpAnswer(429, {}) });
    const before = harness.toasts.length;
    await harness.window.fetch('/api/polls');
    assert.deepEqual(harness.toasts.slice(before), ['Zu viele Anfragen. Bitte warte einen Moment und versuche es dann erneut.']);
});

test('other answers stay untouched and the caller still gets the response', async () => {
    const harness = await boot({ '/api/polls': httpAnswer(400, { error: 'Falsch.' }), '/api/limited': httpAnswer(429, { error: LIMITED }) });
    const before = harness.toasts.length;
    const res = await harness.window.fetch('/api/polls');
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'Falsch.' });
    const limited = await harness.window.fetch('/api/limited');
    assert.equal(limited.status, 429);
    assert.deepEqual(await limited.json(), { error: LIMITED }, 'the body is still readable for the caller');
    assert.deepEqual(harness.toasts.slice(before), [LIMITED]);
});
