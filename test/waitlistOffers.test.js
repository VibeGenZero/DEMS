const { test, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir } = require('./helpers');

// Mock mode with an own database; the empty cwd keeps a local .env out
const tmpDir = createTempDir('waitlist-offers');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'offers.sqlite');

const bot = require('../bot');
const { db, doc, getDoc, setDoc, deleteDoc } = require('../firebaseAdmin');
const { promoteFromWaitlist } = require('../utils/eventUtils');
const { rememberBotSettings, normalizeBotSettings, forgetBotSettings } = require('../utils/botSettings');
const { offerDeadline } = require('../utils/waitlistOffers');

after(async () => {
    await bot.client.destroy();
});

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-11-02T12:00:00.000Z');
const at = (ms) => new Date(Date.now() + ms).toISOString();
const SETTINGS = normalizeBotSettings({});

// Every offer DM the code sends, by registration id
let offered = [];
const realSendOffer = bot.sendWaitlistOffer;
bot.sendWaitlistOffer = async (registrationId) => { offered.push(registrationId); return true; };
afterEach(() => {
    offered = [];
    forgetBotSettings();
});

let counter = 0;
async function createEvent(fields) {
    const id = `offer-event-${++counter}`;
    const event = { title: `Event ${counter}`, status: 'active', approvalMode: 'instant', maxParticipants: 1, startDate: at(72 * HOUR), ...fields };
    await setDoc(doc(db, 'events', id), event);
    return { id, event };
}
async function addRegistration(eventId, status, minutesAgo, fields = {}) {
    const id = `offer-reg-${++counter}`;
    await setDoc(doc(db, 'registrations', id), {
        eventId, userId: `offer-user-${counter}`, userName: `User ${counter}`, status, guests: [], pendingGuests: [],
        createdAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(), ...fields
    });
    return id;
}
const registrationOf = async (id) => (await getDoc(doc(db, 'registrations', id))).data();

// ── offerDeadline ───────────────────────────────────────────────────────

test('the deadline is the period, capped one hour before the start', () => {
    const event = (hoursAhead) => ({ startDate: new Date(NOW.getTime() + hoursAhead * HOUR).toISOString() });
    assert.equal(offerDeadline(event(72), SETTINGS, NOW).toISOString(), new Date(NOW.getTime() + 12 * HOUR).toISOString());
    assert.equal(offerDeadline(event(5), SETTINGS, NOW).toISOString(), new Date(NOW.getTime() + 4 * HOUR).toISOString());
    assert.equal(offerDeadline(event(0.5), SETTINGS, NOW), null, 'start less than an hour away');
    assert.equal(offerDeadline(event(1), SETTINGS, NOW), null, 'exactly one hour away');
    assert.equal(offerDeadline({ startDate: '' }, SETTINGS, NOW), null, 'no start');
    assert.equal(offerDeadline(event(72), normalizeBotSettings({ waitlistConfirmation: false }), NOW), null, 'switch off');
    assert.equal(offerDeadline(event(72), normalizeBotSettings({ waitlistConfirmHours: 2 }), NOW).toISOString(),
        new Date(NOW.getTime() + 2 * HOUR).toISOString());
});

// ── Offer instead of moving up ──────────────────────────────────────────

test('a freed place is offered to the first waitlist entry and stays held', async () => {
    rememberBotSettings(SETTINGS);
    const { id, event } = await createEvent({});
    const first = await addRegistration(id, 'waitlisted', 30);
    const second = await addRegistration(id, 'waitlisted', 20);

    const before = Date.now();
    const promotions = await promoteFromWaitlist(id, event);
    assert.equal(promotions.length, 1);
    assert.equal(promotions[0].status, 'offered');

    const stored = await registrationOf(first);
    assert.equal(stored.status, 'offered');
    const expires = new Date(stored.offer.expiresAt).getTime();
    assert.ok(Math.abs(expires - (before + 12 * HOUR)) < 5000, stored.offer.expiresAt);
    assert.ok(stored.offer.offeredAt);
    assert.equal((await registrationOf(second)).status, 'waitlisted');
    assert.deepEqual(offered, [first]);

    // The held place keeps the event full
    assert.deepEqual(await promoteFromWaitlist(id, event), []);
});

test('on slot events the offer holds the slot', async () => {
    rememberBotSettings(SETTINGS);
    const slots = [{ id: 'tank', name: 'Tank', emoji: '', capacity: 1 }];
    const { id, event } = await createEvent({ slots, maxParticipants: 1 });
    const waiting = await addRegistration(id, 'waitlisted', 10, { slotId: null, preferredSlotId: 'tank', altSlotIds: [] });
    await promoteFromWaitlist(id, event);
    const stored = await registrationOf(waiting);
    assert.equal(stored.status, 'offered');
    assert.equal(stored.slotId, 'tank');
});

test('with the switch off or close to the start members move up at once', async () => {
    rememberBotSettings(normalizeBotSettings({ waitlistConfirmation: false }));
    const off = await createEvent({});
    const waitingOff = await addRegistration(off.id, 'waitlisted', 10);
    await promoteFromWaitlist(off.id, off.event);
    assert.equal((await registrationOf(waitingOff)).status, 'accepted');

    forgetBotSettings();
    rememberBotSettings(SETTINGS);
    const soon = await createEvent({ startDate: at(30 * 60_000), approvalMode: 'manual' });
    const waitingSoon = await addRegistration(soon.id, 'waitlisted', 10);
    await promoteFromWaitlist(soon.id, soon.event);
    const stored = await registrationOf(waitingSoon);
    assert.equal(stored.status, 'pending');
    assert.equal(stored.offer, undefined);
    assert.deepEqual(offered, []);
});

test('the real offer DM helper answers false while the bot is not ready', async () => {
    assert.equal(typeof realSendOffer, 'function');
    const { sendWaitlistOffer } = require('../bot/waitlistOffers');
    assert.equal(await sendWaitlistOffer('offer-reg-none'), false);
});


// ── Confirm, decline, expire ────────────────────────────────────────────

const { confirmOffer, declineOffer, expireOffers } = require('../utils/waitlistOffers');

/** Console lines written while fn runs (the mock bot logs there). */
async function captureLog(fn) {
    const lines = [];
    const original = console.log;
    console.log = (...args) => { lines.push(args.map(String).join(' ')); };
    try {
        await fn();
        await new Promise(resolve => setTimeout(resolve, 50));
    } finally {
        console.log = original;
    }
    return lines.join('\n');
}
const offerUntil = (ms) => ({ offeredAt: new Date().toISOString(), expiresAt: at(ms) });
const userOf = async (id) => (await registrationOf(id)).userId;

test('confirming moves an instant event member up with role and channels', async () => {
    rememberBotSettings(SETTINGS);
    const { id } = await createEvent({ assignRoleId: 'role-offer', discordChannelId: 'voice-offer' });
    const reg = await addRegistration(id, 'offered', 30, { offer: offerUntil(HOUR) });
    let result;
    const log = await captureLog(async () => { result = await confirmOffer({ registrationId: reg, userId: await userOf(reg) }); });
    assert.equal(result.ok, true);
    assert.equal(result.status, 'accepted');
    const stored = await registrationOf(reg);
    assert.equal(stored.status, 'accepted');
    assert.equal(stored.offer, null);
    assert.match(log, /Rolle role-offer an .* vergeben/);
    assert.match(log, /zu den Channels/);
});

test('confirming a manual event makes the request and posts it for approval', async () => {
    rememberBotSettings(SETTINGS);
    const { id } = await createEvent({ approvalMode: 'manual' });
    const reg = await addRegistration(id, 'offered', 30, { offer: offerUntil(HOUR) });
    const requests = [];
    const original = bot.sendApprovalRequest;
    bot.sendApprovalRequest = async (registrationId) => { requests.push(registrationId); return null; };
    try {
        const result = await confirmOffer({ registrationId: reg, userId: await userOf(reg) });
        assert.equal(result.status, 'pending');
    } finally {
        bot.sendApprovalRequest = original;
    }
    assert.equal((await registrationOf(reg)).status, 'pending');
    assert.deepEqual(requests, [reg]);
});

test('expired, not offered, foreign and missing offers are refused', async () => {
    rememberBotSettings(SETTINGS);
    const { id } = await createEvent({});
    const expired = await addRegistration(id, 'offered', 30, { offer: offerUntil(-60_000) });
    const waiting = await addRegistration(id, 'waitlisted', 20);
    const own = await addRegistration(id, 'offered', 10, { offer: offerUntil(HOUR) });
    assert.deepEqual(await confirmOffer({ registrationId: expired, userId: await userOf(expired) }), { ok: false, code: 'expired' });
    assert.deepEqual(await confirmOffer({ registrationId: waiting, userId: await userOf(waiting) }), { ok: false, code: 'not_offered' });
    assert.deepEqual(await confirmOffer({ registrationId: own, userId: 'someone-else' }), { ok: false, code: 'not_yours' });
    assert.deepEqual(await confirmOffer({ registrationId: 'offer-missing', userId: 'x' }), { ok: false, code: 'missing' });
    assert.deepEqual(await declineOffer({ registrationId: own, userId: 'someone-else' }), { ok: false, code: 'not_yours' });
    assert.equal((await registrationOf(expired)).status, 'offered');
    assert.equal((await registrationOf(own)).status, 'offered');
    // Left for the expiry pass otherwise -> the expiry test counts only its own offers
    await deleteDoc(doc(db, 'registrations', expired));
});

test('declining removes the registration and offers the place to the next', async () => {
    rememberBotSettings(SETTINGS);
    const { id } = await createEvent({});
    const reg = await addRegistration(id, 'offered', 30, { offer: offerUntil(HOUR) });
    const next = await addRegistration(id, 'waitlisted', 20);
    assert.deepEqual(await declineOffer({ registrationId: reg, userId: await userOf(reg) }), { ok: true, eventId: id });
    assert.equal((await getDoc(doc(db, 'registrations', reg))).exists(), false);
    assert.equal((await registrationOf(next)).status, 'offered');
    assert.deepEqual(offered, [next]);
});

test('expired offers are removed with a DM and the place goes to the next', async () => {
    rememberBotSettings(SETTINGS);
    const { id } = await createEvent({ title: 'Koop-Abend' });
    const late = await addRegistration(id, 'offered', 30, { offer: offerUntil(-60_000) });
    const next = await addRegistration(id, 'waitlisted', 20);
    const other = await createEvent({});
    const fresh = await addRegistration(other.id, 'offered', 10, { offer: offerUntil(HOUR) });
    const gone = await createEvent({ status: 'cancelled' });
    const cancelledOffer = await addRegistration(gone.id, 'offered', 10, { offer: offerUntil(-60_000) });

    let count;
    const log = await captureLog(async () => { count = await expireOffers(); });
    assert.equal(count, 2);
    assert.equal((await getDoc(doc(db, 'registrations', late))).exists(), false);
    assert.equal((await getDoc(doc(db, 'registrations', cancelledOffer))).exists(), false);
    assert.equal((await registrationOf(next)).status, 'offered');
    assert.equal((await registrationOf(fresh)).status, 'offered');
    assert.match(log, /Dein Platz bei \*\*Koop-Abend\*\* ist verfallen/);
    assert.equal((log.match(/ist verfallen/g) || []).length, 1, 'no DM for the cancelled event');
    assert.deepEqual(offered, [next]);
});

test('two confirmations at once let only one through', async () => {
    rememberBotSettings(SETTINGS);
    const { id } = await createEvent({});
    const reg = await addRegistration(id, 'offered', 30, { offer: offerUntil(HOUR) });
    const userId = await userOf(reg);
    const results = await Promise.all([confirmOffer({ registrationId: reg, userId }), confirmOffer({ registrationId: reg, userId })]);
    assert.deepEqual(results.map(result => result.ok).sort(), [false, true]);
    assert.equal(results.find(result => !result.ok).code, 'not_offered');
});

// ── Offer scheduler ─────────────────────────────────────────────────────

const { startOfferScheduler, stopOfferScheduler } = require('../utils/waitlistOffers');
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

test('the offer scheduler expires offers once the bot is ready', async () => {
    rememberBotSettings(SETTINGS);
    const { id } = await createEvent({});
    const late = await addRegistration(id, 'offered', 30, { offer: offerUntil(-60_000) });
    let botReady;
    startOfferScheduler({ waitFor: new Promise(resolve => { botReady = resolve; }) });
    await sleep(100);
    assert.equal((await registrationOf(late)).status, 'offered', 'waits for the bot');

    botReady(true);
    let gone = false;
    for (let attempt = 0; attempt < 50 && !gone; attempt++) {
        gone = !(await getDoc(doc(db, 'registrations', late))).exists();
        if (!gone) await sleep(20);
    }
    stopOfferScheduler();
    assert.equal(gone, true);
});

test('an offer scheduler stopped before the bot is ready never runs', async () => {
    const { id } = await createEvent({});
    const late = await addRegistration(id, 'offered', 30, { offer: offerUntil(-60_000) });
    let botReady;
    startOfferScheduler({ waitFor: new Promise(resolve => { botReady = resolve; }) });
    stopOfferScheduler();
    botReady(true);
    await sleep(100);
    assert.equal((await registrationOf(late)).status, 'offered');
    await deleteDoc(doc(db, 'registrations', late));
});
