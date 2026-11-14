const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadFrontendApp, isHidden, REPO_ROOT } = require('./helpers');

const ADMIN = { id: 'u-admin', username: 'admin', roles: [], isAdmin: true };

const storedEvent = (reminderHours) => ({
    id: 'evt-raid', title: 'Raid', description: '', status: 'active', accessMode: 'open',
    startDate: '2026-10-20T18:00:00.000Z', formFields: [], reminderHours
});

/**
 * Open the edit dialog of one stored event.
 *
 * @param {*} reminderHours -> Stored reminderHours.
 * @returns {Promise<Object>} -> `{ element, toasts }` of loadFrontendApp().
 */
async function editEventWith(reminderHours) {
    const frontend = await loadFrontendApp({
        '/api/events/evt-raid?status=all': storedEvent(reminderHours),
        '/api/admin/roles': []
    });
    frontend.state.currentUser = ADMIN;
    await frontend.app.openEventEditor({ eventId: 'evt-raid' });
    return frontend;
}

test('editing an event shows every stored reminder in the form', async () => {
    const { element, toasts } = await editEventWith([{ hours: 24, sent: true }, { hours: 1, sent: false }]);
    assert.equal(element('event-reminder').value, '24, 1');
    assert.deepEqual(toasts, []);
});

test('editing a legacy event shows its single reminder', async () => {
    const { element } = await editEventWith(24);
    assert.equal(element('event-reminder').value, '24');
});

test('editing an event without reminders leaves the field empty', async () => {
    const { element } = await editEventWith([]);
    assert.equal(element('event-reminder').value, '');
});

test('the reminder field accepts several hours', async () => {
    const html = fs.readFileSync(path.join(REPO_ROOT, 'public', 'index.html'), 'utf8');
    const field = html.match(/<input[^>]*id="event-reminder"[^>]*>/)[0];
    // A number input would drop "24, 1" (and an array assigned to it) silently
    assert.doesNotMatch(field, /type="number"/);
});

test('the wizard shows the pages and buttons that start hidden in the markup', async () => {
    const { app, element } = await loadFrontendApp({});
    const hidden = (id) => isHidden(element(id));
    // index.html: only the first page and "Weiter" are visible at the start
    assert.deepEqual(['wizard-page-1', 'wizard-page-2', 'wizard-btn-back', 'wizard-btn-next', 'wizard-btn-save'].map(hidden), [false, true, true, false, true]);

    app.wizardGoTo(2);
    assert.deepEqual(['wizard-page-1', 'wizard-page-2', 'wizard-btn-back', 'wizard-btn-next', 'wizard-btn-save'].map(hidden), [true, false, false, false, true]);

    app.wizardGoTo(5);
    assert.deepEqual(['wizard-page-2', 'wizard-page-5', 'wizard-btn-back', 'wizard-btn-next', 'wizard-btn-save'].map(hidden), [true, false, false, true, false]);

    app.wizardGoTo(1);
    assert.deepEqual(['wizard-page-1', 'wizard-page-5', 'wizard-btn-back', 'wizard-btn-next', 'wizard-btn-save'].map(hidden), [false, true, true, false, true]);
});
