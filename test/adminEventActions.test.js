const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadFrontendApp, REPO_ROOT } = require('./helpers');

// setImmediate runs after the microtask queue is drained, so the reload an action starts has settled
const settle = () => new Promise(resolve => setImmediate(resolve));

const ADMIN = { id: 'u-admin', username: 'admin', roles: [], isAdmin: true };
const STATS = { events: { total: 0, active: 0, draft: 0, archived: 0 }, registrations: { total: 0, pending: 0, accepted: 0, rejected: 0, waitlisted: 0 } };
// Admin-set title with everything that breaks unescaped markup
const TRICKY_TEXT = 'Bob\'s "Raid" & <mehr>';

async function openAdmin(routes = {}, options = {}) {
    const harness = await loadFrontendApp({ '/api/admin/all-events': [], '/api/admin/stats': STATS, ...routes }, options);
    harness.state.currentUser = ADMIN;
    harness.state.csrfToken = 'token';
    return {
        ...harness,
        run: async (action, dataset) => { await harness.app.runAction(action, { dataset }); await settle(); },
        // Requests that change something, in call order
        sent: () => harness.requests.filter(request => request.method !== 'GET').map(request => `${request.method} ${request.url}`)
    };
}

// Every action that asks first
const QUESTIONS = [
    ['deleteEvent', { eventId: 'e1', eventTitle: 'Raid' }],
    ['deleteEventSeries', { seriesId: 's1', eventTitle: 'Raid', count: '3' }],
    ['startEvent', { eventId: 'e1', eventTitle: 'Raid' }],
    ['endEvent', { eventId: 'e1', eventTitle: 'Raid', channels: '1' }],
    ['syncDiscordEvent', { eventId: 'e1', eventTitle: 'Raid' }]
];

test('deleting asks in the DEMS dialog, names the event and reloads the list', async () => {
    const { run, sent, dialogs, toasts, requests } = await openAdmin({ '/api/admin/events/e1': { success: true } });
    await run('deleteEvent', { eventId: 'e1', eventTitle: TRICKY_TEXT });
    assert.deepEqual(dialogs, [{ text: `„${TRICKY_TEXT}“ löschen? Alle Anmeldungen werden mitgelöscht.`, label: 'Löschen', danger: true }]);
    assert.deepEqual(sent(), ['DELETE /api/admin/events/e1']);
    assert.deepEqual(toasts, ['Event gelöscht.']);
    assert.ok(requests.some(request => request.url === '/api/admin/all-events'));
    assert.ok(requests.some(request => request.url === '/api/admin/stats'));
});

test('dismissing the dialog sends nothing', async () => {
    for (const [action, dataset] of QUESTIONS) {
        const { run, sent, dialogs, toasts } = await openAdmin({}, { confirm: false });
        await run(action, dataset);
        assert.equal(dialogs.length, 1, action);
        assert.deepEqual(sent(), [], action);
        assert.deepEqual(toasts, [], action);
    }
});

test('each question says what happens and which button confirms', async () => {
    const { run, sent, dialogs, toasts } = await openAdmin({
        '/api/admin/events/series/s1': { deletedCount: 3 },
        '/api/admin/events/e1/start': { success: true },
        '/api/admin/events/e1/end': { success: true },
        '/api/admin/events/e1/sync-discord': { success: true }
    });
    await run('deleteEventSeries', { seriesId: 's1', eventTitle: 'Training', count: '3' });
    await run('startEvent', { eventId: 'e1', eventTitle: 'Spontan' });
    await run('endEvent', { eventId: 'e1', eventTitle: 'Marathon', channels: '1' });
    await run('endEvent', { eventId: 'e1', eventTitle: 'Marathon', channels: '' });
    await run('syncDiscordEvent', { eventId: 'e1', eventTitle: 'Raid' });
    assert.deepEqual(dialogs, [
        { text: 'Ganze Serie „Training“ löschen? Alle 3 Termine und ihre Anmeldungen werden gelöscht.', label: 'Serie löschen', danger: true },
        { text: '„Spontan“ jetzt starten? Das Event wird veröffentlicht, als Start wird jetzt eingetragen.', label: 'Starten', danger: false },
        { text: '„Marathon“ jetzt beenden? Das Event wird archiviert, als Ende wird jetzt eingetragen. Die Event-Channels werden gelöscht.', label: 'Beenden', danger: true },
        { text: '„Marathon“ jetzt beenden? Das Event wird archiviert, als Ende wird jetzt eingetragen.', label: 'Beenden', danger: true },
        { text: '„Raid“ als geplantes Event in Discord eintragen?', label: 'Eintragen', danger: false }
    ]);
    assert.deepEqual(sent(), [
        'DELETE /api/admin/events/series/s1', 'POST /api/admin/events/e1/start', 'POST /api/admin/events/e1/end',
        'POST /api/admin/events/e1/end', 'POST /api/admin/events/e1/sync-discord'
    ]);
    assert.deepEqual(toasts, ['Serie gelöscht (3 Termine).', 'Event gestartet.', 'Event beendet.', 'Event beendet.', 'Event in Discord eingetragen.']);
});

test('a series with one date or an unknown number is asked about correctly', async () => {
    const { run, dialogs } = await openAdmin({}, { confirm: false });
    await run('deleteEventSeries', { seriesId: 's1', eventTitle: 'Kurs', count: '1' });
    await run('deleteEventSeries', { seriesId: 's1', eventTitle: 'Kurs' });
    await run('deleteEvent', { eventId: 'e1' });
    assert.deepEqual(dialogs.map(dialog => dialog.text), [
        'Ganze Serie „Kurs“ löschen? Ihr Termin und seine Anmeldungen werden gelöscht.',
        'Ganze Serie „Kurs“ löschen? Alle Termine und ihre Anmeldungen werden gelöscht.',
        '„Event“ löschen? Alle Anmeldungen werden mitgelöscht.'
    ]);
});

test('status changes need no question and say where the event is now', async () => {
    const { run, dialogs, toasts, requests } = await openAdmin({ '/api/admin/events/e1/status': { id: 'e1' } });
    for (const status of ['active', 'draft', 'archived']) await run('changeEventStatus', { eventId: 'e1', status });
    const changes = requests.filter(request => request.method === 'PUT');
    assert.deepEqual(dialogs, []);
    assert.deepEqual(toasts, ['Event ist jetzt aktiv.', 'Event liegt jetzt in den Entwürfen.', 'Event archiviert.']);
    assert.deepEqual(changes.map(request => JSON.parse(request.body).status), ['active', 'draft', 'archived']);
    assert.ok(changes.every(request => request.headers['X-CSRF-TOKEN'] === 'token'));
});

test('a refused action shows the reason of the server and no success', async () => {
    // No routes: every request answers 404 { error: 'Nicht gefunden' }
    const { run, toasts, requests } = await openAdmin();
    await run('deleteEvent', { eventId: 'gone', eventTitle: 'Raid' });
    await run('deleteEventSeries', { seriesId: 'gone', eventTitle: 'Raid', count: '2' });
    await run('changeEventStatus', { eventId: 'gone', status: 'archived' });
    await run('duplicateEvent', { eventId: 'gone' });
    await run('startEvent', { eventId: 'gone', eventTitle: 'Raid' });
    assert.deepEqual(toasts, ['Nicht gefunden', 'Nicht gefunden', 'Nicht gefunden', 'Nicht gefunden', 'Nicht gefunden']);
    // Nothing changed, so the list is not loaded again
    assert.ok(!requests.some(request => request.url === '/api/admin/all-events'));
});

test('duplicating shows the copy among the drafts', async () => {
    const copy = {
        id: 'copy', title: 'Raid (Kopie)', status: 'draft', startDate: '',
        places: { taken: 0, capacity: 0, guests: 0, pending: 0, waitlist: 0, text: '0 Plätze belegt', waitlistText: '' }
    };
    const { app, run, element, dialogs, toasts } = await openAdmin({
        '/api/admin/all-events': [copy],
        '/api/admin/events/e1/duplicate': { id: 'copy', title: 'Raid (Kopie)' }
    });
    await app.loadAdminEvents();
    await run('duplicateEvent', { eventId: 'e1' });
    assert.deepEqual(dialogs, []);
    assert.deepEqual(toasts, ['Kopie liegt in den Entwürfen: Raid (Kopie)']);
    assert.match(element('admin-events-tabs').innerHTML, /class="nav-link active"[^>]*data-tab="drafts"/);
    assert.match(element('admin-events-table').innerHTML, />Raid \(Kopie\)</);
});

test('the event actions never ask through the browser dialog', () => {
    const source = fs.readFileSync(path.join(REPO_ROOT, 'public', 'js', 'admin', 'event-actions.js'), 'utf8');
    assert.doesNotMatch(source, /(?<![\w.])confirm\(/);
});
