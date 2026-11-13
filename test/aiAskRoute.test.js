const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir, startServer, createClient } = require('./helpers');

// POST /api/events/:id/ask (routes/eventAsk.js) streams the answer of the
// assistant as server-sent events; GET /api/server-info tells the website
// whether the assistant is on. Dev mock mode: the mock provider answers
// "Mock-Antwort: <question>\nQuelle: Beschreibung".
let server;
before(async () => {
    server = await startServer('dev/start.js', { DEV_SQLITE_PATH: path.join(createTempDir('ai-ask'), 'dev.sqlite') });
});
after(() => server.stop());

const OPEN = 'dev-event-open';

async function loginAs(personaId) {
    const client = createClient(server.baseUrl);
    assert.equal((await client.request(`/auth/dev-login/${personaId}`)).status, 302);
    return client;
}

/** Parse an SSE body into [{ event, data }]. */
function parseEvents(text) {
    return text.split('\n\n').filter(Boolean).map(block => {
        const event = /^event: (.*)$/m.exec(block)[1];
        const data = JSON.parse(/^data: (.*)$/m.exec(block)[1]);
        return { event, data };
    });
}

test('logged out: 401', async () => {
    const client = createClient(server.baseUrl);
    const res = await client.send('POST', `/api/events/${OPEN}/ask`, { question: 'Hallo?' });
    assert.equal(res.status, 401);
});

test('a member gets the answer as a stream of token events and a done event', async () => {
    const member = await loginAs('member');
    const res = await member.send('POST', `/api/events/${OPEN}/ask`, { question: 'Wann geht es los?', history: [] });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/event-stream/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const events = parseEvents(await res.text());
    const tokens = events.filter(e => e.event === 'token');
    assert.ok(tokens.length > 0);
    assert.equal(tokens.map(e => e.data.text).join(''), 'Mock-Antwort: Wann geht es los?');
    const last = events[events.length - 1];
    assert.equal(last.event, 'done');
    assert.deepEqual(last.data, { source: 'Beschreibung' });
});

test('without the CSRF token: 403', async () => {
    const member = await loginAs('member');
    const res = await member.request(`/api/events/${OPEN}/ask`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'Hallo?' })
    });
    assert.equal(res.status, 403);
});

test('a draft event answers 404 for a member, an overlong question 400', async () => {
    const member = await loginAs('member');
    const draft = await member.send('POST', '/api/events/dev-event-draft/ask', { question: 'Hallo?' });
    assert.equal(draft.status, 404);
    assert.equal((await draft.json()).error, 'Event nicht gefunden.');
    const long = await member.send('POST', `/api/events/${OPEN}/ask`, { question: 'x'.repeat(501) });
    assert.equal(long.status, 400);
    assert.match((await long.json()).error, /500/);
});

test('server-info reports the assistant and never a key or model name', async () => {
    const res = await createClient(server.baseUrl).request('/api/server-info');
    const info = await res.json();
    assert.equal(info.ai.memberAssistant, true);
    assert.equal(info.ai.adminAssistant, true);
    assert.equal(info.ai.assistantName, 'Event-Assistent');
    assert.equal(typeof info.ai.teaserText, 'string');
    assert.deepEqual(Object.keys(info.ai).sort(), ['adminAssistant', 'assistantName', 'memberAssistant', 'teaserText']);
    const text = JSON.stringify(info);
    assert.equal(text.includes('mock-1'), false);
    assert.equal(/api.?key/i.test(text), false);
});

test('with the website assistant switched off: 404 and server-info says so', async () => {
    const admin = await loginAs('admin');
    assert.equal((await admin.send('PUT', '/api/admin/ai/settings', { memberWeb: false })).status, 200);
    try {
        const member = await loginAs('member');
        const res = await member.send('POST', `/api/events/${OPEN}/ask`, { question: 'Hallo?' });
        assert.equal(res.status, 404);
        assert.equal((await res.json()).error, 'Event nicht gefunden.');
        const info = await (await createClient(server.baseUrl).request('/api/server-info')).json();
        assert.equal(info.ai.memberAssistant, false);
        assert.equal(info.ai.teaserText, '');
    } finally {
        assert.equal((await admin.send('PUT', '/api/admin/ai/settings', { memberWeb: true })).status, 200);
    }
});

test('the 21st question within the hour answers 429 with the hourly sentence', async () => {
    const raider = await loginAs('raider');
    for (let i = 1; i <= 20; i++) {
        const res = await raider.send('POST', `/api/events/${OPEN}/ask`, { question: `Frage ${i}` });
        assert.equal(res.status, 200);
        await res.text();
    }
    const res = await raider.send('POST', `/api/events/${OPEN}/ask`, { question: 'Frage 21' });
    assert.equal(res.status, 429);
    assert.match((await res.json()).error, /Stunde/);
});
