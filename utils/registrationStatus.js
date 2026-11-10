/**
 * Status change of one registration by an admin: accept, reject or waitlist.
 *
 * Shared by PUT /api/admin/registrations/:id/status and the approval buttons
 * in Discord (B-06), so both pick slots, send DMs, let the waitlist move up
 * and write the audit log the same way.
 */
const { db, doc, getDoc, updateDoc } = require('../firebaseAdmin');
const { withEventLock } = require('./eventLock');
const { getSlots, findSlot, resolveAcceptanceSlot } = require('./slotService');
const { notifyRegistrationsChanged } = require('./announcementRefresh');
const { debugLog } = require('./debugLog');
const { hasAnyCheckin, clearedCheckins } = require('./participations');
const { actorName } = require('./approvalRequests');

/**
 * Change the status of a registration.
 *
 * @param {Object} params -> Change input.
 * @param {string} params.registrationId -> The registration document ID.
 * @param {'accepted'|'rejected'|'waitlisted'} params.status -> New status.
 * @param {{ id: string, displayName?: string }} params.actor -> Deciding admin (audit log).
 * @param {string} [params.expectStatus] -> Change only while the registration still has this status (Discord buttons pass 'pending').
 * @returns {Promise<Object>} -> `{ ok: true, registration, event, status, slotId, warning }`, `{ ok: false, code: 'already_decided', registration, event }` or `{ ok: false, code: 'not_found', error }`.
 */
async function changeRegistrationStatus({ registrationId, status, actor, expectStatus = null }) {
    const { loadEventRegistrations, promoteFromWaitlist, addAuditLog } = require('./eventUtils');
    const { notifyStatusChange } = require('./registrationService');

    const regSnap = await getDoc(doc(db, 'registrations', registrationId));
    if (!regSnap.exists()) {
        return { ok: false, code: 'not_found', error: 'Anmeldung nicht gefunden' };
    }

    const reg = { id: registrationId, ...regSnap.data() };
    const eventSnap = await getDoc(doc(db, 'events', reg.eventId));
    const event = eventSnap.exists() ? eventSnap.data() : {};
    const slots = getSlots(event);

    // Status and slot change under the event lock -> no race with new registrations
    const outcome = await withEventLock(reg.eventId, async () => {
        // Two admins may click the same request -> the second one finds it decided
        if (expectStatus) {
            const current = await getDoc(doc(db, 'registrations', registrationId));
            if (!current.exists() || current.data().status !== expectStatus) {
                return { decided: current.exists() ? { id: registrationId, ...current.data() } : reg };
            }
        }
        const update = { status };
        // An admin decision ends a waitlist offer (B-15)
        if (reg.status === 'offered') update.offer = null;
        // Leaving the bench counts as registered now, for the waitlist order (B-17)
        if (reg.status === 'tentative') update.createdAt = new Date().toISOString();
        let overbookedWarning = null;
        // Waitlisted and rejected registrations give up their place -> a later acceptance picks a slot again
        if (slots.length > 0 && (status === 'waitlisted' || status === 'rejected')) {
            update.slotId = null;
        }
        // Only accepted registrations carry a check-in, also for their guests (badges count every checkedIn)
        if (status !== 'accepted' && hasAnyCheckin(reg)) {
            Object.assign(update, clearedCheckins(reg));
        }
        if (slots.length > 0 && status === 'accepted' && !findSlot(slots, reg.slotId)) {
            const registrations = await loadEventRegistrations(reg.eventId);
            const choice = resolveAcceptanceSlot(slots, registrations, reg);
            update.slotId = choice.slotId;
            if (choice.overbooked) {
                overbookedWarning = `Slot „${findSlot(slots, choice.slotId).name}“ ist jetzt überbucht.`;
            }
        }
        await updateDoc(doc(db, 'registrations', registrationId), update);
        return { slotId: 'slotId' in update ? update.slotId : reg.slotId, warning: overbookedWarning };
    });
    if (outcome.decided) {
        return { ok: false, code: 'already_decided', registration: outcome.decided, event };
    }
    const { slotId, warning } = outcome;
    debugLog('admin.updateRegStatus', { regId: registrationId, newStatus: status });

    // The single action tells only accepted and rejected members (no waitlist DM here)
    if (status === 'accepted' || status === 'rejected') {
        await notifyStatusChange({ registration: reg, eventId: reg.eventId, event, status, slotId });
    }
    if (status === 'rejected') {
        await promoteFromWaitlist(reg.eventId, event);
    }

    notifyRegistrationsChanged(reg.eventId);
    await addAuditLog('UPDATE_REGISTRATION_STATUS', actor.id, `Set status to ${status} for user ${reg.userName}`, registrationId);

    // The request message in the approval channel shows the decision (B-06)
    if (reg.status === 'pending') {
        await require('../bot').closeApprovalRequest(reg, { status, actorName: actorName(actor) }, event);
    }

    return { ok: true, registration: reg, event, status, slotId: slotId || null, warning };
}

module.exports = { changeRegistrationStatus };
