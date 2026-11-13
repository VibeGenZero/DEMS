const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadFrontendApp, isHidden } = require('./helpers');

/** Open the wizard for a new event as an admin; routes are added to the role list. */
async function openWizard(routes = {}) {
    const frontend = await loadFrontendApp({ '/api/admin/roles': [], ...routes });
    frontend.state.currentUser = { id: 'u-admin', username: 'mori', roles: [], isAdmin: true };
    frontend.state.csrfToken = 'test-token';
    await frontend.app.openEventEditor();
    return frontend;
}

const stepOf = (element) => element('wizard-step-counter').textContent;

test('"Weiter" without a title stays on step 1 and says why', async () => {
    const { app, element } = await openWizard();
    app.wizardNext();
    assert.equal(stepOf(element), 'Schritt 1 von 5');
    assert.ok(element('event-title').classList.contains('is-invalid'));
    assert.equal(element('event-title-feedback').textContent, 'Bitte einen Titel eingeben.');
    assert.ok(element('event-title-feedback').classList.contains('d-block'));
    assert.ok(element('wstep-1').classList.contains('has-error'));

    element('event-title').value = 'Raidnacht';
    app.wizardNext();
    assert.equal(stepOf(element), 'Schritt 2 von 5');
    assert.equal(element('event-title').classList.contains('is-invalid'), false);
    assert.equal(element('event-title-feedback').classList.contains('d-block'), false);
    assert.equal(element('wstep-1').classList.contains('has-error'), false);
});

test('an active event needs a start date before step 3, a draft does not', async () => {
    const { app, element, state } = await openWizard();
    element('event-title').value = 'Raidnacht';
    app.wizardNext();
    app.wizardNext();
    assert.equal(stepOf(element), 'Schritt 2 von 5');
    assert.equal(element('event-start-date-feedback').textContent, 'Aktive Events brauchen ein Startdatum.');
    assert.equal(isHidden(element('event-start-required')), false);

    element('event-status').value = 'draft';
    app.updateStartRequired();
    assert.ok(isHidden(element('event-start-required')));
    app.wizardNext();
    assert.equal(stepOf(element), 'Schritt 3 von 5');

    element('event-status').value = 'active';
    app.updateStartRequired();
    assert.equal(isHidden(element('event-start-required')), false);
    state.startDatePicker.selectedDates = [new Date('2026-12-01T18:00:00.000Z')];
    app.wizardBack();
    app.wizardNext();
    assert.equal(stepOf(element), 'Schritt 3 von 5');
});

test('"Speichern" checks every step, shows the first one with problems and sends nothing', async () => {
    const { app, element, requests } = await openWizard({ '/api/admin/events': { id: 'neu' } });
    element('event-title').value = 'Raidnacht';
    element('event-max').value = '-2';
    app.wizardGoTo(5);
    await app.saveEvent();
    assert.equal(stepOf(element), 'Schritt 2 von 5');
    assert.ok(element('wstep-2').classList.contains('has-error'));
    assert.ok(element('wstep-3').classList.contains('has-error'));
    assert.equal(element('event-max-feedback').textContent, 'Bitte eine ganze Zahl ab 0 eingeben.');
    assert.equal(element('wstep-1').classList.contains('has-error'), false);
    assert.equal(requests.some(request => request.url === '/api/admin/events'), false);
});

test('a valid draft is sent with all its fields', async () => {
    const { app, element, requests } = await openWizard({ '/api/admin/events': { id: 'neu' } });
    element('event-title').value = 'Raidnacht';
    element('event-status').value = 'draft';
    element('event-reminder').value = '24, 1';
    element('event-allow-tentative').checked = true;
    app.wizardGoTo(5);
    await app.saveEvent();
    const sent = requests.find(request => request.url === '/api/admin/events');
    assert.equal(sent.method, 'POST');
    const body = JSON.parse(sent.body);
    assert.deepEqual([body.title, body.status, body.reminderHours, body.startDate, body.formFields], ['Raidnacht', 'draft', '24, 1', '', []]);
    // „Vielleicht“ / Ersatzbank (B-17)
    assert.equal(body.allowTentative, true);
});

test('opening the wizard again clears the marks of the last attempt', async () => {
    const { app, element } = await openWizard();
    app.wizardNext();
    assert.ok(element('wstep-1').classList.contains('has-error'));
    await app.openEventEditor();
    assert.equal(element('wstep-1').classList.contains('has-error'), false);
    assert.equal(element('event-title-feedback').textContent, '');
});

// Components V2 message of the preview route (B-05)
const previewMessage = (heading) => ({
    components: [{
        type: 17, accent_color: 0x8b5cf6,
        components: [
            { type: 10, content: `## ${heading}\nBringt Tränke mit.` },
            { type: 1, components: [{ type: 2, style: 5, label: 'Zum Event', url: 'http://localhost:3000/#event/vorschau' }] }
        ]
    }]
});
const PREVIEW = {
    message: previewMessage('🎉 Raidnacht'),
    places: { taken: 2, capacity: 6, guests: 0, pending: 0, waitlist: 0, text: '2 von 6 Plätzen belegt', waitlistText: '' },
    bot: { name: 'DEMS Bot', avatarUrl: null }
};

test('the preview shows the card at once and the Discord message of the server', async () => {
    const { app, element, requests } = await openWizard({ '/api/admin/events/preview': PREVIEW });
    element('event-title').value = 'Raidnacht';
    await app.setWizardMode('preview');
    assert.ok(isHidden(element('wizard-page-1')));
    assert.equal(isHidden(element('wizard-preview')), false);
    assert.ok(element('wizard-mode-preview').classList.contains('active'));
    assert.equal(element('wizard-mode-edit').classList.contains('active'), false);

    const call = requests.find(request => request.url === '/api/admin/events/preview');
    assert.equal(call.method, 'POST');
    assert.equal(call.headers['X-CSRF-TOKEN'], 'test-token');
    assert.equal(JSON.parse(call.body).title, 'Raidnacht');
    assert.equal(JSON.parse(call.body).id, undefined);

    assert.ok(element('wizard-preview-card').innerHTML.includes('<h3 class="event-card-title">Raidnacht</h3>'));
    assert.ok(element('wizard-preview-card').innerHTML.includes('2 von 6 belegt'));
    const discordHtml = element('wizard-preview-discord').innerHTML;
    assert.ok(discordHtml.includes('<div class="discord-container" data-style-border-color="#8b5cf6">'), discordHtml);
    assert.ok(discordHtml.includes('🎉 Raidnacht'), discordHtml);
});

test('a failed preview keeps the card and says so', async () => {
    const { app, element } = await openWizard();
    element('event-title').value = 'Raidnacht';
    await app.setWizardMode('preview');
    assert.ok(element('wizard-preview-card').innerHTML.includes('Raidnacht'));
    assert.equal(element('wizard-preview-discord').innerHTML, '<p class="text-body-tertiary small mb-0">Discord-Vorschau gerade nicht verfügbar.</p>');
});

test('an answer that arrives after switching back is dropped', async () => {
    let answer;
    const late = new Promise(resolve => { answer = resolve; });
    const { app, element } = await openWizard({ '/api/admin/events/preview': () => late });
    element('event-title').value = 'Raidnacht';
    const pending = app.setWizardMode('preview');
    await app.setWizardMode('edit');
    answer(PREVIEW);
    await pending;
    assert.doesNotMatch(element('wizard-preview-discord').innerHTML, /discord-container/);
    assert.equal(isHidden(element('wizard-page-1')), false);
    assert.ok(isHidden(element('wizard-preview')));
});

test('only the newest of two quick previews is shown', async () => {
    const answers = [];
    const { app, element } = await openWizard({ '/api/admin/events/preview': () => new Promise(resolve => answers.push(resolve)) });
    element('event-title').value = 'Raidnacht';
    const first = app.setWizardMode('preview');
    const second = app.setWizardMode('preview');
    answers[1]({ ...PREVIEW, message: previewMessage('Zweite Fassung') });
    await second;
    answers[0](PREVIEW);
    await first;
    assert.ok(element('wizard-preview-discord').innerHTML.includes('Zweite Fassung'));
    assert.doesNotMatch(element('wizard-preview-discord').innerHTML, /🎉 Raidnacht/);
});

test('"Weiter" from the preview edits the next step, or the marked one', async () => {
    const { app, element } = await openWizard({ '/api/admin/events/preview': PREVIEW });
    await app.setWizardMode('preview');
    app.wizardNext();
    assert.equal(stepOf(element), 'Schritt 1 von 5');
    assert.ok(isHidden(element('wizard-preview')));
    assert.equal(isHidden(element('wizard-page-1')), false);
    assert.ok(element('event-title').classList.contains('is-invalid'));

    element('event-title').value = 'Raidnacht';
    await app.setWizardMode('preview');
    app.wizardNext();
    assert.equal(stepOf(element), 'Schritt 2 von 5');
    assert.ok(isHidden(element('wizard-preview')));
    assert.equal(isHidden(element('wizard-page-2')), false);
    assert.ok(element('wizard-mode-edit').classList.contains('active'));
});

// ── "Teilnehmer benachrichtigen" (W-04) ─────────────────────────────────

const STORED_EVENT = {
    id: 'evt-raid', title: 'Raidnacht', status: 'active', accessMode: 'open', approvalMode: 'instant',
    startDate: '2026-12-01T18:00:00.000Z', endDate: '', reminderHours: [],
    location: { text: 'Lobby', channelId: '300000000000000001', channelType: 'voice' }
};

/**
 * Open the wizard on a stored event; the PUT answers `saved`.
 *
 * @param {Object} [saved] -> Answer of PUT /api/admin/events/evt-raid.
 * @returns {Promise<Object>} -> loadFrontendApp() result.
 */
async function editStoredEvent(saved = { id: 'evt-raid', notifiedCount: 0 }) {
    const frontend = await loadFrontendApp({
        '/api/events/evt-raid?status=all': STORED_EVENT,
        '/api/admin/roles': [],
        '/api/admin/events/evt-raid': saved
    });
    frontend.state.currentUser = { id: 'u-admin', username: 'mori', roles: [], isAdmin: true };
    frontend.state.csrfToken = 'test-token';
    await frontend.app.openEventEditor({ eventId: 'evt-raid' });
    // The picker double ignores setDate -> hold the loaded start like flatpickr does
    frontend.state.startDatePicker.selectedDates = [new Date(STORED_EVENT.startDate)];
    return frontend;
}

const moveStart = (state, iso = '2026-12-02T18:00:00.000Z') => { state.startDatePicker.selectedDates = [new Date(iso)]; };
const notifyShown = (element) => !isHidden(element('wizard-notify'));
const savedBody = (requests) => JSON.parse(requests.filter(request => request.url === '/api/admin/events/evt-raid').at(-1).body);

test('a new start shows "Teilnehmer benachrichtigen" switched on next to "Speichern"', async () => {
    const { app, element, state } = await editStoredEvent();
    app.wizardGoTo(5);
    assert.equal(notifyShown(element), false);

    moveStart(state);
    app.wizardGoTo(4);
    assert.equal(notifyShown(element), false);
    app.wizardGoTo(5);
    assert.equal(notifyShown(element), true);
    assert.equal(element('event-notify-participants').checked, true);
});

test('the switch goes away when the start is back, also in another notation', async () => {
    const { app, element, state } = await editStoredEvent();
    moveStart(state);
    app.wizardGoTo(5);
    assert.equal(notifyShown(element), true);

    moveStart(state, '2026-12-01T19:00:00+01:00');
    app.wizardGoTo(4);
    app.wizardGoTo(5);
    assert.equal(notifyShown(element), false);
});

test('a new end or location shows the switch, a draft never', async () => {
    const { app, element, state } = await editStoredEvent();
    state.endDatePicker.selectedDates = [new Date('2026-12-01T21:00:00.000Z')];
    app.wizardGoTo(5);
    assert.equal(notifyShown(element), true);

    state.endDatePicker.selectedDates = [];
    element('event-location-text').value = 'Garten';
    element('event-location-channel-id').value = '';
    app.wizardGoTo(5);
    assert.equal(notifyShown(element), true);

    element('event-status').value = 'draft';
    app.wizardGoTo(5);
    assert.equal(notifyShown(element), false);
});

test('a new event never shows the switch, also after editing another one', async () => {
    const { app, element, state } = await editStoredEvent();
    moveStart(state);
    app.wizardGoTo(5);
    assert.equal(notifyShown(element), true);

    await app.openEventEditor();
    element('event-title').value = 'Neu';
    moveStart(state, '2026-12-05T18:00:00.000Z');
    app.wizardGoTo(5);
    assert.equal(notifyShown(element), false);
});

test('a switch turned off stays off when the admin goes back and forth', async () => {
    const { app, element, state } = await editStoredEvent();
    moveStart(state);
    app.wizardGoTo(5);
    element('event-notify-participants').checked = false;
    app.wizardGoTo(2);
    app.wizardGoTo(5);
    assert.equal(notifyShown(element), true);
    assert.equal(element('event-notify-participants').checked, false);

    await app.openEventEditor({ eventId: 'evt-raid' });
    assert.equal(element('event-notify-participants').checked, true);
});

test('saving sends the switch and says how many participants were told', async () => {
    const { app, element, state, requests, toasts } = await editStoredEvent({ id: 'evt-raid', notifiedCount: 5 });
    moveStart(state);
    app.wizardGoTo(5);
    await app.saveEvent();
    assert.equal(savedBody(requests).notifyParticipants, true);
    assert.equal(requests.filter(request => request.url === '/api/admin/events/evt-raid').at(-1).method, 'PUT');
    assert.equal(toasts.at(-1), 'Event aktualisiert – 5 Teilnehmer benachrichtigt.');
});

test('a switch turned off or hidden sends false and the usual toast', async () => {
    const off = await editStoredEvent();
    moveStart(off.state);
    off.app.wizardGoTo(5);
    off.element('event-notify-participants').checked = false;
    await off.app.saveEvent();
    assert.equal(savedBody(off.requests).notifyParticipants, false);
    assert.equal(off.toasts.at(-1), 'Event aktualisiert!');

    const unchanged = await editStoredEvent();
    unchanged.app.wizardGoTo(5);
    await unchanged.app.saveEvent();
    assert.equal(savedBody(unchanged.requests).notifyParticipants, false);
});

test('a new event is sent without the flag', async () => {
    const { app, element, requests } = await openWizard({ '/api/admin/events': { id: 'neu' } });
    element('event-title').value = 'Raidnacht';
    element('event-status').value = 'draft';
    app.wizardGoTo(5);
    await app.saveEvent();
    const body = JSON.parse(requests.find(request => request.url === '/api/admin/events').body);
    assert.equal('notifyParticipants' in body, false);
});

test('the audit log marks a change notice as information', async () => {
    const { app, element } = await loadFrontendApp({
        '/api/admin/audit-log?limit=100': { data: [{ action: 'NOTIFY_EVENT_CHANGE', adminId: 'u-admin', details: 'Notified 5 of 5 participants about changed Beginn', timestamp: new Date().toISOString() }], meta: { totalPages: 1 } }
    });
    element('audit-log-container').scrollIntoView = () => {};
    await app.loadAuditLog();
    const html = element('audit-log-entries').innerHTML;
    assert.match(html, /chip-info[^>]*>NOTIFY_EVENT_CHANGE/, html);
});
