const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const http = require('http');
const { createTempDir, startServer, createClient } = require('./helpers');

// Admin API of the AI integration (routes/adminAi.js) in dev mock mode:
// AI_PROVIDER=mock and AI_MODEL=mock-1 come from the environment there.
let server;
before(async () => {
    server = await startServer('dev/start.js', { DEV_SQLITE_PATH: path.join(createTempDir('ai-admin'), 'dev.sqlite') });
});
after(() => server.stop());

async function loginAs(personaId) {
    const client = createClient(server.baseUrl);
    assert.equal((await client.request(`/auth/dev-login/${personaId}`)).status, 302);
    return client;
}

test('members get 403 on every AI admin route', async () => {
    const member = await loginAs('member');
    assert.equal((await member.request('/api/admin/ai/settings')).status, 403);
    assert.equal((await member.send('PUT', '/api/admin/ai/settings', { teaserEnabled: false })).status, 403);
    assert.equal((await member.send('POST', '/api/admin/ai/test', {})).status, 403);
    assert.equal((await member.send('POST', '/api/admin/ai/models', {})).status, 403);
    assert.equal((await member.request('/api/admin/ai/usage')).status, 403);
});

test('admins read the defaults, the provider table and configured: true', async () => {
    const admin = await loginAs('admin');
    const res = await admin.request('/api/admin/ai/settings');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.configured, true);
    assert.equal(data.settings.memberQuestionsPerHour, 20);
    assert.equal(data.settings.teaserText, 'Fragen zum Event? Frag mich einfach.');
    assert.deepEqual(data.providers.map(p => p.id), ['ollama', 'openrouter', 'openai', 'gemini', 'anthropic']);
    assert.deepEqual(Object.keys(data.providers[0]).sort(), ['defaultBaseUrl', 'id', 'keyRequired', 'label']);
});

test('an invalid value is refused with the sentence, a valid save is stored and audited without values', async () => {
    const admin = await loginAs('admin');
    const bad = await admin.send('PUT', '/api/admin/ai/settings', { teaserText: 'x'.repeat(121) });
    assert.equal(bad.status, 400);
    assert.deepEqual(await bad.json(), { error: 'Der Hinweistext darf höchstens 120 Zeichen lang sein.' });

    const res = await admin.send('PUT', '/api/admin/ai/settings', { assistantName: 'Gildenhelfer', dailyQuestionLimit: 0, extraInstructions: 'Streng-geheimer-Zusatz' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.settings.assistantName, 'Gildenhelfer');
    assert.equal(body.settings.dailyQuestionLimit, 0);

    const stored = await (await admin.request('/api/admin/ai/settings')).json();
    assert.equal(stored.settings.assistantName, 'Gildenhelfer');
    assert.equal(stored.settings.memberQuestionsPerHour, 20);

    const logs = (await (await admin.request('/api/admin/audit-log?limit=500')).json()).data.filter(log => log.action === 'UPDATE_AI_SETTINGS');
    assert.equal(logs.length, 1);
    assert.deepEqual([...logs[0].details.keys].sort(), ['assistantName', 'dailyQuestionLimit', 'extraInstructions']);
    assert.equal(JSON.stringify(logs[0]).includes('Gildenhelfer'), false);
    assert.equal(JSON.stringify(logs[0]).includes('Streng-geheimer-Zusatz'), false);
});

test('the connection test and the model list work in mock mode', async () => {
    const admin = await loginAs('admin');
    const ok = await (await admin.send('POST', '/api/admin/ai/test', {})).json();
    assert.equal(ok.ok, true);
    assert.equal(typeof ok.ms, 'number');
    const models = await admin.send('POST', '/api/admin/ai/models', {});
    assert.equal(models.status, 200);
    assert.deepEqual(await models.json(), { models: ['mock-1'] });
});

test('a test against a closed port answers 200 with the fixed message; models answer 502', async () => {
    const admin = await loginAs('admin');
    const body = { provider: 'openai', baseUrl: 'http://127.0.0.1:1', apiKey: 'typed-key', model: 'm' };
    const test = await admin.send('POST', '/api/admin/ai/test', body);
    assert.equal(test.status, 200);
    assert.deepEqual(await test.json(), { ok: false, error: 'Der KI-Anbieter ist nicht erreichbar.' });
    const models = await admin.send('POST', '/api/admin/ai/models', body);
    assert.equal(models.status, 502);
    assert.deepEqual(await models.json(), { error: 'Der KI-Anbieter ist nicht erreichbar.' });
});

test('usage answers today and the days; the overview status names the AI', async () => {
    const admin = await loginAs('admin');
    const usage = await (await admin.request('/api/admin/ai/usage')).json();
    assert.deepEqual(usage.today, { memberQuestions: 0, adminRequests: 0, inputTokens: 0, outputTokens: 0 });
    assert.ok(Array.isArray(usage.days));
    const system = await (await admin.request('/api/admin/system/settings')).json();
    assert.deepEqual(system.status.ai, { on: true, provider: 'Mock' });
});

test('no answer contains the stored API key', async () => {
    const admin = await loginAs('admin');
    const saved = await admin.send('PUT', '/api/admin/system/settings', { password: 'dev', values: { AI_API_KEY: 'sehr-geheimer-key-4711' } });
    assert.equal(saved.status, 200);
    const answers = [
        await admin.request('/api/admin/ai/settings'),
        await admin.send('PUT', '/api/admin/ai/settings', { teaserEnabled: false }),
        await admin.send('POST', '/api/admin/ai/test', { provider: 'openai', baseUrl: 'http://127.0.0.1:1', model: 'm' }),
        await admin.send('POST', '/api/admin/ai/models', { provider: 'openai', baseUrl: 'http://127.0.0.1:1' }),
        await admin.request('/api/admin/ai/usage'),
        await admin.request('/api/admin/system/settings'),
        await admin.request('/api/admin/audit-log?limit=500')
    ];
    for (const res of answers) assert.equal((await res.text()).includes('sehr-geheimer-key-4711'), false);
});

const ASK_REFRESHED = 'Befehle und Ankündigungen aktualisiert (Event-Assistent)';
/** How often a server printed the refresh line of the mock bot. */
const askRefreshes = (target = server) => target.output().split(ASK_REFRESHED).length - 1;
/** Wait until the server printed the refresh line `count` times (it runs after the answer). */
async function waitForRefreshes(count, target = server) {
    for (let i = 0; i < 40 && askRefreshes(target) < count; i++) await new Promise(resolve => setTimeout(resolve, 50));
    return askRefreshes(target);
}

test('only a flip of the Discord feature refreshes /ask and the announcements, once', async () => {
    const admin = await loginAs('admin');
    const start = askRefreshes();
    for (const body of [{ teaserText: 'Frag ruhig.' }, { assistantName: 'Fragefuchs' }, { memberQuestionsPerHour: 30 }]) {
        assert.equal((await admin.send('PUT', '/api/admin/ai/settings', body)).status, 200);
    }
    for (const values of [{ SERVER_NAME: 'Fragerunde' }, { AI_MODEL_ADMIN: 'mock-admin' }]) {
        const saved = await admin.send('PUT', '/api/admin/system/settings', { password: 'dev', values });
        assert.equal(saved.status, 200);
        assert.deepEqual((await saved.json()).changed, Object.keys(values));
    }
    assert.equal(await waitForRefreshes(start + 1), start, 'values that cannot flip the feature leave Discord alone');

    assert.equal((await admin.send('PUT', '/api/admin/ai/settings', { memberDiscord: false })).status, 200);
    assert.equal(await waitForRefreshes(start + 2), start + 1);
    assert.equal((await admin.send('PUT', '/api/admin/ai/settings', { memberDiscord: true })).status, 200);
    assert.equal(await waitForRefreshes(start + 3), start + 2);
});

test('a system settings save that configures the AI flips the feature and refreshes once', async () => {
    // A provider that needs a key and none set: the AI is not configured until the key is saved
    const other = await startServer('dev/start.js', {
        DEV_SQLITE_PATH: path.join(createTempDir('ai-admin-key'), 'dev.sqlite'), AI_PROVIDER: 'openai', AI_MODEL: 'gpt-test'
    });
    try {
        const admin = createClient(other.baseUrl);
        assert.equal((await admin.request('/auth/dev-login/admin')).status, 302);
        assert.equal((await admin.send('PUT', '/api/admin/ai/settings', { memberDiscord: false })).status, 200);
        assert.equal((await admin.send('PUT', '/api/admin/ai/settings', { memberDiscord: true })).status, 200);
        assert.equal(await waitForRefreshes(1, other), 0, 'the switch cannot flip an unconfigured AI');

        const saved = await admin.send('PUT', '/api/admin/system/settings', { password: 'dev', values: { AI_API_KEY: 'neuer-key-123' } });
        assert.equal(saved.status, 200);
        assert.equal(await waitForRefreshes(2, other), 1);
    } finally {
        await other.stop();
    }
});

test('a typed foreign base URL never receives the stored API key', async () => {
    const received = [];
    const foreign = http.createServer((req, res) => {
        received.push(req.headers.authorization || '');
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'x' }], choices: [{ message: { content: 'ok' } }], usage: {} }));
    });
    await new Promise(resolve => foreign.listen(0, '127.0.0.1', resolve));
    try {
        const admin = await loginAs('admin');
        assert.equal((await admin.send('PUT', '/api/admin/system/settings', { password: 'dev', values: { AI_API_KEY: 'gespeicherter-key-99' } })).status, 200);
        // The stored provider is the mock (no HTTP): the real adapter is reached through a different provider
        const body = { provider: 'ollama', baseUrl: `http://127.0.0.1:${foreign.address().port}/v1`, apiKey: '', model: 'm' };
        await admin.send('POST', '/api/admin/ai/test', body);
        await admin.send('POST', '/api/admin/ai/models', body);
        assert.ok(received.length >= 2);
        for (const header of received) assert.equal(header.includes('gespeicherter-key-99'), false);
    } finally {
        foreign.close();
    }
});
