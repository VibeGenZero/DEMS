/**
 * Waitlist offers (B-15): a freed place is offered to the next waitlist entry,
 * which must confirm it within a deadline; „Doch nicht“ or no answer hands
 * the place on. The registration has status `offered` and
 * `offer: { offeredAt, expiresAt }` meanwhile and holds its place.
 */
const { db, collection, doc, getDoc, getDocs, query, where, updateDoc, deleteDoc } = require('../firebaseAdmin');
const { parseDate, isEventOver } = require('./eventListing');
const { withEventLock } = require('./eventLock');
const { sendAutomaticDM } = require('./botSettings');
const { notifyRegistrationsChanged } = require('./announcementRefresh');

// utils/eventUtils.js loads bot.js and requires this file lazily -> required when used
const eventUtils = () => require('./eventUtils');

const HOUR_MS = 60 * 60 * 1000;
// Offers end at least this long before the start; closer to it members move up at once
const OFFER_LEAD_MS = HOUR_MS;

/**
 * Deadline of an offer made now, or null when members move up at once.
 *
 * @param {Object} event -> Event data (`startDate`).
 * @param {Object} settings -> Normalized bot settings (`waitlistConfirmation`, `waitlistConfirmHours`).
 * @param {Date} [now] -> Reference time.
 * @returns {Date|null} -> Now + period, never later than one hour before the start.
 */
function offerDeadline(event, settings, now = new Date()) {
    if (!settings || settings.waitlistConfirmation === false) return null;
    const start = parseDate(event?.startDate);
    if (!start) return null;
    const latest = start.getTime() - OFFER_LEAD_MS;
    if (latest <= now.getTime()) return null;
    return new Date(Math.min(now.getTime() + settings.waitlistConfirmHours * HOUR_MS, latest));
}

/**
 * Check an offer under the lock: it exists, is the member's and still offered.
 *
 * @param {Object|null} registration -> Stored registration or null.
 * @param {string} userId -> Who clicked.
 * @returns {string|null} -> Refusal code, or null when it may go on.
 */
function offerRefusal(registration, userId) {
    if (!registration) return 'missing';
    if (registration.userId !== userId) return 'not_yours';
    if (registration.status !== 'offered') return 'not_offered';
    return null;
}

/** Stored registration with its id, or null. */
async function loadRegistration(registrationId) {
    const snap = await getDoc(doc(db, 'registrations', registrationId));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/** Stored event, or null. */
async function loadEvent(eventId) {
    const snap = await getDoc(doc(db, 'events', eventId));
    return snap.exists() ? snap.data() : null;
}

/**
 * „Platz annehmen“: move the member up as an instant move-up does (accepted
 * with role and channels, or pending with the approval request).
 *
 * @param {Object} options
 * @param {string} options.registrationId -> The offered registration.
 * @param {string} options.userId -> Discord user id of the clicking member.
 * @param {Date} [options.now] -> Reference time.
 * @returns {Promise<{ ok: true, status: string, eventId: string } | { ok: false, code: 'missing'|'not_yours'|'not_offered'|'expired' }>}
 */
async function confirmOffer({ registrationId, userId, now = new Date() }) {
    const first = await loadRegistration(registrationId);
    if (!first) return { ok: false, code: 'missing' };
    const { eventId } = first;
    const outcome = await withEventLock(eventId, async () => {
        const registration = await loadRegistration(registrationId);
        const refusal = offerRefusal(registration, userId);
        if (refusal) return { ok: false, code: refusal };
        const event = await loadEvent(eventId);
        const expired = new Date(registration.offer?.expiresAt || 0) <= now;
        if (expired || !event || event.status !== 'active' || isEventOver(event, now)) return { ok: false, code: 'expired' };
        const status = event.approvalMode === 'instant' ? 'accepted' : 'pending';
        await updateDoc(doc(db, 'registrations', registrationId), { status, offer: null });
        return { ok: true, status, event, registration };
    });
    if (!outcome.ok) return outcome;

    const { status, event, registration } = outcome;
    try {
        await eventUtils().completePromotion(event, {
            registrationId, userId, userName: registration.userName, status, slotId: registration.slotId || null
        }, { announce: false });
    } catch (err) {
        console.error('Confirmed offer follow-up failed:', err.message);
    }
    notifyRegistrationsChanged(eventId);
    return { ok: true, status, eventId };
}

/**
 * „Doch nicht“: remove the registration and offer the place to the next entry.
 *
 * @param {Object} options
 * @param {string} options.registrationId -> The offered registration.
 * @param {string} options.userId -> Discord user id of the clicking member.
 * @returns {Promise<{ ok: true, eventId: string } | { ok: false, code: string }>}
 */
async function declineOffer({ registrationId, userId }) {
    const first = await loadRegistration(registrationId);
    if (!first) return { ok: false, code: 'missing' };
    const { eventId } = first;
    const outcome = await withEventLock(eventId, async () => {
        const refusal = offerRefusal(await loadRegistration(registrationId), userId);
        if (refusal) return { ok: false, code: refusal };
        await deleteDoc(doc(db, 'registrations', registrationId));
        return { ok: true };
    });
    if (!outcome.ok) return outcome;
    await handPlaceOn(eventId);
    return { ok: true, eventId };
}

/** Give a freed place to the next waitlist entry and refresh the announcements. */
async function handPlaceOn(eventId) {
    const event = await loadEvent(eventId);
    if (event) await eventUtils().promoteFromWaitlist(eventId, event);
    notifyRegistrationsChanged(eventId);
}

/**
 * Remove every offer whose deadline passed, tell the member and hand the
 * place on. Offers of events that are no longer active (or over) are
 * removed quietly.
 *
 * @param {Object} [options]
 * @param {Date} [options.now] -> Reference time.
 * @returns {Promise<number>} -> Number of removed offers.
 */
async function expireOffers({ now = new Date() } = {}) {
    const snapshot = await getDocs(query(collection(db, 'registrations'), where('status', '==', 'offered')));
    const byEvent = new Map();
    for (const regDoc of snapshot.docs) {
        const registration = { id: regDoc.id, ...regDoc.data() };
        if (new Date(registration.offer?.expiresAt || 0) > now) continue;
        if (!byEvent.has(registration.eventId)) byEvent.set(registration.eventId, []);
        byEvent.get(registration.eventId).push(registration.id);
    }

    let count = 0;
    for (const [eventId, ids] of byEvent) {
        try {
            const removed = await withEventLock(eventId, async () => {
                const done = [];
                for (const id of ids) {
                    const registration = await loadRegistration(id);
                    // Confirmed or decided meanwhile -> keep
                    if (registration?.status !== 'offered' || new Date(registration.offer?.expiresAt || 0) > now) continue;
                    await deleteDoc(doc(db, 'registrations', id));
                    done.push(registration);
                }
                return done;
            });
            count += removed.length;
            const event = await loadEvent(eventId);
            const live = event && event.status === 'active' && !isEventOver(event, now);
            if (!live || removed.length === 0) continue;
            for (const registration of removed) {
                await sendAutomaticDM(registration.userId,
                    `⌛ Dein Platz bei **${event.title}** ist verfallen – du bist nicht mehr angemeldet.`);
            }
            await handPlaceOn(eventId);
        } catch (err) {
            console.error('Offer expiry failed for', eventId, err.message);
        }
    }
    if (count > 0) console.log(`⌛ Removed ${count} expired waitlist offer(s)`);
    return count;
}

const OFFER_INTERVAL_MS = 5 * 60 * 1000;
let offerTimer = null;
let schedulerGeneration = 0;

/**
 * Start the offer scheduler: one run once `waitFor` has settled (the server
 * passes the bot start, so the expiry DMs go out), then every 5 minutes.
 *
 * @param {Object} [options]
 * @param {Promise<*>} [options.waitFor] -> Settles when the first run may begin.
 * @returns {void}
 */
function startOfferScheduler({ waitFor = Promise.resolve() } = {}) {
    stopOfferScheduler();
    const generation = schedulerGeneration;
    const run = () => expireOffers().catch(err => console.error('Offer scheduler failed:', err.message));
    const begin = () => {
        // Stopped or started again while waiting
        if (generation !== schedulerGeneration) return;
        run();
        offerTimer = setInterval(run, OFFER_INTERVAL_MS);
        if (typeof offerTimer.unref === 'function') offerTimer.unref();
        console.log('⌛ Offer scheduler started (checks every 5 min)');
    };
    Promise.resolve(waitFor).then(begin, begin);
}

/**
 * Stop the offer scheduler, also before its first run.
 *
 * @returns {void}
 */
function stopOfferScheduler() {
    schedulerGeneration++;
    if (offerTimer) clearInterval(offerTimer);
    offerTimer = null;
}

module.exports = {
    OFFER_INTERVAL_MS,
    offerDeadline,
    confirmOffer,
    declineOffer,
    expireOffers,
    startOfferScheduler,
    stopOfferScheduler
};
