const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir } = require('./helpers');

// Mock mode with an own database; the empty cwd keeps a local .env out
const tmpDir = createTempDir('discord-checkin');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'checkin.sqlite');

const bot = require('../bot');
const { db, doc, getDoc, setDoc } = require('../firebaseAdmin');
const {
    isCheckinActive, isCheckinRunning, checkInMember, listCheckinInvitees, markInvited
} = require('../utils/checkin');

after(async () => {
    await bot.client.destroy();
});

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const NOW = new Date();
const at = (offsetMs) => new Date(NOW.getTime() + offsetMs).toISOString();

/** A running event with check-in on, unless fields say otherwise. */
function eventData(fields = {}) {
    return {
        title: 'Check-in-Abend', status: 'active', startDate: at(-30 * MINUTE), endDate: at(2 * HOUR),
        checkinEnabled: true, checkinCode: '123456', checkinMessage: 'Schön, dass du da bist!', ...fields
    };
}

async function seedEvent(id, fields = {}) {
    await setDoc(doc(db, 'events', id), eventData(fields));
}

async function seedRegistration(id, eventId, userId, fields = {}) {
    await setDoc(doc(db, 'registrations', id), {
        eventId, userId, userName: userId, status: 'accepted', createdAt: at(-24 * HOUR), ...fields
    });
}

const registrationOf = async (id) => (await getDoc(doc(db, 'registrations', id))).data();

// ── Shared rules ────────────────────────────────────────────────────────

test('check-in is active only for active events with a code', () => {
    assert.equal(isCheckinActive(eventData()), true);
    assert.equal(isCheckinActive(eventData({ checkinCode: '' })), false);
    assert.equal(isCheckinActive(eventData({ checkinEnabled: false })), false);
    assert.equal(isCheckinActive(eventData({ status: 'cancelled' })), false);
    assert.equal(isCheckinActive(eventData({ status: 'archived' })), false);
});

test('check-in runs from the start until the event is over', () => {
    assert.equal(isCheckinRunning(eventData(), NOW), true);
    assert.equal(isCheckinRunning(eventData({ startDate: at(10 * MINUTE), endDate: at(3 * HOUR) }), NOW), false, 'before start');
    assert.equal(isCheckinRunning(eventData({ startDate: at(-3 * HOUR), endDate: at(-MINUTE) }), NOW), false, 'over by end');
    assert.equal(isCheckinRunning(eventData({ startDate: at(-3 * HOUR), endDate: '' }), NOW), false, 'over by start + 2 h');
    assert.equal(isCheckinRunning(eventData({ startDate: at(-HOUR), endDate: '' }), NOW), true, 'within start + 2 h');
    assert.equal(isCheckinRunning(eventData({ checkinCode: '' }), NOW), false, 'no code');
    assert.equal(isCheckinRunning(eventData({ status: 'cancelled' }), NOW), false, 'cancelled');
});

test('checkInMember checks an accepted member in and keeps the first time', async () => {
    await seedEvent('rules-ok');
    await seedRegistration('rules-ok-reg', 'rules-ok', 'rules-user');

    const first = await checkInMember({ eventId: 'rules-ok', userId: 'rules-user', now: NOW, requireRunning: true });
    assert.equal(first.ok, true);
    assert.equal(first.alreadyCheckedIn, false);
    assert.equal(first.event.title, 'Check-in-Abend');
    const stored = await registrationOf('rules-ok-reg');
    assert.equal(stored.checkedIn, true);
    assert.equal(stored.checkedInAt, NOW.toISOString());

    const later = new Date(NOW.getTime() + 5 * MINUTE);
    const second = await checkInMember({ eventId: 'rules-ok', userId: 'rules-user', now: later, requireRunning: true });
    assert.equal(second.ok, true);
    assert.equal(second.alreadyCheckedIn, true);
    assert.equal((await registrationOf('rules-ok-reg')).checkedInAt, NOW.toISOString());
});

test('checkInMember refuses with a code and changes nothing', async () => {
    await seedEvent('rules-cancelled', { status: 'cancelled' });
    await seedEvent('rules-off', { checkinEnabled: false, checkinCode: '' });
    await seedEvent('rules-future', { startDate: at(HOUR), endDate: at(3 * HOUR) });
    await seedEvent('rules-over', { startDate: at(-4 * HOUR), endDate: at(-HOUR) });
    await seedEvent('rules-noreg');
    for (const eventId of ['rules-cancelled', 'rules-off', 'rules-future', 'rules-over']) {
        await seedRegistration(`${eventId}-reg`, eventId, 'rules-user');
    }
    await seedRegistration('rules-noreg-reg', 'rules-noreg', 'rules-user', { status: 'pending' });

    const cases = [
        ['rules-missing', 'not_found'],
        ['rules-cancelled', 'not_active'],
        ['rules-off', 'disabled'],
        ['rules-future', 'not_started'],
        ['rules-over', 'over'],
        ['rules-noreg', 'no_registration']
    ];
    for (const [eventId, code] of cases) {
        const result = await checkInMember({ eventId, userId: 'rules-user', now: NOW, requireRunning: true });
        assert.deepEqual([result.ok, result.code], [false, code], eventId);
    }
    for (const eventId of ['rules-cancelled', 'rules-off', 'rules-future', 'rules-over', 'rules-noreg']) {
        assert.notEqual((await registrationOf(`${eventId}-reg`)).checkedIn, true, eventId);
    }
});

test('without requireRunning the time window is not checked (code route)', async () => {
    await seedEvent('rules-code-over', { startDate: at(-4 * HOUR), endDate: at(-HOUR) });
    await seedRegistration('rules-code-over-reg', 'rules-code-over', 'rules-user');

    const result = await checkInMember({ eventId: 'rules-code-over', userId: 'rules-user', now: NOW });

    assert.equal(result.ok, true);
    assert.equal((await registrationOf('rules-code-over-reg')).checkedIn, true);
});

test('invitees are accepted, not checked in and not invited yet', async () => {
    await seedEvent('rules-invitees');
    await seedRegistration('inv-open', 'rules-invitees', 'user-open');
    await seedRegistration('inv-checked', 'rules-invitees', 'user-checked', { checkedIn: true, checkedInAt: at(-MINUTE) });
    await seedRegistration('inv-invited', 'rules-invitees', 'user-invited', { checkinInvitedAt: at(-MINUTE) });
    await seedRegistration('inv-pending', 'rules-invitees', 'user-pending', { status: 'pending' });
    await seedRegistration('inv-waiting', 'rules-invitees', 'user-waiting', { status: 'waitlisted' });
    await seedRegistration('inv-other', 'rules-other-event', 'user-other');

    const invitees = await listCheckinInvitees('rules-invitees');

    assert.deepEqual(invitees.map(entry => entry.userId), ['user-open']);
    assert.equal(invitees[0].id, 'inv-open');
});

// ── Invitation message ──────────────────────────────────────────────────

const { buildCheckinInvitation } = require('../bot/checkin');
const { buildEventUrl } = require('../utils/eventUrl');

/** Buttons of a classic message payload as plain JSON. */
const buttonsOf = (payload) => payload.components.flatMap(row => row.toJSON().components);

test('the invitation carries „Einchecken“ and the event link, never the code', () => {
    const event = eventData({ title: 'Raid-Nacht' });

    const plain = buildCheckinInvitation(event, 'inv-msg');
    const withStart = buildCheckinInvitation(event, 'inv-msg', { startText: true });

    for (const payload of [plain, withStart]) {
        const [checkin, link] = buttonsOf(payload);
        assert.deepEqual([checkin.custom_id, checkin.label], ['event_checkin:inv-msg', 'Einchecken']);
        assert.equal(link.url, buildEventUrl('inv-msg'));
        assert.doesNotMatch(payload.content, /123456/);
        assert.match(payload.content, /Raid-Nacht/);
    }
    assert.match(plain.content, /läuft – checke jetzt ein/);
    assert.doesNotMatch(plain.content, /hat gerade begonnen/);
    assert.match(withStart.content, /hat gerade begonnen/);
});

// ── „Einchecken“ button ─────────────────────────────────────────────────

const { createFakeInteraction, dispatchInteraction } = require('./helpers');

const INVITATION_TEXT = '📍 **Check-in-Abend** läuft – checke jetzt ein!';

/** Click „Einchecken“ in a DM (no member) and return the first answer. */
async function clickCheckin(eventId, userId) {
    const interaction = createFakeInteraction({ kind: 'button', customId: `event_checkin:${eventId}`, userId });
    interaction.message = { content: INVITATION_TEXT };
    await dispatchInteraction(bot.client, interaction);
    const [kind, payload] = interaction.calls.find(([name]) => ['update', 'reply', 'editReply'].includes(name));
    return { kind, payload, buttons: (payload.components || []).flatMap(row => row.toJSON().components) };
}

test('a click checks the member in and replaces the button', async () => {
    await seedEvent('btn-ok');
    await seedRegistration('btn-ok-reg', 'btn-ok', 'btn-user');

    const { kind, payload, buttons } = await clickCheckin('btn-ok', 'btn-user');

    assert.equal(kind, 'update');
    assert.ok(payload.content.startsWith(INVITATION_TEXT), 'keeps the invitation text');
    assert.match(payload.content, /✅ Du bist eingecheckt!/);
    assert.match(payload.content, /Schön, dass du da bist!/);
    assert.deepEqual(buttons.map(button => button.label), ['Zum Event'], 'only the link is left');
    const stored = await registrationOf('btn-ok-reg');
    assert.equal(stored.checkedIn, true);
    assert.ok(stored.checkedInAt);
});

test('a second click says so and keeps the check-in time', async () => {
    await seedEvent('btn-again');
    await seedRegistration('btn-again-reg', 'btn-again', 'btn-user', { checkedIn: true, checkedInAt: at(-10 * MINUTE) });

    const { kind, payload, buttons } = await clickCheckin('btn-again', 'btn-user');

    assert.equal(kind, 'update');
    assert.match(payload.content, /ℹ️ Du bist bereits eingecheckt\./);
    assert.deepEqual(buttons.map(button => button.label), ['Zum Event']);
    assert.equal((await registrationOf('btn-again-reg')).checkedInAt, at(-10 * MINUTE));
});

test('a click after the end closes the invitation without a check-in', async () => {
    await seedEvent('btn-over', { startDate: at(-4 * HOUR), endDate: at(-HOUR) });
    await seedRegistration('btn-over-reg', 'btn-over', 'btn-user');

    const { kind, payload, buttons } = await clickCheckin('btn-over', 'btn-user');

    assert.equal(kind, 'update');
    assert.match(payload.content, /⌛ Der Check-in für dieses Event ist vorbei\./);
    assert.deepEqual(buttons.map(button => button.label), ['Zum Event']);
    assert.notEqual((await registrationOf('btn-over-reg')).checkedIn, true);
});

test('refused clicks answer privately and change nothing', async () => {
    await seedEvent('btn-left');
    await seedEvent('btn-cancelled', { status: 'cancelled' });
    await seedEvent('btn-disabled', { checkinEnabled: false, checkinCode: '' });
    await seedRegistration('btn-cancelled-reg', 'btn-cancelled', 'btn-user');
    await seedRegistration('btn-disabled-reg', 'btn-disabled', 'btn-user');

    const cases = [
        ['btn-left', '❌ Du hast keine angenommene Anmeldung für dieses Event.'],
        ['btn-cancelled', '❌ Dieses Event ist nicht mehr aktiv.'],
        ['btn-gone', '❌ Dieses Event ist nicht mehr aktiv.'],
        ['btn-disabled', '❌ Check-in ist für dieses Event nicht aktiviert.']
    ];
    for (const [eventId, message] of cases) {
        const { kind, payload } = await clickCheckin(eventId, 'btn-user');
        assert.equal(kind, 'reply', eventId);
        assert.equal(payload.content, message, eventId);
        assert.ok(payload.flags, `${eventId} is private`);
    }
    assert.notEqual((await registrationOf('btn-cancelled-reg')).checkedIn, true);
    assert.notEqual((await registrationOf('btn-disabled-reg')).checkedIn, true);
});

// ── Invitations right away (code generated during the event) ────────────

const { inviteToCheckin } = require('../bot/checkin');

/** Run fn and return the console lines it printed. */
async function captureLog(fn) {
    const lines = [];
    const original = console.log;
    console.log = (...args) => { lines.push(args.join(' ')); };
    try {
        await fn();
    } finally {
        console.log = original;
    }
    return lines;
}

test('the mock twin invites the open members of a running event once', async () => {
    await seedEvent('now-running', { title: 'Sofort-Abend' });
    await seedRegistration('now-a', 'now-running', 'now-user-a');
    await seedRegistration('now-b', 'now-running', 'now-user-b', { checkedIn: true });

    let count;
    const lines = await captureLog(async () => { count = await bot.sendCheckinInvitations('now-running'); });

    assert.equal(count, 1);
    assert.ok((await registrationOf('now-a')).checkinInvitedAt);
    assert.equal((await registrationOf('now-b')).checkinInvitedAt, undefined);
    assert.ok(lines.some(line => line.includes('Check-in-Einladung') && line.includes('Sofort-Abend')), 'mock log');
    assert.equal(await bot.sendCheckinInvitations('now-running'), 0, 'only once');
});

test('the mock twin sends nothing before the start or without check-in', async () => {
    await seedEvent('now-future', { startDate: at(HOUR), endDate: at(3 * HOUR) });
    await seedEvent('now-off', { checkinEnabled: false, checkinCode: '' });
    await seedRegistration('now-future-reg', 'now-future', 'now-user');
    await seedRegistration('now-off-reg', 'now-off', 'now-user');

    assert.equal(await bot.sendCheckinInvitations('now-future'), 0);
    assert.equal(await bot.sendCheckinInvitations('now-off'), 0);
    assert.equal(await bot.sendCheckinInvitations('now-missing'), 0);
    assert.equal((await registrationOf('now-future-reg')).checkinInvitedAt, undefined);
});

test('two invitation runs at the same time send one DM per member', async () => {
    await seedEvent('now-race');
    await seedRegistration('race-a', 'now-race', 'race-user-a');
    await seedRegistration('race-b', 'now-race', 'race-user-b');
    const event = (await getDoc(doc(db, 'events', 'now-race'))).data();
    const sent = [];
    const send = async (userId) => { await new Promise(resolve => setTimeout(resolve, 5)); sent.push(userId); };

    await Promise.all([inviteToCheckin('now-race', event, { send }), inviteToCheckin('now-race', event, { send })]);

    assert.deepEqual(sent.sort(), ['race-user-a', 'race-user-b']);
});

// ── Guests (#110) ───────────────────────────────────────────────────────

const { withEventLock } = require('../utils/eventLock');
const { updateDoc } = require('../firebaseAdmin');

test('a listed guest of an accepted registration checks in on that registration', async () => {
    await seedEvent('guest-ok');
    await seedRegistration('guest-ok-reg', 'guest-ok', 'guest-host', { guests: ['guest-1', 'guest-2'] });

    const first = await checkInMember({ eventId: 'guest-ok', userId: 'guest-1', now: NOW });
    assert.deepEqual([first.ok, first.asGuest, first.alreadyCheckedIn], [true, true, false]);
    const stored = await registrationOf('guest-ok-reg');
    assert.deepEqual(stored.guestCheckins['guest-1'], { checkedIn: true, checkedInAt: NOW.toISOString(), checkinInvitedAt: null });
    assert.notEqual(stored.checkedIn, true, 'the host stays as they were');
    assert.equal(stored.guestCheckins['guest-2'], undefined);

    const second = await checkInMember({ eventId: 'guest-ok', userId: 'guest-1', now: new Date(NOW.getTime() + MINUTE) });
    assert.deepEqual([second.ok, second.alreadyCheckedIn, second.checkedInAt], [true, true, NOW.toISOString()]);
    assert.equal((await registrationOf('guest-ok-reg')).guestCheckins['guest-1'].checkedInAt, NOW.toISOString());
});

test('a guest of a pending or waitlisted registration gets no_registration', async () => {
    for (const status of ['pending', 'waitlisted']) {
        await seedEvent(`guest-${status}`);
        await seedRegistration(`guest-${status}-reg`, `guest-${status}`, 'guest-host', { status, guests: ['guest-1'] });
        const result = await checkInMember({ eventId: `guest-${status}`, userId: 'guest-1', now: NOW });
        assert.deepEqual([result.ok, result.code], [false, 'no_registration'], status);
        assert.equal((await registrationOf(`guest-${status}-reg`)).guestCheckins, undefined, status);
    }
});

test('an own accepted registration wins over a guest place', async () => {
    await seedEvent('guest-own');
    await seedRegistration('guest-own-host', 'guest-own', 'guest-host', { guests: ['guest-1'] });
    await seedRegistration('guest-own-reg', 'guest-own', 'guest-1');

    const result = await checkInMember({ eventId: 'guest-own', userId: 'guest-1', now: NOW });

    assert.deepEqual([result.ok, result.asGuest], [true, false]);
    assert.equal((await registrationOf('guest-own-reg')).checkedIn, true);
    assert.equal((await registrationOf('guest-own-host')).guestCheckins, undefined);
});

test('invitees list guests after their host and only once', async () => {
    await seedEvent('guest-invitees');
    await seedRegistration('guest-inv-reg', 'guest-invitees', 'guest-host', {
        guests: ['guest-1', 'guest-2'],
        guestCheckins: { 'guest-1': { checkedIn: true, checkedInAt: at(-MINUTE), checkinInvitedAt: null } }
    });

    assert.deepEqual(await listCheckinInvitees('guest-invitees'), [
        { id: 'guest-inv-reg', userId: 'guest-host', guestId: null },
        { id: 'guest-inv-reg', userId: 'guest-2', guestId: 'guest-2' }
    ]);

    await markInvited('guest-inv-reg', NOW, 'guest-2');
    assert.equal((await registrationOf('guest-inv-reg')).guestCheckins['guest-2'].checkinInvitedAt, NOW.toISOString());
    assert.deepEqual((await listCheckinInvitees('guest-invitees')).map(entry => entry.userId), ['guest-host']);
});

test('the Discord button checks a guest in', async () => {
    await seedEvent('guest-btn');
    await seedRegistration('guest-btn-reg', 'guest-btn', 'guest-host', { guests: ['guest-1'] });

    const { kind, payload } = await clickCheckin('guest-btn', 'guest-1');

    assert.equal(kind, 'update');
    assert.match(payload.content, /✅ Du bist eingecheckt!/);
    assert.equal((await registrationOf('guest-btn-reg')).guestCheckins['guest-1'].checkedIn, true);
});

test('the mock twin invites guests too', async () => {
    await seedEvent('guest-now', { title: 'Gast-Abend' });
    await seedRegistration('guest-now-reg', 'guest-now', 'guest-host', { guests: ['guest-1'] });

    let count;
    const lines = await captureLog(async () => { count = await bot.sendCheckinInvitations('guest-now'); });

    assert.equal(count, 2);
    assert.equal(lines.filter(line => line.includes('Check-in-Einladung') && line.includes('guest-1')).length, 1);
    assert.ok((await registrationOf('guest-now-reg')).guestCheckins['guest-1'].checkinInvitedAt);
    assert.equal(await bot.sendCheckinInvitations('guest-now'), 0, 'only once');
});

test('a guest check-in and a guest answer at the same time both stay', async () => {
    await seedEvent('guest-race');
    await seedRegistration('guest-race-reg', 'guest-race', 'guest-host', { guests: ['guest-1'] });

    // The guest buttons (bot/guests.js) write the same document under the event lock
    const acceptInvitation = withEventLock('guest-race', async () => {
        const current = await registrationOf('guest-race-reg');
        await new Promise(resolve => setTimeout(resolve, 10));
        await updateDoc(doc(db, 'registrations', 'guest-race-reg'), { guests: [...current.guests, 'guest-3'] });
    });
    await Promise.all([acceptInvitation, checkInMember({ eventId: 'guest-race', userId: 'guest-1', now: NOW })]);

    const stored = await registrationOf('guest-race-reg');
    assert.deepEqual(stored.guests, ['guest-1', 'guest-3']);
    assert.equal(stored.guestCheckins['guest-1'].checkedIn, true);
});

test('a person with an own registration and a guest place gets one invitation', async () => {
    await seedEvent('guest-double');
    await seedRegistration('guest-double-host', 'guest-double', 'guest-host', { guests: ['guest-1'], createdAt: at(-30 * HOUR) });
    await seedRegistration('guest-double-own', 'guest-double', 'guest-1');
    await seedRegistration('guest-double-other', 'guest-double', 'guest-host-2', { guests: ['guest-2'] });
    await seedRegistration('guest-double-third', 'guest-double', 'guest-host-3', { guests: ['guest-2'] });

    const invitees = (await listCheckinInvitees('guest-double')).map(entry => entry.userId).sort();
    assert.deepEqual(invitees, ['guest-1', 'guest-2', 'guest-host', 'guest-host-2', 'guest-host-3']);
});

test('two guests of one registration checking in at the same time both stay', async () => {
    await seedEvent('guest-pair');
    await seedRegistration('guest-pair-reg', 'guest-pair', 'guest-host', { guests: ['guest-1', 'guest-2'] });

    await Promise.all([
        checkInMember({ eventId: 'guest-pair', userId: 'guest-1', now: NOW }),
        checkInMember({ eventId: 'guest-pair', userId: 'guest-2', now: NOW })
    ]);

    const stored = await registrationOf('guest-pair-reg');
    assert.equal(stored.guestCheckins['guest-1'].checkedIn, true);
    assert.equal(stored.guestCheckins['guest-2'].checkedIn, true);
});

test('setGuestCheckin refuses a registration that is not accepted any more', async () => {
    const { setGuestCheckin } = require('../utils/checkin');
    await seedEvent('guest-admin');
    await seedRegistration('guest-admin-reg', 'guest-admin', 'guest-host', { status: 'waitlisted', guests: ['guest-1'] });

    assert.equal(await setGuestCheckin({ registrationId: 'guest-admin-reg', guestId: 'guest-1', checkedIn: true, now: NOW }), null);
    assert.equal((await registrationOf('guest-admin-reg')).guestCheckins, undefined);

    await updateDoc(doc(db, 'registrations', 'guest-admin-reg'), { status: 'accepted' });
    const done = await setGuestCheckin({ registrationId: 'guest-admin-reg', guestId: 'guest-1', checkedIn: true, now: NOW });
    assert.deepEqual([done.checkedIn, done.checkedInAt], [true, NOW.toISOString()]);
    assert.equal(await setGuestCheckin({ registrationId: 'guest-admin-reg', guestId: 'nobody', checkedIn: true, now: NOW }), null);
});
