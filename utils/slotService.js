/**
 * Role slots of an event (e.g. tank / healer / damage) -> pure rules.
 *
 * Every function works on plain data so the rules can be tested without a
 * database. A slot is `{ id, name, emoji, capacity }`; registrations are
 * plain objects with `id`, `status`, `slotId`, `preferredSlotId`,
 * `altSlotIds`, `userId`, `userName` and `createdAt`.
 */
const crypto = require('crypto');
const { OCCUPYING_STATUSES, countOccupiedPlaces, summarizePlaces, byCreatedAt } = require('./capacity');

/** Limits of the slot editor. */
const MAX_SLOTS = 10;
const SLOT_NAME_MAX_LENGTH = 30;
const SLOT_CAPACITY_MIN = 1;
const SLOT_CAPACITY_MAX = 100;
const SLOT_ID_LENGTH = 8;

const graphemeSegmenter = new Intl.Segmenter('de', { granularity: 'grapheme' });

/**
 * Slots of an event.
 *
 * @param {Object} event -> The event document data.
 * @returns {Array<Object>} -> The slots, empty for a normal event.
 */
function getSlots(event) {
    return event && Array.isArray(event.slots) ? event.slots : [];
}

/**
 * Whether the event uses role slots.
 *
 * @param {Object} event -> The event document data.
 * @returns {boolean} -> True when at least one slot is defined.
 */
function hasSlots(event) {
    return getSlots(event).length > 0;
}

/**
 * Find a slot by its ID.
 *
 * @param {Array<Object>} slots -> Slots of the event.
 * @param {string} slotId -> Wanted slot ID.
 * @returns {Object|null} -> The slot, or null when it does not exist.
 */
function findSlot(slots, slotId) {
    return slots.find(slot => slot.id === slotId) || null;
}

/**
 * Readable slot name for messages, e.g. "🛡️ Tank".
 *
 * @param {Object|null} slot -> The slot.
 * @returns {string} -> Emoji and name, or an empty string.
 */
function formatSlotLabel(slot) {
    if (!slot) return '';
    return slot.emoji ? `${slot.emoji} ${slot.name}` : slot.name;
}

/**
 * Check that a value is exactly one Unicode emoji.
 *
 * Discord rejects a whole message when a button carries an invalid emoji,
 * so anything else is refused before it is stored.
 *
 * @param {string} value -> Text to check.
 * @returns {boolean} -> True for a single emoji grapheme.
 */
function isSingleEmoji(value) {
    const graphemes = [...graphemeSegmenter.segment(value)];
    return graphemes.length === 1 && /\p{Extended_Pictographic}/u.test(value);
}

/**
 * Total number of places of all slots.
 *
 * @param {Array<Object>} slots -> Slots of the event.
 * @returns {number} -> Sum of the capacities.
 */
function sumCapacity(slots) {
    return slots.reduce((sum, slot) => sum + slot.capacity, 0);
}

/**
 * Create a slot ID that is not used yet.
 *
 * @param {Set<string>} usedIds -> IDs already taken.
 * @returns {string} -> New 8 character hex ID.
 */
function generateSlotId(usedIds) {
    let id;
    do {
        id = crypto.randomUUID().replace(/-/g, '').slice(0, SLOT_ID_LENGTH);
    } while (usedIds.has(id));
    return id;
}

/**
 * Validate and clean the slots sent by the admin form.
 *
 * IDs are only kept when they belong to the event already -> a client can
 * not inject IDs, and existing registrations keep pointing at their slot.
 *
 * @param {*} rawSlots -> Slots from the request body.
 * @param {Array<Object>} [existingSlots] -> Slots stored on the event so far.
 * @returns {{ slots: Array<Object> } | { error: string }} -> Clean slots or a German error message.
 * @example
 * const { slots, error } = normalizeSlots(req.body.slots, getSlots(oldEvent));
 */
function normalizeSlots(rawSlots, existingSlots = []) {
    if (rawSlots === undefined || rawSlots === null) return { slots: [] };
    if (!Array.isArray(rawSlots)) return { error: 'Slots müssen eine Liste sein.' };
    if (rawSlots.length > MAX_SLOTS) return { error: `Es sind höchstens ${MAX_SLOTS} Slots erlaubt.` };

    const knownIds = new Set(existingSlots.map(slot => slot.id));
    const usedIds = new Set();
    const usedNames = new Set();
    const slots = [];

    for (const raw of rawSlots) {
        const name = raw && typeof raw.name === 'string' ? raw.name.trim() : '';
        if (!name || name.length > SLOT_NAME_MAX_LENGTH) {
            return { error: `Jeder Slot braucht einen Namen mit 1–${SLOT_NAME_MAX_LENGTH} Zeichen.` };
        }
        const nameKey = name.toLowerCase();
        if (usedNames.has(nameKey)) return { error: `Slot-Name „${name}“ ist doppelt vergeben.` };
        usedNames.add(nameKey);

        const emoji = typeof raw.emoji === 'string' ? raw.emoji.trim() : '';
        if (emoji && !isSingleEmoji(emoji)) {
            return { error: `Das Emoji von Slot „${name}“ muss ein einzelnes Emoji sein.` };
        }

        const capacity = Number(raw.capacity);
        if (!Number.isInteger(capacity) || capacity < SLOT_CAPACITY_MIN || capacity > SLOT_CAPACITY_MAX) {
            return { error: `Slot „${name}“ braucht ${SLOT_CAPACITY_MIN}–${SLOT_CAPACITY_MAX} Plätze.` };
        }

        const keepId = typeof raw.id === 'string' && knownIds.has(raw.id) && !usedIds.has(raw.id);
        const id = keepId ? raw.id : generateSlotId(usedIds);
        usedIds.add(id);
        slots.push({ id, name, emoji, capacity });
    }

    return { slots };
}

/**
 * Count the taken places per slot.
 *
 * @param {Array<Object>} slots -> Slots of the event.
 * @param {Array<Object>} registrations -> Registrations of the event.
 * @returns {Object} -> `{ [slotId]: number }` for every slot.
 */
function countSlotOccupancy(slots, registrations) {
    const occupancy = Object.fromEntries(slots.map(slot => [slot.id, 0]));
    registrations.forEach(registration => {
        if (!OCCUPYING_STATUSES.includes(registration.status)) return;
        if (Object.hasOwn(occupancy, registration.slotId)) occupancy[registration.slotId] += 1;
    });
    return occupancy;
}

/**
 * Whether a slot still has a free place.
 *
 * @param {Object} slot -> The slot.
 * @param {Object} occupancy -> Result of countSlotOccupancy().
 * @returns {boolean} -> True while taken < capacity.
 */
function hasFreePlace(slot, occupancy) {
    return (occupancy[slot.id] || 0) < slot.capacity;
}

/**
 * Clean the alternative slots of a registration.
 *
 * Unknown IDs and the main role are dropped; the rest is sorted in the slot
 * order of the event -> web and Discord behave the same.
 *
 * @param {Array<Object>} slots -> Slots of the event.
 * @param {string} preferredSlotId -> The main role.
 * @param {*} altSlotIds -> Requested alternatives.
 * @returns {string[]} -> Clean alternative slot IDs.
 */
function sanitizeAltSlotIds(slots, preferredSlotId, altSlotIds) {
    const wanted = new Set(Array.isArray(altSlotIds) ? altSlotIds : []);
    return slots
        .filter(slot => slot.id !== preferredSlotId && wanted.has(slot.id))
        .map(slot => slot.id);
}

/**
 * Pick the slot a registration gets.
 *
 * @param {Array<Object>} slots -> Slots of the event.
 * @param {Object} occupancy -> Result of countSlotOccupancy().
 * @param {string} preferredSlotId -> The main role.
 * @param {string[]} [altSlotIds] -> Clean alternatives in slot order.
 * @returns {string|null} -> Slot ID, or null when everything is full.
 */
function pickSlot(slots, occupancy, preferredSlotId, altSlotIds = []) {
    for (const slotId of [preferredSlotId, ...altSlotIds]) {
        const slot = findSlot(slots, slotId);
        if (slot && hasFreePlace(slot, occupancy)) return slot.id;
    }
    return null;
}

/**
 * Status and slot a binding registration gets right now: on slot events the
 * main role, else the first free fallback, else the waitlist; on other events
 * the waitlist when the member and their guests do not fit; otherwise
 * accepted or pending by the approval mode. Shared by a new registration and
 * the „Fest zusagen“ of a tentative one (B-17).
 *
 * @param {Object} event -> Event data (`slots`, `maxParticipants`, `approvalMode`).
 * @param {Array<Object>} registrations -> All registrations of the event.
 * @param {Object} [wish] -> What the member asks for.
 * @param {string|null} [wish.preferredSlotId] -> Valid main role of a slot event.
 * @param {string[]} [wish.altSlotIds] -> Clean fallback roles in slot order.
 * @param {number} [wish.guestCount] -> Places the member brings in addition to their own.
 * @returns {{ status: 'accepted'|'pending'|'waitlisted', slotId: string|null }} -> The decision.
 * @example
 * decideStatus(event, registrations, { preferredSlotId: 'tank', altSlotIds: ['heal'] });
 */
function decideStatus(event, registrations, { preferredSlotId = null, altSlotIds = [], guestCount = 0 } = {}) {
    const slots = getSlots(event);
    let slotId = null;
    let isWaitlisted = false;
    if (slots.length > 0) {
        slotId = pickSlot(slots, countSlotOccupancy(slots, registrations), preferredSlotId, altSlotIds);
        isWaitlisted = !slotId;
    } else if (event.maxParticipants > 0) {
        isWaitlisted = countOccupiedPlaces(registrations) + 1 + guestCount > event.maxParticipants;
    }
    if (isWaitlisted) return { status: 'waitlisted', slotId: null };
    return { status: event.approvalMode === 'instant' ? 'accepted' : 'pending', slotId };
}

/**
 * Decide which waitlisted registrations move into free slots.
 *
 * The waitlist is walked oldest first; every entry whose main role or one of
 * its alternatives has a free place moves up. Overbooked slots stay closed.
 *
 * @param {Array<Object>} slots -> Slots of the event.
 * @param {Array<Object>} registrations -> All registrations of the event.
 * @returns {Array<{ registrationId: string, slotId: string }>} -> Promotions in order.
 */
function pickWaitlistPromotions(slots, registrations) {
    const occupancy = countSlotOccupancy(slots, registrations);
    const promotions = [];

    registrations
        .filter(registration => registration.status === 'waitlisted')
        .sort(byCreatedAt)
        .forEach(registration => {
            const slotId = pickSlot(slots, occupancy, registration.preferredSlotId, registration.altSlotIds || []);
            if (!slotId) return;
            occupancy[slotId] += 1;
            promotions.push({ registrationId: registration.id, slotId });
        });

    return promotions;
}

/**
 * Pick the slot for a registration an admin accepts manually.
 *
 * @param {Array<Object>} slots -> Slots of the event.
 * @param {Array<Object>} registrations -> All registrations of the event.
 * @param {Object} registration -> The registration being accepted.
 * @returns {{ slotId: string, overbooked: boolean }} -> Wanted free slot, or the main role overbooked.
 */
function resolveAcceptanceSlot(slots, registrations, registration) {
    const others = registrations.filter(entry => entry.id !== registration.id);
    const occupancy = countSlotOccupancy(slots, others);
    const slotId = pickSlot(slots, occupancy, registration.preferredSlotId, registration.altSlotIds || []);
    if (slotId) return { slotId, overbooked: false };

    // A main role that no longer exists must not cause a false overbooking -> take a free slot then
    const fallback = findSlot(slots, registration.preferredSlotId)
        || slots.find(slot => hasFreePlace(slot, occupancy))
        || slots[0];
    return { slotId: fallback.id, overbooked: !hasFreePlace(fallback, occupancy) };
}

/**
 * Compact slot overview for event cards: taken places per slot.
 *
 * @param {Array<Object>} slots -> Slots of the event.
 * @param {Array<Object>} registrations -> Registrations of the event.
 * @returns {Array<Object>} -> `[{ id, name, emoji, capacity, taken }]`.
 */
function buildSlotSummary(slots, registrations) {
    const occupancy = countSlotOccupancy(slots, registrations);
    return slots.map(slot => ({
        id: slot.id,
        name: slot.name,
        emoji: slot.emoji,
        capacity: slot.capacity,
        taken: occupancy[slot.id] || 0
    }));
}

/**
 * Attach the slot summary to an event of an API response.
 *
 * @param {Object} event -> Event with its ID.
 * @param {Array<Object>} registrations -> Registrations of the event.
 * @returns {Object} -> The event, with `slotSummary` when it uses slots.
 */
function withSlotSummary(event, registrations) {
    if (!hasSlots(event)) return event;
    return { ...event, slotSummary: buildSlotSummary(getSlots(event), registrations) };
}

/**
 * Line-up of an event for the event page and the Discord embed.
 *
 * @param {Object} event -> The event document data.
 * @param {Array<Object>} registrations -> All registrations of the event.
 * @param {Object} [usersById] -> User profiles keyed by user ID, for names and avatars.
 * @returns {Object} -> `{ taken, capacity, waitlistCount, places, benchCount, slots, waitlist }`; `places` are the numbers of summarizePlaces() behind the places sentence, `benchCount` the tentative registrations (B-17).
 */
function buildRoster(event, registrations, usersById = {}) {
    const slots = getSlots(event);
    const describe = (registration) => {
        const profile = usersById[registration.userId] || {};
        return {
            displayName: profile.displayName || registration.userName || 'Unbekannt',
            avatar: profile.avatar || ''
        };
    };
    const occupying = registrations
        .filter(registration => OCCUPYING_STATUSES.includes(registration.status))
        .sort(byCreatedAt);
    const waitlisted = registrations
        .filter(registration => registration.status === 'waitlisted')
        .sort(byCreatedAt);
    const places = summarizePlaces(registrations, event.maxParticipants);

    return {
        taken: countOccupiedPlaces(registrations),
        capacity: event.maxParticipants > 0 ? event.maxParticipants : 0,
        waitlistCount: waitlisted.length,
        places,
        benchCount: places.bench,
        slots: slots.map(slot => {
            const members = occupying
                .filter(registration => registration.slotId === slot.id)
                .map(registration => ({
                    ...describe(registration),
                    pending: registration.status === 'pending',
                    isAlt: registration.slotId !== registration.preferredSlotId
                }));
            return { id: slot.id, name: slot.name, emoji: slot.emoji, capacity: slot.capacity, taken: members.length, members };
        }),
        waitlist: slots.length === 0 ? [] : waitlisted.map(registration => ({
            ...describe(registration),
            preferredSlotId: registration.preferredSlotId || null,
            altSlotIds: registration.altSlotIds || []
        }))
    };
}

/**
 * Check whether an admin may change the slots of an event.
 *
 * @param {Object} params -> Check input.
 * @param {Array<Object>} params.oldSlots -> Slots stored so far.
 * @param {Array<Object>} params.newSlots -> Normalized new slots.
 * @param {Array<Object>} params.registrations -> All registrations of the event.
 * @returns {string|null} -> German error message, or null when the change is fine.
 */
function validateSlotChange({ oldSlots, newSlots, registrations }) {
    if (oldSlots.length === 0 && newSlots.length > 0) {
        const hasOpenRegistrations = registrations.some(registration => registration.status !== 'rejected');
        return hasOpenRegistrations ? 'Slots können nur aktiviert werden, solange es keine Anmeldungen gibt.' : null;
    }
    // Turning slots off is always allowed -> the slot fields of the registrations are ignored then
    if (newSlots.length === 0) return null;

    const keptIds = new Set(newSlots.map(slot => slot.id));
    for (const slot of oldSlots) {
        if (keptIds.has(slot.id)) continue;
        // Taken places and waitlisted members whose main role this is would be stranded
        const count = registrations.filter(registration =>
            (OCCUPYING_STATUSES.includes(registration.status) && registration.slotId === slot.id)
            || (registration.status === 'waitlisted' && registration.preferredSlotId === slot.id)
        ).length;
        if (count > 0) {
            return `Slot „${slot.name}“ hat noch ${count} ${count === 1 ? 'Anmeldung' : 'Anmeldungen'} – bitte zuerst verschieben.`;
        }
    }
    return null;
}

module.exports = {
    MAX_SLOTS,
    SLOT_NAME_MAX_LENGTH,
    SLOT_CAPACITY_MIN,
    SLOT_CAPACITY_MAX,
    getSlots,
    hasSlots,
    findSlot,
    formatSlotLabel,
    isSingleEmoji,
    sumCapacity,
    normalizeSlots,
    countSlotOccupancy,
    hasFreePlace,
    sanitizeAltSlotIds,
    pickSlot,
    decideStatus,
    pickWaitlistPromotions,
    resolveAcceptanceSlot,
    buildSlotSummary,
    withSlotSummary,
    buildRoster,
    validateSlotChange
};
