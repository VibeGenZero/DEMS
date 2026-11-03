const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadFrontendApp, isHidden } = require('./helpers');

const INDEX_HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
/** Static markup of the element with this id, up to the next sibling comment. */
const markupOf = (id) => INDEX_HTML.slice(INDEX_HTML.indexOf(`id="${id}"`), INDEX_HTML.indexOf('<!--', INDEX_HTML.indexOf(`id="${id}"`)));

// B-17: „Vielleicht“ / Ersatzbank on the event page.

const settle = () => new Promise(resolve => setImmediate(resolve));
const HOUR = 60 * 60 * 1000;
const MEMBER = { id: 'u-member', username: 'member', roles: [], isAdmin: false };
const at = (offset) => new Date(Date.now() + offset).toISOString();
const EVENT = {
    id: 'ev', title: 'Raid', accessMode: 'open', allowTentative: true, allowGuests: false, maxParticipants: 5, currentParticipants: 2,
    places: { taken: 2, capacity: 5, text: '2 von 5 Plätzen belegt', waitlistText: '', bench: 2, benchText: '2 auf der Ersatzbank' },
    formFields: [], startDate: at(48 * HOUR)
};
const TENTATIVE = { registered: true, id: 'r1', status: 'tentative' };

async function openPage({ event = EVENT, registration = { registered: false }, participants = { participants: [], total: 0, bench: [] }, routes = {} } = {}) {
    const loaded = await loadFrontendApp({
        '/api/events/ev': event,
        '/api/events/ev/my-registration': registration,
        '/api/events/ev/participants': participants,
        '/api/events/ev/comments': [],
        ...routes
    });
    loaded.state.currentUser = MEMBER;
    loaded.state.csrfToken = 'test-token';
    await loaded.app.showEventDetail('ev');
    await settle();
    return loaded;
}

test('„Vielleicht“ stands next to „Teilnehmen“ only where the event allows it', async () => {
    const allowed = await openPage();
    assert.equal(isHidden(allowed.element('register-btn')), false);
    assert.equal(isHidden(allowed.element('tentative-btn')), false);
    assert.match(INDEX_HTML, /data-click="answerTentative" id="tentative-btn">\s*<i class="bi bi-question-circle me-2"><\/i>Vielleicht/);

    const plain = await openPage({ event: { ...EVENT, allowTentative: false } });
    assert.equal(isHidden(plain.element('tentative-btn')), true);
});

test('a full event still offers „Vielleicht“ next to the waitlist', async () => {
    const { element } = await openPage({ event: { ...EVENT, currentParticipants: 5, places: { ...EVENT.places, taken: 5 } } });
    assert.equal(isHidden(element('waitlist-btn')), false);
    assert.equal(isHidden(element('tentative-btn')), false);
});

test('„Vielleicht“ sends the answer with the tentative flag, no guests and the CSRF token', async () => {
    const { app, requests, toasts } = await openPage({
        routes: { '/api/events/ev/register': { id: 'r1', status: 'tentative', message: 'Du stehst auf der Ersatzbank.' } }
    });
    await app.answerTentative();
    await settle();
    const sent = requests.find(request => request.url === '/api/events/ev/register' && request.method === 'POST');
    assert.equal(sent.headers['X-CSRF-TOKEN'], 'test-token');
    const body = JSON.parse(sent.body);
    assert.equal(body.tentative, true);
    assert.deepEqual(body.guests, []);
    assert.equal(toasts.at(-1), 'Du stehst auf der Ersatzbank.');
});

test('the bench card replaces the registered area with „Fest zusagen“ and „Abmelden“', async () => {
    const { element } = await openPage({ registration: TENTATIVE });
    assert.equal(isHidden(element('detail-tentative')), false);
    assert.equal(isHidden(element('detail-registered')), true);
    assert.match(markupOf('detail-tentative'), /Vielleicht \(Ersatzbank\)[\s\S]*data-click="confirmTentative"[\s\S]*Fest zusagen[\s\S]*data-click="unregisterFromEvent"[\s\S]*Abmelden/);
    assert.equal(isHidden(element('tentative-confirm-btn')), false);
    assert.equal(isHidden(element('tentative-btn')), true);
});

test('after the registration deadline the bench card offers no „Fest zusagen“', async () => {
    const { element } = await openPage({ event: { ...EVENT, registrationDeadline: at(-HOUR) }, registration: TENTATIVE });
    assert.equal(isHidden(element('detail-tentative')), false);
    assert.equal(isHidden(element('tentative-confirm-btn')), true);
});

test('„Fest zusagen“ sends the confirmation with the CSRF token, shows the answer and reloads', async () => {
    const { app, requests, toasts } = await openPage({
        registration: TENTATIVE,
        routes: { '/api/events/ev/register/confirm': { id: 'r1', status: 'accepted', message: 'Erfolgreich angemeldet!' } }
    });
    const before = requests.filter(request => request.url === '/api/events/ev/my-registration').length;
    await app.confirmTentative();
    await settle();
    const sent = requests.find(request => request.url === '/api/events/ev/register/confirm');
    assert.equal(sent.method, 'POST');
    assert.equal(sent.headers['X-CSRF-TOKEN'], 'test-token');
    assert.equal(toasts.at(-1), 'Erfolgreich angemeldet!');
    assert.ok(requests.filter(request => request.url === '/api/events/ev/my-registration').length > before, 'reloaded');
});

test('the capacity panel names the bench next to the free places', async () => {
    const { element } = await openPage();
    assert.match(element('sidebar-capacity-content').innerHTML, /3 Plätze frei · 2 auf der Ersatzbank/);
});

test('the participants area lists the bench, on slot events with the wanted role, names escaped', async () => {
    const plain = await openPage({ participants: { participants: [], total: 0, bench: [{ displayName: '<b>Kira</b>', avatar: '' }] } });
    assert.equal(isHidden(plain.element('detail-bench')), false);
    assert.match(plain.element('detail-bench').innerHTML, /&lt;b&gt;Kira&lt;\/b&gt;/);
    assert.match(plain.element('detail-bench').innerHTML, /ERSATZBANK \(1\)/);

    const slots = [{ id: 'heal', name: 'Heiler', emoji: '💚', capacity: 2, taken: 0, members: [] }];
    const raid = await openPage({ participants: { participants: [], total: 0, slots, waitlist: [], bench: [{ displayName: 'Lena', avatar: '', preferredSlotId: 'heal' }] } });
    assert.match(raid.element('detail-bench').innerHTML, /Lena · 💚 Heiler/);

    const empty = await openPage();
    assert.equal(isHidden(empty.element('detail-bench')), true);
});

// ── Labels elsewhere ────────────────────────────────────────────────────

const ADMIN = { id: 'u-admin', username: 'admin', roles: [], isAdmin: true };

test('cards and profile name the bench „Vielleicht“', async () => {
    const { app } = await loadFrontendApp({});
    assert.match(app.renderStatusChip('tentative'), /bi-question-circle[^>]*><\/i>Vielleicht/);
    const event = { id: 'ev-1', title: 'Raid', startDate: at(48 * HOUR), endDate: at(50 * HOUR), status: 'active', location: '', checkinEnabled: false };
    const entry = { id: 'r1', status: 'tentative', checkedIn: false, createdAt: at(-HOUR), slot: { name: 'Heiler', emoji: '💚', wish: true }, waitlistPosition: null, offerExpiresAt: '', event };
    assert.match(app.renderUpcomingRow(entry, new Date(), true), /Vielleicht/);
});

test('the admin dialog labels the bench, decides it and names the time of a former „Vielleicht“', async () => {
    const harness = await loadFrontendApp({
        '/api/admin/events/ev1/registrations': {
            data: [
                { id: 't', userId: '1', userName: 'Elif', status: 'tentative', source: 'web', createdAt: '2026-10-01T18:00:00.000Z', tentativeAt: '2026-10-01T18:00:00.000Z' },
                { id: 'a', userId: '2', userName: 'Ben', status: 'accepted', source: 'web', createdAt: '2026-10-05T18:00:00.000Z', tentativeAt: '2026-10-01T18:00:00.000Z' }
            ],
            slots: [],
            eventStatus: 'active'
        }
    });
    harness.state.currentUser = ADMIN;
    await harness.app.showRegistrations('ev1', 'Raid');
    const rows = harness.element('registrations-tbody').innerHTML.split('<tr>').slice(1);
    assert.match(rows[0], /status-tentative[^>]*>\s*Vielleicht/);
    // Accept, waitlist and reject for the bench
    for (const status of ['accepted', 'waitlisted', 'rejected']) {
        assert.match(rows[0], new RegExp(`data-click="updateRegStatus" data-reg-id="t" data-status="${status}"`), status);
    }
    assert.match(rows[1], /Vielleicht seit 01\.10\.2026/);
    assert.doesNotMatch(rows[0], /Vielleicht seit/);
    // The bench can be ticked for bulk actions
    assert.match(rows[0], /data-change="toggleRegSelection"[^>]*data-reg-id="t"|data-reg-id="t"[^>]*data-change="toggleRegSelection"/);
});
