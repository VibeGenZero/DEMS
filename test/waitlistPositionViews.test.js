const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadFrontendApp } = require('./helpers');

// W-05: waitlisted members see their place on the event page and in the
// profile; admins see the order in the registrations dialog.

const settle = () => new Promise(resolve => setImmediate(resolve));
const HOUR = 60 * 60 * 1000;
const MEMBER = { id: 'u-member', username: 'member', roles: [], isAdmin: false };
const ADMIN = { id: 'u-admin', username: 'admin', roles: [], isAdmin: true };
const at = (offset) => new Date(Date.now() + offset).toISOString();

async function openPage(registration, fields = {}) {
    const loaded = await loadFrontendApp({
        '/api/events/ev': { id: 'ev', title: 'Koop-Abend', accessMode: 'open', maxParticipants: 5, currentParticipants: 5, formFields: [], startDate: at(48 * HOUR), ...fields },
        '/api/events/ev/my-registration': registration,
        '/api/events/ev/participants': { participants: [], total: 0 },
        '/api/events/ev/comments': []
    });
    loaded.state.currentUser = MEMBER;
    await loaded.app.showEventDetail('ev');
    await settle();
    return loaded;
}

const waiting = (position, total, fields = {}) => ({ registered: true, id: 'r1', status: 'waitlisted', waitlistPosition: { position, total }, ...fields });

test('the event page names the place on the waitlist', async () => {
    const { element } = await openPage(waiting(2, 3));
    assert.equal(element('detail-reg-status').textContent, 'Platz 2 von 3 auf der Warteliste');
});

test('without a place the event page keeps "Warteliste", other statuses stay as they are', async () => {
    assert.equal((await openPage({ registered: true, id: 'r1', status: 'waitlisted' })).element('detail-reg-status').textContent, 'Warteliste');
    assert.equal((await openPage({ registered: true, id: 'r1', status: 'accepted' })).element('detail-reg-status').textContent, 'Angenommen');
});

test('the slot area names the place and that a free wanted role can move up earlier', async () => {
    const { app, element } = await loadFrontendApp({});
    const event = { id: 'ev', slots: [{ id: 'tank', name: 'Tank', emoji: '', capacity: 1 }], slotSummary: [{ id: 'tank', name: 'Tank', emoji: '', capacity: 1, taken: 1 }] };
    app.renderOwnSlot(event, waiting(1, 2, { slotId: null, preferredSlotId: 'tank' }));
    const html = element('detail-reg-slot').innerHTML;
    assert.match(html, /Du stehst auf Platz 1 von 2 der Warteliste\./);
    assert.match(html, /Wer eine freie Wunschrolle hat, kann früher nachrücken\./);

    app.renderOwnSlot(event, { registered: true, status: 'waitlisted', slotId: null });
    assert.match(element('detail-reg-slot').innerHTML, /Du stehst auf der Warteliste\./);
});

test('the profile chip of an upcoming event names the place, the history does not', async () => {
    const { app } = await loadFrontendApp({});
    const event = { id: 'ev-1', title: 'Koop-Abend', startDate: at(48 * HOUR), endDate: at(50 * HOUR), status: 'active', location: '', checkinEnabled: false };
    const entry = { id: 'r1', status: 'waitlisted', checkedIn: false, createdAt: at(-HOUR), slot: null, waitlistPosition: { position: 3, total: 3 }, event };
    assert.match(app.renderUpcomingRow(entry, new Date(), true), /chip-info[^>]*><i class="bi bi-list-ol"><\/i>Warteliste · Platz 3 von 3</);
    assert.match(app.renderUpcomingRow({ ...entry, waitlistPosition: null }, new Date(), true), /<\/i>Warteliste<\/span>/);
    const past = { ...event, startDate: at(-48 * HOUR), endDate: at(-46 * HOUR) };
    assert.match(app.renderHistoryRow({ ...entry, event: past }, true), /<span class="chip chip-sm">Warteliste<\/span>/);
});

test('the admin dialog shows the place of each waitlisted registration', async () => {
    const harness = await loadFrontendApp({
        '/api/admin/events/ev1/registrations': {
            data: [
                { id: 'a', userId: '1', userName: 'Elif', status: 'waitlisted', waitlistPosition: { position: 1, total: 2 }, source: 'web', createdAt: at(-2 * HOUR) },
                { id: 'b', userId: '2', userName: 'Tom', status: 'waitlisted', waitlistPosition: { position: 2, total: 2 }, source: 'web', createdAt: at(-HOUR) },
                { id: 'c', userId: '3', userName: 'Lena', status: 'accepted', source: 'web', createdAt: at(-3 * HOUR) }
            ],
            slots: [],
            eventStatus: 'active'
        }
    });
    harness.state.currentUser = ADMIN;
    await harness.app.showRegistrations('ev1', 'Koop-Abend');
    const html = harness.element('registrations-tbody').innerHTML;
    const row = (name) => html.split('<tr').find(part => part.includes(`<strong>${name}</strong>`));
    assert.match(row('Elif'), /Warteliste · Platz 1/);
    assert.match(row('Tom'), /Warteliste · Platz 2/);
    assert.doesNotMatch(row('Lena'), /Platz/);
});
