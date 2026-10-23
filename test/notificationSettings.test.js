/**
 * W-16 in the fake DOM: the profile switches "Discord-Nachrichten" load the
 * stored DM choices and save one kind at a time.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadFrontendApp, REPO_ROOT } = require('./helpers');

const EMOJI = /\p{Extended_Pictographic}/u;
const KINDS = ['reminders', 'changes', 'waitlist'];
const SETTINGS = { acceptInvitations: true, notifications: { reminders: true, changes: false, waitlist: true } };
// The element double does not read data-* from the markup (the last test checks them there)
const toggleOf = (element, kind) => Object.assign(element(`notify-${kind}-toggle`), { dataset: { kind } });

/**
 * Profile code with a logged-in member.
 *
 * @param {Object} routes -> Fake fetch answers.
 * @returns {Promise<Object>} -> loadFrontendApp() result.
 */
async function openProfile(routes) {
    const frontend = await loadFrontendApp(routes);
    frontend.state.currentUser = { id: 'u-tom', username: 'tom', roles: [], isAdmin: false };
    frontend.state.csrfToken = 'test-token';
    return frontend;
}

test('loading the settings sets the three DM switches', async () => {
    const { app, element } = await openProfile({ '/api/user/settings': SETTINGS });
    await app.loadAccountSettings();
    assert.deepEqual(KINDS.map(kind => toggleOf(element, kind).checked), [true, false, true]);
    assert.equal(element('accept-invitations-toggle').checked, true);
});

test('a switch saves only its own kind and says so', async () => {
    const { app, element, requests, toasts } = await openProfile({ '/api/user/settings': SETTINGS });
    await app.loadAccountSettings();
    const toggle = toggleOf(element, 'waitlist');
    toggle.checked = false;
    await app.saveNotificationSetting(toggle);

    const put = requests.find(request => request.method === 'PUT');
    assert.equal(put.url, '/api/user/settings');
    assert.equal(put.headers['X-CSRF-TOKEN'], 'test-token');
    assert.deepEqual(JSON.parse(put.body), { notifications: { waitlist: false } });
    assert.equal(toasts.at(-1), 'Warteliste per DM aus.');

    const changes = toggleOf(element, 'changes');
    changes.checked = true;
    await app.saveNotificationSetting(changes);
    assert.deepEqual(JSON.parse(requests.filter(request => request.method === 'PUT').at(-1).body), { notifications: { changes: true } });
    assert.equal(toasts.at(-1), 'Änderungen per DM an.');
});

test('a failed save puts the switch back and says so', async () => {
    // No route -> the fake fetch answers 404
    const { app, element, toasts } = await openProfile({});
    const toggle = toggleOf(element, 'reminders');
    toggle.checked = false;
    await app.saveNotificationSetting(toggle);
    assert.equal(toggle.checked, true);
    assert.equal(toasts.at(-1), 'Einstellung konnte nicht gespeichert werden.');
});

test('the settings card has three labelled DM switches with German texts', () => {
    const html = fs.readFileSync(path.join(REPO_ROOT, 'public', 'index.html'), 'utf8');
    const card = html.slice(html.indexOf('id="account-settings-card"'), html.indexOf('Account löschen'));
    assert.ok(card.includes('Discord-Nachrichten'));
    for (const [kind, label] of [['reminders', 'Erinnerungen'], ['changes', 'Änderungen'], ['waitlist', 'Warteliste']]) {
        const input = card.match(new RegExp(`<input[^>]*id="notify-${kind}-toggle"[^>]*>`));
        assert.ok(input, kind);
        assert.match(input[0], /role="switch"/);
        assert.match(input[0], new RegExp(`aria-label="${label}"`));
        assert.match(input[0], new RegExp(`data-kind="${kind}"`));
        assert.match(input[0], /data-change="saveNotificationSetting"/);
    }
    assert.ok(card.includes('Nachrücken melden wir immer.'));
    assert.ok(card.indexOf('accept-invitations-toggle') < card.indexOf('notify-reminders-toggle'), 'below the invitations');
    assert.doesNotMatch(card.slice(card.indexOf('Discord-Nachrichten')), EMOJI);
});
