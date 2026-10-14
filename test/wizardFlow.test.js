const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadFrontendApp, isHidden } = require('./helpers');

/** Open the wizard for a new event as an admin; routes are added to the role list. */
async function openWizard(routes = {}) {
    const frontend = await loadFrontendApp({ '/api/admin/roles': [], ...routes });
    frontend.state.currentUser = { id: 'u-admin', username: 'mori', roles: [], isAdmin: true };
    frontend.state.csrfToken = 'test-token';
    await frontend.app.showCreateEventModal();
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
    app.wizardGoTo(5);
    await app.saveEvent();
    const sent = requests.find(request => request.url === '/api/admin/events');
    assert.equal(sent.method, 'POST');
    const body = JSON.parse(sent.body);
    assert.deepEqual([body.title, body.status, body.reminderHours, body.startDate, body.formFields], ['Raidnacht', 'draft', '24, 1', '', []]);
});

test('opening the wizard again clears the marks of the last attempt', async () => {
    const { app, element } = await openWizard();
    app.wizardNext();
    assert.ok(element('wstep-1').classList.contains('has-error'));
    await app.showCreateEventModal();
    assert.equal(element('wstep-1').classList.contains('has-error'), false);
    assert.equal(element('event-title-feedback').textContent, '');
});
