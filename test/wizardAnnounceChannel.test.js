const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadFrontendApp } = require('./helpers');

// Text and voice channels of the server (shape of GET /api/admin/channels)
const CHANNELS = [
    { id: '120000000000000002', name: 'ankündigungen', type: 'text' },
    { id: '120000000000000003', name: 'raid-termine', type: 'text' },
    { id: '120000000000000005', name: 'Event-Voice', type: 'voice' }
];
const DEFAULT_OPTION = '<option value="">Standard aus der Bot-Zentrale (#ankündigungen)</option>';

/** Open the wizard for a new event; `botSettings` answers GET /api/admin/bot/settings. */
async function openWizard({ botSettings = { announceChannel: '120000000000000002' }, routes = {} } = {}) {
    const frontend = await loadFrontendApp({
        '/api/admin/roles': [], '/api/admin/event-templates': [], '/api/admin/channels': CHANNELS,
        '/api/admin/bot/settings': botSettings, ...routes
    });
    frontend.state.currentUser = { id: 'u-admin', username: 'mori', roles: [], isAdmin: true };
    frontend.state.csrfToken = 'test-token';
    await frontend.app.openEventEditor();
    return frontend;
}

test('a new event offers the default first, then the text channels', async () => {
    const { element } = await openWizard();
    const select = element('event-announce-channel');
    assert.ok(select, 'select in step 5');
    assert.ok(select.innerHTML.startsWith(DEFAULT_OPTION), select.innerHTML);
    assert.match(select.innerHTML, /<option value="120000000000000003">#raid-termine<\/option>/);
    assert.doesNotMatch(select.innerHTML, /Event-Voice/);
    assert.equal(select.value, '');
});

test('without a bot center channel the default option names no channel', async () => {
    const { element } = await openWizard({ botSettings: { announceChannel: '' } });
    assert.ok(element('event-announce-channel').innerHTML.startsWith('<option value="">Standard aus der Bot-Zentrale</option>'));
});

test('a stored channel is selected; one the bot cannot list stays selectable', async () => {
    const { app, element } = await openWizard();
    await app.fillWizard({ title: 'Raid', announceChannelId: '120000000000000003' });
    assert.equal(element('event-announce-channel').value, '120000000000000003');

    await app.fillWizard({ title: 'Alt', announceChannelId: '199999999999999999' });
    const select = element('event-announce-channel');
    assert.match(select.innerHTML, /<option value="199999999999999999">Gespeicherter Kanal \(199999999999999999\)<\/option>/);
    assert.equal(select.value, '199999999999999999');

    await app.fillWizard({ title: 'Ohne' });
    assert.equal(element('event-announce-channel').value, '');
});

test('the draft sends the chosen channel', async () => {
    const { app, element } = await openWizard();
    element('event-announce-channel').value = '120000000000000003';
    assert.equal(app.collectEventDraft().announceChannelId, '120000000000000003');
    element('event-announce-channel').value = '';
    assert.equal(app.collectEventDraft().announceChannelId, '');
});

// ── Target line in the announce dialog ─────────────────────────────────

/** Open the announce dialog of one event; `event` answers GET /api/events/<id>. */
async function openAnnounceDialog(event, botSettings) {
    const frontend = await loadFrontendApp({
        '/api/admin/roles': [], '/api/admin/channels': CHANNELS, '/api/admin/bot/settings': botSettings,
        [`/api/events/${event.id}`]: event
    });
    frontend.state.currentUser = { id: 'u-admin', username: 'mori', roles: [], isAdmin: true };
    frontend.state.csrfToken = 'test-token';
    await frontend.app.announceEvent(event.id);
    return frontend.element('announce-target').textContent;
}

test('the announce dialog names the event channel, the default or the missing channel', async () => {
    const withDefault = { announceChannel: '', defaultAnnounceChannel: '120000000000000002' };
    assert.equal(await openAnnounceDialog({ id: 'e1', title: 'Raid', status: 'active', announceChannelId: '120000000000000003' }, withDefault),
        'Wird in #raid-termine gepostet.');
    assert.equal(await openAnnounceDialog({ id: 'e2', title: 'Abend', status: 'active', announceChannelId: '' }, withDefault),
        'Wird in #ankündigungen (Standard) gepostet.');
    assert.equal(await openAnnounceDialog({ id: 'e3', title: 'Abend', status: 'active' }, { announceChannel: '', defaultAnnounceChannel: '' }),
        'Kein Ankündigungskanal festgelegt – bitte in der Bot-Zentrale wählen.');
    assert.equal(await openAnnounceDialog({ id: 'e4', title: 'Alt', status: 'active', announceChannelId: '199999999999999999' }, withDefault),
        'Wird in Kanal 199999999999999999 gepostet.');
});

test('the wizard names the .env default when the bot center has none', async () => {
    const { element } = await openWizard({ botSettings: { announceChannel: '', defaultAnnounceChannel: '120000000000000002' } });
    assert.ok(element('event-announce-channel').innerHTML.startsWith(DEFAULT_OPTION));
});
