const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildProfileEvents, toProfileEntry } = require('../utils/profileEvents');

const NOW = new Date('2026-10-13T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const at = (hours) => new Date(NOW.getTime() + hours * HOUR).toISOString();

const event = (title, fields = {}) => ({ title, status: 'active', startDate: at(48), endDate: at(50), ...fields });
const registration = (eventId, fields = {}) => ({ id: `reg-${eventId}`, eventId, userId: 'u1', status: 'accepted', createdAt: at(-72), ...fields });
const titles = (entries) => entries.map(entry => (entry.event ? entry.event.title : null));

/**
 * Both lists for events keyed by id. Every event gets one accepted
 * registration unless `registrations` lists its own.
 *
 * @param {Object<string, Object>} events -> Event data by id.
 * @param {Array<Object>} [registrations] -> Registrations in the order the database returns them.
 * @returns {{ upcoming: Array<Object>, history: Array<Object> }}
 */
function build(events, registrations = Object.keys(events).map(id => registration(id))) {
    return buildProfileEvents(registrations, new Map(Object.entries(events)), NOW);
}

test('an event that runs, lies ahead or has no date is upcoming, an ended one is history', () => {
    const { upcoming, history } = build({
        ahead: event('Ahead'),
        running: event('Running', { startDate: at(-1), endDate: at(1) }),
        openEnd: event('Open end', { startDate: at(-1), endDate: '' }),
        undated: event('Undated', { startDate: '', endDate: '' }),
        ended: event('Ended', { startDate: at(-5), endDate: at(-3) }),
        // Without an end an event lasts two hours
        longAgo: event('Long ago', { startDate: at(-3), endDate: '' })
    });
    assert.deepEqual(titles(upcoming), ['Running', 'Open end', 'Ahead', 'Undated']);
    assert.deepEqual(titles(history), ['Long ago', 'Ended']);
});

test('cancelled, archived and deleted events are history whatever their date says', () => {
    const { upcoming, history } = build(
        {
            cancelled: event('Cancelled', { status: 'cancelled' }),
            archived: event('Archived', { status: 'archived' }),
            draft: event('Draft', { status: 'draft' })
        },
        [registration('cancelled'), registration('archived'), registration('draft'), registration('gone')]
    );
    assert.deepEqual(titles(upcoming), ['Draft']);
    assert.deepEqual(titles(history), ['Cancelled', 'Archived', null]);
    assert.equal(history[2].id, 'reg-gone');
});

test('upcoming events come by start, undated ones last, equal starts by registration date', () => {
    const { upcoming } = build(
        {
            late: event('Late', { startDate: at(100), endDate: at(102) }),
            early: event('Early', { startDate: at(10), endDate: at(12) }),
            undated: event('Undated', { startDate: '', endDate: '' }),
            twinB: event('Twin B', { startDate: at(50), endDate: at(52) }),
            twinA: event('Twin A', { startDate: at(50), endDate: at(52) }),
            undated2: event('Undated 2', { startDate: '', endDate: '' })
        },
        [
            registration('late'),
            registration('undated', { createdAt: at(-10) }),
            registration('twinB', { createdAt: at(-5) }),
            registration('early'),
            registration('twinA', { createdAt: at(-20) }),
            registration('undated2', { createdAt: at(-30) })
        ]
    );
    assert.deepEqual(titles(upcoming), ['Early', 'Twin A', 'Twin B', 'Late', 'Undated 2', 'Undated']);
});

test('the history starts with the latest event, a deleted event counts by its registration date', () => {
    const { history } = build(
        {
            old: event('Old', { startDate: at(-500), endDate: at(-498) }),
            recent: event('Recent', { startDate: at(-30), endDate: at(-28) })
        },
        [registration('old'), registration('gone', { createdAt: at(-100) }), registration('recent')]
    );
    assert.deepEqual(history.map(entry => entry.id), ['reg-recent', 'reg-gone', 'reg-old']);
});

test('every registration status is listed, rejected ones too', () => {
    const statuses = ['accepted', 'pending', 'waitlisted', 'rejected'];
    const events = Object.fromEntries(statuses.map((status, index) => [status, event(status, { startDate: at(10 + index), endDate: at(20) })]));
    const { upcoming, history } = build(events, statuses.map(status => registration(status, { status })));
    assert.deepEqual(upcoming.map(entry => entry.status), statuses);
    assert.deepEqual(history, []);
});

test('the slot is the one taken, the wish of an open registration, else null', () => {
    const raid = event('Raid', { slots: [{ id: 'tank', name: 'Tank', emoji: '🛡️', capacity: 1 }, { id: 'dps', name: 'Schaden', capacity: 3 }] });
    const slotOf = (fields) => toProfileEntry(registration('raid', fields), raid).slot;

    assert.deepEqual(slotOf({ slotId: 'tank', preferredSlotId: 'dps' }), { name: 'Tank', emoji: '🛡️', wish: false });
    assert.deepEqual(slotOf({ slotId: 'dps' }), { name: 'Schaden', emoji: '', wish: false });
    assert.deepEqual(slotOf({ status: 'waitlisted', slotId: null, preferredSlotId: 'tank' }), { name: 'Tank', emoji: '🛡️', wish: true });
    assert.deepEqual(slotOf({ status: 'pending', preferredSlotId: 'dps' }), { name: 'Schaden', emoji: '', wish: true });
    // „Vielleicht“ names the wanted role, too (B-17)
    assert.deepEqual(slotOf({ status: 'tentative', slotId: null, preferredSlotId: 'tank' }), { name: 'Tank', emoji: '🛡️', wish: true });
    // Rejected: the wish no longer matters. A slot that was removed from the event is gone.
    assert.equal(slotOf({ status: 'rejected', slotId: null, preferredSlotId: 'tank' }), null);
    assert.equal(slotOf({ slotId: 'healer' }), null);
    assert.equal(slotOf({}), null);
    // An event without slots, or with broken slot data, has none
    assert.equal(toProfileEntry(registration('plain', { slotId: 'tank' }), event('Plain')).slot, null);
    assert.equal(toProfileEntry(registration('odd', { slotId: 'tank' }), event('Odd', { slots: 'tank' })).slot, null);
});

test('an entry carries eight event fields and never the check-in code', () => {
    const full = event('Full', {
        description: 'Geheim', formFields: [{ label: 'Name' }], customBotMessages: { accepted: 'Hi' }, category: 'Gaming',
        location: { text: 'Lobby', channelId: '1', channelType: 'voice' }, checkinEnabled: true, checkinCode: '123456'
    });
    const entry = toProfileEntry(registration('full', { checkedIn: true, formAnswers: { Name: 'Tom' }, guests: ['u2'], userName: 'Tom' }), full);
    assert.deepEqual(entry, {
        id: 'reg-full', status: 'accepted', checkedIn: true, createdAt: at(-72), slot: null, waitlistPosition: null, offerExpiresAt: '',
        event: { id: 'full', title: 'Full', startDate: at(48), endDate: at(50), status: 'active', category: 'Gaming', location: 'Lobby', checkinEnabled: true }
    });
    assert.doesNotMatch(JSON.stringify(entry), /123456|Geheim|formFields|formAnswers|userName/);
});

test('the check-in is open only with the switch and a code', () => {
    const open = (fields) => toProfileEntry(registration('e'), event('E', fields)).event.checkinEnabled;
    assert.equal(open({ checkinEnabled: true, checkinCode: '123456' }), true);
    assert.equal(open({ checkinEnabled: true }), false);
    assert.equal(open({ checkinEnabled: false, checkinCode: '123456' }), false);
    assert.equal(open({}), false);
});

test('missing and broken values do not break the lists', () => {
    const { upcoming, history } = build(
        {
            broken: event('Broken', { startDate: 'kein Datum', endDate: '' }),
            legacy: event('Legacy', { startDate: '2026-10-20 18:00', endDate: '' }),
            bare: {}
        },
        [registration('broken'), registration('legacy'), { id: 'reg-bare', eventId: 'bare' }, { id: 'reg-none' }]
    );
    // A date nobody can read counts as "no date yet"; the older format with a space is read
    assert.deepEqual(upcoming.map(entry => entry.id), ['reg-legacy', 'reg-bare', 'reg-broken']);
    assert.deepEqual(upcoming[1], {
        id: 'reg-bare', status: '', checkedIn: false, createdAt: '', slot: null, waitlistPosition: null, offerExpiresAt: '',
        event: { id: 'bare', title: '', startDate: '', endDate: '', status: '', category: '', location: '', checkinEnabled: false }
    });
    assert.deepEqual(history, [{ id: 'reg-none', status: '', checkedIn: false, createdAt: '', slot: null, waitlistPosition: null, offerExpiresAt: '', event: null }]);
    // Only a location object with a text gives a place
    assert.equal(toProfileEntry(registration('e'), event('E', { location: 'Lobby' })).event.location, '');
    assert.equal(toProfileEntry(registration('e'), event('E', { location: { channelId: '1' } })).event.location, '');
    assert.deepEqual(buildProfileEvents([], new Map(), NOW), { upcoming: [], history: [] });
});

test('only upcoming entries carry their waitlist place (W-05)', () => {
    const events = new Map(Object.entries({ full: event('Full'), old: event('Old', { status: 'archived' }) }));
    const waiting = [registration('full', { status: 'waitlisted' }), registration('old', { status: 'waitlisted' })];
    const positions = new Map([['reg-full', { position: 2, total: 3 }], ['reg-old', { position: 1, total: 1 }]]);
    const { upcoming, history } = buildProfileEvents(waiting, events, NOW, positions);
    assert.deepEqual(upcoming[0].waitlistPosition, { position: 2, total: 3 });
    assert.equal(history[0].waitlistPosition, null);
});

test('a tentative registration is listed among the upcoming events with its status (B-17)', () => {
    const { upcoming, history } = build({ raid: event('Raid') }, [registration('raid', { status: 'tentative' })]);
    assert.deepEqual(titles(upcoming), ['Raid']);
    assert.equal(upcoming[0].status, 'tentative');
    assert.deepEqual(history, []);
});
