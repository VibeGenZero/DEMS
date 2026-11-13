const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadFrontendApp, isHidden } = require('./helpers');

/** Open the wizard for a new event; `settings` answers GET /api/admin/bot/settings (omitted = 404). */
async function openWizard(settings) {
    const routes = { '/api/admin/roles': [], '/api/admin/event-templates': [] };
    if (settings) routes['/api/admin/bot/settings'] = settings;
    const frontend = await loadFrontendApp(routes);
    frontend.state.currentUser = { id: 'u-admin', username: 'mori', roles: [], isAdmin: true };
    frontend.state.csrfToken = 'test-token';
    await frontend.app.openEventEditor();
    return frontend;
}

test('with channel creation off in the bot center the wizard locks the channel option', async () => {
    const { element } = await openWizard({ autoChannelCreation: false, dmNotifications: true });
    assert.equal(element('event-auto-create-channels').disabled, true);
    assert.equal(isHidden(element('event-channels-locked')), false);
    // The fake DOM knows ids, not texts -> the sentence is checked in the markup
    const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'index.html'), 'utf8');
    assert.ok(html.includes('id="event-channels-locked"><i class="bi bi-lock me-1"></i>In der Bot-Zentrale ausgeschaltet.</div>'));
});

test('with channel creation on the option stays usable', async () => {
    const { element } = await openWizard({ autoChannelCreation: true, dmNotifications: true });
    assert.equal(element('event-auto-create-channels').disabled, false);
    assert.ok(isHidden(element('event-channels-locked')));
});

test('when the bot settings cannot be read the option stays usable', async () => {
    const { element, state } = await openWizard();
    assert.equal(element('event-auto-create-channels').disabled, false);
    assert.ok(isHidden(element('event-channels-locked')));
    assert.equal(state.botSettings.dmNotifications, true, 'unknown settings count as on');
});

test('editing an event applies the lock too', async () => {
    const event = { id: 'e1', status: 'active', startDate: '', autoCreateChannels: true, title: 'Mit Kanal' };
    const frontend = await loadFrontendApp({
        '/api/events/e1?status=all': event, '/api/admin/roles': [], '/api/admin/event-templates': [],
        '/api/admin/bot/settings': { autoChannelCreation: false, dmNotifications: true }
    });
    frontend.state.currentUser = { id: 'u-admin', username: 'mori', roles: [], isAdmin: true };
    await frontend.app.openEventEditor({ eventId: 'e1' });
    assert.equal(frontend.element('event-auto-create-channels').disabled, true);
    assert.equal(frontend.element('event-auto-create-channels').checked, true, 'the event keeps its option');
});

test('with DM notifications off the wizard does not offer "Teilnehmer benachrichtigen"', async () => {
    const event = { id: 'e2', status: 'active', startDate: '2099-03-06T19:00:00.000Z', endDate: '', title: 'Raid', location: null };
    for (const [dmNotifications, shown] of [[false, false], [true, true]]) {
        const frontend = await loadFrontendApp({
            '/api/events/e2?status=all': event, '/api/admin/roles': [], '/api/admin/event-templates': [],
            '/api/admin/bot/settings': { dmNotifications, autoChannelCreation: true }
        });
        frontend.state.currentUser = { id: 'u-admin', username: 'mori', roles: [], isAdmin: true };
        await frontend.app.openEventEditor({ eventId: 'e2' });
        frontend.app.updateNotifySwitch({ ...event, startDate: '2099-03-07T19:00:00.000Z' });
        assert.equal(isHidden(frontend.element('wizard-notify')), !shown, `dmNotifications ${dmNotifications}`);
    }
});

// ── Bot center: announcement channel (B-02) ─────────────────────────────

const CHANNELS = [
    { id: 'c-voice', name: 'Lobby', type: 'voice' },
    { id: 'c-events', name: 'events', type: 'text' },
    { id: 'c-general', name: 'allgemein', type: 'text' }
];

async function openBotCenter(settings, channels = CHANNELS) {
    const frontend = await loadFrontendApp({
        '/api/admin/bot/settings': settings,
        '/api/admin/channels': channels
    });
    frontend.state.currentUser = { id: 'u-admin', username: 'mori', roles: [], isAdmin: true };
    frontend.state.csrfToken = 'test-token';
    await frontend.app.loadBotSettings();
    return frontend;
}

test('the bot center lists only text channels after "Standard aus .env" and selects the stored one', async () => {
    const { element } = await openBotCenter({ announceChannel: 'c-events', dmNotifications: true });
    const options = element('bot-announce-channel').innerHTML;
    assert.ok(options.startsWith('<option value="">Standard aus .env</option>'), options);
    assert.ok(options.includes('<option value="c-events">#events</option>'));
    assert.ok(options.includes('<option value="c-general">#allgemein</option>'));
    assert.equal(options.includes('c-voice'), false);
    assert.equal(element('bot-announce-channel').value, 'c-events');
});

test('a stored channel the bot cannot list stays selectable, so saving keeps it', async () => {
    const { element } = await openBotCenter({ announceChannel: 'c-gone' }, []);
    assert.ok(element('bot-announce-channel').innerHTML.includes('<option value="c-gone">Gespeicherter Kanal (c-gone)</option>'));
    assert.equal(element('bot-announce-channel').value, 'c-gone');
});

test('channel names are escaped in the dropdown', async () => {
    const { element } = await openBotCenter({ announceChannel: '' }, [{ id: 'x', name: '<b>böse</b>', type: 'text' }]);
    assert.ok(element('bot-announce-channel').innerHTML.includes('#&lt;b&gt;böse&lt;/b&gt;'));
});

test('saving the bot center sends the chosen announcement channel', async () => {
    const frontend = await openBotCenter({ announceChannel: '' });
    frontend.element('bot-announce-channel').value = 'c-general';
    await frontend.app.saveBotSettingsForm();
    const sent = frontend.requests.find(request => request.url === '/api/admin/bot/settings' && request.method === 'PUT');
    assert.equal(JSON.parse(sent.body).announceChannel, 'c-general');
});

test('no element that starts hidden carries a Bootstrap display utility (its !important would show it)', () => {
    const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const clashes = [...html.matchAll(/class="([^"]*)"/g)]
        .map(match => match[1].split(/\s+/))
        .filter(classes => classes.includes('is-hidden') && classes.some(name => /^d-(block|flex|inline|inline-block|inline-flex|grid)$/.test(name)))
        .map(classes => classes.join(' '));
    assert.deepEqual(clashes, []);
});

// ── Bot center: discussion threads (B-14) ───────────────────────────────

test('the thread switch shows the stored value, on when the key is missing', async () => {
    assert.equal((await openBotCenter({ announcementThreads: false })).element('bot-announcement-threads').checked, false);
    assert.equal((await openBotCenter({})).element('bot-announcement-threads').checked, true);
});

test('saving the bot center sends the thread switch', async () => {
    const frontend = await openBotCenter({ announcementThreads: true });
    frontend.element('bot-announcement-threads').checked = false;
    await frontend.app.saveBotSettingsForm();
    const sent = frontend.requests.find(request => request.url === '/api/admin/bot/settings' && request.method === 'PUT');
    assert.equal(JSON.parse(sent.body).announcementThreads, false);
});

test('the thread switch says what it does', () => {
    // The fake DOM knows ids, not texts -> the label is checked in the markup
    const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'index.html'), 'utf8');
    assert.match(html, /id="bot-announcement-threads" checked>/);
    assert.match(html, /<i class="bi bi-chat-dots me-1"><\/i>Diskussions-Thread zu Ankündigungen/);
    assert.ok(html.includes('Öffnet beim Ankündigen eines Events einen Thread für Fragen und Absprachen.'));
});

// ── Approval channel (B-06) ─────────────────────────────────────────────

const APPROVAL_CHANNELS = [
    { id: 'c-text', name: 'freigaben', type: 'text' },
    { id: 'c-voice', name: 'Lobby', type: 'voice' }
];

test('the approval channel list offers "Keiner" and the text channels', async () => {
    const { app } = await loadFrontendApp({});
    const html = app.approvalChannelOptions(APPROVAL_CHANNELS, '');
    assert.ok(html.startsWith('<option value="">Keiner – Freigaben nur auf der Website</option>'));
    assert.ok(html.includes('<option value="c-text">#freigaben</option>'));
    assert.ok(!html.includes('Lobby'));
    assert.ok(app.approvalChannelOptions([], 'c-old').includes('Gespeicherter Kanal (c-old)'));
});

test('the bot center loads and saves the approval channel', async () => {
    const settings = { approvalChannel: 'c-text', announceChannel: '' };
    const frontend = await loadFrontendApp({
        '/api/admin/bot/settings': settings,
        '/api/admin/channels': APPROVAL_CHANNELS
    });
    frontend.state.csrfToken = 'test-token';
    await frontend.app.loadBotSettings();
    const select = frontend.element('bot-approval-channel');
    assert.ok(select.innerHTML.includes('#freigaben'));
    assert.equal(select.value, 'c-text');

    select.value = '';
    await frontend.app.saveBotSettingsForm();
    const put = frontend.requests.find(request => request.method === 'PUT');
    assert.equal(JSON.parse(put.body).approvalChannel, '');
});
