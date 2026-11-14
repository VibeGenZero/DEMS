const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadFrontendApp, httpAnswer, isHidden, REPO_ROOT } = require('./helpers');

// The AI assistant panel and the field helpers of the event editor (admin/editor-assist.js)

const HTML = fs.readFileSync(path.join(REPO_ROOT, 'public', 'index.html'), 'utf8');

// Copy of ALLOWED_DRAFT_FIELDS (ai/draftFields.js); a test below keeps the two equal
const DRAFT_FIELDS = [
    'title', 'description', 'aiNotes', 'accentColor', 'category', 'location', 'maxParticipants', 'accessMode',
    'requiredRoles', 'approvalMode', 'allowGuests', 'allowTentative', 'slots', 'assignRoleId', 'formFields',
    'reminderHours', 'checkinMessage', 'autoCreateChannels', 'channelConfig', 'customBotMessages',
    'announceChannelId', 'startDate', 'endDate', 'registrationDeadline', 'unregisterDeadline'
];

const AI_ON = { memberAssistant: false, adminAssistant: true, assistantName: 'Event-Assistent', teaserText: '' };
const DRAFT_URL = '/api/admin/ai/event-draft';
const TEXT_URL = '/api/admin/ai/text';
const ADMIN = { id: 'u-admin', username: 'mori', roles: [], isAdmin: true };
const EVENT = {
    id: 'e1', title: 'Raid', description: 'Text', status: 'active', startDate: '2026-12-01T19:00:00.000Z', endDate: '',
    maxParticipants: 10, accessMode: 'open', approvalMode: 'manual', formFields: [], updatedAt: 'T1'
};

const settle = () => new Promise(resolve => setImmediate(resolve));

/**
 * Load the app as an admin and open the editor of a new event.
 *
 * @param {Object} [setup] -> `{ routes, ai, options, route }`.
 * @returns {Promise<Object>} -> The loadFrontendApp() harness.
 */
async function openEditor({ routes = {}, ai = AI_ON, options = {}, route = 'event-editor/new' } = {}) {
    const harness = await loadFrontendApp({ '/api/admin/roles': [], '/api/events/e1?status=all': EVENT, ...routes }, options);
    harness.state.currentUser = ADMIN;
    harness.state.csrfToken = 'csrf-1';
    harness.state.aiInfo = ai;
    harness.location.hash = '#' + route;
    await harness.app.handleRoute();
    await settle();
    return harness;
}

const message = (harness, n) => harness.element(`editor-assist-msg-${n}`);
const posts = (harness, url) => harness.requests.filter(request => request.url === url && request.method === 'POST');

async function send(harness, text) {
    harness.element('editor-assist-input').value = text;
    await harness.app.runAction('sendEditorAssist', {});
    await settle();
}

test('the panel lives in the assist column and the toggle in the top bar', () => {
    assert.match(HTML, /<aside class="editor-assist is-hidden" id="event-editor-assist"/);
    assert.match(HTML, /id="editor-assist-messages"[^>]*aria-live="polite"/);
    assert.match(HTML, /<textarea[^>]*id="editor-assist-input"[^>]*maxlength="2000"/);
    assert.match(HTML, /Beschreib dein Event in eigenen Worten – ich fülle das Formular aus\. Gespeichert wird erst, wenn du speicherst\./);
    assert.match(HTML, /id="event-editor-assist-toggle"[^>]*data-click="toggleEditorAssist"/);
    assert.match(HTML, /id="event-description-improve"[^>]*data-click="improveDescription"/);
    assert.match(HTML, /id="event-ai-notes-suggest"[^>]*data-click="suggestAiNotes"/);
});

test('everything stays hidden while the admin assistant is off', async () => {
    const harness = await openEditor({ ai: { ...AI_ON, adminAssistant: false } });
    assert.ok(isHidden(harness.element('event-editor-assist-toggle')));
    assert.ok(isHidden(harness.element('event-editor-assist')));
    assert.ok(isHidden(harness.element('event-description-improve')));
    assert.ok(isHidden(harness.element('event-ai-notes-suggest')));
    await harness.app.runAction('toggleEditorAssist', {});
    assert.ok(isHidden(harness.element('event-editor-assist')));
});

test('the toggle opens the panel, sets aria-expanded and focuses the input; again closes it', async () => {
    const harness = await openEditor();
    const toggle = harness.element('event-editor-assist-toggle');
    assert.ok(!isHidden(toggle));
    assert.ok(isHidden(harness.element('event-editor-assist')));
    await harness.app.runAction('toggleEditorAssist', {});
    assert.ok(!isHidden(harness.element('event-editor-assist')));
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.deepEqual(harness.element('editor-assist-input').calls.at(-1), ['focus']);
    await harness.app.runAction('toggleEditorAssist', {});
    assert.ok(isHidden(harness.element('event-editor-assist')));
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
});

test('the request holds the message, the current draft and the history, with the CSRF header', async () => {
    const harness = await openEditor({ routes: { [DRAFT_URL]: { patch: {}, reply: 'Wann soll es losgehen?', questions: [] } } });
    harness.element('event-title').value = 'Schon da';
    await send(harness, 'Raid am Samstag');
    await send(harness, 'Um 20 Uhr');
    const [first, second] = posts(harness, DRAFT_URL);
    assert.equal(first.headers['X-CSRF-TOKEN'], 'csrf-1');
    const body = JSON.parse(first.body);
    assert.equal(body.message, 'Raid am Samstag');
    assert.equal(body.draft.title, 'Schon da');
    assert.deepEqual(body.history, []);
    assert.deepEqual(JSON.parse(second.body).history, [
        { role: 'user', text: 'Raid am Samstag' },
        { role: 'assistant', text: 'Wann soll es losgehen?' }
    ]);
    assert.equal(harness.element('editor-assist-input').value, '');
});

test('the history sent is the last six turns', async () => {
    const harness = await openEditor({ routes: { [DRAFT_URL]: { patch: {}, reply: 'Ok', questions: [] } } });
    for (const text of ['a', 'b', 'c', 'd', 'e']) await send(harness, text);
    const history = JSON.parse(posts(harness, DRAFT_URL).at(-1).body).history;
    assert.equal(history.length, 6);
    assert.deepEqual(history[0], { role: 'user', text: 'b' });
});

test('a returned patch changes exactly those fields, marks them and stays on the step', async () => {
    const patch = { title: 'Raid am Samstag', maxParticipants: 20, startDate: '2026-12-05T19:00:00.000Z' };
    const harness = await openEditor({ routes: { [DRAFT_URL]: { patch, reply: 'Entwurf ist im Formular, 3 Felder gefüllt.', questions: [] } } });
    harness.element('event-category').value = 'Raid';
    harness.app.wizardGoTo(2);
    await send(harness, 'Raid am Samstag 20 Uhr, 20 Plätze');
    assert.equal(harness.element('event-title').value, 'Raid am Samstag');
    assert.equal(String(harness.element('event-max').value), '20');
    assert.equal(harness.state.startDatePicker.selectedDates[0].toISOString(), '2026-12-05T19:00:00.000Z');
    assert.equal(harness.element('event-category').value, 'Raid');
    assert.equal(harness.element('wizard-step-counter').textContent, 'Schritt 2 von 5');
    for (const [field, id] of [['title', 'event-title'], ['maxParticipants', 'event-max'], ['startDate', 'event-start-date']]) {
        assert.ok(harness.element(id).classList.contains('is-ai-filled'), id);
        assert.match(harness.element(`ai-mark-${field}`).innerHTML, /von KI/);
    }
    assert.ok(!harness.element('event-category').classList.contains('is-ai-filled'));
    assert.equal(harness.element('ai-mark-category'), null);
    assert.match(message(harness, 2).innerHTML, /Entwurf ist im Formular, 3 Felder gefüllt\./);
    assert.ok(harness.element('editor-assist-undo'));
});

test('a field the patch sets to its current value is not marked', async () => {
    const harness = await openEditor({ routes: { [DRAFT_URL]: { patch: { title: 'Gleich', maxParticipants: 0 }, reply: 'Ok', questions: [] } } });
    harness.element('event-title').value = 'Gleich';
    await send(harness, 'x');
    assert.ok(!harness.element('event-title').classList.contains('is-ai-filled'));
    assert.ok(!harness.element('event-max').classList.contains('is-ai-filled'));
    assert.equal(harness.element('editor-assist-undo'), null);
});

test('AI_FIELD_INPUTS covers every field the AI may set, and every target exists in the page', async () => {
    const { ALLOWED_DRAFT_FIELDS } = require('../ai/draftFields');
    assert.deepEqual([...DRAFT_FIELDS].sort(), [...ALLOWED_DRAFT_FIELDS].sort());
    const harness = await openEditor();
    const { AI_FIELD_INPUTS } = harness.app;
    assert.deepEqual(Object.keys(AI_FIELD_INPUTS).sort(), [...DRAFT_FIELDS].sort());
    for (const [field, id] of Object.entries(AI_FIELD_INPUTS)) {
        assert.match(HTML, new RegExp(`id="${id}"`), `${field} -> ${id}`);
    }
});

test('typing into a marked field removes its mark', async () => {
    const harness = await openEditor({ routes: { [DRAFT_URL]: { patch: { title: 'KI-Titel', category: 'Raid' }, reply: 'Ok', questions: [] } } });
    await send(harness, 'x');
    harness.element('event-title').dispatch('input');
    assert.ok(!harness.element('event-title').classList.contains('is-ai-filled'));
    assert.equal(harness.element('ai-mark-title'), null);
    assert.ok(harness.element('event-category').classList.contains('is-ai-filled'));
});

test('„Rückgängig" restores the form from before the patch and is offered once', async () => {
    const harness = await openEditor({ routes: { [DRAFT_URL]: { patch: { title: 'KI-Titel' }, reply: 'Ok', questions: [] } } });
    harness.element('event-title').value = 'Mein Titel';
    await send(harness, 'x');
    assert.equal(harness.element('event-title').value, 'KI-Titel');
    await harness.app.runAction('undoEditorAssist', {});
    assert.equal(harness.element('event-title').value, 'Mein Titel');
    assert.ok(!harness.element('event-title').classList.contains('is-ai-filled'));
    assert.equal(harness.element('ai-mark-title'), null);
    assert.equal(harness.element('editor-assist-undo'), null);
    harness.element('event-title').value = 'Danach getippt';
    await harness.app.runAction('undoEditorAssist', {});
    assert.equal(harness.element('event-title').value, 'Danach getippt');
});

test('questions and the reply are rendered escaped', async () => {
    const harness = await openEditor({ routes: { [DRAFT_URL]: { patch: {}, reply: '<b>Fast</b> fertig', questions: ['<img src=x onerror=alert(1)>?', 'Wie viele Plätze?'] } } });
    await send(harness, '<i>Raid</i>');
    assert.match(message(harness, 1).innerHTML, /&lt;i&gt;Raid&lt;\/i&gt;/);
    const html = message(harness, 2).innerHTML;
    assert.doesNotMatch(html, /<img|<b>/);
    assert.match(html, /&lt;b&gt;Fast&lt;\/b&gt; fertig/);
    assert.match(html, /<li>&lt;img src=x onerror=alert\(1\)&gt;\?<\/li>/);
    assert.match(html, /<li>Wie viele Plätze\?<\/li>/);
});

test('while a request runs the input is disabled and a typing indicator shows', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const harness = await openEditor({ routes: { [DRAFT_URL]: () => gate.then(() => ({ patch: {}, reply: 'Ok', questions: [] })) } });
    harness.element('editor-assist-input').value = 'x';
    const running = harness.app.runAction('sendEditorAssist', {});
    await settle();
    assert.equal(harness.element('editor-assist-input').disabled, true);
    assert.equal(harness.element('editor-assist-send').disabled, true);
    assert.match(message(harness, 2).innerHTML, /assistant-typing/);
    // A second send while one runs does nothing
    harness.element('editor-assist-input').value = 'y';
    await harness.app.runAction('sendEditorAssist', {});
    release();
    await running;
    await settle();
    assert.equal(posts(harness, DRAFT_URL).length, 1);
    assert.equal(harness.element('editor-assist-input').disabled, false);
    assert.doesNotMatch(message(harness, 2).innerHTML, /assistant-typing/);
});

test('a 429 shows the server sentence and re-enables the input', async () => {
    const harness = await openEditor({ routes: { [DRAFT_URL]: httpAnswer(429, { error: 'Du hast das KI-Limit für diese Stunde erreicht.' }) } });
    await send(harness, 'x');
    assert.match(message(harness, 2).innerHTML, /Du hast das KI-Limit für diese Stunde erreicht\./);
    assert.match(message(harness, 2).className, /is-warning/);
    assert.equal(harness.element('editor-assist-input').disabled, false);
    // A refused message is no turn of the history
    await send(harness, 'y');
    assert.deepEqual(JSON.parse(posts(harness, DRAFT_URL).at(-1).body).history, []);
});

test('an empty message sends nothing', async () => {
    const harness = await openEditor({ routes: { [DRAFT_URL]: { patch: {}, reply: 'Ok', questions: [] } } });
    await send(harness, '   ');
    assert.equal(posts(harness, DRAFT_URL).length, 0);
});

test('„Mit KI verbessern" is disabled while the description is empty', async () => {
    const harness = await openEditor();
    assert.equal(harness.element('event-description-improve').disabled, true);
    harness.state.descriptionEditor.value('Raid am Samstag');
    harness.app.editorChanged();
    assert.equal(harness.element('event-description-improve').disabled, false);
});

test('„Mit KI verbessern" replaces the description, marks it and points to the undo', async () => {
    const harness = await openEditor({ routes: { [TEXT_URL]: { text: '## Raid\n\nKlarer Text.' } } });
    harness.state.descriptionEditor.value('raid samstag');
    harness.app.editorChanged();
    await harness.app.runAction('improveDescription', {});
    await settle();
    const [request] = posts(harness, TEXT_URL);
    assert.equal(request.headers['X-CSRF-TOKEN'], 'csrf-1');
    const body = JSON.parse(request.body);
    assert.equal(body.kind, 'improve-description');
    assert.equal(body.draft.description, 'raid samstag');
    assert.equal(harness.state.descriptionEditor.value(), '## Raid\n\nKlarer Text.');
    assert.ok(harness.element('event-description-group').classList.contains('is-ai-filled'));
    assert.ok(harness.toasts.includes('Rückgängig über den KI-Assistenten möglich.'));
    await harness.app.runAction('undoEditorAssist', {});
    assert.equal(harness.state.descriptionEditor.value(), 'raid samstag');
});

test('„Vorschlag von KI" fills the notes for the assistant', async () => {
    const harness = await openEditor({ routes: { [TEXT_URL]: { text: 'Gibt es Pausen?\nAntwort: ' } } });
    await harness.app.runAction('suggestAiNotes', {});
    await settle();
    assert.equal(JSON.parse(posts(harness, TEXT_URL)[0].body).kind, 'suggest-ai-notes');
    assert.equal(harness.element('event-ai-notes').value, 'Gibt es Pausen?\nAntwort: ');
    assert.ok(harness.element('event-ai-notes').classList.contains('is-ai-filled'));
});

test('a refused field helper shows the sentence and changes nothing', async () => {
    const harness = await openEditor({ routes: { [TEXT_URL]: httpAnswer(429, { error: 'Du hast das KI-Limit für diese Stunde erreicht.' }) } });
    harness.element('event-ai-notes').value = 'Alt';
    await harness.app.runAction('suggestAiNotes', {});
    await settle();
    assert.equal(harness.element('event-ai-notes').value, 'Alt');
    assert.ok(harness.toasts.includes('Du hast das KI-Limit für diese Stunde erreicht.'));
    assert.equal(harness.element('event-ai-notes-suggest').disabled, false);
});

test('saving clears all marks', async () => {
    const harness = await openEditor({
        routes: { [DRAFT_URL]: { patch: { title: 'KI-Titel' }, reply: 'Ok', questions: [] }, '/api/admin/events': { id: 'neu' } }
    });
    await send(harness, 'x');
    harness.element('event-status').value = 'draft';
    await harness.app.saveEvent();
    assert.ok(harness.toasts.includes('Event erstellt!'), harness.toasts.join(' | '));
    assert.ok(!harness.element('event-title').classList.contains('is-ai-filled'));
    assert.equal(harness.element('ai-mark-title'), null);
});

test('the kept draft of the editor contains the applied patch', async () => {
    const harness = await openEditor({
        routes: { [DRAFT_URL]: { patch: { title: 'KI-Titel', maxParticipants: 20 }, reply: 'Ok', questions: [] } },
        options: { timers: true }
    });
    await send(harness, 'x');
    await harness.advance(800);
    const kept = JSON.parse(harness.localStorage.getItem('dems_event_draft_new'));
    assert.equal(kept.draft.title, 'KI-Titel');
    assert.equal(String(kept.draft.maxParticipants), '20');
});

test('opening another event starts a fresh conversation', async () => {
    const harness = await openEditor({ routes: { [DRAFT_URL]: { patch: { title: 'KI-Titel' }, reply: 'Ok', questions: [] } } });
    await send(harness, 'x');
    harness.location.hash = '#admin';
    await harness.app.handleRoute();
    await harness.app.handleRoute();
    harness.location.hash = '#event-editor/e1';
    await harness.app.handleRoute();
    await settle();
    assert.equal(message(harness, 1), null);
    assert.equal(harness.element('editor-assist-undo'), null);
    await send(harness, 'y');
    assert.deepEqual(JSON.parse(posts(harness, DRAFT_URL).at(-1).body).history, []);
});

async function openAdmin(ai) {
    const harness = await loadFrontendApp({
        '/api/admin/roles': [], '/api/admin/stats': { events: {}, registrations: {} }, '/api/admin/all-events': []
    });
    harness.state.currentUser = ADMIN;
    harness.state.csrfToken = 'csrf-1';
    harness.state.aiInfo = ai;
    harness.location.hash = '#admin';
    await harness.app.handleRoute();
    await settle();
    return harness;
}

test('„Mit KI erstellen" shows on the dashboard only while the admin assistant is on', async () => {
    const off = await openAdmin({ ...AI_ON, adminAssistant: false });
    assert.ok(isHidden(off.element('admin-create-ai')));
    const on = await openAdmin(AI_ON);
    assert.ok(!isHidden(on.element('admin-create-ai')));
});

test('„Mit KI erstellen" opens a new event with the assistant open and the input focused', async () => {
    const harness = await openAdmin(AI_ON);
    await harness.app.runAction('createEventWithAi', {});
    await settle();
    assert.equal(harness.location.hash, '#event-editor/new');
    assert.equal(harness.element('event-editor-section').style.display, 'block');
    assert.ok(!isHidden(harness.element('event-editor-assist')));
    assert.equal(harness.element('event-editor-assist-toggle').getAttribute('aria-expanded'), 'true');
    assert.deepEqual(harness.element('editor-assist-input').calls.at(-1), ['focus']);
});
