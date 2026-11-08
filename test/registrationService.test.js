const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir } = require('./helpers');

// Mock mode with an own database; the empty cwd keeps a local .env out
const tmpDir = createTempDir('registration-service');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'registrations.sqlite');

const bot = require('../bot');
const { db, doc, setDoc } = require('../firebaseAdmin');
const {
    registerUserForEvent, switchOwnSlot, moveRegistrationToSlot, unregisterUserFromEvent, buildTemplateVars
} = require('../utils/registrationService');
const { loadEventRegistrations } = require('../utils/eventUtils');

after(async () => {
    await bot.client.destroy();
});

const SLOTS = [
    { id: 'tank', name: 'Tank', emoji: '🛡️', capacity: 1 },
    { id: 'heal', name: 'Heiler', emoji: '💚', capacity: 1 },
    { id: 'dps', name: 'Schaden', emoji: '⚔️', capacity: 2 }
];

let counter = 0;

async function createEvent(fields = {}) {
    const id = `svc-event-${++counter}`;
    await setDoc(doc(db, 'events', id), {
        title: `Test ${counter}`, status: 'active', accessMode: 'open', approvalMode: 'instant',
        maxParticipants: 0, formFields: [], allowGuests: true, ...fields
    });
    return id;
}

const user = (name) => ({ id: `svc-user-${name}`, displayName: name, roles: [] });
const register = (eventId, name, fields = {}) => registerUserForEvent({ eventId, user: user(name), ...fields });

async function registrationOf(eventId, name) {
    return (await loadEventRegistrations(eventId)).find(entry => entry.userId === user(name).id);
}

test('a full main role falls back to the first free alternative, then to the waitlist', async () => {
    const eventId = await createEvent({ slots: SLOTS, maxParticipants: 4 });

    const ana = await register(eventId, 'Ana', { slotId: 'tank' });
    assert.equal(ana.status, 'accepted');
    assert.equal(ana.slotId, 'tank');
    assert.equal(ana.isAlt, false);
    assert.equal(ana.message, 'Erfolgreich angemeldet! Dein Slot: 🛡️ Tank.');

    const ben = await register(eventId, 'Ben', { slotId: 'tank', altSlotIds: ['dps', 'heal'] });
    assert.equal(ben.slotId, 'heal');
    assert.equal(ben.isAlt, true);
    assert.equal(ben.message, 'Erfolgreich angemeldet! Dein Slot: 💚 Heiler (🛡️ Tank war voll).');
    const stored = await registrationOf(eventId, 'Ben');
    assert.equal(stored.preferredSlotId, 'tank');
    assert.deepEqual(stored.altSlotIds, ['heal', 'dps']);

    const cem = await register(eventId, 'Cem', { slotId: 'heal' });
    assert.equal(cem.status, 'waitlisted');
    assert.equal(cem.slotId, null);
});

test('slot events need a valid slot and allow no guests', async () => {
    const eventId = await createEvent({ slots: SLOTS, maxParticipants: 4 });

    for (const slotId of [undefined, 'nope']) {
        const result = await register(eventId, 'Dana', { slotId });
        assert.equal(result.ok, false);
        assert.equal(result.code, 'invalid_slot');
        assert.equal(result.httpStatus, 400);
        assert.equal(result.error, 'Bitte wähle einen gültigen Slot.');
    }

    const withGuest = await register(eventId, 'Dana', { slotId: 'dps', guests: [{ id: 'svc-guest' }] });
    assert.equal(withGuest.code, 'guests_not_allowed');
});

test('two simultaneous registrations for the last place get one place', async () => {
    const slotEventId = await createEvent({ slots: [SLOTS[0]], maxParticipants: 1 });
    const slotResults = await Promise.all([
        register(slotEventId, 'Eva', { slotId: 'tank' }),
        register(slotEventId, 'Finn', { slotId: 'tank' })
    ]);
    assert.deepEqual(slotResults.map(result => result.status).sort(), ['accepted', 'waitlisted']);

    const normalEventId = await createEvent({ maxParticipants: 1 });
    const normalResults = await Promise.all([register(normalEventId, 'Eva'), register(normalEventId, 'Finn')]);
    assert.deepEqual(normalResults.map(result => result.status).sort(), ['accepted', 'waitlisted']);
});

test('members switch into free slots only and free their old place', async () => {
    const eventId = await createEvent({ slots: SLOTS, maxParticipants: 4 });
    await register(eventId, 'Ana', { slotId: 'tank' });
    await register(eventId, 'Ben', { slotId: 'heal' });
    await register(eventId, 'Cem', { slotId: 'heal' });

    const full = await switchOwnSlot({ eventId, userId: user('Ben').id, slotId: 'tank' });
    assert.deepEqual([full.ok, full.code, full.httpStatus, full.error], [false, 'slot_full', 409, 'Dieser Slot ist bereits voll.']);

    const moved = await switchOwnSlot({ eventId, userId: user('Ben').id, slotId: 'dps' });
    assert.equal(moved.ok, true);
    assert.equal(moved.slotId, 'dps');
    assert.equal(moved.message, 'Du bist jetzt als ⚔️ Schaden eingeplant.');
    assert.equal((await registrationOf(eventId, 'Ben')).preferredSlotId, 'dps');

    const cem = await registrationOf(eventId, 'Cem');
    assert.equal(cem.status, 'accepted');
    assert.equal(cem.slotId, 'heal');
});

test('a waitlisted member can take a free slot directly', async () => {
    const eventId = await createEvent({ slots: SLOTS, maxParticipants: 4 });
    await register(eventId, 'Ana', { slotId: 'tank' });
    await register(eventId, 'Ben', { slotId: 'tank' });

    const result = await switchOwnSlot({ eventId, userId: user('Ben').id, slotId: 'heal' });
    assert.equal(result.status, 'accepted');
    assert.equal(result.slotId, 'heal');

    const notRegistered = await switchOwnSlot({ eventId, userId: user('Zoe').id, slotId: 'dps' });
    assert.equal(notRegistered.code, 'not_registered');
});

test('admins move registrations, even into full slots', async () => {
    const eventId = await createEvent({ slots: SLOTS, maxParticipants: 4 });
    await register(eventId, 'Ana', { slotId: 'tank' });
    await register(eventId, 'Ben', { slotId: 'heal' });
    await register(eventId, 'Cem', { slotId: 'heal' });
    const ben = await registrationOf(eventId, 'Ben');

    const result = await moveRegistrationToSlot({ registrationId: ben.id, slotId: 'tank' });
    assert.equal(result.ok, true);
    assert.equal(result.warning, 'Slot „Tank“ ist jetzt überbucht.');
    assert.equal(result.slotName, 'Tank');
    assert.equal((await registrationOf(eventId, 'Ben')).slotId, 'tank');
    assert.equal((await registrationOf(eventId, 'Cem')).slotId, 'heal');

    await register(eventId, 'Dana', { slotId: 'tank' });
    const dana = await registrationOf(eventId, 'Dana');
    const waiting = await moveRegistrationToSlot({ registrationId: dana.id, slotId: 'dps' });
    assert.equal(waiting.code, 'not_movable');
});

test('unregistering frees the place for the waitlist', async () => {
    const eventId = await createEvent({ slots: SLOTS, maxParticipants: 4 });
    await register(eventId, 'Ana', { slotId: 'tank' });
    await register(eventId, 'Ben', { slotId: 'tank' });

    const result = await unregisterUserFromEvent({ eventId, userId: user('Ana').id });
    assert.equal(result.ok, true);
    assert.ok(result.event.title.startsWith('Test'));
    assert.equal(await registrationOf(eventId, 'Ana'), undefined);
    assert.equal((await registrationOf(eventId, 'Ben')).status, 'accepted');

    const again = await unregisterUserFromEvent({ eventId, userId: user('Ana').id });
    assert.deepEqual([again.code, again.httpStatus], ['not_registered', 404]);
});

test('message templates can use the slot', async () => {
    const vars = await buildTemplateVars({ user: user('Ana'), eventId: 'x', event: { title: 'Raid' }, slot: SLOTS[0] });
    assert.equal(vars['slot.name'], 'Tank');
    assert.equal(vars['slot.emoji'], '🛡️');
    const plain = await buildTemplateVars({ user: user('Ana'), eventId: 'x', event: { title: 'Raid' } });
    assert.equal(plain['slot.name'], '');
});

test('registration and slot switch close when the event is over', async () => {
    const MINUTE = 60 * 1000;
    const ended = { startDate: new Date(Date.now() - 180 * MINUTE).toISOString(), endDate: new Date(Date.now() - MINUTE).toISOString() };
    const ENDED = { ok: false, code: 'event_ended', httpStatus: 400, error: 'Das Event ist schon vorbei.' };
    const pick = (result) => ({ ok: result.ok, code: result.code, httpStatus: result.httpStatus, error: result.error });

    const eventId = await createEvent(ended);
    assert.deepEqual(pick(await register(eventId, 'Spät')), ENDED);
    assert.deepEqual(pick(await register(eventId, 'Mitgast', { guests: [{ id: 'svc-guest-1', displayName: 'Gast' }] })), ENDED);

    const slotEventId = await createEvent({ ...ended, slots: SLOTS, maxParticipants: 4 });
    await setDoc(doc(db, 'registrations', `${slotEventId}-ana`), {
        eventId: slotEventId, userId: user('Ana').id, userName: 'Ana', status: 'accepted', slotId: 'tank', preferredSlotId: 'tank',
        altSlotIds: [], guests: [], pendingGuests: [], formAnswers: {}, source: 'web', createdAt: new Date().toISOString()
    });
    assert.deepEqual(pick(await switchOwnSlot({ eventId: slotEventId, userId: user('Ana').id, slotId: 'heal' })), ENDED);
});

test('a running event still takes registrations up to its end', async () => {
    const MINUTE = 60 * 1000;
    const eventId = await createEvent({ startDate: new Date(Date.now() - 60 * MINUTE).toISOString(), endDate: new Date(Date.now() + MINUTE).toISOString() });
    assert.equal((await register(eventId, 'Pünktlich')).ok, true);
});

test('nobody moves up into an event that is over', async () => {
    const MINUTE = 60 * 1000;
    const ended = { startDate: new Date(Date.now() - 180 * MINUTE).toISOString(), endDate: new Date(Date.now() - MINUTE).toISOString() };
    const entry = (eventId, name, status, slotId) => setDoc(doc(db, 'registrations', `${eventId}-${name}`), {
        eventId, userId: user(name).id, userName: name, status, slotId: status === 'accepted' ? slotId : null, preferredSlotId: slotId,
        altSlotIds: [], guests: [], pendingGuests: [], formAnswers: {}, source: 'web', createdAt: new Date().toISOString()
    });

    // Unregistering after the end frees a place, but the waitlist stays where it is
    const eventId = await createEvent({ ...ended, maxParticipants: 1 });
    await entry(eventId, 'Ana', 'accepted', null);
    await entry(eventId, 'Ben', 'waitlisted', null);
    assert.equal((await unregisterUserFromEvent({ eventId, userId: user('Ana').id })).ok, true);
    assert.equal((await registrationOf(eventId, 'Ben')).status, 'waitlisted');

    // An admin moving someone out of a full slot after the end promotes nobody either
    const slotEventId = await createEvent({ ...ended, slots: SLOTS, maxParticipants: 4 });
    await entry(slotEventId, 'Ana', 'accepted', 'tank');
    await entry(slotEventId, 'Ben', 'waitlisted', 'tank');
    const ana = await registrationOf(slotEventId, 'Ana');
    assert.equal((await moveRegistrationToSlot({ registrationId: ana.id, slotId: 'heal' })).ok, true);
    assert.equal((await registrationOf(slotEventId, 'Ben')).status, 'waitlisted');
});

test('registration and own slot switch close at the registration deadline (W-03)', async () => {
    const MINUTE = 60 * 1000;
    const inTwoDays = new Date(Date.now() + 2 * 24 * 60 * MINUTE).toISOString();
    const passed = new Date(Date.now() - MINUTE).toISOString();
    const CLOSED = { ok: false, code: 'registration_closed', httpStatus: 400, error: 'Die Anmeldung für dieses Event ist geschlossen.' };
    const pick = (result) => ({ ok: result.ok, code: result.code, httpStatus: result.httpStatus, error: result.error });

    const eventId = await createEvent({ startDate: inTwoDays, registrationDeadline: passed });
    assert.deepEqual(pick(await register(eventId, 'Zuspät')), CLOSED);
    assert.equal(await registrationOf(eventId, 'Zuspät'), undefined);

    const openId = await createEvent({ startDate: inTwoDays, registrationDeadline: new Date(Date.now() + MINUTE).toISOString() });
    assert.equal((await register(openId, 'Knapp')).ok, true);

    const slotEventId = await createEvent({ startDate: inTwoDays, registrationDeadline: passed, slots: SLOTS, maxParticipants: 4 });
    await setDoc(doc(db, 'registrations', `${slotEventId}-ana`), {
        eventId: slotEventId, userId: user('Ana').id, userName: 'Ana', status: 'accepted', slotId: 'tank', preferredSlotId: 'tank',
        altSlotIds: [], guests: [], pendingGuests: [], formAnswers: {}, source: 'web', createdAt: new Date().toISOString()
    });
    assert.deepEqual(pick(await switchOwnSlot({ eventId: slotEventId, userId: user('Ana').id, slotId: 'heal' })), CLOSED);
    assert.equal((await registrationOf(slotEventId, 'Ana')).slotId, 'tank');
});

test('members cannot unregister after the unregister deadline (W-03)', async () => {
    const MINUTE = 60 * 1000;
    const inTwoDays = new Date(Date.now() + 2 * 24 * 60 * MINUTE).toISOString();
    const eventId = await createEvent({ startDate: inTwoDays, unregisterDeadline: new Date(Date.now() - MINUTE).toISOString() });
    await register(eventId, 'Fest');

    const result = await unregisterUserFromEvent({ eventId, userId: user('Fest').id });
    assert.deepEqual(
        { ok: result.ok, code: result.code, httpStatus: result.httpStatus, error: result.error },
        { ok: false, code: 'unregister_closed', httpStatus: 400, error: 'Abmelden ist nicht mehr möglich. Wende dich an einen Admin.' }
    );
    assert.equal((await registrationOf(eventId, 'Fest')).status, 'accepted');

    // Without an unregister deadline it stays open, even after the end
    const ended = await createEvent({ startDate: new Date(Date.now() - 180 * MINUTE).toISOString(), endDate: new Date(Date.now() - MINUTE).toISOString() });
    await setDoc(doc(db, 'registrations', `${ended}-frei`), {
        eventId: ended, userId: user('Frei').id, userName: 'Frei', status: 'accepted', guests: [], pendingGuests: [],
        formAnswers: {}, source: 'web', createdAt: new Date().toISOString()
    });
    assert.equal((await unregisterUserFromEvent({ eventId: ended, userId: user('Frei').id })).ok, true);
});

// --- „Vielleicht“ / Ersatzbank (B-17) ---

const { flushAnnouncementRefreshes } = require('../utils/announcementRefresh');
const maybe = (eventId, name, fields = {}) => register(eventId, name, { tentative: true, ...fields });
const failureOf = (result) => ({ ok: result.ok, code: result.code, httpStatus: result.httpStatus, error: result.error });

/** Console lines written while fn runs (the mock bot logs there). */
async function captureLog(fn) {
    const lines = [];
    const original = console.log;
    console.log = (...args) => { lines.push(args.map(String).join(' ')); };
    try {
        await fn();
        await flushAnnouncementRefreshes();
        await new Promise(resolve => setTimeout(resolve, 50));
    } finally {
        console.log = original;
    }
    return lines.join('\n');
}

test('„Vielleicht“ needs the event switch and allows no guests (B-17)', async () => {
    const closedId = await createEvent();
    assert.deepEqual(failureOf(await maybe(closedId, 'Mia')), {
        ok: false, code: 'tentative_not_allowed', httpStatus: 400, error: 'Für dieses Event gibt es kein „Vielleicht“.'
    });
    assert.equal(await registrationOf(closedId, 'Mia'), undefined);

    const openId = await createEvent({ allowTentative: true });
    assert.deepEqual(failureOf(await maybe(openId, 'Mia', { guests: [{ id: 'svc-guest' }] })), {
        ok: false, code: 'guests_not_allowed', httpStatus: 400, error: 'Gäste sind für dieses Event nicht zugelassen.'
    });
    assert.equal(await registrationOf(openId, 'Mia'), undefined);
});

test('„Vielleicht“ runs the checks of a registration (B-17)', async () => {
    const MINUTE = 60 * 1000;
    const inTwoDays = new Date(Date.now() + 2 * 24 * 60 * MINUTE).toISOString();
    const codeOf = async (fields, answer = {}) => (await maybe(await createEvent({ allowTentative: true, ...fields }), 'Pia', answer)).code;

    assert.equal(await codeOf({ status: 'draft' }), 'event_inactive');
    assert.equal(await codeOf({ startDate: new Date(Date.now() - 180 * MINUTE).toISOString(), endDate: new Date(Date.now() - MINUTE).toISOString() }), 'event_ended');
    assert.equal(await codeOf({ startDate: inTwoDays, registrationDeadline: new Date(Date.now() - MINUTE).toISOString() }), 'registration_closed');
    assert.equal(await codeOf({ accessMode: 'role-required', requiredRoles: ['raid-role'] }), 'missing_role');
    assert.equal(await codeOf({ formFields: [{ label: 'Klasse', type: 'text', required: true }] }), 'missing_fields');
    assert.equal(await codeOf({ slots: SLOTS }, { slotId: 'nope' }), 'invalid_slot');

    const twiceId = await createEvent({ allowTentative: true });
    await register(twiceId, 'Pia');
    assert.equal((await maybe(twiceId, 'Pia')).code, 'already_registered');
});

test('a tentative answer takes no place, even on a full event (B-17)', async () => {
    const eventId = await createEvent({ allowTentative: true, maxParticipants: 1, formFields: [{ label: 'Klasse', type: 'text', required: true }] });
    await register(eventId, 'Ana', { formAnswers: { Klasse: 'Magier' } });

    const ben = await maybe(eventId, 'Ben', { formAnswers: { Klasse: 'Krieger' } });
    assert.equal(ben.ok, true);
    assert.equal(ben.status, 'tentative');
    assert.equal(ben.message, 'Du stehst auf der Ersatzbank.');
    const stored = await registrationOf(eventId, 'Ben');
    assert.equal(stored.status, 'tentative');
    assert.deepEqual(stored.formAnswers, { Klasse: 'Krieger' });
    assert.equal(stored.tentativeAt, stored.createdAt);

    // The bench is no queue: the next binding registration still goes to the waitlist
    assert.equal((await register(eventId, 'Cem', { formAnswers: { Klasse: 'Druide' } })).status, 'waitlisted');
});

test('on slot events a tentative answer keeps the wanted role but holds no slot (B-17)', async () => {
    const eventId = await createEvent({ allowTentative: true, slots: SLOTS, maxParticipants: 4 });
    const result = await maybe(eventId, 'Heidi', { slotId: 'heal', altSlotIds: ['dps', 'nope'] });
    assert.equal(result.status, 'tentative');
    assert.equal(result.slotId, null);
    const stored = await registrationOf(eventId, 'Heidi');
    assert.equal(stored.slotId, null);
    assert.equal(stored.preferredSlotId, 'heal');
    assert.deepEqual(stored.altSlotIds, ['dps']);
    // The healer slot is still free for a binding registration
    assert.equal((await register(eventId, 'Ivo', { slotId: 'heal' })).slotId, 'heal');
});

test('a tentative answer sends no DM, gives no role or channels and asks for no approval (B-17)', async () => {
    for (const approvalMode of ['instant', 'manual']) {
        const eventId = await createEvent({
            title: `Bank ${approvalMode}`, allowTentative: true, approvalMode, assignRoleId: 'role-bench', discordChannelId: 'voice-bench',
            announcements: [{ channelId: 'chan-bench', messageId: 'msg-bench' }]
        });
        const requests = [];
        const original = bot.sendApprovalRequest;
        bot.sendApprovalRequest = async (registrationId) => { requests.push(registrationId); return null; };
        let log;
        try {
            log = await captureLog(() => maybe(eventId, `Jule-${approvalMode}`));
        } finally {
            bot.sendApprovalRequest = original;
        }
        assert.doesNotMatch(log, /DM an/, approvalMode);
        assert.doesNotMatch(log, /Rolle .* vergeben/, approvalMode);
        assert.doesNotMatch(log, /zu den Channels/, approvalMode);
        assert.deepEqual(requests, [], approvalMode);
        assert.match(log, new RegExp(`Ankündigung von "Bank ${approvalMode}" aktualisiert`), approvalMode);
    }
});

test('the bench can withdraw after the unregister deadline, a binding registration cannot (B-17)', async () => {
    const MINUTE = 60 * 1000;
    const eventId = await createEvent({
        allowTentative: true,
        startDate: new Date(Date.now() + 2 * 24 * 60 * MINUTE).toISOString(),
        unregisterDeadline: new Date(Date.now() - MINUTE).toISOString()
    });
    await maybe(eventId, 'Vage');
    await register(eventId, 'Sicher');

    let result;
    const log = await captureLog(async () => { result = await unregisterUserFromEvent({ eventId, userId: user('Vage').id }); });
    assert.equal(result.ok, true);
    assert.equal(await registrationOf(eventId, 'Vage'), undefined);
    assert.doesNotMatch(log, /DM an/);
    assert.equal((await unregisterUserFromEvent({ eventId, userId: user('Sicher').id })).code, 'unregister_closed');
});

test('switching the role on the bench changes the wanted role, never takes a place (B-17)', async () => {
    const eventId = await createEvent({ allowTentative: true, slots: SLOTS, maxParticipants: 4 });
    await maybe(eventId, 'Wanda', { slotId: 'tank' });
    const result = await switchOwnSlot({ eventId, userId: user('Wanda').id, slotId: 'heal' });
    assert.equal(result.ok, true);
    assert.equal(result.status, 'tentative');
    assert.equal(result.message, 'Deine Wunschrolle ist jetzt 💚 Heiler.');
    const stored = await registrationOf(eventId, 'Wanda');
    assert.deepEqual([stored.status, stored.slotId, stored.preferredSlotId], ['tentative', null, 'heal']);
    // The healer place is still free for a binding registration
    assert.equal((await register(eventId, 'Xaver', { slotId: 'heal' })).slotId, 'heal');
});

// ── Guests come from stored profiles (pentest vuln-0008) ────────────────

async function createGuestUser(name, fields = {}) {
    const id = `svc-friend-${name}`;
    await setDoc(doc(db, 'users', id), {
        id, username: name.toLowerCase(), displayName: name, avatar: `${name}.png`, acceptInvitations: true, ...fields
    });
    return id;
}

test('guests are taken from the stored profiles, never from the request', async () => {
    const eventId = await createEvent();
    const friendId = await createGuestUser('Echt');

    const result = await register(eventId, 'Gastgeber', {
        guests: [{ id: friendId, displayName: 'Admin', avatar: 'https://evil.example/x.png' }, { id: friendId }]
    });
    assert.equal(result.ok, true, result.error);

    const registration = await registrationOf(eventId, 'Gastgeber');
    assert.deepEqual(registration.pendingGuests, [
        { userId: friendId, displayName: 'Echt', avatar: 'Echt.png', status: 'pending' }
    ]);
});

test('unknown guests, the member themself and guests who decline invitations are refused', async () => {
    const eventId = await createEvent();
    const declinerId = await createGuestUser('Nein', { acceptInvitations: false });
    const failure = (result) => ({ code: result.code, error: result.error });

    assert.deepEqual(failure(await register(eventId, 'A', { guests: [{ id: 'svc-nobody' }] })), {
        code: 'invalid_guests', error: 'Ein eingeladener Gast ist nicht bei DEMS registriert.'
    });
    assert.deepEqual(failure(await register(eventId, 'B', { guests: [{ id: user('B').id }] })), {
        code: 'invalid_guests', error: 'Du kannst dich nicht selbst als Gast einladen.'
    });
    assert.deepEqual(failure(await register(eventId, 'C', { guests: [{ id: declinerId }] })), {
        code: 'invalid_guests', error: 'Nein nimmt keine Gast-Einladungen an.'
    });
    assert.equal((await loadEventRegistrations(eventId)).length, 0, 'no refused registration is stored');
});

test('a member brings at most 10 guests', async () => {
    const eventId = await createEvent();
    const ids = [];
    for (let i = 1; i <= 11; i++) ids.push(await createGuestUser(`Viele${i}`));

    const tooMany = await register(eventId, 'Gruppe', { guests: ids.map(id => ({ id })) });
    assert.equal(tooMany.code, 'invalid_guests');
    assert.equal(tooMany.error, 'Du kannst höchstens 10 Gäste einladen.');

    const ten = await register(eventId, 'Gruppe', { guests: ids.slice(0, 10).map(id => ({ id })) });
    assert.equal(ten.ok, true, ten.error);
});
