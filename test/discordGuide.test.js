const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadFrontendApp, REPO_ROOT } = require('./helpers');

// #138: the step-by-step guide for the Discord application in the setup
// wizard and the admin "System" view (public/js/pages/discord-guide.js)
const SOURCE = fs.readFileSync(path.join(REPO_ROOT, 'public', 'js', 'pages', 'discord-guide.js'), 'utf8');

const render = async (options) => (await loadFrontendApp({})).app.renderDiscordGuide(options);

test('the guide has five steps in the order of the Developer Portal', async () => {
    const html = await render({ baseUrl: 'https://events.example.org', inviteUrl: '' });
    const titles = [...html.matchAll(/class="setup-guide-title">([^<]+)</g)].map(match => match[1]);
    assert.deepEqual(titles, [
        'Anwendung anlegen',
        'OAuth2: Client ID, Client Secret und Redirect-URL',
        'Bot: Token und Intents',
        'Bot auf deinen Server einladen',
        'Server-ID kopieren'
    ]);
    for (const step of [1, 2, 3, 4, 5]) assert.match(html, new RegExp(`id="guide-step-${step}"`));
    assert.match(html, /bi-1-circle/);
    assert.match(html, /bi-5-circle/);
});

test('the guide quotes the labels of the Developer Portal and of Discord exactly', async () => {
    const html = await render({ baseUrl: 'https://events.example.org', inviteUrl: '' });
    for (const label of ['New Application', 'Create', 'OAuth2', 'Client ID', 'Reset Secret', 'Add Redirect', 'Save Changes',
        'Reset Token', 'Privileged Gateway Intents', 'Server Members Intent', 'Message Content Intent', 'Public Bot',
        'Entwicklermodus', 'Server-ID kopieren']) {
        assert.ok(html.includes(`„${label}“`), `missing „${label}“`);
    }
});

test('the Developer Portal link opens in a new tab without opener', async () => {
    const html = await render({ baseUrl: 'https://events.example.org', inviteUrl: '' });
    assert.match(html, /<a href="https:\/\/discord\.com\/developers\/applications" target="_blank" rel="noopener noreferrer"/);
});

test('the redirect URL is built from BASE_URL, escaped and copyable', async () => {
    const html = await render({ baseUrl: 'https://events.example.org/"><script>', inviteUrl: '' });
    assert.ok(html.includes('https://events.example.org/&quot;&gt;&lt;script&gt;/auth/discord/callback'));
    assert.ok(!html.includes('<script>'));
    assert.match(html, /data-click="copyGuideValue" data-copy-value="https:\/\/events\.example\.org\/&quot;&gt;&lt;script&gt;\/auth\/discord\/callback"/);
});

test('the invite button appears only with an invite URL, otherwise a hint', async () => {
    const without = await render({ baseUrl: 'https://e.org', inviteUrl: '' });
    assert.match(without, /Trag zuerst die Client ID ein/);
    assert.doesNotMatch(without, /setup-guide-invite/);

    const url = 'https://discord.com/oauth2/authorize?client_id=123456789012345678&permissions=8&scope=bot%20applications.commands';
    const withUrl = await render({ baseUrl: 'https://e.org', inviteUrl: url });
    assert.ok(withUrl.includes(`href="${url.replace(/&/g, '&amp;')}"`));
    assert.match(withUrl, /class="btn btn-discord setup-guide-invite"[^>]*target="_blank" rel="noopener noreferrer"/);
});

test('done steps show a check mark and are closed, the open step is open', async () => {
    const html = await render({ baseUrl: 'https://e.org', inviteUrl: '', done: new Set([1, 2]), open: 3 });
    const step = (n) => html.match(new RegExp(`<details[^>]*id="guide-step-${n}"[^>]*>`))[0];
    assert.match(step(1), /is-done/);
    assert.doesNotMatch(step(1), /\bopen\b/);
    assert.match(step(3), /\bopen\b/);
    assert.equal((html.match(/bi-check-circle-fill/g) || []).length, 2);
});

test('marking a step as done closes it and opens the next one', async () => {
    const { app, element } = await loadFrontendApp({});
    const container = element('setup-guide');
    assert.ok(container, 'the setup section holds the guide container');
    app.resetDiscordGuide();
    app.mountDiscordGuide('setup-guide', { baseUrl: 'https://e.org', inviteUrl: '' });
    assert.match(container.innerHTML, /id="guide-step-1"[^>]* open/);

    await app.runAction('markGuideStepDone', { dataset: { guideStep: '1' } });
    assert.match(container.innerHTML, /class="setup-guide-step is-done" id="guide-step-1"/);
    assert.match(container.innerHTML, /id="guide-step-2"[^>]* open/);

    app.updateGuideInviteUrl('https://discord.com/oauth2/authorize?client_id=1');
    assert.match(container.innerHTML, /setup-guide-invite/);
});

test('the guide names its actions literally and has no inline style or handler', () => {
    for (const name of ['markGuideStepDone', 'openGuideStep', 'copyGuideValue']) {
        assert.match(SOURCE, new RegExp(`data-click="${name}"`));
        assert.match(SOURCE, new RegExp(`\\b${name}:`));
    }
    assert.doesNotMatch(SOURCE, /style="|\bon[a-z]+="/);
});

test('each input of the Discord step points to its guide step', async () => {
    const { app } = await loadFrontendApp({});
    assert.deepEqual({ ...app.GUIDE_FIELD_STEPS }, { clientId: 2, clientSecret: 2, botToken: 3, guildId: 5 });
});
