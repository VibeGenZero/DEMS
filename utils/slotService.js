/**
 * Role slots of an event (e.g. tank / healer / damage) -> pure rules.
 *
 * Every function works on plain data so the rules can be tested without a
 * database. A slot is `{ id, name, emoji, capacity }`; registrations are
 * plain objects with `id`, `status`, `slotId`, `preferredSlotId`,
 * `altSlotIds`, `userId`, `userName` and `createdAt`.
 */
const crypto = require('crypto');
const { OCCUPYING_STATUSES } = require('./capacity');

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

module.exports = {
    MAX_SLOTS,
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
    pickSlot
};
