const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { loadFrontendApp, isHidden } = require('./helpers');
const { PARTICIPANT_MESSAGE_CASES } = require('./fixtures/participantMessageCases');

let app;
before(async () => { ({ app } = await loadFrontendApp({})); });

// ── Pure parts ────────────────────────────────────────────────

for (const [description, input, expected] of PARTICIPANT_MESSAGE_CASES) {
    test(`the preview matches the DM of the server: ${description}`, () => {
        assert.equal(app.buildParticipantMessagePreview(input), expected);
    });
}

test('the counter names one or many people', () => {
    assert.equal(app.participantCountText(1), 'an 1 Person');
    assert.equal(app.participantCountText(12), 'an 12 Personen');
    assert.equal(app.participantCountText(0), 'an 0 Personen');
});

test('the preview looks like a Discord message with the DM text', () => {
    const html = app.renderParticipantPreview('Hallo **Team**');
    assert.match(html, /^<div class="discord-message">/);
    assert.match(html, /discord-message-author">DEMS</);
    assert.match(html, /Hallo \*\*Team\*\*/);
});

test('the two groups are accepted only (default) and all registrations', () => {
    assert.deepEqual(Array.from(app.PARTICIPANT_GROUPS, group => [group.key, group.label]), [
        ['accepted', 'Nur Angenommene'],
        ['all', 'Alle Anmeldungen']
    ]);
});

// ── Dialog ────────────────────────────────────────────────────

const COUNTS_URL = '/api/admin/events/ev/message-recipients';
const SEND_URL = '/api/admin/events/ev/message';

async function openDialog({ counts = { accepted: 3, all: 5 }, sent = { recipients: 3, delivered: 3 } } = {}) {
    const loaded = await loadFrontendApp({
        [COUNTS_URL]: counts,
        [SEND_URL]: typeof sent === 'function' ? sent : sent
    });
    loaded.state.csrfToken = 'token-1';
    loaded.state.currentUser = { id: 'admin', displayName: 'Mori', isAdmin: true };
    await loaded.app.showParticipantMessage('ev', 'Raid');
    return loaded;
}

const type = (loaded, text) => {
    loaded.element('participant-message-text').value = text;
    loaded.app.updateParticipantMessage();
};

test('opening loads the counts and starts with accepted only', async () => {
    const loaded = await openDialog();
    assert.ok(loaded.requests.some(r => r.url === COUNTS_URL && r.method === 'GET'));
    assert.equal(loaded.element('participant-message-title').textContent, 'Raid');
    assert.equal(loaded.element('participant-message-count').textContent, 'an 3 Personen');
    loaded.app.setParticipantGroup('all');
    assert.equal(loaded.element('participant-message-count').textContent, 'an 5 Personen');
});

test('sending is disabled without text and with nobody to reach', async () => {
    const loaded = await openDialog({ counts: { accepted: 0, all: 2 } });
    assert.equal(loaded.element('participant-message-send').disabled, true);
    type(loaded, 'Hallo');
    assert.equal(loaded.element('participant-message-send').disabled, true);
    assert.match(loaded.element('participant-message-hint').textContent, /Niemand in dieser Auswahl/);
    loaded.app.setParticipantGroup('all');
    assert.equal(loaded.element('participant-message-send').disabled, false);
    type(loaded, '   ');
    assert.equal(loaded.element('participant-message-send').disabled, true);
});

test('the preview and the character count follow the text', async () => {
    const loaded = await openDialog();
    type(loaded, 'Treffpunkt Tor 2');
    assert.match(loaded.element('participant-message-preview').innerHTML, /Treffpunkt Tor 2/);
    assert.match(loaded.element('participant-message-preview').innerHTML, /Nachricht zum Event „Raid“/);
    assert.match(loaded.element('participant-message-preview').innerHTML, /— Mori · Alle Infos: .*#event\/ev/);
    assert.equal(loaded.element('participant-message-chars').textContent, '16 / 1500');
});

test('asking to send shows the question and posts nothing; going back keeps the text', async () => {
    const loaded = await openDialog();
    type(loaded, 'Hallo');
    loaded.app.askSendParticipantMessage();
    assert.equal(isHidden(loaded.element('participant-message-confirm')), false);
    assert.equal(isHidden(loaded.element('participant-message-actions')), true);
    assert.equal(loaded.element('participant-message-question').textContent, 'Nachricht an 3 Personen senden?');
    assert.ok(!loaded.requests.some(r => r.url === SEND_URL));

    loaded.app.cancelSendParticipantMessage();
    assert.equal(isHidden(loaded.element('participant-message-confirm')), true);
    assert.equal(loaded.element('participant-message-text').value, 'Hallo');
    assert.ok(!loaded.requests.some(r => r.url === SEND_URL));
});

test('sending posts text and group with the CSRF token and reports the delivery', async () => {
    const loaded = await openDialog();
    type(loaded, '  Hallo  ');
    loaded.app.setParticipantGroup('all');
    loaded.app.askSendParticipantMessage();
    await loaded.app.sendParticipantMessage();
    const post = loaded.requests.find(r => r.url === SEND_URL);
    assert.equal(post.method, 'POST');
    assert.equal(post.headers['X-CSRF-TOKEN'], 'token-1');
    assert.deepEqual(JSON.parse(post.body), { text: 'Hallo', group: 'all' });
    assert.deepEqual(loaded.toasts, ['Nachricht an 3 von 3 Personen zugestellt.']);
});

test('a partial delivery is reported as such', async () => {
    const loaded = await openDialog({ sent: { recipients: 3, delivered: 0 } });
    type(loaded, 'Hallo');
    loaded.app.askSendParticipantMessage();
    await loaded.app.sendParticipantMessage();
    assert.deepEqual(loaded.toasts, ['Nachricht an 0 von 3 Personen zugestellt.']);
});
