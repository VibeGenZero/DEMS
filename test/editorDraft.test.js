const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadFrontendApp } = require('./helpers');

// Browser store of unsaved event drafts (public/js/admin/editor-draft.js)

const DRAFT = { title: 'Raid', maxParticipants: 20, slots: [{ id: 's1', name: 'Tank', emoji: '', capacity: 2 }] };

test('a stored draft comes back with step and base time', async () => {
    const { app } = await loadFrontendApp({});
    assert.equal(app.storeDraft('', { draft: DRAFT, step: 3, baseUpdatedAt: '' }), true);
    const stored = app.readDraft('');
    assert.equal(JSON.stringify(stored.draft), JSON.stringify(DRAFT));
    assert.equal(stored.step, 3);
    assert.equal(stored.baseUpdatedAt, '');
    assert.match(stored.savedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test('new events and each event id have their own key', async () => {
    const { app, localStorage } = await loadFrontendApp({});
    assert.equal(app.draftKey(''), 'dems_event_draft_new');
    assert.equal(app.draftKey(null), 'dems_event_draft_new');
    assert.equal(app.draftKey(undefined), 'dems_event_draft_new');
    assert.equal(app.draftKey('abc'), 'dems_event_draft_abc');
    app.storeDraft('abc', { draft: DRAFT, step: 1, baseUpdatedAt: 'T1' });
    assert.equal(app.readDraft(''), null);
    assert.equal(app.readDraft('abc').baseUpdatedAt, 'T1');
    assert.ok(localStorage.getItem('dems_event_draft_abc'));
});

test('unparsable or foreign content reads as null', async () => {
    for (const content of ['{oops', '"text"', '{"draft":5}', 'null', '[]', '{"draft":{},"step":"x"}']) {
        const { app } = await loadFrontendApp({}, { storage: { dems_event_draft_new: content } });
        assert.equal(app.readDraft(''), null, content);
    }
});

test('a step outside the wizard falls back to the first one', async () => {
    const stored = JSON.stringify({ draft: DRAFT, step: 9, baseUpdatedAt: '', savedAt: '2026-11-13T19:14:00.000Z' });
    const { app } = await loadFrontendApp({}, { storage: { dems_event_draft_new: stored } });
    assert.equal(app.readDraft('').step, 1);
});

test('a storage that throws makes storeDraft answer false and readDraft null', async () => {
    const { app } = await loadFrontendApp({}, { storage: 'throws' });
    assert.equal(app.storeDraft('', { draft: DRAFT, step: 1, baseUpdatedAt: '' }), false);
    assert.equal(app.readDraft(''), null);
    assert.doesNotThrow(() => app.clearDraft(''));
});

test('a draft is stale when the event was saved since', async () => {
    const { app } = await loadFrontendApp({});
    assert.equal(app.isDraftStale({ baseUpdatedAt: 'A' }, { updatedAt: 'B' }), true);
    assert.equal(app.isDraftStale({ baseUpdatedAt: 'A' }, { updatedAt: 'A' }), false);
    assert.equal(app.isDraftStale({ baseUpdatedAt: '' }, {}), false);
    assert.equal(app.isDraftStale({ baseUpdatedAt: 'A' }, null), false);
    assert.equal(app.isDraftStale({ baseUpdatedAt: 'A' }, undefined), false);
});

test('clearDraft removes only its own key', async () => {
    const { app } = await loadFrontendApp({});
    app.storeDraft('', { draft: DRAFT, step: 1, baseUpdatedAt: '' });
    app.storeDraft('abc', { draft: DRAFT, step: 2, baseUpdatedAt: 'T1' });
    app.clearDraft('');
    assert.equal(app.readDraft(''), null);
    assert.equal(app.readDraft('abc').step, 2);
});

test('the saved note shows the local time with two digits', async () => {
    const { app } = await loadFrontendApp({});
    const at = new Date(2026, 10, 13, 9, 5, 0);
    assert.equal(app.formatSavedAt(at.toISOString()), 'Entwurf gesichert 09:05');
    assert.equal(app.formatSavedAt('kaputt'), '');
});
