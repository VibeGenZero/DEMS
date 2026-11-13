const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadFrontendApp, httpAnswer, isHidden, REPO_ROOT } = require('./helpers');

// Category "KI" of the admin page "System" (public/js/admin/system-ai.js)
const HTML = fs.readFileSync(path.join(REPO_ROOT, 'public', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const SOURCE = fs.readFileSync(path.join(REPO_ROOT, 'public', 'js', 'admin', 'system-ai.js'), 'utf8');

const SETTINGS = [
    { key: 'DISCORD_CLIENT_ID', group: 'discord', secret: false, value: '1', isSet: true, source: 'db', locked: false, applies: 'live' },
    { key: 'AI_PROVIDER', group: 'ai', secret: false, value: 'openai', isSet: true, source: 'db', locked: false, applies: 'live' },
    { key: 'AI_BASE_URL', group: 'ai', secret: false, value: '', isSet: false, source: 'none', locked: false, applies: 'live' },
    { key: 'AI_API_KEY', group: 'ai', secret: true, value: null, isSet: true, source: 'db', locked: false, applies: 'live' },
    { key: 'AI_MODEL', group: 'ai', secret: false, value: 'gpt-x', isSet: true, source: 'db', locked: false, applies: 'live' },
    { key: 'AI_MODEL_ADMIN', group: 'ai', secret: false, value: '', isSet: false, source: 'none', locked: false, applies: 'live' }
];
const LOCKED = SETTINGS.map(entry => (entry.key === 'AI_PROVIDER' ? { ...entry, value: 'mock', source: 'env', locked: true } : entry));
const AI_SETTINGS = {
    memberWeb: true, memberDiscord: true, adminAssistant: true, teaserEnabled: true, teaserText: 'Fragen zum Event? Frag mich einfach.',
    assistantName: 'Event-Assistent', extraInstructions: '', memberQuestionsPerHour: 20, dailyQuestionLimit: 500
};
const PROVIDERS = [
    { id: 'ollama', label: 'Ollama (lokal oder Cloud)', defaultBaseUrl: 'http://localhost:11434/v1', keyRequired: false },
    { id: 'openai', label: 'OpenAI', defaultBaseUrl: 'https://api.openai.com/v1', keyRequired: true }
];
const USAGE = {
    today: { memberQuestions: 3, adminRequests: 1, inputTokens: 100, outputTokens: 50 },
    days: [
        { date: '2026-11-13', memberQuestions: 3, adminRequests: 1, inputTokens: 100, outputTokens: 50, errors: 0 },
        { date: '2026-11-12', memberQuestions: 7, adminRequests: 0, inputTokens: 900, outputTokens: 450, errors: 0 }
    ]
};

async function openSystem(routes = {}, settings = SETTINGS) {
    const harness = await loadFrontendApp({
        '/api/admin/system/settings': { settings, status: { database: 'sqlite', bot: { online: true, guildName: 'G' }, ai: { on: true, provider: 'OpenAI' } } },
        '/api/admin/ai/settings': (options) => (options.method === 'PUT'
            ? { success: true, settings: { ...AI_SETTINGS, ...JSON.parse(options.body) } }
            : { settings: AI_SETTINGS, providers: PROVIDERS, configured: true }),
        '/api/admin/ai/usage': USAGE,
        ...routes
    });
    harness.state.currentUser = { id: 'a', isAdmin: true };
    await harness.app.showSystemSection('ai');
    return harness;
}

test('the category KI sits after Sicherheit and has its panel', async () => {
    const { element } = await openSystem();
    const nav = element('system-nav').innerHTML;
    assert.ok(nav.indexOf('href="#system/security"') < nav.indexOf('href="#system/ai"'));
    assert.ok(nav.indexOf('href="#system/ai"') < nav.indexOf('href="#system/privacy"'));
    assert.match(nav, /<span class="settings-nav-label">KI<\/span>\s*<span class="settings-nav-sub">Anbieter, Assistenten<\/span>/);
    assert.equal(isHidden(element('system-panel-ai')), false);
    assert.match(HTML, /<datalist id="system-ai-models">/);
    assert.match(HTML, /Namen und Discord-IDs der Mitglieder werden nie mitgesendet\./);
});

test('the provider is a select with "Aus" first, the model fields use the datalist', async () => {
    const { element } = await openSystem();
    const fields = element('system-ai-fields').innerHTML;
    assert.match(fields, /<select class="form-select" id="system-AI_PROVIDER"[^>]*><option value="">Aus<\/option><option value="ollama">Ollama \(lokal oder Cloud\)<\/option><option value="openai" selected>OpenAI<\/option><\/select>/);
    assert.match(fields, /id="system-AI_BASE_URL"[^>]*placeholder="https:\/\/api\.openai\.com\/v1"/);
    assert.match(fields, /id="system-AI_MODEL" type="text" list="system-ai-models"/);
    assert.match(fields, /id="system-AI_MODEL_ADMIN" type="text" list="system-ai-models"/);
    assert.match(fields, /id="system-AI_API_KEY" type="password"/);
    assert.match(fields, /Leer lassen = den bisherigen behalten\./);
    assert.match(fields, /Nur für Ollama oder eigene Endpunkte nötig\./);
    assert.match(fields, /Optional: stärkeres Modell für das Erstellen von Events\. Leer = wie oben\./);
});

test('a provider locked by .env renders read-only with "aus .env"', async () => {
    const { element } = await openSystem({}, LOCKED);
    const fields = element('system-ai-fields').innerHTML;
    assert.match(fields, /Anbieter <span class="chip chip-sm chip-info">aus \.env<\/span>/);
    assert.match(fields, /<select class="form-select" id="system-AI_PROVIDER"[^>]* disabled>/);
    assert.match(fields, /<option value="mock" selected>mock<\/option>/);
});

test('the test button sends the typed, unsaved values and shows the result as a chip', async () => {
    const { app, element, requests } = await openSystem({ '/api/admin/ai/test': { ok: true, ms: 42 } });
    element('system-AI_PROVIDER').value = 'ollama';
    element('system-AI_BASE_URL').value = 'http://ollama.test:11434/v1';
    element('system-AI_API_KEY').value = 'frisch-getippt';
    element('system-AI_MODEL').value = 'llama3';
    await app.runAction('testAiConnection', {});
    const post = requests.find(request => request.url === '/api/admin/ai/test');
    assert.equal(post.method, 'POST');
    assert.deepEqual(JSON.parse(post.body), { provider: 'ollama', baseUrl: 'http://ollama.test:11434/v1', apiKey: 'frisch-getippt', model: 'llama3' });
    assert.match(element('ai-test-result').innerHTML, /chip-success">Verbunden · 42 ms</);
});

test('a failed test shows the message as a danger chip, escaped', async () => {
    const { app, element } = await openSystem({ '/api/admin/ai/test': { ok: false, error: 'Der KI-Anbieter ist <nicht> erreichbar.' } });
    await app.runAction('testAiConnection', {});
    assert.match(element('ai-test-result').innerHTML, /chip-danger">Der KI-Anbieter ist &lt;nicht&gt; erreichbar\.</);
});

test('"Modelle laden" fills the datalist, a failure toasts the message', async () => {
    const ok = await openSystem({ '/api/admin/ai/models': { models: ['a', 'b"c'] } });
    await ok.app.runAction('loadAiModels', {});
    assert.equal(ok.element('system-ai-models').innerHTML, '<option value="a"></option><option value="b&quot;c"></option>');
    const bad = await openSystem({ '/api/admin/ai/models': httpAnswer(502, { error: 'Der KI-Anbieter ist nicht erreichbar.' }) });
    await bad.app.runAction('loadAiModels', {});
    assert.deepEqual(bad.toasts, ['Der KI-Anbieter ist nicht erreichbar.']);
});

test('saving the behaviour settings sends no password and clears its mark', async () => {
    const { app, element, requests, toasts } = await openSystem();
    element('ai-assistantName').value = 'Gildenhelfer';
    element('ai-dailyQuestionLimit').value = '0';
    await app.runAction('aiSettingChanged', {});
    assert.deepEqual([...app.dirtyCategories()], ['ai']);
    await app.runAction('saveAiSettings', {});
    const put = requests.find(request => request.url === '/api/admin/ai/settings' && request.method === 'PUT');
    const body = JSON.parse(put.body);
    assert.equal('password' in body, false);
    assert.equal(body.assistantName, 'Gildenhelfer');
    assert.equal(body.dailyQuestionLimit, 0);
    assert.equal(body.memberQuestionsPerHour, 20);
    assert.deepEqual(toasts, ['KI-Einstellungen gespeichert.']);
    assert.deepEqual([...app.dirtyCategories()], []);
});

test('the unsaved mark covers the connection fields and the behaviour block independently', async () => {
    const { app, element } = await openSystem();
    element('system-AI_MODEL').value = 'anderes';
    await app.runAction('systemFieldChanged', { id: 'system-AI_MODEL', value: 'x', dataset: { group: 'ai' } });
    element('ai-teaserText').value = 'Neu';
    await app.runAction('aiSettingChanged', {});
    assert.deepEqual([...app.dirtyCategories()], ['ai']);
    // Undoing the behaviour input keeps the mark of the connection fields
    element('ai-teaserText').value = AI_SETTINGS.teaserText;
    await app.runAction('aiSettingChanged', {});
    assert.deepEqual([...app.dirtyCategories()], ['ai']);
    element('system-AI_MODEL').value = 'gpt-x';
    await app.runAction('systemFieldChanged', { id: 'system-AI_MODEL', value: 'x', dataset: { group: 'ai' } });
    assert.deepEqual([...app.dirtyCategories()], []);
});

test('the character counter and the usage table are drawn', async () => {
    const { app, element } = await openSystem();
    element('ai-extraInstructions').value = 'Duze alle.';
    await app.runAction('aiSettingChanged', {});
    assert.equal(element('ai-extraInstructions-count').textContent, '10 / 1000');
    const usage = element('ai-usage-body').innerHTML;
    assert.match(usage, /Heute<\/th><td>3<\/td><td>1<\/td><td>100<\/td><td>50<\/td>/);
    assert.match(usage, /Letzte 30 Tage<\/th><td>10<\/td><td>1<\/td><td>1\.000<\/td><td>500<\/td>/);
});

test('the overview shows the row KI', async () => {
    const on = await openSystem();
    assert.match(on.element('system-status-list').innerHTML, /<span>KI<\/span>\s*<span class="chip chip-sm chip-success">OpenAI<\/span>/);
    const off = await openSystem({ '/api/admin/system/settings': { settings: SETTINGS, status: { database: 'sqlite', bot: { online: true, guildName: '' }, ai: { on: false, provider: '' } } } });
    assert.match(off.element('system-status-list').innerHTML, /<span>KI<\/span>\s*<span class="chip chip-sm">aus<\/span>/);
});

test('a failing AI load leaves the page usable and says so in the panel', async () => {
    const { element } = await openSystem({ '/api/admin/ai/settings': httpAnswer(500, { error: 'x' }) });
    assert.equal(element('ai-load-note').textContent, 'KI-Einstellungen konnten nicht geladen werden.');
    assert.match(element('system-ai-fields').innerHTML, /id="system-AI_PROVIDER"/);
});

test('the module names its actions literally and keeps no inline style', () => {
    for (const name of ['aiSettingChanged', 'testAiConnection', 'loadAiModels', 'saveAiSettings']) {
        assert.ok(HTML.includes(`data-${name === 'aiSettingChanged' ? 'change' : 'click'}="${name}"`), name);
        assert.match(SOURCE, new RegExp(`\\b${name}[,:\\s]`));
    }
    assert.doesNotMatch(SOURCE, /style="|\bon[a-z]+="/);
});
