const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { apiLimitFor, apiLimitKey, tooManyRequestsMessage, createApiLimiter } = require('../middleware/rateLimits');

// The general /api limiter (middleware/rateLimits.js): per user once logged in,
// per IP before; both limits can be set in the environment.

test('a logged-in user has an own, larger budget; everybody else counts per IP', () => {
    assert.equal(apiLimitFor({ session: {} }, {}), 200);
    assert.equal(apiLimitFor({ session: { user: { id: 'u1' } } }, {}), 1000);
    assert.equal(apiLimitFor({}, { RATE_LIMIT_MAX: '50' }), 50);
    assert.equal(apiLimitFor({ session: { user: { id: 'u1' } } }, { RATE_LIMIT_MAX_USER: '3000' }), 3000);
    // Nonsense falls back to the defaults
    assert.equal(apiLimitFor({}, { RATE_LIMIT_MAX: 'viele' }), 200);
    assert.equal(apiLimitFor({ session: { user: { id: 'u1' } } }, { RATE_LIMIT_MAX_USER: '0' }), 1000);

    assert.equal(apiLimitKey({ session: { user: { id: 'u1' } }, ip: '10.0.0.1' }), 'user:u1');
    assert.equal(apiLimitKey({ session: {}, ip: '10.0.0.1' }), 'ip:10.0.0.1');
});

test('the refusal says how long to wait, in whole minutes', () => {
    assert.equal(tooManyRequestsMessage(30 * 1000), 'Zu viele Anfragen. Bitte warte etwa 1 Minute und versuche es dann erneut.');
    assert.equal(tooManyRequestsMessage(4 * 60 * 1000 + 1), 'Zu viele Anfragen. Bitte warte etwa 5 Minuten und versuche es dann erneut.');
});

async function serve(app) {
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}

test('two users behind one address do not share a budget; a refusal carries the minutes', async () => {
    const env = { RATE_LIMIT_MAX: '2', RATE_LIMIT_MAX_USER: '3' };
    const app = express();
    // Stand-in for the session: the header names the logged-in user
    app.use((req, res, next) => { const id = req.get('x-user'); req.session = id ? { user: { id } } : {}; next(); });
    app.use('/api/', createApiLimiter({ env }));
    app.get('/api/ping', (req, res) => res.json({ ok: true }));
    const { url, close } = await serve(app);
    try {
        const call = (user) => fetch(`${url}/api/ping`, { headers: user ? { 'x-user': user } : {} });
        for (let i = 0; i < 3; i++) assert.equal((await call('anna')).status, 200);
        const refused = await call('anna');
        assert.equal(refused.status, 429);
        assert.match((await refused.json()).error, /^Zu viele Anfragen\. Bitte warte etwa \d+ Minuten? und versuche es dann erneut\.$/);
        // Ben on the same address still has his own budget, and so has the address itself
        assert.equal((await call('ben')).status, 200);
        assert.equal((await call()).status, 200);
        assert.equal((await call()).status, 200);
        assert.equal((await call()).status, 429);
    } finally {
        await close();
    }
});

test('dev mock mode skips the limiter', async () => {
    const app = express();
    app.use('/api/', createApiLimiter({ env: { RATE_LIMIT_MAX: '1' }, skip: true }));
    app.get('/api/ping', (req, res) => res.json({ ok: true }));
    const { url, close } = await serve(app);
    try {
        for (let i = 0; i < 3; i++) assert.equal((await fetch(`${url}/api/ping`)).status, 200);
    } finally {
        await close();
    }
});
