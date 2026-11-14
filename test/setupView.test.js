const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadFrontendApp, httpAnswer, isHidden, REPO_ROOT } = require('./helpers');

// #138: the setup wizard in the SPA (public/js/pages/setup.js)
const SOURCE = fs.readFileSync(path.join(REPO_ROOT, 'public', 'js', 'pages', 'setup.js'), 'utf8');
const HTML = fs.readFileSync(path.join(REPO_ROOT, 'public', 'index.html'), 'utf8');

const STATUS = {
    required: true, unlocked: false, locked: [],
    defaults: { BASE_URL: 'https://events.example.org', TIMEZONE: 'Europe/Berlin' }
};

test('the setup section and its steps start hidden', () => {
    for (const id of ['setup-section', 'setup-error', 'setup-step-pin', 'setup-step-discord', 'setup-step-server',
        'setup-step-security', 'setup-step-ai', 'setup-step-privacy', 'setup-step-done', 'setup-done-restart']) {
        assert.match(HTML, new RegExp(`<[^>]*class="[^"]*is-hidden[^"]*"[^>]*id="${id}"|<[^>]*id="${id}"[^>]*class="[^"]*is-hidden`), id);
    }
});

test('a fresh installation shows the wizard and never asks who is logged in', async () => {
    const { app, element, requests } = await loadFrontendApp({ '/api/csrf-token': { token: 't' }, '/api/setup/status': STATUS });
    await app.finishLoading();

    const urls = requests.map(request => request.url);
    assert.ok(urls.includes('/api/setup/status'));
    assert.ok(!urls.includes('/auth/me'));
    assert.equal(element('setup-section').style.display, 'block');
    assert.equal(element('main-navbar').style.display, 'none');
    assert.equal(isHidden(element('setup-step-pin')), false);
    assert.equal(isHidden(element('setup-step-discord')), true);
    assert.match(element('setup-steps').innerHTML, /is-active[^>]*aria-current="step"><i class="bi bi-1-circle"/);
});

test('a set-up installation goes on with the login check', async () => {
    const { app, element, requests } = await loadFrontendApp({
        '/api/csrf-token': { token: 't' },
        '/api/setup/status': { ...STATUS, required: false },
        '/auth/me': null
    });
    await app.finishLoading();
    assert.ok(requests.some(request => request.url === '/auth/me'));
    assert.notEqual(element('setup-section').style.display, 'block');
});

test('the PIN unlocks the wizard and takes the new CSRF token', async () => {
    let unlocked = false;
    const { app, state, element, requests } = await loadFrontendApp({
        '/api/csrf-token': { token: 'old' },
        '/api/setup/status': () => ({ ...STATUS, unlocked, discordDone: false, values: {}, secretsSet: {} }),
        '/api/setup/unlock': () => { unlocked = true; return { success: true, csrfToken: 'new' }; }
    });
    await app.finishLoading();
    element('setup-pin').value = ' 12345678 ';
    await app.runAction('submitSetupPin', {});

    const unlock = requests.find(request => request.url === '/api/setup/unlock');
    assert.equal(unlock.method, 'POST');
    assert.equal(unlock.headers['X-CSRF-TOKEN'], 'old');
    assert.deepEqual(JSON.parse(unlock.body), { pin: '12345678' });
    assert.equal(state.csrfToken, 'new');
    assert.equal(isHidden(element('setup-step-discord')), false);
    assert.match(element('setup-guide').innerHTML, /guide-step-5/);
    assert.match(element('setup-discord-fields').innerHTML, /id="setup-client-id"[^>]*data-input="setupClientIdChanged"/);
    assert.match(element('setup-discord-fields').innerHTML, /data-click="openGuideStep" data-guide-step="2"/);
});

test('values from .env are read-only with "aus .env", secrets stay hidden', async () => {
    const { app, element } = await loadFrontendApp({
        '/api/csrf-token': { token: 't' },
        '/api/setup/status': {
            ...STATUS, unlocked: true, discordDone: false,
            locked: ['DISCORD_CLIENT_ID', 'DISCORD_BOT_TOKEN'],
            values: { DISCORD_CLIENT_ID: '123456789012345678"><b>' },
            secretsSet: { DISCORD_BOT_TOKEN: true, DISCORD_CLIENT_SECRET: false }
        }
    });
    await app.finishLoading();
    const html = element('setup-discord-fields').innerHTML;
    assert.match(html, /id="setup-client-id" value="123456789012345678&quot;&gt;&lt;b&gt;"[^>]* readonly/);
    assert.match(html, /Client ID <span class="chip chip-sm chip-info">aus \.env<\/span>/);
    assert.match(html, /id="setup-bot-token" value="" placeholder="gesetzt \(aus \.env\)" readonly/);
    assert.ok(!html.includes('<b>'));
});

test('a Discord error names its guide step and the invite link opens step 4', async () => {
    const { app, element } = await loadFrontendApp({
        '/api/csrf-token': { token: 't' },
        '/api/setup/status': { ...STATUS, unlocked: true, discordDone: false, values: {}, secretsSet: {} },
        '/api/setup/discord': httpAnswer(400, { error: 'Der Bot ist nicht auf dem Server mit dieser ID. Lade ihn mit dem Einladungslink ein (Schritt 4 der Anleitung).', inviteUrl: 'https://discord.com/oauth2/authorize?client_id=1&scope=bot' })
    });
    await app.finishLoading();
    await app.runAction('submitSetupDiscord', {});

    assert.equal(isHidden(element('setup-step-discord')), false);
    const error = element('setup-error');
    assert.equal(isHidden(error), false);
    assert.match(error.innerHTML, /Schritt 4 der Anleitung\)\. <button[^>]*data-click="openGuideStep" data-guide-step="4"/);
    const guide = element('setup-guide').innerHTML;
    assert.match(guide, /href="https:\/\/discord\.com\/oauth2\/authorize\?client_id=1&amp;scope=bot" class="btn btn-discord setup-guide-invite"/);
    assert.match(guide, /id="guide-step-4" open/);
    assert.equal(element('setup-discord-submit').disabled, false);
});

test('the server step offers the roles, channels and categories from Discord', async () => {
    const { app, element } = await loadFrontendApp({
        '/api/csrf-token': { token: 't' },
        '/api/setup/status': { ...STATUS, unlocked: true, discordDone: true, values: { BASE_URL: '' }, secretsSet: {} },
        '/api/setup/guild': {
            guildName: 'Gilde <3',
            roles: [{ id: '345678901234567890', name: 'Orga', managed: false }, { id: '345678901234567891', name: 'Bot-Rolle', managed: true }],
            channels: [{ id: '456789012345678901', name: 'news', type: 'text' }, { id: '456789012345678902', name: 'Lobby', type: 'voice' }],
            categories: [{ id: '567890123456789012', name: 'Events' }]
        }
    });
    await app.finishLoading();
    const html = element('setup-server-fields').innerHTML;
    assert.equal(isHidden(element('setup-step-server')), false);
    assert.match(html, /id="setup-base-url" value="https:\/\/events\.example\.org"/);
    assert.match(html, /<option value="345678901234567890">Orga<\/option>/);
    assert.ok(!html.includes('Bot-Rolle'));
    assert.match(html, /<option value="456789012345678901">news<\/option>/);
    assert.ok(!html.includes('Lobby'));
    assert.match(html, /<option value="567890123456789012">Events<\/option>/);
    assert.match(html, /placeholder="Gilde &lt;3"/);
    assert.equal(element('setup-server-intro').textContent, 'Der Bot ist auf „Gilde <3“ angemeldet. Jetzt Adresse, Name und Rollen festlegen.');
});

test('the security step checks length and repetition before going on', async () => {
    const { app, element } = await loadFrontendApp({
        '/api/csrf-token': { token: 't' },
        '/api/setup/status': { ...STATUS, unlocked: true, discordDone: true, values: {}, secretsSet: {} },
        '/api/setup/guild': { guildName: 'G', roles: [], channels: [], categories: [] }
    });
    await app.finishLoading();
    app.showSetupStep('security');
    element('setup-reset-password').value = 'kurz';
    await app.runAction('submitSetupSecurity', {});
    assert.match(element('setup-error').innerHTML, /mindestens 12 Zeichen/);

    element('setup-reset-password').value = 'ein-langes-passwort';
    element('setup-reset-password-repeat').value = 'anders-und-lang';
    await app.runAction('submitSetupSecurity', {});
    assert.match(element('setup-error').innerHTML, /stimmen nicht überein/);

    element('setup-reset-password-repeat').value = 'ein-langes-passwort';
    await app.runAction('submitSetupSecurity', {});
    assert.equal(isHidden(element('setup-step-ai')), false);
});

test('completing sends every collected value and shows the login button', async () => {
    const { app, element, requests } = await loadFrontendApp({
        '/api/csrf-token': { token: 't' },
        '/api/setup/status': { ...STATUS, unlocked: true, discordDone: true, values: {}, secretsSet: {} },
        '/api/setup/guild': { guildName: 'G', roles: [], channels: [], categories: [] },
        '/api/setup/complete': { success: true, restartRequired: true }
    });
    await app.finishLoading();
    element('setup-base-url').value = 'https://dems.example.org';
    await app.runAction('submitSetupServer', {});
    element('setup-reset-password').value = 'ein-langes-passwort';
    element('setup-reset-password-repeat').value = 'ein-langes-passwort';
    await app.runAction('submitSetupSecurity', {});
    element('setup-ai-provider').value = 'ollama';
    element('setup-ai-model').value = 'llama3.1';
    await app.runAction('submitSetupAi', {});
    element('setup-privacy-text').value = '# Datenschutz';
    await app.runAction('completeSetup', {});

    const body = JSON.parse(requests.find(request => request.url === '/api/setup/complete').body);
    assert.equal(body.baseUrl, 'https://dems.example.org');
    assert.equal(body.adminResetPassword, 'ein-langes-passwort');
    assert.equal(body.privacyMarkdown, '# Datenschutz');
    assert.equal(body.aiProvider, 'ollama');
    assert.equal(body.aiModel, 'llama3.1');
    assert.equal(isHidden(element('setup-step-done')), false);
    assert.equal(isHidden(element('setup-done-restart')), false);
});

test('the wizard escapes values and names its actions literally', () => {
    assert.match(SOURCE, /escapeHtml\(/);
    assert.doesNotMatch(SOURCE, /style="|\bon[a-z]+="/);
    for (const name of ['submitSetupPin', 'submitSetupDiscord', 'submitSetupServer', 'submitSetupSecurity', 'submitSetupAi', 'skipSetupAi', 'testSetupAi', 'loadSetupAiModels', 'setupAiProviderChanged', 'completeSetup', 'previewSetupPrivacy', 'setupBack', 'setupClientIdChanged']) {
        assert.ok(HTML.includes(`data-click="${name}"`) || HTML.includes(`data-input="${name}"`) || SOURCE.includes(`data-input="${name}"`) || SOURCE.includes(`data-click="${name}"`) || SOURCE.includes(`data-change="${name}"`), name);
        assert.match(SOURCE, new RegExp(`\\b${name}[,:]`));
    }
});

test('the PIN step warns when the setup is opened without HTTPS in production', async () => {
    const { app, element } = await loadFrontendApp({ '/api/csrf-token': { token: 't' }, '/api/setup/status': { ...STATUS, httpsRequired: true } });
    await app.finishLoading();
    assert.equal(isHidden(element('setup-https-warning')), false);
    const secure = await loadFrontendApp({ '/api/csrf-token': { token: 't' }, '/api/setup/status': { ...STATUS, httpsRequired: false } });
    await secure.app.finishLoading();
    assert.equal(isHidden(secure.element('setup-https-warning')), true);
});

// ── Step „KI (optional)" ───────────────────────────────────────────────

const AI_PROVIDERS = [
    { id: 'ollama', label: 'Ollama (lokal oder Cloud)', defaultBaseUrl: 'http://localhost:11434/v1', keyRequired: false },
    { id: 'openai', label: 'OpenAI', defaultBaseUrl: 'https://api.openai.com/v1', keyRequired: true }
];

async function openAiStep(routes = {}, status = {}) {
    const harness = await loadFrontendApp({
        '/api/csrf-token': { token: 't' },
        '/api/setup/status': { ...STATUS, unlocked: true, discordDone: true, values: {}, secretsSet: {}, aiProviders: AI_PROVIDERS, ...status },
        '/api/setup/guild': { guildName: 'G', roles: [], channels: [], categories: [] },
        '/api/setup/complete': { success: true, restartRequired: false },
        ...routes
    });
    await harness.app.finishLoading();
    harness.app.showSetupStep('ai');
    return harness;
}

test('the step list shows seven labels with „KI" fifth', async () => {
    const { element } = await openAiStep();
    const labels = [...element('setup-steps').innerHTML.matchAll(/<span>([^<]*)<\/span>/g)].map(match => match[1]);
    assert.deepEqual(labels, ['PIN', 'Discord', 'Server', 'Sicherheit', 'KI', 'Datenschutz', 'Fertig']);
    assert.match(element('setup-steps').innerHTML, /is-active[^>]*aria-current="step"><i class="bi bi-5-circle"/);
});

test('the AI step explains itself and offers „Keine KI verwenden" first', async () => {
    const { element } = await openAiStep();
    assert.match(HTML, /id="setup-step-ai"[\s\S]*KI \(optional\)[\s\S]*DEMS kann Fragen von Mitgliedern zu Events beantworten und dir beim Erstellen von Events helfen\. Du kannst das auch später unter System › KI einrichten\./);
    const fields = element('setup-ai-fields').innerHTML;
    assert.match(fields, /<select[^>]*id="setup-ai-provider"[^>]*data-change="setupAiProviderChanged"[^>]*><option value="">Keine KI verwenden<\/option><option value="ollama">Ollama \(lokal oder Cloud\)<\/option>/);
    assert.match(fields, /id="setup-ai-base-url"/);
    assert.match(fields, /type="password"[^>]*id="setup-ai-api-key"|id="setup-ai-api-key"[^>]*type="password"/);
    assert.match(fields, /id="setup-ai-model"[^>]*list="setup-ai-models"/);
    assert.match(fields, /data-click="loadSetupAiModels"/);
    for (const action of ['testSetupAi', 'skipSetupAi', 'submitSetupAi']) assert.match(HTML, new RegExp(`data-click="${action}"`));
});

test('„Überspringen" leads to the privacy step and sends empty AI values', async () => {
    const { app, element, requests } = await openAiStep();
    element('setup-ai-provider').value = 'openai';
    element('setup-ai-api-key').value = 'sk-x';
    element('setup-ai-model').value = 'gpt';
    await app.runAction('skipSetupAi', {});
    assert.equal(isHidden(element('setup-step-privacy')), false);
    await app.runAction('completeSetup', {});
    const body = JSON.parse(requests.find(request => request.url === '/api/setup/complete').body);
    assert.equal(body.aiProvider, '');
    assert.equal(body.aiBaseUrl, '');
    assert.equal(body.aiApiKey, '');
    assert.equal(body.aiModel, '');
});

test('„Weiter" with a provider but no model stays on the step', async () => {
    const { app, element } = await openAiStep();
    element('setup-ai-provider').value = 'ollama';
    await app.runAction('submitSetupAi', {});
    assert.match(element('setup-error').innerHTML, /Bitte wähle ein KI-Modell oder überspringe den KI-Schritt\./);
    assert.equal(isHidden(element('setup-step-ai')), false);
});

test('the test button sends the typed values and shows the result chip', async () => {
    const { app, element, requests } = await openAiStep({ '/api/setup/ai/test': { ok: true, ms: 42 } });
    element('setup-ai-provider').value = 'ollama';
    element('setup-ai-model').value = 'llama3.1';
    await app.runAction('testSetupAi', {});
    const request = requests.find(entry => entry.url === '/api/setup/ai/test');
    assert.equal(request.method, 'POST');
    assert.deepEqual(JSON.parse(request.body), { provider: 'ollama', baseUrl: '', apiKey: '', model: 'llama3.1' });
    assert.match(element('setup-ai-test-result').innerHTML, /chip-success[^>]*>Verbunden · 42 ms/);

    const failed = await openAiStep({ '/api/setup/ai/test': { ok: false, error: '<b>Der KI-Anbieter ist nicht erreichbar.</b>' } });
    failed.element('setup-ai-provider').value = 'ollama';
    await failed.app.runAction('testSetupAi', {});
    assert.match(failed.element('setup-ai-test-result').innerHTML, /chip-danger[^>]*>&lt;b&gt;Der KI-Anbieter ist nicht erreichbar\.&lt;\/b&gt;/);
});

test('„Modelle laden" fills the suggestions of the model field', async () => {
    const { app, element } = await openAiStep({ '/api/setup/ai/models': { models: ['llama3.1', '<x>'] } });
    element('setup-ai-provider').value = 'ollama';
    await app.runAction('loadSetupAiModels', {});
    assert.equal(element('setup-ai-models').innerHTML, '<option value="llama3.1"></option><option value="&lt;x&gt;"></option>');
    const failed = await openAiStep({ '/api/setup/ai/models': httpAnswer(502, { error: 'Der KI-Anbieter ist nicht erreichbar.' }) });
    failed.element('setup-ai-provider').value = 'ollama';
    await failed.app.runAction('loadSetupAiModels', {});
    assert.match(failed.element('setup-error').innerHTML, /Der KI-Anbieter ist nicht erreichbar\./);
});

test('a new provider shows its default address and drops the old test result', async () => {
    const { app, element } = await openAiStep({ '/api/setup/ai/test': { ok: true, ms: 5 } });
    element('setup-ai-provider').value = 'ollama';
    await app.runAction('testSetupAi', {});
    element('setup-ai-provider').value = 'openai';
    await app.runAction('setupAiProviderChanged', element('setup-ai-provider'));
    assert.equal(element('setup-ai-base-url').placeholder, 'https://api.openai.com/v1');
    assert.equal(element('setup-ai-test-result').innerHTML, '');
});

test('AI values from .env are read-only with "aus .env"', async () => {
    const { element } = await openAiStep({}, { locked: ['AI_PROVIDER', 'AI_API_KEY'], values: { AI_PROVIDER: 'ollama' }, secretsSet: { AI_API_KEY: true } });
    const fields = element('setup-ai-fields').innerHTML;
    assert.match(fields, /id="setup-ai-provider" value="ollama"[^>]*readonly/);
    assert.match(fields, /API-Schlüssel <span class="chip chip-sm chip-info">aus \.env<\/span>/);
    assert.doesNotMatch(fields, /<select[^>]*id="setup-ai-provider"/);
});

test('a refused AI value of the server leads back to the AI step', async () => {
    const { app, element } = await openAiStep({ '/api/setup/complete': httpAnswer(400, { error: 'Bitte wähle ein KI-Modell oder überspringe den KI-Schritt.' }) });
    app.showSetupStep('privacy');
    await app.runAction('completeSetup', {});
    assert.equal(isHidden(element('setup-step-ai')), false);
    assert.match(element('setup-error').innerHTML, /KI-Modell/);
});
