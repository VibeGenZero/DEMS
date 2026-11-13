const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadFrontendApp, isHidden } = require('./helpers');

// Weekly series in the future: the edited date is the second of four
const SERIES = [
    { id: 's1', seriesId: 'serie', status: 'active', startDate: '2099-03-06T19:00:00.000Z', title: 'Raid' },
    { id: 's2', seriesId: 'serie', status: 'active', startDate: '2099-03-13T19:00:00.000Z', title: 'Raid' },
    { id: 's3', seriesId: 'serie', status: 'draft', startDate: '2099-03-20T19:00:00.000Z', title: 'Raid' },
    { id: 's4', seriesId: 'serie', status: 'cancelled', startDate: '2099-03-27T19:00:00.000Z', title: 'Raid' },
    { id: 's5', seriesId: 'serie', status: 'active', startDate: '2099-04-03T18:00:00.000Z', title: 'Raid' }
];
const stored = (id) => ({
    ...SERIES.find(event => event.id === id), endDate: '', description: '', accessMode: 'open', approvalMode: 'instant',
    recurring: true, recurringInterval: 'weekly', recurringUntil: '2099-04-03', formFields: [], slots: [], reminderHours: []
});

/**
 * Open the wizard on a stored event; the PUT answers `saved`.
 *
 * @param {Object} event -> Stored event.
 * @param {Object} [saved] -> Answer of the PUT.
 * @returns {Promise<Object>} -> loadFrontendApp() result.
 */
async function editDate(event, saved = { id: event.id, notifiedCount: 0, updatedDates: 0, createdDates: 0 }) {
    const frontend = await loadFrontendApp({
        [`/api/events/${event.id}?status=all`]: event,
        '/api/events/series/serie': SERIES,
        '/api/admin/roles': [],
        [`/api/admin/events/${event.id}`]: saved,
        '/api/admin/events': { id: 'neu' }
    });
    frontend.state.currentUser = { id: 'u-admin', username: 'mori', roles: [], isAdmin: true };
    frontend.state.csrfToken = 'test-token';
    await frontend.app.openEventEditor({ eventId: event.id });
    // The picker double ignores setDate -> hold the loaded start like flatpickr does
    frontend.state.startDatePicker.selectedDates = [new Date(event.startDate)];
    return frontend;
}

const scopeShown = (element) => !isHidden(element('wizard-series-scope'));
const sentBody = (requests, id) => JSON.parse(requests.filter(request => request.url === `/api/admin/events/${id}`).at(-1).body);

test('followingDateCount counts the later dates that are not over and still changeable', async () => {
    const { app } = await loadFrontendApp({});
    const now = new Date('2099-03-01T00:00:00.000Z');
    assert.equal(app.followingDateCount(SERIES, SERIES[1], now), 2);
    assert.equal(app.followingDateCount(SERIES, SERIES[4], now), 0);
    assert.equal(app.followingDateCount(SERIES, SERIES[0], new Date('2099-03-21T00:00:00.000Z')), 1);
    assert.equal(app.followingDateCount(SERIES, { id: 'x', startDate: '' }, now), 0);
});

test('editing a series date offers "Nur dieser Termin" and "Dieser und alle folgenden Termine" on the last step', async () => {
    const { app, element } = await editDate(stored('s2'));
    app.wizardGoTo(4);
    assert.equal(scopeShown(element), false);
    app.wizardGoTo(5);
    assert.equal(scopeShown(element), true);
    assert.equal(element('event-scope-this').checked, true);
    assert.equal(element('event-scope-following').checked, false);
    assert.equal(element('event-scope-following-label').textContent, 'Dieser und alle folgenden Termine (2)');
});

test('the last date of a series, a single event and a new event get no choice', async () => {
    const last = await editDate(stored('s5'));
    last.app.wizardGoTo(5);
    assert.equal(scopeShown(last.element), false);

    const single = await editDate({ ...stored('s2'), id: 'solo', seriesId: '', recurring: false });
    single.app.wizardGoTo(5);
    assert.equal(scopeShown(single.element), false);
    assert.equal(single.element('event-recurring').disabled, false);

    const fresh = await editDate(stored('s2'));
    await fresh.app.openEventEditor();
    fresh.element('event-title').value = 'Neu';
    fresh.app.wizardGoTo(5);
    assert.equal(scopeShown(fresh.element), false);
    assert.equal(fresh.element('event-recurring').disabled, false);
    assert.equal(fresh.element('event-recurring-interval').disabled, false);
    assert.ok(isHidden(fresh.element('event-recurring-until-hint')));
});

test('a series date locks the repeat switch and the interval and explains "Wiederholen bis"', async () => {
    const { element } = await editDate(stored('s2'));
    assert.equal(element('event-recurring').checked, true);
    assert.equal(element('event-recurring').disabled, true);
    assert.equal(element('event-recurring-interval').disabled, true);
    assert.equal(element('event-recurring-until').min, '2099-04-03');
    assert.equal(isHidden(element('event-recurring-until-hint')), false);
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    assert.match(html, /id="event-recurring-until-hint">Ein späteres Datum legt neue Termine an.</);
});

test('an earlier "Wiederholen bis" of a series is reported on step 2', async () => {
    const { app } = await loadFrontendApp({});
    // Results come from the module realm -> compare plain copies
    const check = (input) => JSON.parse(JSON.stringify(app.checkWizardStep(2, input)));
    const draft = { title: 'Raid', status: 'active', startDate: '2099-03-13T19:00:00.000Z', recurring: true, recurringUntil: '2099-03-27', storedRecurringUntil: '2099-04-03' };
    assert.deepEqual(check(draft), [{ field: 'recurringUntil', message: '„Wiederholen bis“ kann nur verlängert werden. Einzelne Termine löschst du in der Terminliste.' }]);
    assert.deepEqual(check({ ...draft, recurringUntil: '2099-04-10' }), []);
    assert.deepEqual(check({ ...draft, storedRecurringUntil: '' }), []);
});

test('saving with "Dieser und alle folgenden Termine" sends the scope and names the dates in the toast', async () => {
    const { app, element, requests, toasts } = await editDate(stored('s2'), { id: 's2', notifiedCount: 0, updatedDates: 3, createdDates: 0 });
    app.wizardGoTo(5);
    element('event-scope-this').checked = false;
    element('event-scope-following').checked = true;
    await app.saveEvent();
    assert.equal(sentBody(requests, 's2').applyTo, 'following');
    assert.equal(toasts.at(-1), 'Event und 3 folgende Termine aktualisiert!');
});

test('the toast adds notified participants and created dates', async () => {
    const notified = await editDate(stored('s2'), { id: 's2', notifiedCount: 5, updatedDates: 3, createdDates: 0 });
    notified.app.wizardGoTo(5);
    await notified.app.saveEvent();
    assert.equal(notified.toasts.at(-1), 'Event und 3 folgende Termine aktualisiert – 5 Teilnehmer benachrichtigt.');

    const extended = await editDate(stored('s2'), { id: 's2', notifiedCount: 0, updatedDates: 0, createdDates: 2 });
    extended.app.wizardGoTo(5);
    await extended.app.saveEvent();
    assert.equal(sentBody(extended.requests, 's2').applyTo, 'this');
    assert.equal(extended.toasts.at(-1), 'Event aktualisiert! 2 neue Termine angelegt.');

    const one = await editDate(stored('s2'), { id: 's2', notifiedCount: 1, updatedDates: 1, createdDates: 1 });
    one.app.wizardGoTo(5);
    await one.app.saveEvent();
    assert.equal(one.toasts.at(-1), 'Event und 1 folgender Termin aktualisiert – 1 Teilnehmer benachrichtigt. 1 neuer Termin angelegt.');
});

test('a single event is saved as before, without a scope', async () => {
    const { app, requests, toasts } = await editDate({ ...stored('s2'), id: 'solo', seriesId: '', recurring: false });
    app.wizardGoTo(5);
    await app.saveEvent();
    assert.equal(sentBody(requests, 'solo').applyTo, undefined);
    assert.equal(toasts.at(-1), 'Event aktualisiert!');
});

test('the scope goes back to "Nur dieser Termin" when the wizard opens again', async () => {
    const { app, element } = await editDate(stored('s2'));
    app.wizardGoTo(5);
    element('event-scope-this').checked = false;
    element('event-scope-following').checked = true;
    await app.openEventEditor({ eventId: 's2' });
    app.wizardGoTo(5);
    assert.equal(element('event-scope-this').checked, true);
    assert.equal(element('event-scope-following').checked, false);
});
