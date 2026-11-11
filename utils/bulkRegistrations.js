/**
 * Bulk actions on the registrations of one event (W-08): decides which
 * selected registration ends in which status and slot. Pure, no database;
 * the route writes the plan under the event lock.
 */
const { placesOf, countOccupiedPlaces, byCreatedAt } = require('./capacity');
const { getSlots, countSlotOccupancy, pickSlot } = require('./slotService');
const { hasAnyCheckin } = require('./participations');

/** Statuses each action applies to; the frontend copy lives in public/js/admin/registration-bulk.js. */
// An offered registration (B-15) is decided like a waitlisted one; the bench (B-17) holds no place
const BULK_ACTIONS = {
    accept: ['pending', 'waitlisted', 'offered', 'tentative'],
    waitlist: ['pending', 'accepted', 'offered', 'tentative'],
    reject: ['pending', 'waitlisted', 'accepted', 'offered', 'tentative']
};
const TARGET_STATUS = { accept: 'accepted', waitlist: 'waitlisted', reject: 'rejected' };
const MAX_BULK_IDS = 200;

/**
 * Plan one bulk action.
 *
 * @param {Object} params -> `{ action, ids, registrations, event }`: action key of BULK_ACTIONS,
 *   selected registration ids, every registration of the event (with `id`), the event.
 * @returns {Object} -> `{ changes, skipped, full }`: changes `[{ id, from, to, slotId, clearCheckin }]`
 *   oldest first (`slotId` undefined = leave it, null = clear it), skipped ids (unknown or
 *   status the action does not apply to), and ids that did not get a place on accept.
 */
function planBulkAction({ action, ids, registrations, event }) {
    const applies = BULK_ACTIONS[action] || [];
    const byId = new Map(registrations.map(registration => [registration.id, registration]));
    const wanted = [...new Set(ids)];
    const skipped = wanted.filter(id => !byId.has(id) || !applies.includes(byId.get(id).status));
    const selected = wanted
        .filter(id => !skipped.includes(id))
        .map(id => byId.get(id))
        .sort(byCreatedAt);
    const slots = getSlots(event);
    const hasSlots = slots.length > 0;

    if (action !== 'accept') {
        const to = TARGET_STATUS[action];
        const changes = selected.map(registration => ({
            id: registration.id,
            from: registration.status,
            to,
            slotId: hasSlots ? null : undefined,
            // Also the check-ins of guests (#110)
            clearCheckin: hasAnyCheckin(registration)
        }));
        return { changes, skipped, full: [] };
    }

    // Places of everyone not selected stay taken; the selection fills what is left
    const selectedIds = new Set(selected.map(registration => registration.id));
    const unselected = registrations.filter(registration => !selectedIds.has(registration.id));
    const changes = [];
    const full = [];
    const toWaitlist = (registration) => {
        full.push(registration.id);
        if (registration.status === 'waitlisted') return;
        changes.push({ id: registration.id, from: registration.status, to: 'waitlisted', slotId: hasSlots ? null : undefined, clearCheckin: false });
    };

    if (hasSlots) {
        const occupancy = countSlotOccupancy(slots, unselected);
        for (const registration of selected) {
            const preferred = registration.preferredSlotId || registration.slotId;
            const slotId = pickSlot(slots, occupancy, preferred, registration.altSlotIds || []);
            if (!slotId) {
                toWaitlist(registration);
                continue;
            }
            occupancy[slotId] += 1;
            changes.push({ id: registration.id, from: registration.status, to: 'accepted', slotId, clearCheckin: false });
        }
        return { changes, skipped, full };
    }

    const limit = Number(event.maxParticipants) || 0;
    let occupied = countOccupiedPlaces(unselected);
    for (const registration of selected) {
        const needed = placesOf(registration);
        if (limit > 0 && occupied + needed > limit) {
            toWaitlist(registration);
            continue;
        }
        occupied += needed;
        changes.push({ id: registration.id, from: registration.status, to: 'accepted', slotId: undefined, clearCheckin: false });
    }
    return { changes, skipped, full };
}

module.exports = { BULK_ACTIONS, MAX_BULK_IDS, planBulkAction };
