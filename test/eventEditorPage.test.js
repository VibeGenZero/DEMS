const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadFrontendApp, httpAnswer, REPO_ROOT } = require('./helpers');

// The event editor as a page (#event-editor/new, #event-editor/<id>; public/js/admin/editor-page.js)

const HTML = fs.readFileSync(path.join(REPO_ROOT, 'public', 'index.html'), 'utf8');

const EVENT = {
    id: 'e1', title: 'Raid', description: 'Text', status: 'active', startDate: '2026-12-01T19:00:00.000Z', endDate: '',
    maxParticipants: 10, accessMode: 'open', approvalMode: 'manual', formFields: [], updatedAt: 'T1'
};

async function openApp(routes = {}, options = {}, user = { id: 'u-admin', username: 'mori', roles: [], isAdmin: true }) {
    const harness = await loadFrontendApp({ '/api/admin/roles': [], '/api/events/e1?status=all': EVENT, ...routes }, options);
    harness.state.currentUser = user;
    harness.state.csrfToken = 'test-token';
    return harness;
}

/** Show a route like the browser does after a hash change. */
async function go(harness, hash) {
    harness.location.hash = '#' + hash;
    await harness.app.handleRoute();
}

test('the editor is a section, the dialog is gone', () => {
    assert.match(HTML, /<section id="event-editor-section" class="app-section is-hidden">/);
    assert.doesNotMatch(HTML, /id="eventModal"/);
    assert.doesNotMatch(HTML, /id="eventModalTitle"/);
    assert.match(HTML, /<h2[^>]*id="event-editor-title"/);
    assert.match(HTML, /<aside class="editor-assist is-hidden" id="event-editor-assist"/);
    assert.match(HTML, /id="event-editor-topbar-extra"/);
});

test('the router shows the editor only to admins', async () => {
    const member = await openApp({}, {}, { id: 'u1', username: 'x', roles: [], isAdmin: false });
    await go(member, 'event-editor/new');
    assert.notEqual(member.element('event-editor-section').style.display, 'block');
    assert.equal(member.location.hash, '#events');

    const admin = await openApp();
    await go(admin, 'event-editor/new');
    assert.equal(admin.element('event-editor-section').style.display, 'block');
});

test('#event-editor/new opens an empty wizard on step 1', async () => {
    const harness = await openApp();
    await go(harness, 'event-editor/new');
    assert.equal(harness.element('event-editor-title').textContent, 'Neues Event');
    assert.equal(harness.element('wizard-step-counter').textContent, 'Schritt 1 von 5');
    assert.equal(harness.element('event-title').value, '');
    assert.equal(harness.element('event-edit-id').value, '');
});

test('#event-editor/<id> loads the event', async () => {
    const harness = await openApp();
    await go(harness, 'event-editor/e1');
    assert.equal(harness.element('event-editor-title').textContent, 'Event bearbeiten: Raid');
    assert.equal(harness.element('event-title').value, 'Raid');
    assert.equal(harness.element('event-edit-id').value, 'e1');
});

test('an unknown event leads back to the dashboard with a message', async () => {
    const harness = await openApp({ '/api/events/weg?status=all': httpAnswer(404, { error: 'Event nicht gefunden' }) });
    await go(harness, 'event-editor/weg');
    assert.ok(harness.toasts.includes('Event nicht gefunden.'));
    assert.equal(harness.location.hash, '#admin');
});

test('"Neues Event" and "Bearbeiten" lead to the address of the editor', async () => {
    const harness = await openApp();
    await harness.app.runAction('showCreateEvent', {});
    assert.equal(harness.location.hash, '#event-editor/new');
    assert.equal(harness.element('event-editor-section').style.display, 'block');
    await go(harness, 'admin');
    await harness.app.runAction('editEvent', { dataset: { eventId: 'e1' } });
    assert.equal(harness.location.hash, '#event-editor/e1');
    assert.equal(harness.element('event-title').value, 'Raid');
    assert.match(HTML, /data-click="showCreateEvent"/);
    assert.doesNotMatch(HTML, /showCreateEventModal/);
});

test('openEventEditor with a prefill fills the wizard once, and the router does not reset it', async () => {
    const harness = await openApp();
    await harness.app.openEventEditor({ prefill: { title: 'Aus Vorlage' } });
    assert.equal(harness.element('event-title').value, 'Aus Vorlage');
    // What a caller sets after opening must survive the hash change the browser fires afterwards
    harness.element('event-title').value = 'Vom Aufrufer gesetzt';
    const loads = harness.requests.length;
    await harness.app.handleRoute();
    assert.equal(harness.element('event-title').value, 'Vom Aufrufer gesetzt');
    assert.equal(harness.requests.length, loads);
    assert.equal(harness.element('event-editor-section').style.display, 'block');
});

test('opening the editor again after leaving starts fresh', async () => {
    const harness = await openApp();
    await go(harness, 'event-editor/new');
    harness.element('event-title').value = 'Alt';
    await go(harness, 'admin');
    await go(harness, 'event-editor/new');
    assert.equal(harness.element('event-title').value, '');
});

test('"Zurück" returns to where the admin came from, the dashboard after a reload', async () => {
    const harness = await openApp({ '/api/polls/p1': httpAnswer(404, {}) });
    harness.location.hash = '#poll/p1';
    await harness.app.openEventEditor({});
    await harness.app.runAction('closeEventEditor', {});
    assert.equal(harness.location.hash, '#poll/p1');

    const reloaded = await openApp();
    await go(reloaded, 'event-editor/new');
    await reloaded.app.runAction('closeEventEditor', {});
    assert.equal(reloaded.location.hash, '#admin');
});

test('a saved new event returns to the dashboard', async () => {
    const harness = await openApp({ '/api/admin/events': { id: 'neu' } });
    await go(harness, 'admin');
    await harness.app.runAction('showCreateEvent', {});
    harness.element('event-title').value = 'Raidnacht';
    harness.element('event-status').value = 'draft';
    await harness.app.saveEvent();
    assert.ok(harness.toasts.includes('Event erstellt!'), harness.toasts.join(' | '));
    assert.equal(harness.location.hash, '#admin');
});

test('the top-bar save of an existing event first shows step 5, then saves', async () => {
    const harness = await openApp({ '/api/admin/events/e1': { id: 'e1' } });
    await go(harness, 'event-editor/e1');
    await harness.app.runAction('saveEventFromTopbar', {});
    assert.equal(harness.element('wizard-step-counter').textContent, 'Schritt 5 von 5');
    assert.ok(harness.toasts.includes('Bitte prüfe die Optionen für das Speichern.'));
    assert.equal(harness.requests.filter(request => request.method === 'PUT').length, 0);
    // The date pickers of the harness hold no date; a draft needs none
    harness.element('event-status').value = 'draft';
    await harness.app.runAction('saveEventFromTopbar', {});
    assert.equal(harness.requests.filter(request => request.method === 'PUT').length, 1);
});

test('the top-bar save of a new event saves from any step', async () => {
    const harness = await openApp({ '/api/admin/events': { id: 'neu' } });
    await go(harness, 'event-editor/new');
    harness.element('event-title').value = 'Raidnacht';
    harness.element('event-status').value = 'draft';
    await harness.app.runAction('saveEventFromTopbar', {});
    assert.equal(harness.requests.filter(request => request.method === 'POST' && request.url === '/api/admin/events').length, 1);
});

test('the footer "Abbrechen" and the top bar "Zurück" close the editor through an action', () => {
    const section = HTML.slice(HTML.indexOf('<section id="event-editor-section"'), HTML.indexOf('<section id="insights-section"'));
    assert.equal(section.split('data-click="closeEventEditor"').length - 1, 2);
    assert.doesNotMatch(section, /data-bs-dismiss="modal"/);
});
