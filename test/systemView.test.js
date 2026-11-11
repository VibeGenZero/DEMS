const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadFrontendApp, httpAnswer, REPO_ROOT } = require('./helpers');

// #138: admin page "System" (#system, public/js/admin/system.js)
const SOURCE = fs.readFileSync(path.join(REPO_ROOT, 'public', 'js', 'admin', 'system.js'), 'utf8');
const HTML = fs.readFileSync(path.join(REPO_ROOT, 'public', 'index.html'), 'utf8');

const SETTINGS = [
    { key: 'DISCORD_CLIENT_ID', group: 'discord', secret: false, value: '123456789012345678', isSet: true, source: 'db', locked: false, applies: 'live' },
    { key: 'DISCORD_CLIENT_SECRET', group: 'discord', secret: true, value: null, isSet: true, source: 'db', locked: false, applies: 'live' },
    { key: 'DISCORD_BOT_TOKEN', group: 'discord', secret: true, value: null, isSet: false, source: 'none', locked: false, applies: 'bot' },
    { key: 'DISCORD_GUILD_ID', group: 'discord', secret: false, value: '234567890123456789', isSet: true, source: 'env', locked: true, applies: 'bot' },
    { key: 'DISCORD_THREAD_SYNC', group: 'discord', secret: false, value: '', isSet: false, source: 'none', locked: false, applies: 'restart' },
    { key: 'SERVER_NAME', group: 'server', secret: false, value: 'Gilde"><b>', isSet: true, source: 'db', locked: false, applies: 'live' },
    { key: 'BASE_URL', group: 'server', secret: false, value: 'https://events.example.org', isSet: true, source: 'env', locked: true, applies: 'live' },
    { key: 'TIMEZONE', group: 'server', secret: false, value: '', isSet: false, source: 'none', locked: false, applies: 'live' },
    { key: 'ADMIN_RESET_PASSWORD', group: 'security', secret: true, value: null, isSet: true, source: 'env', locked: true, applies: 'live' }
];

async function openSystem(routes = {}) {
    const harness = await loadFrontendApp({ '/api/admin/system/settings': { settings: SETTINGS }, ...routes });
    harness.state.currentUser = { id: 'a', isAdmin: true };
    await harness.app.showSystemSection();
    return harness;
}

test('the admin header links the System page, the router guards it', () => {
    assert.match(HTML, /<a class="btn btn-outline-light" href="#system">/);
    assert.match(HTML, /<section id="system-section" class="app-section is-hidden">/);
    const router = fs.readFileSync(path.join(REPO_ROOT, 'public', 'js', 'core', 'router.js'), 'utf8');
    assert.match(router, /case 'system':\s*\n\s*if \(state\.currentUser && state\.currentUser\.isAdmin\) \{\s*\n\s*showSystemSection\(\);/);
    assert.match(router, /system: 'admin'/);
});

test('values are grouped, a value from .env is read-only with "aus .env"', async () => {
    const { element } = await openSystem();
    assert.equal(element('system-section').style.display, 'block');
    const discord = element('system-discord-fields').innerHTML;
    assert.match(discord, /id="system-DISCORD_GUILD_ID"[^>]*value="234567890123456789"[^>]* readonly/);
    assert.match(discord, /Server-ID <span class="chip chip-sm chip-info">aus \.env<\/span>/);
    assert.match(discord, /id="system-DISCORD_CLIENT_ID"[^>]*value="123456789012345678"/);
    assert.match(element('system-server-fields').innerHTML, /id="system-BASE_URL"[^>]* readonly/);
    assert.match(element('system-security-fields').innerHTML, /aus \.env/);
});

test('secrets show only whether they are set, values are escaped', async () => {
    const { element } = await openSystem();
    const discord = element('system-discord-fields').innerHTML;
    assert.match(discord, /id="system-DISCORD_CLIENT_SECRET" type="password" value="" placeholder="gesetzt – leer lassen zum Behalten"/);
    assert.match(discord, /id="system-DISCORD_BOT_TOKEN" type="password" value="" placeholder="nicht gesetzt"/);
    assert.match(discord, /<span class="chip chip-sm chip-success">gesetzt<\/span>/);
    assert.match(discord, /Wirkt erst nach einem Neustart/);
    const server = element('system-server-fields').innerHTML;
    assert.ok(server.includes('value="Gilde&quot;&gt;&lt;b&gt;"'));
    assert.ok(!server.includes('<b>'));
});

test('saving sends only the changed values with the reset password', async () => {
    const { app, element, requests, toasts } = await openSystem({
        '/api/admin/system/settings': (options) => (options.method === 'PUT'
            ? { success: true, changed: ['SERVER_NAME', 'DISCORD_BOT_TOKEN'], restartRequired: false, bot: { ok: true, guildName: 'Gilde' } }
            : { settings: SETTINGS })
    });
    await app.runAction('saveSystemSettings', {});
    assert.deepEqual(toasts, ['Keine Änderungen zum Speichern.']);

    element('system-SERVER_NAME').value = 'Neue Gilde';
    element('system-DISCORD_BOT_TOKEN').value = 'neuer-token';
    await app.runAction('saveSystemSettings', {});
    element('system-reset-password').value = 'geheim';
    await app.runAction('confirmSystemSave', {});

    const put = requests.find(request => request.method === 'PUT');
    assert.equal(put.url, '/api/admin/system/settings');
    assert.deepEqual(JSON.parse(put.body), { password: 'geheim', values: { SERVER_NAME: 'Neue Gilde', DISCORD_BOT_TOKEN: 'neuer-token' } });
    assert.ok(toasts.includes('Systemeinstellungen gespeichert. Der Bot ist neu angemeldet.'));
    assert.equal(element('system-reset-password').value, '');
});

test('a refused save names the reason and keeps the input', async () => {
    const { app, element, toasts } = await openSystem({
        '/api/admin/system/settings': (options) => (options.method === 'PUT'
            ? httpAnswer(401, { error: 'Ungültiges Admin-Reset-Passwort.' })
            : { settings: SETTINGS })
    });
    element('system-SERVER_NAME').value = 'X';
    await app.runAction('saveSystemSettings', {});
    element('system-reset-password').value = 'falsch';
    await app.runAction('confirmSystemSave', {});
    assert.deepEqual(toasts, ['Ungültiges Admin-Reset-Passwort.']);
    assert.equal(element('system-SERVER_NAME').value, 'X');
});

test('"Anleitung anzeigen" opens the Discord guide with the invite link of the client id', async () => {
    const { app, element } = await openSystem({ '/api/admin/system/invite-url': { url: 'https://discord.com/oauth2/authorize?client_id=123456789012345678' } });
    await app.runAction('showDiscordGuideDialog', {});
    const guide = element('system-guide').innerHTML;
    assert.match(guide, /guide-step-5/);
    assert.match(guide, /https:\/\/events\.example\.org\/auth\/discord\/callback/);
    assert.match(guide, /href="https:\/\/discord\.com\/oauth2\/authorize\?client_id=123456789012345678"/);
});

test('the page names its actions literally and keeps no inline style', () => {
    for (const name of ['saveSystemSettings', 'confirmSystemSave', 'showDiscordGuideDialog']) {
        assert.ok(HTML.includes(`data-click="${name}"`), name);
        assert.match(SOURCE, new RegExp(`\\b${name}[,:\\s]`));
    }
    assert.doesNotMatch(SOURCE, /style="|\bon[a-z]+="/);
    assert.match(SOURCE, /escapeHtml\(/);
});

test('the privacy card loads the policy and previews it', async () => {
    const { app, element } = await openSystem({ '/api/privacy': { markdown: '# Datenschutz', version: 2, updatedAt: '2026-11-09T10:00:00.000Z' } });
    assert.equal(element('system-privacy-text').value, '# Datenschutz');
    assert.match(element('system-privacy-version').textContent, /Fassung 2/);
    element('system-privacy-text').value = '# Neu';
    await app.runAction('previewSystemPrivacy', {});
    assert.match(element('system-privacy-preview').innerHTML, /# Neu/);
});

test('saving the policy reports the new version and that everybody accepts again', async () => {
    const { app, element, requests, toasts } = await openSystem({
        '/api/privacy': httpAnswer(404, { error: 'Es gibt keine Datenschutzerklärung.' }),
        '/api/admin/privacy': { success: true, version: 1, changed: true }
    });
    assert.match(element('system-privacy-version').textContent, /Noch keine/);
    element('system-privacy-text').value = '# Datenschutz';
    await app.runAction('saveSystemPrivacy', {});
    const put = requests.find(request => request.url === '/api/admin/privacy');
    assert.equal(put.method, 'PUT');
    assert.deepEqual(JSON.parse(put.body), { markdown: '# Datenschutz' });
    assert.deepEqual(toasts, ['Datenschutzerklärung gespeichert (Fassung 1). Alle Mitglieder stimmen beim nächsten Besuch neu zu.']);
});

// Version card: GET /api/admin/system/update-status (utils/updateCheck.js)
const STATUS = {
    enabled: true, reason: null, current: '3.0.0', latest: null, updateAvailable: false, switchToLatest: false,
    releaseUrl: null, checkedAt: '2026-11-11T10:00:00.000Z', channel: null, commit: null
};
const versionCard = async (status) => {
    const { element, toasts } = await openSystem({ '/api/admin/system/update-status': status });
    return { body: element('system-update-body').innerHTML, toasts };
};

test('a newer version shows the release link and the update command', async () => {
    const { body } = await versionCard({ ...STATUS, latest: '3.0.1', updateAvailable: true, releaseUrl: 'https://github.com/VibeGenZero/DEMS/releases/tag/3.0.1' });
    assert.match(body, /Update verfügbar/);
    assert.match(body, /Neue Version <strong>3\.0\.1<\/strong> verfügbar \(installiert: 3\.0\.0\)/);
    assert.match(body, /href="https:\/\/github\.com\/VibeGenZero\/DEMS\/releases\/tag\/3\.0\.1"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
    assert.match(body, /Was ist neu\?/);
    assert.match(body, /docker compose pull &amp;&amp; docker compose up -d/);
});

test('without a release link the card shows no link', async () => {
    const { body } = await versionCard({ ...STATUS, latest: '3.0.1', updateAvailable: true });
    assert.match(body, /Neue Version/);
    assert.doesNotMatch(body, /<a /);
});

test('a pre-release install is told to switch to latest for a final release', async () => {
    const { body } = await versionCard({ ...STATUS, current: '3.0.0-rc.1', latest: '3.0.0', updateAvailable: true, switchToLatest: true });
    assert.match(body, /fertige Release/);
    assert.match(body, /DEMS_TAG=latest/);
    // A compose file with a fixed tag (deployment example) changes the image line instead
    assert.match(body, /image: moritakahashi\/dems:latest/);
    assert.doesNotMatch(body, /Neue Version/);
});

test('up to date, not yet answered, switched off, edge, mock mode and an invalid repo each say so', async () => {
    assert.match((await versionCard(STATUS)).body, /DEMS 3\.0\.0 ist aktuell\. Zuletzt geprüft: /);
    assert.match((await versionCard({ ...STATUS, checkedAt: null })).body, /Noch keine Antwort von GitHub/);
    assert.match((await versionCard({ ...STATUS, enabled: false, reason: 'disabled', checkedAt: null })).body, /ausgeschaltet \(UPDATE_CHECK=false\)/);
    const edge = (await versionCard({ ...STATUS, enabled: false, reason: 'edge', channel: 'edge', commit: 'abcdef1', checkedAt: null })).body;
    assert.match(edge, /Entwicklungsstand \(edge, Commit abcdef1\)/);
    assert.match((await versionCard({ ...STATUS, enabled: false, reason: 'mock', checkedAt: null })).body, /Dev-Mock-Modus/);
    assert.match((await versionCard({ ...STATUS, enabled: false, reason: 'invalid-repo', checkedAt: null })).body, /UPDATE_CHECK_REPO ist ungültig/);
});

test('values in the version card are escaped', async () => {
    const { body } = await versionCard({ ...STATUS, current: '<b>x', latest: '<img src=x>', updateAvailable: true });
    assert.match(body, /&lt;img src=x&gt;/);
    assert.doesNotMatch(body, /<img|<b>/);
});

test('a failed status request says so in the card, without a toast', async () => {
    const { body, toasts } = await versionCard(httpAnswer(500, { error: 'x' }));
    assert.match(body, /Versionsinfo konnte nicht geladen werden/);
    assert.deepEqual(toasts, []);
});

test('the version card is the first card of the System page', () => {
    assert.match(HTML, /<div class="system-grid">\s*<div class="glass-card system-card" id="system-update-card">/);
    assert.match(HTML, /<div id="system-update-body"><\/div>/);
});
