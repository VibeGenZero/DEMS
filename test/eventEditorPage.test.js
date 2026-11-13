const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadFrontendApp, httpAnswer, isHidden, REPO_ROOT } = require('./helpers');

// The breakpoint of the preview column, as editor-page.js exports it (checked against the stylesheet below)
const EDITOR_SOURCE = require('fs').readFileSync(require('path').join(REPO_ROOT, 'public', 'js', 'admin', 'editor-page.js'), 'utf8');
const harnessQuery = () => (EDITOR_SOURCE.match(/export const EDITOR_WIDE_QUERY = '([^']+)'/) || [])[1];

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
    // Unsaved input: the question is confirmed, then the browser routes on the hash change
    await go(harness, 'admin');
    await harness.app.handleRoute();
    assert.equal(harness.dialogs.length, 1);
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

// ─── Layout: permanent preview on wide screens ───

const PREVIEW = { places: { capacity: 10, taken: 0 }, components: [] };
const previews = (harness) => harness.requests.filter(request => request.url === '/api/admin/events/preview').length;
const previewRoutes = (answer = PREVIEW) => ({ '/api/admin/events/preview': answer });

test('on a wide screen the preview is visible on every step and drawn on open', async () => {
    const harness = await openApp(previewRoutes(), { wide: true, timers: true });
    await go(harness, 'event-editor/new');
    assert.equal(previews(harness), 1);
    assert.equal(harness.app.isPreviewVisible(), true);
    for (const step of [3, 5, 1]) {
        harness.app.wizardGoTo(step);
        assert.equal(isHidden(harness.element('wizard-preview')), false, `step ${step}`);
        assert.equal(isHidden(harness.element(`wizard-page-${step}`)), false, `page ${step}`);
    }
    // Changing the step asks for nothing new and drops no pending answer
    assert.equal(previews(harness), 1);
});

test('typing redraws the preview once after the pause, not per key', async () => {
    const harness = await openApp(previewRoutes(), { wide: true, timers: true });
    await go(harness, 'event-editor/new');
    harness.element('event-title').value = 'Raid';
    harness.app.editorChanged();
    harness.app.editorChanged();
    harness.app.editorChanged();
    await harness.advance(599);
    assert.equal(previews(harness), 1);
    await harness.advance(1);
    assert.equal(previews(harness), 2);
    const sent = JSON.parse(harness.requests.filter(request => request.url === '/api/admin/events/preview')[1].body);
    assert.equal(sent.title, 'Raid');
    await harness.advance(5000);
    assert.equal(previews(harness), 2);
});

test('on a narrow screen nothing is requested until the preview tab is chosen', async () => {
    const harness = await openApp(previewRoutes(), { timers: true });
    await go(harness, 'event-editor/new');
    harness.app.editorChanged();
    await harness.advance(600);
    assert.equal(previews(harness), 0);
    assert.equal(harness.app.isPreviewVisible(), false);
    assert.equal(isHidden(harness.element('wizard-preview')), true);

    await harness.app.setWizardMode('preview');
    assert.equal(previews(harness), 1);
    assert.equal(harness.app.isPreviewVisible(), true);
    harness.app.editorChanged();
    await harness.advance(600);
    assert.equal(previews(harness), 2);
});

test('a failed preview shows a quiet note and no toast', async () => {
    const harness = await openApp(previewRoutes(httpAnswer(500, { error: 'Kaputt' })), { wide: true, timers: true });
    await go(harness, 'event-editor/new');
    assert.match(harness.element('wizard-preview-discord').innerHTML, /Discord-Vorschau gerade nicht verfügbar\./);
    assert.deepEqual(harness.toasts, []);
});

test('leaving the editor drops a preview that still waits', async () => {
    const harness = await openApp(previewRoutes(), { wide: true, timers: true });
    await go(harness, 'event-editor/new');
    harness.app.editorChanged();
    await go(harness, 'info');
    await harness.advance(600);
    assert.equal(previews(harness), 1);
});

test('the layout names its parts and the modal padding is gone', () => {
    const section = HTML.slice(HTML.indexOf('<section id="event-editor-section"'), HTML.indexOf('<section id="insights-section"'));
    for (const name of ['editor-topbar', 'editor-body', 'editor-form', 'editor-footer', 'editor-preview-column', 'editor-assist']) {
        assert.match(section, new RegExp(`class="${name}[ "]`), name);
    }
    assert.match(section, /<div class="wizard-head">/);
    const css = fs.readFileSync(path.join(REPO_ROOT, 'public', 'css', 'style.css'), 'utf8');
    assert.match(css, /@media \(min-width: 1200px\) \{[^@]*\.editor-body \{/);
    assert.equal(harnessQuery(), '(min-width: 1200px)');
});

// ─── Not losing work: stored draft, restore, leave question ───

const stored = (draft, extra = {}) => JSON.stringify({ draft, step: 3, baseUpdatedAt: '', savedAt: '2026-11-13T19:14:00.000Z', ...extra });
const NEW_KEY = 'dems_event_draft_new';
const E1_KEY = 'dems_event_draft_e1';

async function typeTitle(harness, title) {
    harness.element('event-title').value = title;
    harness.app.editorChanged();
    await harness.advance(800);
}

test('a filled wizard survives collect -> apply -> collect unchanged', async () => {
    const harness = await openApp();
    await go(harness, 'event-editor/new');
    const set = (id, value) => { harness.element(id).value = value; };
    set('event-title', 'Raid');
    harness.state.descriptionEditor.value('**Text**');
    set('event-banner-url', '/uploads/banners/x.png');
    harness.app.wizardGoTo(2);
    harness.state.startDatePicker.setDate('2026-12-01T19:00:00.000Z');
    harness.state.endDatePicker.setDate('2026-12-01T22:00:00.000Z');
    harness.state.registrationDeadlinePicker.setDate('2026-11-30T18:00:00.000Z');
    harness.state.unregisterDeadlinePicker.setDate('2026-12-01T12:00:00.000Z');
    set('event-status', 'draft');
    set('event-max', '20');
    set('event-category', 'Raid');
    set('event-access', 'role-required');
    set('event-approval', 'instant');
    set('event-reminder', '24, 1');
    set('event-checkin-message', 'Willkommen');
    harness.element('event-auto-create-channels').checked = true;
    set('event-channel-type', 'both');
    set('event-voice-name', 'Raid Voice');
    set('event-text-name', 'raid-text');
    harness.element('event-allow-guests').checked = false;
    harness.element('event-allow-tentative').checked = true;
    harness.element('event-recurring').checked = true;
    set('event-recurring-interval', 'biweekly');
    set('event-recurring-until', '2027-01-31');
    set('event-msg-registration', 'A');
    set('event-msg-accepted', 'B');
    set('event-msg-rejected', 'C');
    set('event-location-text', 'Voice 1');
    set('event-location-channel-id', '123456789012345678');
    set('event-location-channel-type', 'voice');
    // A colour input always holds a colour in the browser
    set('event-accent-color', '#22c55e');

    const before = JSON.stringify(harness.app.collectEventDraft());
    await harness.app.resetWizard();
    assert.notEqual(JSON.stringify(harness.app.collectEventDraft()), before);
    await harness.app.applyDraft(JSON.parse(before));
    assert.equal(JSON.stringify(harness.app.collectEventDraft()), before);
});

test('a change is stored after the pause and the note shows the time', async () => {
    const harness = await openApp({}, { timers: true });
    await go(harness, 'event-editor/new');
    assert.equal(isHidden(harness.element('event-editor-saved')), true);
    harness.element('event-title').value = 'Raid';
    harness.app.wizardGoTo(2);
    harness.app.editorChanged();
    await harness.advance(799);
    assert.equal(harness.localStorage.getItem(NEW_KEY), null);
    await harness.advance(1);
    const kept = JSON.parse(harness.localStorage.getItem(NEW_KEY));
    assert.equal(kept.draft.title, 'Raid');
    assert.equal(kept.step, 2);
    assert.equal(kept.baseUpdatedAt, '');
    assert.match(harness.element('event-editor-saved').textContent, /^Entwurf gesichert \d\d:\d\d$/);
    assert.equal(isHidden(harness.element('event-editor-saved')), false);
});

test('input that is back at the loaded state is not kept', async () => {
    const harness = await openApp({}, { timers: true });
    await go(harness, 'event-editor/new');
    await typeTitle(harness, 'Raid');
    assert.ok(harness.localStorage.getItem(NEW_KEY));
    await typeTitle(harness, '');
    assert.equal(harness.localStorage.getItem(NEW_KEY), null);
    assert.equal(isHidden(harness.element('event-editor-saved')), true);
});

test('reopening restores draft and step and shows the banner', async () => {
    const harness = await openApp({}, { storage: { [NEW_KEY]: stored({ title: 'Gesichert', status: 'draft', maxParticipants: '12' }) } });
    await go(harness, 'event-editor/new');
    assert.equal(harness.element('event-title').value, 'Gesichert');
    assert.equal(harness.element('event-max').value, '12');
    assert.equal(harness.element('wizard-step-counter').textContent, 'Schritt 3 von 5');
    assert.equal(isHidden(harness.element('event-editor-restored')), false);
    assert.match(HTML, /id="event-editor-restored"[^>]*>\s*<span>Ungespeicherter Entwurf wiederhergestellt<\/span>\s*<button[^>]*data-click="discardEditorDraft"[^>]*>Verwerfen<\/button>/);
    assert.match(harness.element('event-editor-saved').textContent, /^Entwurf gesichert \d\d:\d\d$/);
});

test('without a stored draft there is no banner', async () => {
    const harness = await openApp();
    await go(harness, 'event-editor/new');
    assert.equal(isHidden(harness.element('event-editor-restored')), true);
});

test('a draft of an event changed on the server is dropped with a note', async () => {
    const harness = await openApp({}, { storage: { [E1_KEY]: stored({ title: 'Alt getippt' }, { baseUpdatedAt: 'T0' }) } });
    await go(harness, 'event-editor/e1');
    assert.equal(harness.element('event-title').value, 'Raid');
    assert.ok(harness.toasts.includes('Der gespeicherte Entwurf war veraltet und wurde verworfen.'));
    assert.equal(harness.localStorage.getItem(E1_KEY), null);
    assert.equal(isHidden(harness.element('event-editor-restored')), true);
});

test('a draft based on the current event is restored over it', async () => {
    const harness = await openApp({}, { storage: { [E1_KEY]: stored({ title: 'Weitergetippt', status: 'active' }, { baseUpdatedAt: 'T1', step: 1 }) } });
    await go(harness, 'event-editor/e1');
    assert.equal(harness.element('event-title').value, 'Weitergetippt');
    assert.equal(harness.element('event-edit-id').value, 'e1');
    assert.equal(isHidden(harness.element('event-editor-restored')), false);
});

test('"Verwerfen" removes the draft and shows the server state', async () => {
    const harness = await openApp({}, { storage: { [E1_KEY]: stored({ title: 'Weitergetippt' }, { baseUpdatedAt: 'T1' }) } });
    await go(harness, 'event-editor/e1');
    await harness.app.runAction('discardEditorDraft', {});
    assert.equal(harness.element('event-title').value, 'Raid');
    assert.equal(harness.localStorage.getItem(E1_KEY), null);
    assert.equal(isHidden(harness.element('event-editor-restored')), true);
    assert.equal(isHidden(harness.element('event-editor-saved')), true);
    assert.equal(harness.element('wizard-step-counter').textContent, 'Schritt 1 von 5');
});

test('a prefill wins over a stored draft of a new event', async () => {
    const harness = await openApp({}, { storage: { [NEW_KEY]: stored({ title: 'Gesichert' }) } });
    await harness.app.openEventEditor({ prefill: { title: 'Aus Vorlage' } });
    assert.equal(harness.element('event-title').value, 'Aus Vorlage');
    assert.equal(harness.localStorage.getItem(NEW_KEY), null);
    assert.equal(isHidden(harness.element('event-editor-restored')), true);
});

test('saving clears the stored draft and does not ask on the way out', async () => {
    const harness = await openApp({ '/api/admin/events': { id: 'neu' } }, { timers: true });
    await go(harness, 'event-editor/new');
    harness.element('event-status').value = 'draft';
    await typeTitle(harness, 'Raidnacht');
    assert.ok(harness.localStorage.getItem(NEW_KEY));
    await harness.app.saveEvent();
    assert.equal(harness.localStorage.getItem(NEW_KEY), null);
    await harness.app.handleRoute();
    assert.equal(harness.dialogs.length, 0);
    assert.equal(harness.location.hash, '#admin');
});

test('leaving a changed editor asks; "Abbrechen" keeps page, input and the stored draft', async () => {
    const harness = await openApp({}, { confirm: false, timers: true });
    await go(harness, 'event-editor/new');
    await typeTitle(harness, 'Raid');
    await go(harness, 'admin');
    assert.equal(harness.dialogs.length, 1);
    assert.equal(harness.dialogs[0].text, 'Ungespeicherte Änderungen verwerfen?');
    assert.equal(harness.dialogs[0].label, 'Verwerfen');
    assert.equal(harness.location.hash, '#event-editor/new');
    assert.equal(harness.element('event-editor-section').style.display, 'block');
    assert.equal(harness.element('event-title').value, 'Raid');
    assert.ok(harness.localStorage.getItem(NEW_KEY));
});

test('a confirmed leave forgets the stored draft', async () => {
    const harness = await openApp({}, { timers: true });
    await go(harness, 'event-editor/new');
    await typeTitle(harness, 'Raid');
    await go(harness, 'admin');
    assert.equal(harness.dialogs.length, 1);
    await harness.app.handleRoute();
    assert.equal(harness.localStorage.getItem(NEW_KEY), null);
    await go(harness, 'event-editor/new');
    assert.equal(harness.element('event-title').value, '');
    assert.equal(isHidden(harness.element('event-editor-restored')), true);
});

test('leaving an untouched editor does not ask and leaves the history alone', async () => {
    const harness = await openApp();
    await go(harness, 'event-editor/e1');
    await go(harness, 'admin');
    assert.equal(harness.dialogs.length, 0);
    assert.deepEqual(harness.historyCalls, []);
    assert.equal(harness.location.hash, '#admin');
});

test('"Zurück" with unsaved input asks as well', async () => {
    const harness = await openApp({}, { confirm: false, timers: true });
    await go(harness, 'event-editor/new');
    await typeTitle(harness, 'Raid');
    await harness.app.runAction('closeEventEditor', {});
    await harness.app.handleRoute();
    assert.equal(harness.dialogs.length, 1);
    assert.equal(harness.location.hash, '#event-editor/new');
});

test('a storage that throws leaves the editor usable and shows no note', async () => {
    const harness = await openApp({}, { storage: 'throws', timers: true });
    await go(harness, 'event-editor/new');
    await typeTitle(harness, 'Raid');
    assert.equal(harness.element('event-title').value, 'Raid');
    assert.equal(isHidden(harness.element('event-editor-saved')), true);
    assert.deepEqual(harness.toasts, []);
    assert.equal(isHidden(harness.element('event-editor-restored')), true);
});

test('the layout uses no class name of the Markdown editor inside it', () => {
    // EasyMDE styles .editor-toolbar, .editor-preview, .editor-preview-side, .editor-statusbar ...; a shared name would style both
    const vendor = fs.readFileSync(path.join(REPO_ROOT, 'public', 'vendor', 'easymde', 'easymde.min.css'), 'utf8');
    const taken = new Set([...vendor.matchAll(/\.(editor-[a-z-]+)/g)].map(match => match[1]));
    assert.ok(taken.has('editor-preview'));
    const section = HTML.slice(HTML.indexOf('<section id="event-editor-section"'), HTML.indexOf('<section id="insights-section"'));
    const used = new Set([...section.matchAll(/class="([^"]*)"/g)].flatMap(match => match[1].split(/\s+/)).filter(name => name.startsWith('editor-')));
    assert.ok(used.size >= 8);
    assert.deepEqual([...used].filter(name => taken.has(name)), []);
});
