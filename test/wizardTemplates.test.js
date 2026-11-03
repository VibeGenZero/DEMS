const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadFrontendApp } = require('./helpers');

// Settings of a stored template (shape of GET /api/admin/event-templates)
const RAID_SETTINGS = {
    title: 'Raid-Abend',
    description: 'Wöchentlicher Raid.',
    bannerUrl: 'https://example.com/raid.png',
    accentColor: '#22c55e',
    category: 'Raid',
    location: { text: 'Event-Voice', channelId: 'c-voice', channelType: 'voice' },
    maxParticipants: 6,
    accessMode: 'role-required',
    requiredRoles: ['r-raid'],
    approvalMode: 'instant',
    allowGuests: false,
    allowTentative: true,
    slots: [{ id: 's1', name: 'Tank', emoji: '', capacity: 1 }, { id: 's2', name: 'Heiler', emoji: '', capacity: 5 }],
    assignRoleId: 'r-assign',
    formFields: [{ label: 'Charaktername', type: 'text', required: true, options: [], description: '' }],
    reminderHours: [{ hours: 24 }, { hours: 1 }],
    checkinMessage: 'Willkommen im Raid!',
    autoCreateChannels: true,
    channelConfig: { type: 'both', voiceName: 'Raid-Voice', textName: 'raid-chat' },
    customBotMessages: { registration: 'Danke!', accepted: 'Du bist dabei.', rejected: '' }
};

/** Open the wizard for a new event as an admin. */
async function openWizard(routes = {}) {
    const frontend = await loadFrontendApp({ '/api/admin/roles': [], '/api/admin/event-templates': [], ...routes });
    frontend.state.currentUser = { id: 'u-admin', username: 'mori', roles: [], isAdmin: true };
    frontend.state.csrfToken = 'test-token';
    await frontend.app.showCreateEventModal();
    return frontend;
}

test('fillWizard puts every template setting into the wizard', async () => {
    const { app, element, state } = await openWizard();
    await app.fillWizard(RAID_SETTINGS);
    assert.equal(element('event-title').value, 'Raid-Abend');
    assert.equal(state.descriptionEditor.value(), 'Wöchentlicher Raid.');
    assert.equal(element('event-banner-url').value, 'https://example.com/raid.png');
    assert.equal(element('event-accent-color').value, '#22c55e');
    assert.equal(element('event-category').value, 'Raid');
    assert.equal(element('event-location-text').value, 'Event-Voice');
    assert.equal(element('event-location-channel-id').value, 'c-voice');
    assert.equal(element('event-access').value, 'role-required');
    assert.equal(element('event-approval').value, 'instant');
    assert.equal(element('event-reminder').value, '24, 1');
    assert.equal(element('event-checkin-message').value, 'Willkommen im Raid!');
    assert.equal(element('event-auto-create-channels').checked, true);
    assert.equal(element('event-channel-type').value, 'both');
    assert.equal(element('event-voice-name').value, 'Raid-Voice');
    assert.equal(element('event-text-name').value, 'raid-chat');
    assert.equal(element('event-allow-guests').checked, false);
    assert.equal(element('event-allow-tentative').checked, true);
    assert.equal(element('event-use-slots').checked, true);
    assert.equal(element('event-assign-role').value, 'r-assign');
    assert.equal(element('event-custom-msg-toggle').checked, true);
    assert.equal(element('event-msg-registration').value, 'Danke!');
    assert.equal(element('event-msg-accepted').value, 'Du bist dabei.');
});

test('fillWizard sets the place limit of a template without slots', async () => {
    const { app, element } = await openWizard();
    await app.fillWizard({ ...RAID_SETTINGS, slots: [], allowGuests: true, maxParticipants: 12 });
    assert.equal(element('event-max').value, 12);
    assert.equal(element('event-use-slots').checked, false);
    assert.equal(element('event-allow-guests').checked, true);
    // A template without „Vielleicht“ switches it off again (B-17)
    const { allowTentative, ...withoutBench } = RAID_SETTINGS;
    assert.equal(allowTentative, true);
    await app.fillWizard(withoutBench);
    assert.equal(element('event-allow-tentative').checked, false);
});

test('fillWizard leaves dates, deadlines, status and series alone', async () => {
    const { app, element, state } = await openWizard();
    element('event-status').value = 'draft';
    element('event-recurring').checked = true;
    element('event-recurring-until').value = '2099-05-01';
    await app.fillWizard({ ...RAID_SETTINGS, status: 'active', recurring: false, startDate: '2099-03-06T19:00:00.000Z' });
    assert.equal(element('event-status').value, 'draft');
    assert.equal(element('event-recurring').checked, true);
    assert.equal(element('event-recurring-until').value, '2099-05-01');
    assert.equal(state.startDatePicker?.selectedDates?.length ?? 0, 0);
});

test('editing an event still fills the wizard through the same function', async () => {
    const event = { id: 'e1', status: 'draft', startDate: '', endDate: '', recurring: false, ...RAID_SETTINGS, title: 'Alter Raid' };
    const frontend = await loadFrontendApp({ '/api/events/e1?status=all': event, '/api/admin/roles': [], '/api/admin/event-templates': [] });
    frontend.state.currentUser = { id: 'u-admin', username: 'mori', roles: [], isAdmin: true };
    await frontend.app.editEvent('e1');
    assert.equal(frontend.element('event-edit-id').value, 'e1');
    assert.equal(frontend.element('event-title').value, 'Alter Raid');
    assert.equal(frontend.element('event-checkin-message').value, 'Willkommen im Raid!');
    assert.equal(frontend.element('event-status').value, 'draft');
});

// ── Choosing, saving and deleting templates (W-10) ──────────────────────

const { isHidden } = require('./helpers');
const { TEMPLATE_FIELDS } = require('../utils/eventTemplates');

const RAID = { id: 't-raid', name: 'Raid-Abend', settings: RAID_SETTINGS, createdBy: 'u-admin' };
const TOURNEY = { id: 't-tourney', name: 'Turnier', settings: { ...RAID_SETTINGS, title: 'Turnier', slots: [] }, createdBy: 'u-admin' };

/**
 * Wizard with stored templates; POST/PUT/DELETE on the template URLs answer `answers`.
 *
 * @param {Array<Object>} templates -> Answer of GET /api/admin/event-templates.
 * @param {Object} [answers] -> `{ post, put, delete }` bodies; `skipItemRoutes` leaves PUT/DELETE unanswered (404).
 * @returns {Promise<Object>} -> loadFrontendApp() result.
 */
async function wizardWithTemplates(templates, answers = {}) {
    let frontend;
    const lastMethod = () => frontend.requests.at(-1).method;
    const routes = {
        '/api/admin/roles': [],
        '/api/admin/events': { id: 'neu' },
        '/api/admin/event-templates': () => (lastMethod() === 'POST' ? answers.post : templates)
    };
    for (const template of answers.skipItemRoutes ? [] : templates) {
        routes[`/api/admin/event-templates/${template.id}`] = () => (lastMethod() === 'DELETE' ? answers.delete || { success: true } : answers.put);
    }
    frontend = await loadFrontendApp(routes);
    frontend.state.currentUser = { id: 'u-admin', username: 'mori', roles: [], isAdmin: true };
    frontend.state.csrfToken = 'test-token';
    await frontend.app.showCreateEventModal();
    return frontend;
}

const templateRequests = (requests) => requests.filter(request => request.url.startsWith('/api/admin/event-templates') && request.method !== 'GET');

test('the template chooser shows only for a new event and only with templates', async () => {
    const withTemplates = await wizardWithTemplates([RAID, TOURNEY]);
    assert.equal(isHidden(withTemplates.element('wizard-template-area')), false);
    const options = withTemplates.element('event-template-select').innerHTML;
    assert.ok(options.includes('value="t-raid"') && options.includes('Raid-Abend'));
    assert.ok(options.includes('Turnier'));

    const none = await wizardWithTemplates([]);
    assert.ok(isHidden(none.element('wizard-template-area')));

    const event = { id: 'e1', status: 'draft', startDate: '', ...RAID_SETTINGS };
    const editing = await loadFrontendApp({ '/api/events/e1?status=all': event, '/api/admin/roles': [], '/api/admin/event-templates': [RAID] });
    editing.state.currentUser = { id: 'u-admin', username: 'mori', roles: [], isAdmin: true };
    await editing.app.showCreateEventModal();
    assert.equal(isHidden(editing.element('wizard-template-area')), false);
    await editing.app.editEvent('e1');
    assert.ok(isHidden(editing.element('wizard-template-area')));
});

test('template names in the chooser are escaped', async () => {
    const { element } = await wizardWithTemplates([{ ...RAID, name: '<img src=x>' }]);
    const options = element('event-template-select').innerHTML;
    assert.equal(options.includes('<img'), false);
    assert.ok(options.includes('&lt;img src=x&gt;'));
});

test('choosing a template fills the wizard, keeps the dates empty and says so', async () => {
    const { app, element, state, toasts } = await wizardWithTemplates([RAID, TOURNEY]);
    element('event-template-select').value = 't-raid';
    await app.applyTemplate(element('event-template-select'));
    assert.equal(element('event-title').value, 'Raid-Abend');
    assert.equal(element('event-checkin-message').value, 'Willkommen im Raid!');
    assert.equal(state.startDatePicker?.selectedDates?.length ?? 0, 0);
    assert.equal(toasts.at(-1), 'Vorlage „Raid-Abend“ übernommen.');
    assert.equal(element('event-template-delete').disabled, false);
});

test('"Als Vorlage speichern" stores the inputs as a new template and creates no event', async () => {
    const created = { id: 't-new', name: 'Spieleabend', settings: {}, createdBy: 'u-admin' };
    const { app, element, requests, toasts } = await wizardWithTemplates([RAID], { post: created });
    element('event-title').value = 'Spieleabend';
    element('event-status').value = 'active';
    app.openTemplateSave();
    assert.equal(isHidden(element('wizard-template-save')), false);
    assert.equal(element('event-template-name').value, '');
    element('event-template-name').value = '  Spieleabend ';
    await app.saveTemplate();

    const [sent] = templateRequests(requests);
    assert.equal(sent.method, 'POST');
    assert.equal(sent.url, '/api/admin/event-templates');
    assert.equal(sent.headers['X-CSRF-TOKEN'], 'test-token');
    const body = JSON.parse(sent.body);
    assert.equal(body.name, 'Spieleabend');
    assert.equal(body.settings.title, 'Spieleabend');
    for (const field of ['startDate', 'endDate', 'status', 'recurring', 'registrationDeadline', 'fromPoll', 'storedRecurringUntil']) {
        assert.equal(field in body.settings, false, field);
    }
    assert.deepEqual(Object.keys(body.settings).sort(), [...TEMPLATE_FIELDS].sort());
    assert.equal(requests.some(request => request.url === '/api/admin/events'), false, 'no event saved');
    assert.equal(toasts.at(-1), 'Vorlage „Spieleabend“ gespeichert.');
    assert.ok(isHidden(element('wizard-template-save')));
});

test('an existing name is overwritten only after the warning and a second click', async () => {
    const { app, element, requests, toasts } = await wizardWithTemplates([RAID], { put: { ...RAID } });
    element('event-template-select').value = 't-raid';
    await app.applyTemplate(element('event-template-select'));
    app.openTemplateSave();
    assert.equal(element('event-template-name').value, 'Raid-Abend', 'prefilled with the applied template');

    await app.saveTemplate();
    assert.equal(templateRequests(requests).length, 0, 'nothing sent yet');
    assert.equal(isHidden(element('wizard-template-warning')), false);
    assert.equal(element('wizard-template-warning').textContent, 'Die Vorlage „Raid-Abend“ wird überschrieben.');

    await app.saveTemplate();
    const [sent] = templateRequests(requests);
    assert.equal(sent.method, 'PUT');
    assert.equal(sent.url, '/api/admin/event-templates/t-raid');
    assert.equal(JSON.parse(sent.body).name, 'Raid-Abend');
    assert.equal(toasts.at(-1), 'Vorlage „Raid-Abend“ aktualisiert.');
});

test('changing the name after the warning asks again', async () => {
    const { app, element, requests } = await wizardWithTemplates([RAID, TOURNEY], { put: { ...TOURNEY } });
    app.openTemplateSave();
    element('event-template-name').value = 'raid-abend';
    await app.saveTemplate();
    element('event-template-name').value = 'Turnier';
    app.resetTemplateWarning();
    assert.ok(isHidden(element('wizard-template-warning')));
    await app.saveTemplate();
    assert.equal(templateRequests(requests).length, 0);
    assert.equal(element('wizard-template-warning').textContent, 'Die Vorlage „Turnier“ wird überschrieben.');
});

test('an empty template name is refused in the browser', async () => {
    const { app, element, requests, toasts } = await wizardWithTemplates([]);
    app.openTemplateSave();
    element('event-template-name').value = '   ';
    await app.saveTemplate();
    assert.equal(templateRequests(requests).length, 0);
    assert.equal(toasts.at(-1), 'Bitte einen Namen für die Vorlage eingeben.');
});

test('a server error while saving shows as a danger toast and keeps the panel open', async () => {
    // No route for the PUT -> the fake server answers 404 { error: 'Nicht gefunden' }
    const { app, element, toasts } = await wizardWithTemplates([RAID], { skipItemRoutes: true });
    app.openTemplateSave();
    element('event-template-name').value = 'Raid-Abend';
    await app.saveTemplate();
    await app.saveTemplate();
    assert.equal(toasts.at(-1), 'Nicht gefunden');
    assert.equal(isHidden(element('wizard-template-save')), false);
});

test('deleting a template asks inline first and keeps the inputs', async () => {
    const { app, element, requests, toasts } = await wizardWithTemplates([RAID, TOURNEY]);
    element('event-template-select').value = 't-raid';
    await app.applyTemplate(element('event-template-select'));
    app.askDeleteTemplate();
    assert.equal(templateRequests(requests).length, 0);
    assert.equal(isHidden(element('wizard-template-delete-confirm')), false);
    assert.equal(element('wizard-template-delete-text').textContent, 'Vorlage „Raid-Abend“ löschen?');

    await app.deleteTemplate();
    const [sent] = templateRequests(requests);
    assert.equal(sent.method, 'DELETE');
    assert.equal(sent.url, '/api/admin/event-templates/t-raid');
    assert.equal(toasts.at(-1), 'Vorlage „Raid-Abend“ gelöscht.');
    assert.equal(element('event-template-select').innerHTML.includes('t-raid'), false);
    assert.ok(element('event-template-select').innerHTML.includes('t-tourney'));
    assert.equal(element('event-title').value, 'Raid-Abend', 'inputs stay');
    assert.ok(isHidden(element('wizard-template-delete-confirm')));
});

test('the frontend list of template fields equals the server list', async () => {
    const { app } = await wizardWithTemplates([]);
    assert.deepEqual(JSON.parse(JSON.stringify(app.TEMPLATE_FIELDS)), TEMPLATE_FIELDS);
});
