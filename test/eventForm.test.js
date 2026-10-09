const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadFrontendApp, REPO_ROOT } = require('./helpers');

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
    await frontend.app.editEvent('evt-raid');
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

test('the admin card shows every reminder', async () => {
    const { app, element, toasts, state } = await loadFrontendApp({
        '/api/admin/all-events': [storedEvent([{ hours: 24, sent: true }, { hours: 1, sent: false }])]
    });
    state.currentUser = ADMIN;
    await app.loadAdminEvents();
    assert.match(element('admin-events-grid').innerHTML, /bi-bell"><\/i>24h · 1h</);
    assert.deepEqual(toasts, []);
});
