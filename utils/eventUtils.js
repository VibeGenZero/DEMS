const { db, collection, doc, getDoc, getDocs, addDoc, updateDoc, query, where } = require('../firebaseAdmin');
const { assignRole, addParticipantToEventChannels } = require('../bot');
const { sendAutomaticDM, sendWelcomeOnce, loadBotSettings } = require('./botSettings');
const { pickCapacityPromotions } = require('./capacity');
const {
    getSlots, hasSlots, findSlot, formatSlotLabel, pickWaitlistPromotions, buildRoster, normalizeSlots, validateSlotChange
} = require('./slotService');
const { withEventLock } = require('./eventLock');
const { notifyRegistrationsChanged } = require('./announcementRefresh');
const { isEventOver } = require('./eventListing');
const { participationsOf } = require('./participations');

/**
 * Move waitlisted registrations up while places are free.
 *
 * Takes the event lock itself -> code that already holds the lock must use
 * promoteFromWaitlistLocked() and announcePromotions() instead.
 *
 * @param {string} eventId -> The event document ID.
 * @param {Object} event -> The event document data.
 * @returns {Promise<Array<Object>>} -> Promotions, empty on errors.
 */
async function promoteFromWaitlist(eventId, event) {
    try {
        const promotions = await withEventLock(eventId, () => promoteFromWaitlistLocked(eventId, event));
        await announcePromotions(eventId, event, promotions);
        return promotions;
    } catch (err) {
        console.error('Waitlist promotion error:', err.message);
        return [];
    }
}

/**
 * Write the waitlist promotions of an event. The caller holds the event lock.
 *
 * Slot events fill free slots with the oldest matching entries; normal
 * events move up everyone whose places (including guests) still fit. With
 * „Nachrücken bestätigen“ on (B-15) the place is offered instead: status
 * `offered` with a deadline, confirmed later through utils/waitlistOffers.js.
 * Nobody moves up once the event is over: a place in it is worth nothing
 * then, and the DM, role and channel access would only confuse (W-01).
 *
 * @param {string} eventId -> The event document ID.
 * @param {Object} event -> The event document data.
 * @param {Object} [options]
 * @param {Date} [options.now] -> Reference time of the offer deadline.
 * @returns {Promise<Array<Object>>} -> `[{ registrationId, userId, status, slotId, expiresAt? }]`.
 */
async function promoteFromWaitlistLocked(eventId, event, { now = new Date() } = {}) {
    if (isEventOver(event)) return [];
    const registrations = await loadEventRegistrations(eventId);
    const picked = hasSlots(event)
        ? pickWaitlistPromotions(getSlots(event), registrations)
        : pickCapacityPromotions(event.maxParticipants || 0, registrations)
            .map(registrationId => ({ registrationId, slotId: null }));

    if (picked.length === 0) return [];

    // Offer the place instead of moving up at once (B-15)
    const { offerDeadline } = require('./waitlistOffers');
    const deadline = offerDeadline(event, await loadBotSettings(), now);
    const status = deadline ? 'offered' : (event.approvalMode === 'instant' ? 'accepted' : 'pending');
    const offer = deadline ? { offeredAt: now.toISOString(), expiresAt: deadline.toISOString() } : null;
    const promotions = [];
    for (const { registrationId, slotId } of picked) {
        const updates = { status, ...(offer ? { offer } : {}), ...(slotId ? { slotId } : {}) };
        await updateDoc(doc(db, 'registrations', registrationId), updates);
        const promoted = registrations.find(entry => entry.id === registrationId);
        promotions.push({ registrationId, userId: promoted.userId, status, slotId, ...(offer ? { expiresAt: offer.expiresAt } : {}) });
    }
    return promotions;
}

/**
 * Tell promoted members about their new place. Call it outside the lock.
 *
 * @param {string} eventId -> The event document ID.
 * @param {Object} event -> The event document data.
 * @param {Array<Object>} promotions -> Result of promoteFromWaitlistLocked().
 * @returns {Promise<void>} -> Resolves once every DM was attempted.
 */
async function announcePromotions(eventId, event, promotions) {
    if (promotions.length === 0) return;

    for (const promotion of promotions) {
        try {
            if (promotion.status === 'offered') {
                // Always announced, also with waitlist DMs off: the member must confirm (B-15)
                await require('../bot').sendWaitlistOffer(promotion.registrationId);
            } else {
                await completePromotion(event, promotion);
            }
        } catch (err) {
            console.error('Promotion notification failed:', err.message);
        }
        console.log(`Promoted user ${promotion.userId} from waitlist for event ${eventId}`);
    }

    notifyRegistrationsChanged(eventId);
}

/**
 * Effects of a finished move-up: accepted → DM, welcome, role, channel access;
 * pending → DM and the approval request (B-06). A confirmed offer (B-15) runs
 * it without the DM, the button answer already tells the member.
 *
 * @param {Object} event -> The event document data.
 * @param {Object} promotion -> `{ registrationId, userId, userName?, status, slotId }`.
 * @param {Object} [options]
 * @param {boolean} [options.announce] -> Send the "Ein Platz wurde frei" DM.
 * @returns {Promise<void>}
 */
async function completePromotion(event, promotion, { announce = true } = {}) {
    const slot = findSlot(getSlots(event), promotion.slotId);
    const slotLine = slot ? `\n🎯 Dein Slot: **${formatSlotLabel(slot)}**` : '';
    if (promotion.status === 'accepted') {
        if (announce) {
            await sendAutomaticDM(promotion.userId,
                `🎉 Ein Platz wurde frei! Du wurdest von der Warteliste für **${event.title}** in die Teilnehmerliste aufgenommen!${slotLine}`
            );
        }
        await sendWelcomeOnce({ id: promotion.userId, displayName: promotion.userName }, promotion.registrationId || null);
        if (event.assignRoleId) {
            await assignRole(promotion.userId, event.assignRoleId, process.env.DISCORD_GUILD_ID);
        }
        if (event.discordChannelId || event.discordTextChannelId) {
            await addParticipantToEventChannels(event, promotion.userId);
        }
        return;
    }
    if (announce) {
        await sendAutomaticDM(promotion.userId,
            `📋 Ein Platz wurde frei bei **${event.title}**! Deine Anfrage wird jetzt geprüft.${slotLine}`
        );
    }
    // Manual events: the request goes to the approval channel (B-06)
    if (promotion.registrationId) await require('../bot').sendApprovalRequest(promotion.registrationId);
}

// Event fields only admins may see; members would otherwise check in without being there
const PRIVATE_EVENT_FIELDS = ['checkinCode'];

/**
 * Event data for answers outside the admin area.
 *
 * @param {string} eventId -> The event document ID.
 * @param {Object} event -> The event document data.
 * @returns {Object} -> `{ id, ...event }` without PRIVATE_EVENT_FIELDS.
 */
function toPublicEvent(eventId, event) {
    const publicEvent = { id: eventId, ...event };
    for (const field of PRIVATE_EVENT_FIELDS) delete publicEvent[field];
    return publicEvent;
}

// Event statuses only admins may see; for everyone else such an event does not exist
const ADMIN_ONLY_STATUSES = ['draft', 'archived'];

/**
 * Whether a user may see an event at all.
 *
 * @param {Object|undefined} user -> Session user.
 * @param {Object} event -> The event document data.
 * @returns {boolean} -> False for draft and archived events unless the user is an admin.
 */
function isEventVisibleTo(user, event) {
    return !!user?.isAdmin || !ADMIN_ONLY_STATUSES.includes(event.status);
}

/**
 * Load every registration of an event.
 *
 * @param {string} eventId -> The event document ID.
 * @returns {Promise<Array<Object>>} -> Registrations with their `id`.
 */
async function loadEventRegistrations(eventId) {
    const snapshot = await getDocs(query(collection(db, 'registrations'), where('eventId', '==', eventId)));
    return snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
}

/**
 * Everything a person took part in or asked for: own registrations and guest
 * places on other members' registrations (#110), one participation each.
 *
 * @param {string} userId -> Discord user id.
 * @returns {Promise<Array<Object>>} -> participationsOf() of utils/participations.js; guest places carry `asGuest: true`.
 */
async function loadUserParticipations(userId) {
    const [own, asGuest] = await Promise.all([
        getDocs(query(collection(db, 'registrations'), where('userId', '==', userId))),
        getDocs(query(collection(db, 'registrations'), where('guests', 'array-contains', userId)))
    ]);
    const byId = new Map();
    for (const docSnap of [...own.docs, ...asGuest.docs]) byId.set(docSnap.id, { id: docSnap.id, ...docSnap.data() });
    return participationsOf([...byId.values()], userId);
}

/**
 * Find the registration of one user for an event.
 *
 * @param {string} eventId -> The event document ID.
 * @param {string} userId -> Discord user ID.
 * @returns {Promise<Object|null>} -> The registration with its `id`, or null.
 */
async function findUserRegistration(eventId, userId) {
    const registrations = await loadEventRegistrations(eventId);
    return registrations.find(registration => registration.userId === userId) || null;
}

/**
 * Load the line-up of an event.
 *
 * @param {string} eventId -> The event document ID.
 * @param {Object} event -> The event document data.
 * @param {Object} [options] -> Load options.
 * @param {boolean} [options.withProfiles] -> Also load user profiles for names and avatars.
 * @returns {Promise<Object>} -> Roster from buildRoster().
 */
async function loadEventRoster(eventId, event, { withProfiles = false } = {}) {
    const registrations = await loadEventRegistrations(eventId);
    const usersById = {};
    if (withProfiles) {
        const usersSnap = await getDocs(collection(db, 'users'));
        usersSnap.forEach(userDoc => { usersById[userDoc.id] = userDoc.data(); });
    }
    return buildRoster(event, registrations, usersById);
}

/**
 * Validate new slots and write an event update under the event lock.
 *
 * Holding the lock keeps a parallel registration from landing in a slot that
 * is being removed at the same moment.
 *
 * @param {string} eventId -> The event document ID.
 * @param {*} rawSlots -> Slots from the admin form.
 * @param {Function} buildUpdates -> `(slots, oldEvent) => fields` to write.
 * @returns {Promise<Object>} -> `{ ok: true, oldEvent, updates }` or `{ ok: false, error }`.
 */
async function saveEventWithSlots(eventId, rawSlots, buildUpdates) {
    return withEventLock(eventId, async () => {
        const eventSnap = await getDoc(doc(db, 'events', eventId));
        const oldEvent = eventSnap.exists() ? eventSnap.data() : {};

        const slotResult = normalizeSlots(rawSlots, getSlots(oldEvent));
        if (slotResult.error) return { ok: false, error: slotResult.error };

        const registrations = await loadEventRegistrations(eventId);
        const slotError = validateSlotChange({ oldSlots: getSlots(oldEvent), newSlots: slotResult.slots, registrations });
        if (slotError) return { ok: false, error: slotError };

        const updates = buildUpdates(slotResult.slots, oldEvent);
        await updateDoc(doc(db, 'events', eventId), updates);
        return { ok: true, oldEvent, updates };
    });
}

/**
 * Log admin action to auditing collection
 */
async function addAuditLog(action, adminId, details, targetId = null) {
    try {
        await addDoc(collection(db, 'auditLogs'), {
            action,
            adminId,
            details,
            targetId,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error('Audit log error:', err);
    }
}

module.exports = {
    promoteFromWaitlist,
    promoteFromWaitlistLocked,
    announcePromotions,
    completePromotion,
    addAuditLog,
    toPublicEvent,
    isEventVisibleTo,
    loadEventRegistrations,
    loadUserParticipations,
    findUserRegistration,
    loadEventRoster,
    saveEventWithSlots
};
