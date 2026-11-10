const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadFrontendApp } = require('./helpers');

// #110: a guest sees the real status of the registration that invited them,
// and an accepted guest checks in like a participant.

const settle = () => new Promise(resolve => setImmediate(resolve));
const HOUR = 60 * 60 * 1000;
const GUEST = { id: 'u-guest', username: 'guest', roles: [], isAdmin: false };
const at = (offset) => new Date(Date.now() + offset).toISOString();

async function openAsGuest(registration, fields = {}) {
    const loaded = await loadFrontendApp({
        '/api/events/ev': { id: 'ev', title: 'Workshop', accessMode: 'open', maxParticipants: 5, currentParticipants: 3, formFields: [], startDate: at(-HOUR), endDate: at(2 * HOUR), ...fields },
        '/api/events/ev/my-registration': { registered: true, asGuest: true, id: 'r-host', checkedIn: false, checkedInAt: null, ...registration },
        '/api/events/ev/participants': { participants: [], total: 0 },
        '/api/events/ev/comments': []
    });
    loaded.state.currentUser = GUEST;
    await loaded.app.showEventDetail('ev');
    await settle();
    return loaded;
}

test('the guest label follows the real status', async () => {
    const cases = [
        ['pending', 'Ausstehend (Gast)', 'text-warning'],
        ['accepted', 'Angenommen (Gast)', 'text-success'],
        ['waitlisted', 'Warteliste (Gast)', 'text-info'],
        ['offered', 'Platz angeboten (Gast)', 'text-secondary']
    ];
    for (const [status, label, colour] of cases) {
        const { element } = await openAsGuest({ status });
        const line = element('detail-reg-status');
        assert.equal(line.textContent, label, status);
        assert.match(line.className, new RegExp(colour), status);
    }
    // The place on the waitlist belongs to the inviting member
    const { element } = await openAsGuest({ status: 'waitlisted', waitlistPosition: { position: 2, total: 3 } });
    assert.equal(element('detail-reg-status').textContent, 'Warteliste (Gast)');
});

test('an accepted guest gets the code field while check-in is on', async () => {
    const { element } = await openAsGuest({ status: 'accepted' }, { checkinEnabled: true });
    assert.match(element('checkin-section').innerHTML, /checkin-code-input/);
});

test('a checked-in guest sees the done state, a pending guest no code field', async () => {
    const done = await openAsGuest({ status: 'accepted', checkedIn: true, checkedInAt: at(-10 * 60 * 1000) }, { checkinEnabled: true });
    assert.match(done.element('checkin-section').innerHTML, /Du bist eingecheckt!/);
    assert.doesNotMatch(done.element('checkin-section').innerHTML, /checkin-code-input/);

    const pending = await openAsGuest({ status: 'pending' }, { checkinEnabled: true });
    assert.doesNotMatch(pending.element('checkin-section').innerHTML, /checkin-code-input/);
});
