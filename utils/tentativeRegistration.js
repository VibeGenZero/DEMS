/**
 * „Fest zusagen“ (B-17): a member on the bench (status `tentative`) turns the
 * „Vielleicht“ into a binding registration. The registration then gets the
 * status a new registration would get now (accepted, pending or waitlisted;
 * slot events the wanted role or a free fallback) and counts as registered
 * at this moment, so it never jumps ahead of the waitlist.
 */
const { db, doc, getDoc, updateDoc } = require('../firebaseAdmin');
const { withEventLock } = require('./eventLock');
const { notifyRegistrationsChanged } = require('./announcementRefresh');
const { TENTATIVE_STATUS } = require('./capacity');
const { isEventOver, isRegistrationClosed, REGISTRATION_CLOSED_MESSAGE } = require('./eventListing');
const { getSlots, findSlot, decideStatus } = require('./slotService');
const { loadEventRegistrations } = require('./eventUtils');
const {
    REGISTRATION_ERROR, notifyRegistration, postApprovalRequest, buildStatusMessage, buildFailure
} = require('./registrationService');

const NOT_TENTATIVE_MESSAGE = 'Du stehst nicht auf der Ersatzbank.';

/**
 * Decide and write the new status under the event lock.
 *
 * @param {string} eventId -> The event document ID.
 * @param {string} userId -> Discord user ID of the member.
 * @returns {Promise<Object>} -> `{ ok: true, event, registration, status, slotId }` or a failure.
 */
async function confirmLocked(eventId, userId) {
    const eventSnap = await getDoc(doc(db, 'events', eventId));
    if (!eventSnap.exists()) return buildFailure(REGISTRATION_ERROR.NOT_FOUND, 'Event nicht gefunden');
    const event = eventSnap.data();

    const registrations = await loadEventRegistrations(eventId);
    const registration = registrations.find(entry => entry.userId === userId);
    if (!registration || registration.status !== TENTATIVE_STATUS) {
        return buildFailure(REGISTRATION_ERROR.NOT_TENTATIVE, NOT_TENTATIVE_MESSAGE);
    }
    // Same closing rules as a new registration; the answer stays on the bench
    if (event.status && event.status !== 'active') {
        return buildFailure(REGISTRATION_ERROR.INACTIVE, 'Dieses Event akzeptiert keine Anmeldungen.');
    }
    if (isEventOver(event)) return buildFailure(REGISTRATION_ERROR.ENDED, 'Das Event ist schon vorbei.');
    if (isRegistrationClosed(event)) return buildFailure(REGISTRATION_ERROR.CLOSED, REGISTRATION_CLOSED_MESSAGE);

    const slots = getSlots(event);
    const preferredSlot = findSlot(slots, registration.preferredSlotId);
    const wish = preferredSlot
        ? { preferredSlotId: preferredSlot.id, altSlotIds: registration.altSlotIds || [] }
        // A wanted role deleted meanwhile: the first free role of the event
        : { preferredSlotId: slots[0]?.id || null, altSlotIds: slots.slice(1).map(slot => slot.id) };
    const { status, slotId } = decideStatus(event, registrations, wish);

    await updateDoc(doc(db, 'registrations', registration.id), {
        status,
        slotId: slots.length > 0 ? slotId : null,
        createdAt: new Date().toISOString()
    });
    return { ok: true, event, registration, status, slotId };
}

/**
 * „Fest zusagen“ of the member's tentative registration.
 *
 * @param {Object} params -> Confirm input.
 * @param {string} params.eventId -> The event document ID.
 * @param {string} params.userId -> Discord user ID of the member.
 * @returns {Promise<Object>} -> `{ ok: true, id, status, slotId, message, event }` or `{ ok: false, code, httpStatus, error }`.
 * @example
 * const result = await confirmTentativeRegistration({ eventId: 'abc', userId: '1234' });
 */
async function confirmTentativeRegistration({ eventId, userId }) {
    const outcome = await withEventLock(eventId, () => confirmLocked(eventId, userId));
    if (!outcome.ok) return outcome;

    const { event, registration, status, slotId } = outcome;
    const slots = getSlots(event);
    const slot = findSlot(slots, slotId);
    const isAlt = !!slot && slotId !== registration.preferredSlotId;
    const user = { id: registration.userId, displayName: registration.userName };

    // The same DM, role and channels as a new registration with this status
    await notifyRegistration({ user, eventId, event, status, slot, isAlt, registrationId: registration.id });
    if (status === 'pending') postApprovalRequest(registration.id);
    notifyRegistrationsChanged(eventId);

    return {
        ok: true,
        id: registration.id,
        status,
        slotId: slotId || null,
        message: buildStatusMessage(status, slot, isAlt ? findSlot(slots, registration.preferredSlotId) : null),
        event
    };
}

module.exports = { confirmTentativeRegistration, NOT_TENTATIVE_MESSAGE };
