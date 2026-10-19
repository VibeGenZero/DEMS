const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadFrontendApp, isHidden } = require('./helpers');

// W-03: the event page and the overview tell members the registration and
// unregister deadlines, and close the form or the "Abmelden" button.

const settle = () => new Promise(resolve => setImmediate(resolve));

const HOUR = 60 * 60 * 1000;
const MEMBER = { id: 'u-member', username: 'member', roles: [], isAdmin: false };
const at = (offset) => new Date(Date.now() + offset).toISOString();

const eventRoutes = (fields, registration) => ({
    '/api/events/ev': { id: 'ev', title: 'Koop-Abend', accessMode: 'open', maxParticipants: 0, currentParticipants: 0, formFields: [], startDate: at(48 * HOUR), ...fields },
    '/api/events/ev/my-registration': registration,
    '/api/events/ev/participants': { participants: [], total: 0 },
    '/api/events/ev/comments': []
});

async function openPage(fields, registration) {
    const loaded = await loadFrontendApp(eventRoutes(fields, registration));
    loaded.state.currentUser = MEMBER;
    await loaded.app.showEventDetail('ev');
    await settle();
    return loaded;
}

const formatted = (iso) => new Date(iso).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) + ' Uhr';

test('the details name both deadlines', async () => {
    const registrationDeadline = at(24 * HOUR);
    const unregisterDeadline = at(40 * HOUR);
    const { element } = await openPage({ registrationDeadline, unregisterDeadline }, { registered: false });
    const registrationRow = element('sidebar-registration-deadline-row');
    const unregisterRow = element('sidebar-unregister-deadline-row');
    assert.equal(isHidden(registrationRow), false);
    assert.match(registrationRow.innerHTML, /Anmeldung bis/);
    assert.ok(registrationRow.innerHTML.includes(formatted(registrationDeadline)), registrationRow.innerHTML);
    assert.match(unregisterRow.innerHTML, /Abmeldung bis/);
    assert.ok(unregisterRow.innerHTML.includes(formatted(unregisterDeadline)), unregisterRow.innerHTML);
});

test('an event without deadlines shows no deadline rows, also after one with them', async () => {
    const { app, element } = await openPage({ registrationDeadline: at(24 * HOUR) }, { registered: false });
    app.renderSidebarDetails({ id: 'other', startDate: at(48 * HOUR) });
    assert.ok(isHidden(element('sidebar-registration-deadline-row')));
    assert.ok(isHidden(element('sidebar-unregister-deadline-row')));
});

test('after the registration deadline a visitor sees that registration is closed', async () => {
    const { element } = await openPage({ registrationDeadline: at(-HOUR) }, { registered: false });
    assert.equal(isHidden(element('detail-registration-closed')), false);
    assert.ok(isHidden(element('detail-register-area')));
    assert.ok(isHidden(element('detail-ended')));
    // The countdown still runs: the event has not started yet
    assert.equal(isHidden(element('detail-countdown-area')), false);
});

test('before the registration deadline the form is there', async () => {
    const { element } = await openPage({ registrationDeadline: at(HOUR) }, { registered: false });
    assert.equal(isHidden(element('detail-register-area')), false);
    assert.ok(isHidden(element('detail-registration-closed')));
});

test('after the unregister deadline a registered member keeps the status but loses "Abmelden"', async () => {
    const { element } = await openPage({ unregisterDeadline: at(-HOUR) }, { registered: true, status: 'accepted' });
    assert.equal(isHidden(element('detail-registered')), false);
    assert.ok(isHidden(element('unregister-btn')));
    assert.equal(isHidden(element('detail-unregister-closed')), false);
});

test('before the unregister deadline "Abmelden" is there', async () => {
    const { element } = await openPage({ unregisterDeadline: at(HOUR) }, { registered: true, status: 'accepted' });
    assert.equal(isHidden(element('unregister-btn')), false);
    assert.ok(isHidden(element('detail-unregister-closed')));
});

test('the overview card says when registration is closed', async () => {
    const { app } = await loadFrontendApp({});
    const now = new Date();
    const card = (fields) => app.renderEventCard({ id: 'c', title: 'Abend', accessMode: 'open', startDate: at(48 * HOUR), maxParticipants: 0, ...fields }, now);
    assert.match(card({ registrationDeadline: at(-HOUR) }), /Anmeldung geschlossen/);
    assert.doesNotMatch(card({ registrationDeadline: at(HOUR) }), /Anmeldung geschlossen/);
    assert.doesNotMatch(card({}), /Anmeldung geschlossen/);
    // An ended event is over, not "closed"
    assert.doesNotMatch(card({ startDate: at(-6 * HOUR), endDate: at(-3 * HOUR), registrationDeadline: at(-7 * HOUR) }), /Anmeldung geschlossen/);
});
