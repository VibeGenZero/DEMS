# Rollen-Slots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Events bekommen Rollen-Slots (z. B. 🛡️ Tank 2 · 💚 Heiler 3 · ⚔️ Schaden 10) mit Haupt- und Ausweichrolle, eigener Warteliste pro Slot, einem Button pro Slot in Discord und einer Ankündigung, die sich live aktualisiert.

**Architecture:** Die Regeln liegen als reine Funktionen in `utils/capacity.js` und `utils/slotService.js` (ohne Datenbank testbar). `utils/registrationService.js` und `utils/eventUtils.js` wenden sie unter einer Sperre pro Event (`utils/eventLock.js`) an. Jede Änderung an Anmeldungen ruft `notifyRegistrationsChanged(eventId)` (`utils/announcementRefresh.js`) auf, das gebündelt `refreshEventAnnouncements` in `bot.js` auslöst. Routes, Bot und Frontend nutzen nur diese Bausteine.

**Tech Stack:** Node.js ≥ 22, Express 5, discord.js 14, Firestore-API über `firebaseAdmin.js` (SQLite im Dev-Modus), `node:test`, Vanilla-JS-SPA ohne Build.

**Spec:** `docs/superpowers/specs/2026-10-02-role-slots-design.md`

**Branch:** `feature/role-slots` (bereits angelegt, enthält den Spec-Commit)

## Global Constraints

- Keine neuen npm-Abhängigkeiten. Tests mit `node:test` + `node:assert/strict`, Testfirst (TDD).
- Datenzugriff nur über `firebaseAdmin.js` (`collection`, `doc`, `getDoc`, `getDocs`, `addDoc`, `setDoc`, `updateDoc`, `deleteDoc`, `query`, `where`, `orderBy`, `writeBatch`). Filtern/Sortieren im Speicher, kein `limit`, Datumswerte als ISO-Strings.
- Alles, was Nutzer sehen (UI, `{ error }`-Meldungen, Discord-Texte), auf Deutsch; Code, Kommentare, Commits und Wiki auf Englisch. Kommentarstil wie in `bot.js` (JSDoc, `->`).
- Jeder Route-Handler hat ein eigenes `try/catch` und antwortet mit `res.status(x).json({ error: '<Deutsch>' })`. Admin-Mutationen rufen `addAuditLog(...)`.
- Event-Felder müssen in **beiden** Whitelists (`POST /events` und `PUT /events/:id` in `routes/admin.js`) stehen.
- Neue Discord-Aufrufe nur in exportierten `bot.js`-Helfern mit `if (!isReady) return <neutral>` + `try/catch` und einem loggenden Zwilling in `dev/mockBot.js`. `flags: MessageFlags.Ephemeral`. Event-Links nur über `buildEventUrl(id)`.
- Frontend: globale Funktionen für Inline-`onclick`, jeder eingesetzte Wert durch `escapeHtml`, Meldungen über `showToast(msg, 'success'|'danger'|'warning'|'info')`, schreibende Requests mit Header `X-CSRF-TOKEN: csrfToken`.
- `checkinCode` erscheint in keiner neuen Antwort.
- Grenzen: höchstens **10** Slots, Name **1–30** Zeichen, Plätze **1–100**, Emoji leer oder genau **ein** Unicode-Emoji, Debounce **2000 ms**, im Embed höchstens **5** Namen pro Slot, **5** Buttons pro Discord-Zeile, bei Slot-Events mit mehr als einem Slot höchstens **4** Formularfelder im Discord-Modal.
- Commits: englischer Imperativ-Betreff, Begründung im Body, am Ende
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` und `Claude-Session: https://claude.ai/code/session_018hAdfGQGsteU1Kwt1KHJg7`.
- Große Dateien nie komplett lesen (`public/js/app.js`, `public/css/style.css`, `bot.js`, `public/index.html`, `routes/admin.js`): mit `grep -n "function <name>" <datei>` springen und ~80 Zeilen lesen.

## Review Focus

1. **Mehrere Leute klicken gleichzeitig auf den letzten Platz** (Discord-Ankündigung frisch gepostet): genau eine Zusage, der Rest Ausweichrolle/Warteliste. → Task 7, Test `two simultaneous registrations for the last place get one place`.
2. **Admin bearbeitet ein Event mit Anmeldungen** (Slot entfernen, Slots nachträglich einschalten, Kapazität senken): keine Anmeldung darf verloren gehen oder ohne Slot dastehen. → Task 2 (`validateSlotChange`) und Task 9, Test `a slot that still has registrations cannot be removed`.
3. **Ungültiges Emoji im Slot** (`:shield:`, `abc`, zwei Emojis): Discord würde die komplette Ankündigung ablehnen. → Task 1, Test `normalizeSlots only accepts a single emoji`; Task 8, Test `invalid slots are rejected with a German message`.
4. **Ankündigung wurde in Discord gelöscht**: Live-Aktualisierung darf nicht dauerhaft Fehler werfen, der Eintrag wird verworfen. → Task 5, Test `deleted Discord messages count as gone`.
5. **Events ohne Slots** (inkl. Gäste): verhalten sich wie bisher, das Nachrücken überbucht nicht mehr (known-issue #6). → Task 1 (`pickCapacityPromotions`), Task 6, Test `a waitlisted registration with guests does not overbook a normal event`.

---

## File Structure

| Datei | Verantwortung |
|---|---|
| `utils/capacity.js` | **neu** — Plätze zählen (inkl. Gäste), Nachrücken bei Events ohne Slots |
| `utils/slotService.js` | **neu** — reine Slot-Regeln: Validierung, Belegung, Zuordnung, Nachrücken, Aufstellung, Bearbeitungsprüfung |
| `utils/eventLock.js` | **neu** — `withEventLock(eventId, fn)` |
| `utils/announcementRefresh.js` | **neu** — `notifyRegistrationsChanged`, Debounce, `flushAnnouncementRefreshes` |
| `utils/eventUtils.js` | Anmeldungen/Aufstellung laden, Nachrücken neu |
| `utils/registrationService.js` | Anmelden mit Slot, Selbst-Wechsel, Admin-Verschieben, Abmelden, Template-Variablen |
| `utils/formFields.js` | Modal-Feldgrenze abhängig von Slots |
| `bot.js` | Embed mit Aufstellung, Slot-Buttons, Slot-Modal, Wechsel/Abmelden, Live-Aktualisierung |
| `dev/mockBot.js` | Mock für `refreshEventAnnouncements`, `sendChannelMessage` mit Fake-IDs |
| `routes/admin.js` | Slots anlegen/bearbeiten, Ankündigung speichern, Status/Verschieben/Liste/Export |
| `routes/events.js` | Anmeldung mit Slot, `PUT /:id/register/slot`, Abmelden über Service, Aufstellung, `slotSummary` |
| `routes/user.js` | Account-Löschung: Nachrücken + Aktualisierung |
| `dev/seedData.js` | Raid-Event mit Slots |
| `public/index.html`, `public/js/app.js`, `public/css/style.css` | Wizard-Editor, Karten-Chips, Aufstellung, Slot-Wahl, Admin-Spalte |
| `test/capacity.test.js`, `test/slotService.test.js`, `test/eventLock.test.js`, `test/announcementRefresh.test.js`, `test/eventComponents.test.js`, `test/waitlistPromotion.test.js`, `test/registrationService.test.js` | **neu** |
| `test/mockBot.test.js`, `test/devServer.test.js`, `test/seed.test.js` | erweitert |
| `docs/wiki/**`, `updates.json`, `package.json`, `package-lock.json` | Doku & Release |

Abweichungen von der Spec (bewusst, klein):
- Die Platzzählung inkl. Gäste kommt in ein eigenes reines Modul `utils/capacity.js`, weil `registrationService` (Anmeldung) und `eventUtils` (Nachrücken) sie beide brauchen und sie so ohne Datenbank testbar ist. `pickWaitlistPromotions(slots, registrations)` berechnet die Belegung selbst (statt sie als Parameter zu bekommen).
- Seed: Das Raid-Event bekommt 🛡️ Tank 1 · 💚 Heiler 2 · ⚔️ Schaden 3 (statt 2/3/10), weil der Mock-Server nur vier Raid-Team-Mitglieder hat — nur so zeigt es gleichzeitig einen vollen Slot, eine Ausweichrolle und die Warteliste. Ein Dropdown „Bevorzugte Rolle“ gab es bei diesem Event nie; das Turnier-Event behält seins.
- Der Test für gleichzeitige Anmeldungen liegt im Service-Test (Task 7, deterministisch im selben Prozess) statt im Dev-Server-Test.
- Bei Events ohne Begrenzung (`maxParticipants` 0) rückt beim Nachrücken die ganze Warteliste auf (vorher eine Person pro Aufruf) — konsequent zu „jede Anmeldung, die noch passt“.
- Ankündigungen: höchstens die 5 neuesten Nachrichten pro Event werden live gehalten (begrenzt die Edits pro Änderung).

---

### Task 1: Platzzählung und Slot-Grundregeln

**Files:**
- Create: `utils/capacity.js`
- Create: `utils/slotService.js`
- Test: `test/capacity.test.js`, `test/slotService.test.js`

**Interfaces:**
- Consumes: —
- Produces:
  - `capacity.js`: `OCCUPYING_STATUSES: string[]` (`['pending','accepted']`), `placesOf(registration): number`, `countOccupiedPlaces(registrations): number`, `byCreatedAt(a, b): number`, `pickCapacityPromotions(maxParticipants: number, registrations): string[]` (IDs)
  - `slotService.js`: `MAX_SLOTS = 10`, `getSlots(event): Slot[]`, `hasSlots(event): boolean`, `findSlot(slots, slotId): Slot|null`, `formatSlotLabel(slot): string`, `isSingleEmoji(value): boolean`, `sumCapacity(slots): number`, `normalizeSlots(rawSlots, existingSlots = []): { slots } | { error }`, `countSlotOccupancy(slots, registrations): { [slotId]: number }`, `hasFreePlace(slot, occupancy): boolean`, `sanitizeAltSlotIds(slots, preferredSlotId, altSlotIds): string[]`, `pickSlot(slots, occupancy, preferredSlotId, altSlotIds = []): string|null`
  - `Slot = { id: string, name: string, emoji: string, capacity: number }`; Registrierungen sind Objekte mit `id`, `status`, `slotId`, `preferredSlotId`, `altSlotIds`, `userId`, `userName`, `guests`, `pendingGuests`, `createdAt`.

- [ ] **Step 1: Write the failing tests**

`test/capacity.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { placesOf, countOccupiedPlaces, pickCapacityPromotions } = require('../utils/capacity');

/** Registration with the fields the capacity rules read. */
function registration(id, status, createdAt, fields = {}) {
    return { id, status, createdAt, guests: [], pendingGuests: [], ...fields };
}

test('a registration needs one place per person and per open invitation', () => {
    const withGuests = registration('r1', 'accepted', '2026-10-01T10:00:00.000Z', {
        guests: ['g1'],
        pendingGuests: [{ userId: 'g1', status: 'accepted' }, { userId: 'g2', status: 'pending' }]
    });
    assert.equal(placesOf(withGuests), 3);
    assert.equal(placesOf({ status: 'accepted' }), 1);
});

test('only pending and accepted registrations occupy places', () => {
    const registrations = [
        registration('a', 'accepted', '1', { guests: ['g1'] }),
        registration('b', 'pending', '2'),
        registration('c', 'waitlisted', '3'),
        registration('d', 'rejected', '4')
    ];
    assert.equal(countOccupiedPlaces(registrations), 3);
});

test('a waitlisted registration with guests does not block a single person behind it', () => {
    const registrations = [
        registration('accepted', 'accepted', '2026-10-01T09:00:00.000Z'),
        registration('withGuest', 'waitlisted', '2026-10-01T10:00:00.000Z', { guests: ['g1'] }),
        registration('single', 'waitlisted', '2026-10-01T11:00:00.000Z')
    ];
    assert.deepEqual(pickCapacityPromotions(2, registrations), ['single']);
});

test('several registrations move up when enough places are free', () => {
    const registrations = [
        registration('accepted', 'accepted', '2026-10-01T09:00:00.000Z'),
        registration('w3', 'waitlisted', '2026-10-01T12:00:00.000Z'),
        registration('w1', 'waitlisted', '2026-10-01T10:00:00.000Z'),
        registration('w2', 'waitlisted', '2026-10-01T11:00:00.000Z')
    ];
    assert.deepEqual(pickCapacityPromotions(3, registrations), ['w1', 'w2']);
    assert.deepEqual(pickCapacityPromotions(0, registrations), ['w1', 'w2', 'w3']);
});
```

`test/slotService.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    MAX_SLOTS, getSlots, hasSlots, findSlot, formatSlotLabel, isSingleEmoji, sumCapacity,
    normalizeSlots, countSlotOccupancy, sanitizeAltSlotIds, pickSlot
} = require('../utils/slotService');

const SLOTS = [
    { id: 'tank', name: 'Tank', emoji: '🛡️', capacity: 1 },
    { id: 'heal', name: 'Heiler', emoji: '💚', capacity: 2 },
    { id: 'dps', name: 'Schaden', emoji: '⚔️', capacity: 3 }
];

test('events without slots have an empty slot list', () => {
    assert.deepEqual(getSlots({}), []);
    assert.deepEqual(getSlots(null), []);
    assert.equal(hasSlots({ slots: [] }), false);
    assert.equal(hasSlots({ slots: SLOTS }), true);
    assert.equal(findSlot(SLOTS, 'heal').name, 'Heiler');
    assert.equal(findSlot(SLOTS, 'nope'), null);
    assert.equal(sumCapacity(SLOTS), 6);
});

test('slot labels show the emoji when there is one', () => {
    assert.equal(formatSlotLabel(SLOTS[0]), '🛡️ Tank');
    assert.equal(formatSlotLabel({ name: 'Flex', emoji: '' }), 'Flex');
    assert.equal(formatSlotLabel(null), '');
});

test('normalizeSlots trims names, keeps known IDs and creates new ones', () => {
    const result = normalizeSlots([
        { id: 'tank', name: ' Tank ', emoji: '🛡️', capacity: '2' },
        { id: 'forged', name: 'Heiler', emoji: '', capacity: 3 }
    ], SLOTS);

    assert.equal(result.error, undefined);
    assert.deepEqual(result.slots[0], { id: 'tank', name: 'Tank', emoji: '🛡️', capacity: 2 });
    assert.notEqual(result.slots[1].id, 'forged');
    assert.match(result.slots[1].id, /^[0-9a-f]{8}$/);
    assert.equal(result.slots[1].emoji, '');
});

test('normalizeSlots treats a missing value as no slots', () => {
    assert.deepEqual(normalizeSlots(undefined), { slots: [] });
    assert.deepEqual(normalizeSlots(null), { slots: [] });
    assert.deepEqual(normalizeSlots([]), { slots: [] });
});

test('normalizeSlots rejects invalid input with a German message', () => {
    const tooMany = Array.from({ length: MAX_SLOTS + 1 }, (_, i) => ({ name: `Slot ${i}`, capacity: 1 }));
    const cases = [
        ['nope', 'Slots müssen eine Liste sein.'],
        [tooMany, 'Es sind höchstens 10 Slots erlaubt.'],
        [[{ name: '  ', capacity: 1 }], 'Jeder Slot braucht einen Namen mit 1–30 Zeichen.'],
        [[{ name: 'x'.repeat(31), capacity: 1 }], 'Jeder Slot braucht einen Namen mit 1–30 Zeichen.'],
        [[{ name: 'Tank', capacity: 1 }, { name: 'tank', capacity: 1 }], 'Slot-Name „tank“ ist doppelt vergeben.'],
        [[{ name: 'Tank', capacity: 0 }], 'Slot „Tank“ braucht 1–100 Plätze.'],
        [[{ name: 'Tank', capacity: 101 }], 'Slot „Tank“ braucht 1–100 Plätze.'],
        [[{ name: 'Tank', capacity: 2.5 }], 'Slot „Tank“ braucht 1–100 Plätze.']
    ];
    for (const [input, message] of cases) {
        assert.deepEqual(normalizeSlots(input), { error: message });
    }
});

test('normalizeSlots only accepts a single emoji', () => {
    for (const emoji of ['🛡️', '💚', '⚔️', '👩‍🚀', '👍🏽']) {
        assert.equal(isSingleEmoji(emoji), true, emoji);
    }
    for (const emoji of ['abc', '🛡️🛡️', ':shield:', 'T']) {
        assert.equal(isSingleEmoji(emoji), false, emoji);
        assert.deepEqual(
            normalizeSlots([{ name: 'Tank', emoji, capacity: 1 }]),
            { error: 'Das Emoji von Slot „Tank“ muss ein einzelnes Emoji sein.' }
        );
    }
});

test('slot occupancy counts pending and accepted registrations only', () => {
    const occupancy = countSlotOccupancy(SLOTS, [
        { status: 'accepted', slotId: 'tank' },
        { status: 'pending', slotId: 'heal' },
        { status: 'waitlisted', slotId: null },
        { status: 'rejected', slotId: 'heal' },
        { status: 'accepted', slotId: 'removed-slot' }
    ]);
    assert.deepEqual(occupancy, { tank: 1, heal: 1, dps: 0 });
});

test('alternatives are cleaned and sorted in slot order', () => {
    assert.deepEqual(sanitizeAltSlotIds(SLOTS, 'tank', ['dps', 'tank', 'unknown', 'heal', 'dps']), ['heal', 'dps']);
    assert.deepEqual(sanitizeAltSlotIds(SLOTS, 'tank', 'heal'), []);
});

test('pickSlot prefers the main role, then the first free alternative', () => {
    assert.equal(pickSlot(SLOTS, { tank: 0, heal: 0, dps: 0 }, 'tank', ['heal']), 'tank');
    assert.equal(pickSlot(SLOTS, { tank: 1, heal: 0, dps: 0 }, 'tank', ['heal', 'dps']), 'heal');
    assert.equal(pickSlot(SLOTS, { tank: 1, heal: 2, dps: 0 }, 'tank', ['heal', 'dps']), 'dps');
    assert.equal(pickSlot(SLOTS, { tank: 1, heal: 2, dps: 3 }, 'tank', ['heal', 'dps']), null);
    assert.equal(pickSlot(SLOTS, { tank: 1, heal: 0, dps: 0 }, 'tank'), null);
    assert.equal(pickSlot(SLOTS, { tank: 0, heal: 0, dps: 0 }, 'gone', ['dps']), 'dps');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/capacity.test.js test/slotService.test.js`
Expected: FAIL with `Cannot find module '../utils/capacity'` / `'../utils/slotService'`.

- [ ] **Step 3: Implement `utils/capacity.js`**

```js
/**
 * Capacity counting shared by registrations and waitlist promotion.
 *
 * A registration occupies one place for the registrant, one per confirmed
 * guest and one per guest invitation that is still open -> an invitation
 * reserves its place until the guest answers.
 */

/** Registration statuses that occupy a place. */
const OCCUPYING_STATUSES = ['pending', 'accepted'];

/**
 * Number of places a single registration needs.
 *
 * @param {Object} registration -> Registration document data.
 * @returns {number} -> 1 + confirmed guests + open guest invitations.
 */
function placesOf(registration) {
    const confirmedGuests = Array.isArray(registration.guests) ? registration.guests.length : 0;
    const openInvitations = Array.isArray(registration.pendingGuests)
        ? registration.pendingGuests.filter(guest => guest.status === 'pending').length
        : 0;
    return 1 + confirmedGuests + openInvitations;
}

/**
 * Count the places that are currently taken at an event.
 *
 * @param {Array<Object>} registrations -> All registrations of the event.
 * @returns {number} -> Occupied places including guests.
 */
function countOccupiedPlaces(registrations) {
    return registrations
        .filter(registration => OCCUPYING_STATUSES.includes(registration.status))
        .reduce((sum, registration) => sum + placesOf(registration), 0);
}

/**
 * Sort comparator -> oldest registration first.
 *
 * @param {Object} a -> Registration.
 * @param {Object} b -> Registration.
 * @returns {number} -> Negative when `a` is older.
 */
function byCreatedAt(a, b) {
    return (a.createdAt || '').localeCompare(b.createdAt || '');
}

/**
 * Decide which waitlisted registrations of an event without slots move up.
 *
 * The waitlist is walked oldest first and every registration whose places
 * still fit moves up -> a registration with guests that does not fit yet
 * does not block a single person behind it.
 *
 * @param {number} maxParticipants -> Capacity of the event, 0 = unlimited.
 * @param {Array<Object>} registrations -> All registrations of the event.
 * @returns {string[]} -> IDs of the registrations that move up, oldest first.
 * @example
 * pickCapacityPromotions(10, registrations); // ['reg1', 'reg4']
 */
function pickCapacityPromotions(maxParticipants, registrations) {
    let occupied = countOccupiedPlaces(registrations);
    const promoted = [];

    registrations
        .filter(registration => registration.status === 'waitlisted')
        .sort(byCreatedAt)
        .forEach(registration => {
            const needed = placesOf(registration);
            if (maxParticipants > 0 && occupied + needed > maxParticipants) return;
            occupied += needed;
            promoted.push(registration.id);
        });

    return promoted;
}

module.exports = {
    OCCUPYING_STATUSES,
    placesOf,
    countOccupiedPlaces,
    byCreatedAt,
    pickCapacityPromotions
};
```

- [ ] **Step 4: Implement `utils/slotService.js` (part 1)**

```js
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/capacity.test.js test/slotService.test.js`
Expected: PASS (all tests).

- [ ] **Step 6: Commit**

```bash
git add utils/capacity.js utils/slotService.js test/capacity.test.js test/slotService.test.js
git commit -m "Add the place counting and the basic slot rules" -m "Role slots need validation, per-slot occupancy and the main/fallback choice; the place counting including guests is shared with the waitlist so both use the same numbers." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018hAdfGQGsteU1Kwt1KHJg7"
```

---

### Task 2: Slot-Regeln für Nachrücken, Aufstellung und Bearbeiten

**Files:**
- Modify: `utils/slotService.js`
- Test: `test/slotService.test.js`

**Interfaces:**
- Consumes: Task 1 (`countSlotOccupancy`, `pickSlot`, `findSlot`, `getSlots`, `hasSlots`; `capacity.byCreatedAt`, `capacity.countOccupiedPlaces`, `capacity.OCCUPYING_STATUSES`)
- Produces:
  - `pickWaitlistPromotions(slots, registrations): Array<{ registrationId: string, slotId: string }>`
  - `resolveAcceptanceSlot(slots, registrations, registration): { slotId: string, overbooked: boolean }`
  - `buildSlotSummary(slots, registrations): Array<{ id, name, emoji, capacity, taken }>`
  - `withSlotSummary(event, registrations): Object` (Event + `slotSummary`, unverändert ohne Slots)
  - `buildRoster(event, registrations, usersById = {}): Roster` mit `Roster = { taken: number, capacity: number, waitlistCount: number, slots: Array<{ id, name, emoji, capacity, taken, members: Array<{ displayName, avatar, pending, isAlt }> }>, waitlist: Array<{ displayName, avatar, preferredSlotId, altSlotIds }> }`
  - `validateSlotChange({ oldSlots, newSlots, registrations }): string|null`

- [ ] **Step 1: Write the failing tests** (an `test/slotService.test.js` anhängen; Import-Zeile oben um die neuen Namen erweitern)

```js
const {
    pickWaitlistPromotions, resolveAcceptanceSlot, buildSlotSummary, withSlotSummary,
    buildRoster, validateSlotChange
} = require('../utils/slotService');

/** Registration for the slot rules. */
function slotReg(id, status, slotId, createdAt, fields = {}) {
    return {
        id, status, slotId, createdAt,
        preferredSlotId: slotId, altSlotIds: [],
        userId: `user-${id}`, userName: `Name ${id}`,
        guests: [], pendingGuests: [],
        ...fields
    };
}

test('the oldest matching waitlist entry moves into a free slot', () => {
    const registrations = [
        slotReg('a', 'accepted', 'tank', '2026-10-01T08:00:00.000Z'),
        slotReg('b', 'accepted', 'heal', '2026-10-01T08:30:00.000Z'),
        slotReg('wTank', 'waitlisted', null, '2026-10-01T09:00:00.000Z', { preferredSlotId: 'tank' }),
        slotReg('wHeal', 'waitlisted', null, '2026-10-01T10:00:00.000Z', { preferredSlotId: 'heal' })
    ];
    assert.deepEqual(pickWaitlistPromotions(SLOTS, registrations), [{ registrationId: 'wHeal', slotId: 'heal' }]);
});

test('waitlist entries move into their alternatives and several can move at once', () => {
    const registrations = [
        slotReg('a', 'accepted', 'tank', '2026-10-01T08:00:00.000Z'),
        slotReg('w1', 'waitlisted', null, '2026-10-01T09:00:00.000Z', { preferredSlotId: 'tank', altSlotIds: ['dps'] }),
        slotReg('w2', 'waitlisted', null, '2026-10-01T10:00:00.000Z', { preferredSlotId: 'dps' }),
        slotReg('w3', 'waitlisted', null, '2026-10-01T11:00:00.000Z', { preferredSlotId: 'gone', altSlotIds: ['heal'] })
    ];
    assert.deepEqual(pickWaitlistPromotions(SLOTS, registrations), [
        { registrationId: 'w1', slotId: 'dps' },
        { registrationId: 'w2', slotId: 'dps' },
        { registrationId: 'w3', slotId: 'heal' }
    ]);
});

test('nobody moves into an overbooked slot', () => {
    const registrations = [
        slotReg('a', 'accepted', 'tank', '1'),
        slotReg('b', 'accepted', 'tank', '2'),
        slotReg('w', 'waitlisted', null, '3', { preferredSlotId: 'tank' })
    ];
    assert.deepEqual(pickWaitlistPromotions(SLOTS, registrations), []);
});

test('accepting picks a free wanted slot, otherwise the main role overbooked', () => {
    const registrations = [
        slotReg('a', 'accepted', 'tank', '1'),
        slotReg('w', 'waitlisted', null, '2', { preferredSlotId: 'tank', altSlotIds: ['heal'] })
    ];
    assert.deepEqual(resolveAcceptanceSlot(SLOTS, registrations, registrations[1]), { slotId: 'heal', overbooked: false });

    const noAlternative = { ...registrations[1], altSlotIds: [] };
    assert.deepEqual(resolveAcceptanceSlot(SLOTS, registrations, noAlternative), { slotId: 'tank', overbooked: true });
});

test('the slot summary counts the taken places', () => {
    const registrations = [slotReg('a', 'accepted', 'tank', '1'), slotReg('b', 'pending', 'dps', '2')];
    assert.deepEqual(buildSlotSummary(SLOTS, registrations), [
        { id: 'tank', name: 'Tank', emoji: '🛡️', capacity: 1, taken: 1 },
        { id: 'heal', name: 'Heiler', emoji: '💚', capacity: 2, taken: 0 },
        { id: 'dps', name: 'Schaden', emoji: '⚔️', capacity: 3, taken: 1 }
    ]);
    assert.equal('slotSummary' in withSlotSummary({ title: 'x' }, registrations), false);
    assert.equal(withSlotSummary({ title: 'x', slots: SLOTS }, registrations).slotSummary.length, 3);
});

test('the roster lists members per slot and the waitlist in order', () => {
    const registrations = [
        slotReg('a', 'accepted', 'tank', '1'),
        slotReg('b', 'pending', 'heal', '2', { preferredSlotId: 'tank', altSlotIds: ['heal'] }),
        slotReg('w2', 'waitlisted', null, '4', { preferredSlotId: 'dps' }),
        slotReg('w1', 'waitlisted', null, '3', { preferredSlotId: 'tank', altSlotIds: ['heal'] }),
        slotReg('r', 'rejected', 'dps', '5')
    ];
    const usersById = { 'user-a': { displayName: 'Anna', avatar: 'https://cdn.example/a.png' } };
    const roster = buildRoster({ slots: SLOTS, maxParticipants: 6 }, registrations, usersById);

    assert.equal(roster.taken, 2);
    assert.equal(roster.capacity, 6);
    assert.equal(roster.waitlistCount, 2);
    assert.deepEqual(roster.slots[0].members, [{ displayName: 'Anna', avatar: 'https://cdn.example/a.png', pending: false, isAlt: false }]);
    assert.deepEqual(roster.slots[1].members, [{ displayName: 'Name b', avatar: '', pending: true, isAlt: true }]);
    assert.equal(roster.slots[2].taken, 0);
    assert.deepEqual(roster.waitlist.map(entry => entry.displayName), ['Name w1', 'Name w2']);
    assert.deepEqual(roster.waitlist[0].altSlotIds, ['heal']);
});

test('the roster of a normal event counts guests and has no slots', () => {
    const registrations = [slotReg('a', 'accepted', undefined, '1', { guests: ['g1'] }), slotReg('w', 'waitlisted', undefined, '2')];
    const roster = buildRoster({ maxParticipants: 10 }, registrations);
    assert.deepEqual(roster, { taken: 2, capacity: 10, waitlistCount: 1, slots: [], waitlist: [] });
    assert.equal(buildRoster({ maxParticipants: 0 }, []).capacity, 0);
});

test('a slot that still has registrations cannot be removed', () => {
    const registrations = [slotReg('a', 'accepted', 'tank', '1'), slotReg('b', 'pending', 'tank', '2')];
    assert.equal(
        validateSlotChange({ oldSlots: SLOTS, newSlots: SLOTS.slice(1), registrations }),
        'Slot „Tank“ hat noch 2 Anmeldungen – bitte zuerst verschieben.'
    );
    assert.equal(validateSlotChange({ oldSlots: SLOTS, newSlots: SLOTS.slice(0, 2), registrations }), null);
    assert.equal(validateSlotChange({ oldSlots: SLOTS, newSlots: [], registrations }), null);
});

test('slots can only be switched on while nobody is registered', () => {
    const open = [slotReg('a', 'waitlisted', undefined, '1')];
    const rejectedOnly = [slotReg('a', 'rejected', undefined, '1')];
    assert.equal(
        validateSlotChange({ oldSlots: [], newSlots: SLOTS, registrations: open }),
        'Slots können nur aktiviert werden, solange es keine Anmeldungen gibt.'
    );
    assert.equal(validateSlotChange({ oldSlots: [], newSlots: SLOTS, registrations: rejectedOnly }), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/slotService.test.js`
Expected: FAIL with `pickWaitlistPromotions is not a function`.

- [ ] **Step 3: Implement** — in `utils/slotService.js` den Import auf `const { OCCUPYING_STATUSES, countOccupiedPlaces, byCreatedAt } = require('./capacity');` ändern, vor `module.exports` einfügen und die neuen Namen exportieren:

```js
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

    const fallback = findSlot(slots, registration.preferredSlotId) || slots[0];
    return { slotId: fallback.id, overbooked: true };
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
 * @returns {Object} -> `{ taken, capacity, waitlistCount, slots, waitlist }`.
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

    return {
        taken: countOccupiedPlaces(registrations),
        capacity: event.maxParticipants > 0 ? event.maxParticipants : 0,
        waitlistCount: waitlisted.length,
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
    const occupancy = countSlotOccupancy(oldSlots, registrations);
    for (const slot of oldSlots) {
        const count = occupancy[slot.id] || 0;
        if (!keptIds.has(slot.id) && count > 0) {
            return `Slot „${slot.name}“ hat noch ${count} ${count === 1 ? 'Anmeldung' : 'Anmeldungen'} – bitte zuerst verschieben.`;
        }
    }
    return null;
}
```

`module.exports` ergänzen um: `pickWaitlistPromotions, resolveAcceptanceSlot, buildSlotSummary, withSlotSummary, buildRoster, validateSlotChange`.

Hinweis: Wird ein normales Event (`oldSlots` leer) wieder ohne Slots gespeichert oder ein Slot-Event ganz auf „ohne Slots“ umgestellt, liefert `validateSlotChange` `null` (Spec: „Slot-Event → normales Event: erlaubt“).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/slotService.test.js test/capacity.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add utils/slotService.js test/slotService.test.js
git commit -m "Add the slot rules for promotion, line-up and editing" -m "Waitlist promotion, manual acceptance, the event page line-up and the event editor all need the same per-slot view of the registrations." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018hAdfGQGsteU1Kwt1KHJg7"
```

---

### Task 3: Sperre pro Event und gebündelte Embed-Aktualisierung

**Files:**
- Create: `utils/eventLock.js`, `utils/announcementRefresh.js`
- Test: `test/eventLock.test.js`, `test/announcementRefresh.test.js`

**Interfaces:**
- Consumes: — (der Standard-Refresher ruft lazy `require('../bot').refreshEventAnnouncements(eventId)`, das in Task 5 entsteht; bis dahin wird nur ein Fehler geloggt, nichts geworfen)
- Produces:
  - `withEventLock(eventId: string, fn: () => Promise<T>): Promise<T>` — nicht reentrant
  - `createAnnouncementRefresher({ refresh, delayMs }): { notify(eventId), flush(): Promise<void> }`
  - `notifyRegistrationsChanged(eventId): void`, `flushAnnouncementRefreshes(): Promise<void>`, `ANNOUNCEMENT_REFRESH_DELAY_MS = 2000`

- [ ] **Step 1: Write the failing tests**

`test/eventLock.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withEventLock } = require('../utils/eventLock');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

test('work for the same event runs one after another', async () => {
    const steps = [];
    await Promise.all([
        withEventLock('event-a', async () => { steps.push('first-start'); await sleep(30); steps.push('first-end'); }),
        withEventLock('event-a', async () => { steps.push('second-start'); steps.push('second-end'); })
    ]);
    assert.deepEqual(steps, ['first-start', 'first-end', 'second-start', 'second-end']);
});

test('different events do not wait for each other', async () => {
    const steps = [];
    await Promise.all([
        withEventLock('event-b', async () => { await sleep(40); steps.push('b'); }),
        withEventLock('event-c', async () => { steps.push('c'); })
    ]);
    assert.deepEqual(steps, ['c', 'b']);
});

test('a failing task passes its error on and releases the lock', async () => {
    const failing = withEventLock('event-d', async () => { throw new Error('kaputt'); });
    const next = withEventLock('event-d', async () => 'weiter');
    await assert.rejects(failing, /kaputt/);
    assert.equal(await next, 'weiter');
});
```

`test/announcementRefresh.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAnnouncementRefresher } = require('../utils/announcementRefresh');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

test('changes in a burst lead to one refresh per event', async () => {
    const calls = [];
    const refresher = createAnnouncementRefresher({ refresh: async (eventId) => calls.push(eventId), delayMs: 20 });
    refresher.notify('e1');
    refresher.notify('e1');
    refresher.notify('e2');
    refresher.notify('e1');
    await sleep(80);
    assert.deepEqual(calls.sort(), ['e1', 'e2']);
});

test('flush runs pending refreshes at once', async () => {
    const calls = [];
    const refresher = createAnnouncementRefresher({ refresh: async (eventId) => calls.push(eventId), delayMs: 30 });
    refresher.notify('e1');
    await refresher.flush();
    assert.deepEqual(calls, ['e1']);
    await sleep(60);
    assert.deepEqual(calls, ['e1']);
});

test('a failing refresh is logged, not thrown', async () => {
    const original = console.error;
    const logged = [];
    console.error = (...args) => logged.push(args.join(' '));
    try {
        const refresher = createAnnouncementRefresher({ refresh: async () => { throw new Error('Discord weg'); }, delayMs: 10 });
        refresher.notify('e1');
        await refresher.flush();
    } finally {
        console.error = original;
    }
    assert.ok(logged.some(line => line.includes('Discord weg')));
});

test('calls without an event ID are ignored', async () => {
    const calls = [];
    const refresher = createAnnouncementRefresher({ refresh: async (eventId) => calls.push(eventId), delayMs: 10 });
    refresher.notify('');
    refresher.notify(undefined);
    await refresher.flush();
    assert.deepEqual(calls, []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/eventLock.test.js test/announcementRefresh.test.js`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement `utils/eventLock.js`**

```js
/**
 * Serialize work per event inside this process.
 *
 * DEMS runs as one Node.js process, so an in-memory promise chain per event
 * is enough to stop two registrations from taking the same last place.
 * The lock is NOT reentrant -> code that already holds it must not call
 * withEventLock() for the same event again, it would wait for itself.
 */
const chains = new Map();

/**
 * Run `fn` once all earlier work for the same event has finished.
 *
 * @param {string} eventId -> The event document ID.
 * @param {Function} fn -> Async work to run exclusively.
 * @returns {Promise<*>} -> Result (or error) of `fn`.
 * @example
 * const result = await withEventLock(eventId, () => createRegistration(params));
 */
function withEventLock(eventId, fn) {
    const previous = chains.get(eventId) || Promise.resolve();
    const result = previous.then(() => fn());
    const tail = result.then(() => undefined, () => undefined);
    chains.set(eventId, tail);
    tail.then(() => {
        if (chains.get(eventId) === tail) chains.delete(eventId);
    });
    return result;
}

module.exports = { withEventLock };
```

- [ ] **Step 4: Implement `utils/announcementRefresh.js`**

```js
/**
 * Keep the Discord announcements of an event up to date.
 *
 * Every change to the registrations calls notifyRegistrationsChanged(). The
 * calls are bundled per event (trailing debounce), so a wave of sign-ups
 * right after an announcement edits the message only once and stays clear
 * of Discord's rate limits.
 */

/** Quiet time after the last change before the announcement is edited. */
const ANNOUNCEMENT_REFRESH_DELAY_MS = 2000;

/**
 * Create a debounced refresher.
 *
 * @param {Object} options -> Refresher options.
 * @param {Function} options.refresh -> Async function receiving the event ID.
 * @param {number} [options.delayMs] -> Debounce delay in milliseconds.
 * @returns {{ notify: Function, flush: Function }} -> Refresher API.
 */
function createAnnouncementRefresher({ refresh, delayMs = ANNOUNCEMENT_REFRESH_DELAY_MS }) {
    const timers = new Map();

    async function run(eventId) {
        timers.delete(eventId);
        try {
            await refresh(eventId);
        } catch (err) {
            console.error('[announcementRefresh] refresh failed:', err.message);
        }
    }

    function notify(eventId) {
        if (!eventId) return;
        clearTimeout(timers.get(eventId));
        const timer = setTimeout(() => run(eventId), delayMs);
        // A pending refresh must never keep the process (or a test) alive
        if (typeof timer.unref === 'function') timer.unref();
        timers.set(eventId, timer);
    }

    async function flush() {
        const eventIds = [...timers.keys()];
        eventIds.forEach(eventId => clearTimeout(timers.get(eventId)));
        await Promise.all(eventIds.map(run));
    }

    return { notify, flush };
}

// bot.js is required lazily -> it requires the registration helpers itself
const defaultRefresher = createAnnouncementRefresher({
    refresh: (eventId) => require('../bot').refreshEventAnnouncements(eventId)
});

module.exports = {
    ANNOUNCEMENT_REFRESH_DELAY_MS,
    createAnnouncementRefresher,
    notifyRegistrationsChanged: defaultRefresher.notify,
    flushAnnouncementRefreshes: defaultRefresher.flush
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/eventLock.test.js test/announcementRefresh.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add utils/eventLock.js utils/announcementRefresh.js test/eventLock.test.js test/announcementRefresh.test.js
git commit -m "Add a per-event lock and a debounced announcement refresher" -m "Simultaneous clicks on the last slot must not both win, and a wave of sign-ups should edit the Discord announcement once instead of hitting rate limits." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018hAdfGQGsteU1Kwt1KHJg7"
```

---

### Task 4: Aufstellung laden, Embed und Buttons mit Slots

**Files:**
- Modify: `utils/eventUtils.js` (Lade-Helfer), `utils/formFields.js` (`getModalFieldLimit`), `bot.js` (`buildEventEmbed`, `buildEventComponents`, neuer `buildSlotButton`)
- Test: `test/eventComponents.test.js` (neu)

**Interfaces:**
- Consumes: Task 1/2 (`getSlots`, `hasSlots`, `formatSlotLabel`, `buildRoster`)
- Produces:
  - `eventUtils.loadEventRegistrations(eventId): Promise<Array<{ id, ...data }>>`
  - `eventUtils.findUserRegistration(eventId, userId): Promise<Object|null>`
  - `eventUtils.loadEventRoster(eventId, event, { withProfiles = false } = {}): Promise<Roster>`
  - `formFields.getModalFieldLimit(event): number` (5, bzw. 4 bei mehr als einem Slot); `fitsIntoDiscordModal` nutzt ihn
  - `bot.buildEventEmbed(event, registrationLink, roster?)`, `bot.buildEventComponents(event, eventId, roster?)` — Custom-ID `event_slot:<eventId>:<slotId>`

- [ ] **Step 1: Write the failing tests** — `test/eventComponents.test.js`:

```js
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir } = require('./helpers');

// Mock mode with an own database; the empty cwd keeps a local .env out
const tmpDir = createTempDir('event-components');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'components.sqlite');

const bot = require('../bot');
const { fitsIntoDiscordModal, getModalFieldLimit } = require('../utils/formFields');
const { buildRoster } = require('../utils/slotService');

after(async () => {
    await bot.client.destroy();
});

const SLOTS = [
    { id: 'tank', name: 'Tank', emoji: '🛡️', capacity: 2 },
    { id: 'heal', name: 'Heiler', emoji: '💚', capacity: 2 },
    { id: 'dps', name: 'Schaden', emoji: '⚔️', capacity: 3 }
];
const BUTTON_STYLE = { PRIMARY: 1, SECONDARY: 2, SUCCESS: 3, LINK: 5 };

const slotEvent = (fields = {}) => ({ title: 'Raid', status: 'active', slots: SLOTS, maxParticipants: 7, formFields: [], ...fields });
const buttonsOf = (components) => components.map(row => row.toJSON().components);
const textField = (label) => ({ label, type: 'text', required: false });
let regCounter = 0;
const member = (slotId, name, status = 'accepted') => ({
    id: `r${++regCounter}`, status, slotId, preferredSlotId: slotId, altSlotIds: [],
    userId: `u${regCounter}`, userName: name, createdAt: String(regCounter), guests: [], pendingGuests: []
});

test('slot events get one button per slot and the link button last', () => {
    const [row] = buttonsOf(bot.buildEventComponents(slotEvent(), 'evt1'));
    assert.deepEqual(row.map(button => button.custom_id).slice(0, 3), ['event_slot:evt1:tank', 'event_slot:evt1:heal', 'event_slot:evt1:dps']);
    assert.deepEqual(row.map(button => button.label), ['Tank', 'Heiler', 'Schaden', 'Zum Event']);
    assert.equal(row[0].emoji.name, '🛡️');
    assert.equal(row[0].style, BUTTON_STYLE.PRIMARY);
    assert.equal(row[3].style, BUTTON_STYLE.LINK);
    assert.ok(row[3].url.endsWith('#event/evt1'));
});

test('a full slot is marked but stays clickable', () => {
    const event = slotEvent();
    const roster = buildRoster(event, [member('tank', 'Ana'), member('tank', 'Ben')]);
    const [row] = buttonsOf(bot.buildEventComponents(event, 'evt1', roster));
    assert.equal(row[0].label, 'Tank (voll)');
    assert.equal(row[0].style, BUTTON_STYLE.SECONDARY);
    assert.equal(row[0].disabled, undefined);
    assert.equal(row[1].style, BUTTON_STYLE.PRIMARY);
});

test('ten slots are spread over rows of five buttons', () => {
    const slots = Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, name: `Slot ${i}`, emoji: '', capacity: 1 }));
    const rows = buttonsOf(bot.buildEventComponents(slotEvent({ slots }), 'evt1'));
    assert.deepEqual(rows.map(row => row.length), [5, 5, 1]);
    assert.equal(rows[2][0].style, BUTTON_STYLE.LINK);
});

test('inactive slot events only keep the link button', () => {
    const rows = buttonsOf(bot.buildEventComponents(slotEvent({ status: 'archived' }), 'evt1'));
    assert.deepEqual(rows.map(row => row.length), [1]);
});

test('the fallback select takes one modal place away from the form', () => {
    assert.equal(getModalFieldLimit(slotEvent()), 4);
    assert.equal(getModalFieldLimit(slotEvent({ slots: [SLOTS[0]] })), 5);
    assert.equal(getModalFieldLimit({}), 5);

    const fourFields = ['A', 'B', 'C', 'D'].map(textField);
    assert.equal(fitsIntoDiscordModal(slotEvent({ formFields: fourFields })), true);
    const fiveFields = [...fourFields, textField('E')];
    assert.equal(fitsIntoDiscordModal(slotEvent({ formFields: fiveFields })), false);
    assert.equal(fitsIntoDiscordModal(slotEvent({ slots: [SLOTS[0]], formFields: fiveFields })), true);

    const rows = buttonsOf(bot.buildEventComponents(slotEvent({ formFields: fiveFields }), 'evt1'));
    assert.deepEqual(rows.map(row => row.map(button => button.label)), [['Zum Event']]);
});

test('normal events keep the register button', () => {
    const [row] = buttonsOf(bot.buildEventComponents({ title: 'Abend', status: 'active' }, 'evt2'));
    assert.deepEqual(row.map(button => button.label), ['Anmelden', 'Zum Event']);
    assert.equal(row[0].custom_id, 'event_register:evt2');
});

test('the embed shows the line-up per slot', () => {
    const event = slotEvent();
    const registrations = [
        member('tank', 'Ana'), member('tank', '*Star*'),
        ...['C1', 'C2', 'C3', 'C4', 'C5', 'C6'].map(name => member('dps', name)),
        member(null, 'Wartend', 'waitlisted')
    ];
    const fields = bot.buildEventEmbed(event, 'https://dems.example/#event/evt1', buildRoster(event, registrations)).toJSON().fields;
    const byName = Object.fromEntries(fields.map(field => [field.name, field.value]));

    assert.equal(byName['👥 Teilnehmer'], '8/7');
    assert.equal(byName['🛡️ Tank 2/2 ✅'], 'Ana, \\*Star\\*');
    assert.equal(byName['💚 Heiler 0/2'], '— frei —');
    assert.equal(byName['⚔️ Schaden 6/3 ⚠️'], 'C1, C2, C3, C4, C5, +1');
    assert.equal(byName['⏳ Warteliste'], '1');
});

test('normal events show the live participant count', () => {
    const registrations = [member(undefined, 'A'), member(undefined, 'B'), member(undefined, 'C')];
    const limited = { title: 'Abend', status: 'active', maxParticipants: 10 };
    const unlimited = { title: 'Abend', status: 'active', maxParticipants: 0 };
    const valueOf = (embed) => embed.toJSON().fields.find(field => field.name === '👥 Teilnehmer').value;

    assert.equal(valueOf(bot.buildEventEmbed(limited, '', buildRoster(limited, registrations))), '3/10');
    assert.equal(valueOf(bot.buildEventEmbed(unlimited, '', buildRoster(unlimited, registrations))), '3 (unbegrenzt)');
    assert.equal(valueOf(bot.buildEventEmbed(limited)), 'Max. 10');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/eventComponents.test.js`
Expected: FAIL (`getModalFieldLimit is not a function` / Buttons ohne Slot-IDs).

- [ ] **Step 3: Modal-Grenze in `utils/formFields.js`**

Oben nach dem Kopfkommentar: `const { getSlots } = require('./slotService');`. Vor `fitsIntoDiscordModal` einfügen und `fitsIntoDiscordModal` anpassen:

```js
/**
 * Number of form fields that fit into the Discord modal of an event.
 *
 * Slot events with more than one slot show a select for the fallback roles,
 * which takes one of the five top level components.
 *
 * @param {Object} event -> The event document data.
 * @returns {number} -> Maximum number of form fields.
 */
function getModalFieldLimit(event) {
    return getSlots(event).length > 1 ? MODAL_MAX_FIELDS - 1 : MODAL_MAX_FIELDS;
}
```

In `fitsIntoDiscordModal`: `if (formFields.length > MODAL_MAX_FIELDS) return false;` → `if (formFields.length > getModalFieldLimit(event)) return false;`. `getModalFieldLimit` exportieren.

- [ ] **Step 4: Lade-Helfer in `utils/eventUtils.js`**

Import-Zeilen oben ersetzen durch:

```js
const { db, collection, doc, getDocs, addDoc, updateDoc, query, where } = require('../firebaseAdmin');
const { sendDM, assignRole } = require('../bot');
const { buildRoster } = require('./slotService');
```

Vor `addAuditLog` einfügen:

```js
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
```

`module.exports = { promoteFromWaitlist, addAuditLog, loadEventRegistrations, findUserRegistration, loadEventRoster };`
(`orderBy` wurde nicht genutzt und fällt aus dem Import; `promoteFromWaitlist` bleibt bis Task 6 unverändert.)

- [ ] **Step 5: Embed und Buttons in `bot.js`**

1. Im `require('discord.js')`-Block `escapeMarkdown` ergänzen.
2. Nach dem `formFields`-Import:
   ```js
   const { getSlots, hasSlots, findSlot, formatSlotLabel, countSlotOccupancy, hasFreePlace } = require('./utils/slotService');
   ```
   und `getModalFieldLimit` zum `formFields`-Import hinzufügen.
3. Bei den Custom-ID-Konstanten ergänzen:
   ```js
   const SLOT_BUTTON_PREFIX = 'event_slot';
   const SLOT_MODAL_PREFIX = 'event_slot_modal';
   const SLOT_SWITCH_PREFIX = 'slot_switch';
   const SLOT_LEAVE_PREFIX = 'slot_leave';
   const ALT_SLOTS_FIELD_ID = 'alt_slots';

   // Discord allows five buttons per action row
   const BUTTONS_PER_ROW = 5;
   // Names listed per slot in the announcement embed
   const ROSTER_NAMES_MAX = 5;
   ```
4. `buildEventEmbed` komplett ersetzen:

```js
/**
 * Build an event announcement embed.
 *
 * With a roster the embed shows live numbers: the participant count and,
 * for slot events, one field per slot with the first names.
 *
 * @param {Object} event -> Event data.
 * @param {string} [registrationLink] -> Link to the event page.
 * @param {Object} [roster] -> Line-up from loadEventRoster().
 * @returns {EmbedBuilder} -> The embed.
 */
function buildEventEmbed(event, registrationLink, roster) {
    const embed = new EmbedBuilder()
        .setColor(0x8b5cf6)
        .setTitle(`🎉 ${event.title}`)
        .setDescription(event.description || 'Keine Beschreibung.')
        .addFields(
            { name: '🗓️ Datum', value: event.startDate ? new Date(event.startDate).toLocaleString('de-DE', { timeZone: TIMEZONE }) : 'TBA', inline: true },
            { name: '👥 Teilnehmer', value: formatParticipantCount(event, roster), inline: true },
            { name: '🔓 Zugang', value: event.accessMode === 'open' ? 'Offen für alle' : 'Rollen-Requirement', inline: true }
        )
        .setFooter({ text: 'DEMS — Event Management' })
        .setTimestamp();

    if (roster && roster.slots.length > 0) {
        roster.slots.forEach(slot => {
            embed.addFields({ name: formatRosterSlotTitle(slot), value: formatRosterMembers(slot), inline: true });
        });
        if (roster.waitlistCount > 0) {
            embed.addFields({ name: '⏳ Warteliste', value: String(roster.waitlistCount), inline: true });
        }
    }

    if (event.bannerUrl) {
        embed.setImage(event.bannerUrl);
    }

    if (event.category) {
        embed.addFields({ name: '🏷️ Kategorie', value: event.category, inline: true });
    }

    if (registrationLink) {
        embed.addFields({ name: '📋 Anmeldung', value: `[Hier anmelden](${registrationLink})`, inline: false });
    }

    return embed;
}

/**
 * Participant field of the embed.
 *
 * @param {Object} event -> Event data.
 * @param {Object} [roster] -> Line-up with live numbers.
 * @returns {string} -> "3/10", "3 (unbegrenzt)" or the static capacity.
 */
function formatParticipantCount(event, roster) {
    if (!roster) return event.maxParticipants > 0 ? `Max. ${event.maxParticipants}` : 'Unbegrenzt';
    return roster.capacity > 0 ? `${roster.taken}/${roster.capacity}` : `${roster.taken} (unbegrenzt)`;
}

/**
 * Field title of one slot, e.g. "🛡️ Tank 2/2 ✅".
 *
 * @param {Object} slot -> Roster slot.
 * @returns {string} -> Title with ✅ when full and ⚠️ when overbooked.
 */
function formatRosterSlotTitle(slot) {
    let marker = '';
    if (slot.taken > slot.capacity) marker = ' ⚠️';
    else if (slot.taken === slot.capacity) marker = ' ✅';
    return `${formatSlotLabel(slot)} ${slot.taken}/${slot.capacity}${marker}`;
}

/**
 * Field value of one slot: the first names, then "+N".
 *
 * @param {Object} slot -> Roster slot.
 * @returns {string} -> Names, escaped for Discord markdown.
 */
function formatRosterMembers(slot) {
    if (slot.members.length === 0) return '— frei —';
    const names = slot.members.slice(0, ROSTER_NAMES_MAX).map(member => escapeMarkdown(member.displayName));
    const hidden = slot.members.length - ROSTER_NAMES_MAX;
    return hidden > 0 ? `${names.join(', ')}, +${hidden}` : names.join(', ');
}
```

5. `buildEventComponents` komplett ersetzen:

```js
/**
 * Build the button rows that are attached to an event announcement.
 *
 * Slot events get one button per slot, normal events the "Anmelden" button,
 * both only while the event can be joined from Discord. The link button is
 * always the last button.
 *
 * @param {Object} event -> The event document data.
 * @param {string} eventId -> The event document ID.
 * @param {Object} [roster] -> Line-up, marks full slots.
 * @returns {ActionRowBuilder[]} -> Components array ready for channel.send().
 * @example
 * await channel.send({ embeds: [embed], components: buildEventComponents(event, eventId, roster) });
 */
function buildEventComponents(event, eventId, roster) {
    const buttons = [];

    if (canRegisterViaDiscord(event)) {
        if (hasSlots(event)) {
            getSlots(event).forEach(slot => buttons.push(buildSlotButton(eventId, slot, roster)));
        } else {
            buttons.push(
                new ButtonBuilder()
                    .setCustomId(`${REGISTER_BUTTON_PREFIX}:${eventId}`)
                    .setLabel('Anmelden')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅')
            );
        }
    }

    buttons.push(
        new ButtonBuilder()
            .setLabel('Zum Event')
            .setStyle(ButtonStyle.Link)
            .setURL(buildEventUrl(eventId))
            .setEmoji('🔗')
    );

    const rows = [];
    for (let index = 0; index < buttons.length; index += BUTTONS_PER_ROW) {
        rows.push(new ActionRowBuilder().addComponents(...buttons.slice(index, index + BUTTONS_PER_ROW)));
    }
    return rows;
}

/**
 * Build the button of one slot.
 *
 * Full slots stay clickable -> the click can still lead to a fallback role
 * or the waitlist.
 *
 * @param {string} eventId -> The event document ID.
 * @param {Object} slot -> The slot.
 * @param {Object} [roster] -> Line-up with the taken places.
 * @returns {ButtonBuilder} -> The slot button.
 */
function buildSlotButton(eventId, slot, roster) {
    const rosterSlot = roster ? roster.slots.find(entry => entry.id === slot.id) : null;
    const isFull = !!rosterSlot && rosterSlot.taken >= slot.capacity;
    const button = new ButtonBuilder()
        .setCustomId(`${SLOT_BUTTON_PREFIX}:${eventId}:${slot.id}`)
        .setLabel(isFull ? `${slot.name} (voll)` : slot.name)
        .setStyle(isFull ? ButtonStyle.Secondary : ButtonStyle.Primary);
    if (slot.emoji) button.setEmoji(slot.emoji);
    return button;
}
```

`findSlot`, `countSlotOccupancy`, `hasFreePlace` und `SLOT_*`-Konstanten werden erst ab Task 11 genutzt; ein Import, der noch nicht verwendet wird, ist in diesem Projekt ohne Linter unkritisch.

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test test/eventComponents.test.js test/mockBot.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add utils/eventUtils.js utils/formFields.js bot.js test/eventComponents.test.js
git commit -m "Show the slot line-up and slot buttons in announcements" -m "Members should see in Discord which roles are still free and join a role with one click; the fallback select costs one modal place, so slot events allow four form fields." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018hAdfGQGsteU1Kwt1KHJg7"
```

---

### Task 5: Live-Ankündigungen

**Files:**
- Modify: `bot.js` (`sendChannelMessage`, neu `refreshEventAnnouncements`, `isGoneDiscordError`, Exports), `dev/mockBot.js`, `routes/admin.js` (`POST /events/:id/announce`)
- Test: `test/mockBot.test.js`, `test/devServer.test.js`

**Interfaces:**
- Consumes: Task 4 (`loadEventRoster`, `buildEventEmbed`, `buildEventComponents`)
- Produces:
  - `sendChannelMessage(...)`: `Promise<{ channelId, messageId } | false>`
  - `refreshEventAnnouncements(eventId): Promise<boolean>` (exportiert, Mock-Zwilling)
  - `isGoneDiscordError(err): boolean` (exportiert)
  - Event-Feld `announcements: [{ channelId, messageId }]` (höchstens 5, neueste zuletzt)

- [ ] **Step 1: Write the failing tests**

In `test/mockBot.test.js` die Assertion zu `sendChannelMessage` ersetzen:

```js
    const sent = await bot.sendChannelMessage(CHANNEL_ID.ANNOUNCEMENTS, bot.buildEventEmbed(event), {
        text: 'Neues Event!',
        roleIds: [ROLE_ID.RAID_TEAM],
        components: bot.buildEventComponents(event, 'evt-mock')
    });
    assert.equal(sent.channelId, CHANNEL_ID.ANNOUNCEMENTS);
    assert.match(sent.messageId, /^\d+$/);
```

und am Dateiende anhängen:

```js
/** Collect everything printed with console.log while `fn` runs. */
async function captureLogs(fn) {
    const lines = [];
    const original = console.log;
    console.log = (...args) => lines.push(args.map(String).join(' '));
    try {
        await fn();
    } finally {
        console.log = original;
    }
    return lines.join('\n');
}

test('announcements are refreshed only when the event has stored messages', async () => {
    await setDoc(doc(db, 'events', 'evt-refresh'), { title: 'Live-Test', status: 'active', maxParticipants: 5 });
    assert.equal(await bot.refreshEventAnnouncements('evt-refresh'), false);

    await setDoc(doc(db, 'events', 'evt-refresh'), {
        title: 'Live-Test', status: 'active', maxParticipants: 5,
        announcements: [{ channelId: CHANNEL_ID.ANNOUNCEMENTS, messageId: '123' }]
    });
    let result;
    const output = await captureLogs(async () => { result = await bot.refreshEventAnnouncements('evt-refresh'); });
    assert.equal(result, true);
    assert.ok(output.includes('Ankündigung von "Live-Test" aktualisiert'));
    assert.equal(await bot.refreshEventAnnouncements('does-not-exist'), false);
});

test('deleted Discord messages count as gone', () => {
    assert.equal(bot.isGoneDiscordError({ code: 10008 }), true);
    assert.equal(bot.isGoneDiscordError({ code: 10003 }), true);
    assert.equal(bot.isGoneDiscordError({ code: 50013 }), false);
    assert.equal(bot.isGoneDiscordError(null), false);
});
```

In `test/devServer.test.js` nach dem Test `announcing an event is logged instead of sent to Discord` einfügen:

```js
test('announcing stores the message for live updates', async () => {
    const admin = await loginAs('admin');
    const res = await admin.send('POST', `/api/admin/events/${EVENT_ID.OPEN}/announce`, { text: 'Live!' });
    assert.equal(res.status, 200);

    const events = await (await admin.request('/api/admin/all-events')).json();
    const announcements = events.find(event => event.id === EVENT_ID.OPEN).announcements;
    assert.ok(announcements.length >= 1);
    assert.match(announcements[announcements.length - 1].messageId, /^\d+$/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/mockBot.test.js test/devServer.test.js`
Expected: FAIL (`sent.channelId` undefined, `refreshEventAnnouncements is not a function`, `announcements` undefined).

- [ ] **Step 3: `bot.js`**

1. In `sendChannelMessage` `await channel.send({...});` → `const message = await channel.send({...});` und das folgende `return true;` → `return { channelId: channel.id, messageId: message.id };`. JSDoc-Rückgabe anpassen: `@returns {Promise<Object|false>} -> { channelId, messageId } of the sent message, false on failure.`
2. Nach `buildSlotButton` einfügen:

```js
// Discord error codes for "Unknown Channel" and "Unknown Message"
const DISCORD_GONE_ERROR_CODES = [10003, 10008];

/**
 * Whether a Discord API error means the channel or message no longer exists.
 *
 * @param {*} err -> Error thrown by discord.js.
 * @returns {boolean} -> True for deleted channels or messages.
 */
function isGoneDiscordError(err) {
    return !!err && DISCORD_GONE_ERROR_CODES.includes(err.code);
}

/**
 * Re-render every stored announcement of an event with the live line-up.
 *
 * Deleted messages are dropped from `event.announcements`; other errors are
 * logged and the message is kept for the next attempt.
 *
 * @param {string} eventId -> The event document ID.
 * @returns {Promise<boolean>} -> True when announcements were processed.
 */
async function refreshEventAnnouncements(eventId) {
    if (!isReady) return false;
    try {
        const eventSnap = await getDoc(doc(db, 'events', eventId));
        if (!eventSnap.exists()) return false;

        const event = eventSnap.data();
        const announcements = Array.isArray(event.announcements) ? event.announcements : [];
        if (announcements.length === 0) return false;

        const { loadEventRoster } = require('./utils/eventUtils');
        const roster = await loadEventRoster(eventId, event);
        const embed = buildEventEmbed(event, buildEventUrl(eventId), roster);
        const components = buildEventComponents(event, eventId, roster);

        const kept = [];
        for (const announcement of announcements) {
            try {
                const channel = await client.channels.fetch(announcement.channelId);
                const message = await channel.messages.fetch(announcement.messageId);
                await message.edit({ embeds: [embed], components });
                kept.push(announcement);
            } catch (err) {
                if (isGoneDiscordError(err)) continue;
                console.error('Failed to refresh announcement:', err.message);
                kept.push(announcement);
            }
        }

        if (kept.length !== announcements.length) {
            await updateDoc(doc(db, 'events', eventId), { announcements: kept });
        }
        return true;
    } catch (err) {
        console.error('refreshEventAnnouncements failed:', err.message);
        return false;
    }
}
```

3. In `module.exports` `refreshEventAnnouncements` und `isGoneDiscordError` ergänzen.

- [ ] **Step 4: `dev/mockBot.js`**

Import ergänzen: `const { buildEventUrl } = require('../utils/eventUrl');`. In `sendChannelMessage` `return true;` → `return { channelId, messageId: fakeSnowflake() };`. Nach `sendChannelMessage` einfügen und in `module.exports` aufnehmen:

```js
async function refreshEventAnnouncements(eventId) {
    const snap = await getDoc(doc(db, 'events', eventId));
    if (!snap.exists()) return false;

    const event = snap.data();
    const announcements = Array.isArray(event.announcements) ? event.announcements : [];
    if (announcements.length === 0) return false;

    // Required lazily -> bot.js merges this module into its own exports
    const { buildEventEmbed, buildEventComponents } = require('../bot');
    const { loadEventRoster } = require('../utils/eventUtils');
    const roster = await loadEventRoster(eventId, event);
    mockLog(`Ankündigung von "${event.title}" aktualisiert (${announcements.length}×)`, {
        embed: toPayload(buildEventEmbed(event, buildEventUrl(eventId), roster)),
        components: buildEventComponents(event, eventId, roster).map(toPayload)
    });
    return true;
}
```

- [ ] **Step 5: Ankündigung speichern in `routes/admin.js`**

Import aus `../utils/eventUtils` um `loadEventRoster` erweitern und nach den Imports einfügen:

```js
// Announcements per event that are kept up to date live
const MAX_TRACKED_ANNOUNCEMENTS = 5;
```

In `POST /events/:id/announce` den Block von `const embed = buildEventEmbed(...)` bis `if (success) {` ersetzen durch:

```js
        const roster = await loadEventRoster(req.params.id, event);
        const embed = buildEventEmbed(event, registrationLink, roster);
        const sent = await sendChannelMessage(channelId, embed, {
            text: text || '',
            roleIds: roleIds || [],
            pingEveryone: !!pingEveryone,
            components: buildEventComponents(event, req.params.id, roster)
        });

        if (sent) {
            const announcements = [
                ...(Array.isArray(event.announcements) ? event.announcements : []),
                { channelId: sent.channelId, messageId: sent.messageId }
            ].slice(-MAX_TRACKED_ANNOUNCEMENTS);
            await updateDoc(doc(db, 'events', req.params.id), { announcements });
```

(Der Rest des `if`-Zweigs mit `addAuditLog` und `res.json` bleibt.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test test/mockBot.test.js test/devServer.test.js test/eventComponents.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add bot.js dev/mockBot.js routes/admin.js test/mockBot.test.js test/devServer.test.js
git commit -m "Keep Discord announcements up to date" -m "Announcements now remember their message so the line-up and the participant count can be edited in place after every change; deleted messages are forgotten instead of failing forever." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018hAdfGQGsteU1Kwt1KHJg7"
```

---
### Task 6: Nachrücken neu (Slots + Fix known-issue #6)

**Files:**
- Modify: `utils/eventUtils.js`
- Test: `test/waitlistPromotion.test.js` (neu)

**Interfaces:**
- Consumes: Task 1/2 (`pickCapacityPromotions`, `pickWaitlistPromotions`, `getSlots`, `hasSlots`, `findSlot`, `formatSlotLabel`), Task 3 (`withEventLock`, `notifyRegistrationsChanged`), Task 4 (`loadEventRegistrations`)
- Produces:
  - `promoteFromWaitlist(eventId, event): Promise<Promotion[]>` — nimmt die Sperre selbst, schickt DMs, ruft `notifyRegistrationsChanged`; wirft nie
  - `promoteFromWaitlistLocked(eventId, event): Promise<Promotion[]>` — nur schreiben, **Aufrufer hält die Sperre**
  - `announcePromotions(eventId, event, promotions): Promise<void>` — DMs/Rolle/Channel + `notifyRegistrationsChanged`, außerhalb der Sperre aufrufen
  - `Promotion = { registrationId: string, userId: string, status: 'accepted'|'pending', slotId: string|null }`

- [ ] **Step 1: Write the failing tests** — `test/waitlistPromotion.test.js`:

```js
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createTempDir } = require('./helpers');

// Mock mode with an own database; the empty cwd keeps a local .env out
const tmpDir = createTempDir('promotion');
process.chdir(tmpDir);
delete process.env.NODE_ENV;
process.env.DEV_MOCK = 'true';
process.env.DEV_SQLITE_PATH = path.join(tmpDir, 'promotion.sqlite');

const bot = require('../bot');
const { db, doc, getDoc, setDoc } = require('../firebaseAdmin');
const { promoteFromWaitlist } = require('../utils/eventUtils');

after(async () => {
    await bot.client.destroy();
});

let counter = 0;

async function createEvent(fields) {
    const id = `promo-event-${++counter}`;
    const event = { title: `Event ${counter}`, status: 'active', approvalMode: 'instant', maxParticipants: 0, ...fields };
    await setDoc(doc(db, 'events', id), event);
    return { id, event };
}

async function addRegistration(eventId, status, createdAt, fields = {}) {
    const id = `promo-reg-${++counter}`;
    await setDoc(doc(db, 'registrations', id), {
        eventId, userId: `promo-user-${counter}`, userName: `User ${counter}`,
        status, guests: [], pendingGuests: [], createdAt, ...fields
    });
    return id;
}

async function registration(id) {
    return (await getDoc(doc(db, 'registrations', id))).data();
}

test('a waitlisted registration with guests does not overbook a normal event', async () => {
    const { id, event } = await createEvent({ maxParticipants: 2 });
    await addRegistration(id, 'accepted', '2026-10-01T08:00:00.000Z');
    const withGuest = await addRegistration(id, 'waitlisted', '2026-10-01T09:00:00.000Z', { guests: ['promo-guest'] });
    const single = await addRegistration(id, 'waitlisted', '2026-10-01T10:00:00.000Z');

    const promotions = await promoteFromWaitlist(id, event);

    assert.deepEqual(promotions.map(promotion => promotion.registrationId), [single]);
    assert.equal((await registration(withGuest)).status, 'waitlisted');
    assert.equal((await registration(single)).status, 'accepted');
});

test('several registrations move up when places are free', async () => {
    const { id, event } = await createEvent({ maxParticipants: 3 });
    await addRegistration(id, 'accepted', '2026-10-01T08:00:00.000Z');
    const first = await addRegistration(id, 'waitlisted', '2026-10-01T09:00:00.000Z');
    const second = await addRegistration(id, 'waitlisted', '2026-10-01T10:00:00.000Z');
    const third = await addRegistration(id, 'waitlisted', '2026-10-01T11:00:00.000Z');

    await promoteFromWaitlist(id, event);

    assert.equal((await registration(first)).status, 'accepted');
    assert.equal((await registration(second)).status, 'accepted');
    assert.equal((await registration(third)).status, 'waitlisted');
});

test('a freed slot goes to the oldest matching waitlist entry', async () => {
    const slots = [
        { id: 'tank', name: 'Tank', emoji: '🛡️', capacity: 1 },
        { id: 'heal', name: 'Heiler', emoji: '💚', capacity: 1 }
    ];
    const { id, event } = await createEvent({ slots, maxParticipants: 2 });
    await addRegistration(id, 'accepted', '1', { slotId: 'tank', preferredSlotId: 'tank', altSlotIds: [] });
    const waitsForTank = await addRegistration(id, 'waitlisted', '2', { slotId: null, preferredSlotId: 'tank', altSlotIds: [] });
    const waitsForHeal = await addRegistration(id, 'waitlisted', '3', { slotId: null, preferredSlotId: 'tank', altSlotIds: ['heal'] });

    const promotions = await promoteFromWaitlist(id, event);

    assert.deepEqual(promotions.map(({ registrationId, slotId, status }) => ({ registrationId, slotId, status })), [
        { registrationId: waitsForHeal, slotId: 'heal', status: 'accepted' }
    ]);
    assert.equal((await registration(waitsForTank)).status, 'waitlisted');
    assert.equal((await registration(waitsForHeal)).slotId, 'heal');
});

test('manual approval moves people up as pending requests', async () => {
    const slots = [{ id: 'dps', name: 'Schaden', emoji: '', capacity: 2 }];
    const { id, event } = await createEvent({ slots, maxParticipants: 2, approvalMode: 'manual' });
    const waiting = await addRegistration(id, 'waitlisted', '1', { slotId: null, preferredSlotId: 'dps', altSlotIds: [] });

    await promoteFromWaitlist(id, event);

    assert.equal((await registration(waiting)).status, 'pending');
    assert.equal((await registration(waiting)).slotId, 'dps');
});

test('nothing moves while every place is taken', async () => {
    const { id, event } = await createEvent({ maxParticipants: 1 });
    await addRegistration(id, 'accepted', '1');
    const waiting = await addRegistration(id, 'waitlisted', '2');

    assert.deepEqual(await promoteFromWaitlist(id, event), []);
    assert.equal((await registration(waiting)).status, 'waitlisted');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/waitlistPromotion.test.js`
Expected: FAIL — die alte Funktion gibt nichts zurück (`promotions` ist `undefined`) und befördert die Anmeldung mit Gast.

- [ ] **Step 3: Implement** — in `utils/eventUtils.js` die Imports ersetzen:

```js
const { db, collection, doc, getDocs, addDoc, updateDoc, query, where } = require('../firebaseAdmin');
const { sendDM, assignRole, addParticipantToEventChannels } = require('../bot');
const { pickCapacityPromotions } = require('./capacity');
const { getSlots, hasSlots, findSlot, formatSlotLabel, pickWaitlistPromotions, buildRoster } = require('./slotService');
const { withEventLock } = require('./eventLock');
const { notifyRegistrationsChanged } = require('./announcementRefresh');
```

Die alte Funktion `promoteFromWaitlist` (inkl. Kommentar „Promote the oldest waitlisted user when a spot opens“) komplett ersetzen durch:

```js
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
 * events move up everyone whose places (including guests) still fit.
 *
 * @param {string} eventId -> The event document ID.
 * @param {Object} event -> The event document data.
 * @returns {Promise<Array<Object>>} -> `[{ registrationId, userId, status, slotId }]`.
 */
async function promoteFromWaitlistLocked(eventId, event) {
    const registrations = await loadEventRegistrations(eventId);
    const picked = hasSlots(event)
        ? pickWaitlistPromotions(getSlots(event), registrations)
        : pickCapacityPromotions(event.maxParticipants || 0, registrations)
            .map(registrationId => ({ registrationId, slotId: null }));

    const status = event.approvalMode === 'instant' ? 'accepted' : 'pending';
    const promotions = [];
    for (const { registrationId, slotId } of picked) {
        await updateDoc(doc(db, 'registrations', registrationId), slotId ? { status, slotId } : { status });
        const promoted = registrations.find(entry => entry.id === registrationId);
        promotions.push({ registrationId, userId: promoted.userId, status, slotId });
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
    const slots = getSlots(event);

    for (const promotion of promotions) {
        const slot = findSlot(slots, promotion.slotId);
        const slotLine = slot ? `\n🎯 Dein Slot: **${formatSlotLabel(slot)}**` : '';
        try {
            if (promotion.status === 'accepted') {
                await sendDM(promotion.userId,
                    `🎉 Ein Platz wurde frei! Du wurdest von der Warteliste für **${event.title}** in die Teilnehmerliste aufgenommen!${slotLine}`
                );
                if (event.assignRoleId) {
                    await assignRole(promotion.userId, event.assignRoleId, process.env.DISCORD_GUILD_ID);
                }
                if (event.discordChannelId || event.discordTextChannelId) {
                    await addParticipantToEventChannels(event, promotion.userId);
                }
            } else {
                await sendDM(promotion.userId,
                    `📋 Ein Platz wurde frei bei **${event.title}**! Deine Anfrage wird jetzt geprüft.${slotLine}`
                );
            }
        } catch (err) {
            console.error('Promotion notification failed:', err.message);
        }
        console.log(`Promoted user ${promotion.userId} from waitlist for event ${eventId}`);
    }

    notifyRegistrationsChanged(eventId);
}
```

`module.exports` erweitern: `promoteFromWaitlist, promoteFromWaitlistLocked, announcePromotions, addAuditLog, loadEventRegistrations, findUserRegistration, loadEventRoster`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/waitlistPromotion.test.js && npm test`
Expected: PASS (die bestehenden Aufrufer in `routes/admin.js`, `routes/events.js` und `bot.js` nutzen weiterhin `promoteFromWaitlist(eventId, event)`).

- [ ] **Step 5: Commit**

```bash
git add utils/eventUtils.js test/waitlistPromotion.test.js
git commit -m "Promote the waitlist per slot and count guests" -m "Freed slots go to the oldest waitlist entry that wants that role, and normal events no longer get overbooked when a waitlisted registration brings guests (known issue #6). Promotions run under the event lock." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018hAdfGQGsteU1Kwt1KHJg7"
```

---

### Task 7: Anmeldeservice mit Slots

**Files:**
- Modify: `utils/registrationService.js` (komplett neu, s. u.)
- Test: `test/registrationService.test.js` (neu)

**Interfaces:**
- Consumes: Task 1/2, Task 3 (`withEventLock`, `notifyRegistrationsChanged`), Task 6 (`loadEventRegistrations`, `promoteFromWaitlist`, `promoteFromWaitlistLocked`, `announcePromotions`)
- Produces:
  - `registerUserForEvent({ eventId, user, formAnswers, guests, source, slotId = null, altSlotIds = [] })` → Erfolg `{ ok: true, id, status, message, event, slotId, isAlt }`, sonst `{ ok: false, code, httpStatus, error }`
  - `switchOwnSlot({ eventId, userId, slotId })` → `{ ok: true, status, slotId, message }`
  - `moveRegistrationToSlot({ registrationId, slotId })` → `{ ok: true, slotId, slotName, userName, warning: string|null }`
  - `unregisterUserFromEvent({ eventId, userId })` → `{ ok: true, registration, event: Object|null }`
  - `buildTemplateVars({ user, eventId, event, slot = null })` → Variablen inkl. `slot.name`, `slot.emoji`
  - `REGISTRATION_ERROR` zusätzlich: `INVALID_SLOT: 'invalid_slot'` (400), `SLOT_FULL: 'slot_full'` (409), `NOT_REGISTERED: 'not_registered'` (404), `NOT_MOVABLE: 'not_movable'` (400)

- [ ] **Step 1: Write the failing tests** — `test/registrationService.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/registrationService.test.js`
Expected: FAIL (`switchOwnSlot is not a function`, Slot-Felder fehlen).

- [ ] **Step 3: Implement** — `utils/registrationService.js` komplett durch Folgendes ersetzen (`REGISTRATION_SOURCE`, `REGISTRATION_STATUS`, `STATUS_MESSAGES` und die Prüfreihenfolge bleiben inhaltlich gleich):

```js
const { db, collection, doc, getDoc, addDoc, updateDoc, deleteDoc } = require('../firebaseAdmin');
const {
    sendDM, assignRole, removeRole, parseTemplate, getGuildRoles,
    addParticipantToEventChannels, removeParticipantFromEventChannels, sendGuestInvitation
} = require('../bot');
const { debugLog } = require('./debugLog');
const { findMissingRequiredFields } = require('./formFields');
const { buildEventUrl } = require('./eventUrl');
const { withEventLock } = require('./eventLock');
const { notifyRegistrationsChanged } = require('./announcementRefresh');
const { OCCUPYING_STATUSES, countOccupiedPlaces } = require('./capacity');
const {
    getSlots, findSlot, formatSlotLabel, sanitizeAltSlotIds, countSlotOccupancy, hasFreePlace, pickSlot
} = require('./slotService');
const {
    loadEventRegistrations, promoteFromWaitlist, promoteFromWaitlistLocked, announcePromotions
} = require('./eventUtils');

/** Registration sources — where a registration was created. */
const REGISTRATION_SOURCE = {
    WEB: 'web',
    DISCORD: 'discord'
};

/** Status values a fresh registration can receive. */
const REGISTRATION_STATUS = {
    PENDING: 'pending',
    ACCEPTED: 'accepted',
    WAITLISTED: 'waitlisted'
};

/** Machine readable failure codes returned by the functions of this module. */
const REGISTRATION_ERROR = {
    NOT_FOUND: 'event_not_found',
    INACTIVE: 'event_inactive',
    ALREADY_REGISTERED: 'already_registered',
    MISSING_ROLE: 'missing_role',
    GUESTS_NOT_ALLOWED: 'guests_not_allowed',
    MISSING_FIELDS: 'missing_fields',
    INVALID_SLOT: 'invalid_slot',
    SLOT_FULL: 'slot_full',
    NOT_REGISTERED: 'not_registered',
    NOT_MOVABLE: 'not_movable',
    FAILED: 'registration_failed'
};

/** HTTP status codes mapped to the failure codes above. */
const ERROR_HTTP_STATUS = {
    [REGISTRATION_ERROR.NOT_FOUND]: 404,
    [REGISTRATION_ERROR.INACTIVE]: 400,
    [REGISTRATION_ERROR.ALREADY_REGISTERED]: 400,
    [REGISTRATION_ERROR.MISSING_ROLE]: 403,
    [REGISTRATION_ERROR.GUESTS_NOT_ALLOWED]: 400,
    [REGISTRATION_ERROR.MISSING_FIELDS]: 400,
    [REGISTRATION_ERROR.INVALID_SLOT]: 400,
    [REGISTRATION_ERROR.SLOT_FULL]: 409,
    [REGISTRATION_ERROR.NOT_REGISTERED]: 404,
    [REGISTRATION_ERROR.NOT_MOVABLE]: 400,
    [REGISTRATION_ERROR.FAILED]: 500
};

/** Success messages shown to the user, keyed by resulting status. */
const STATUS_MESSAGES = {
    [REGISTRATION_STATUS.ACCEPTED]: 'Erfolgreich angemeldet!',
    [REGISTRATION_STATUS.PENDING]: 'Anfrage eingegangen.',
    [REGISTRATION_STATUS.WAITLISTED]: 'Auf die Warteliste gesetzt.'
};

/**
 * Resolve the template variables used in the bot messages.
 *
 * @param {Object} params -> Resolution input.
 * @param {Object} params.user -> The user ({ id, displayName }).
 * @param {string} params.eventId -> The event document ID.
 * @param {Object} params.event -> The event document data.
 * @param {Object|null} [params.slot] -> The slot of the registration.
 * @returns {Promise<Object>} -> Variable map for parseTemplate().
 */
async function buildTemplateVars({ user, eventId, event, slot = null }) {
    let roleName = '';
    let roleMention = '';

    if (event.assignRoleId) {
        const roles = await getGuildRoles(process.env.DISCORD_GUILD_ID);
        const role = roles.find(r => r.id === event.assignRoleId);
        if (role) {
            roleName = role.name;
            roleMention = `<@&${role.id}>`;
        } else {
            roleName = 'Unbekannte Rolle';
            roleMention = 'Unbekannte Rolle';
        }
    }

    return {
        'user.id': user.id,
        'user.name': user.displayName,
        'user.mention': `<@${user.id}>`,
        'event.title': event.title || 'Unbekanntes Event',
        'event.url': buildEventUrl(eventId),
        'role.name': roleName,
        'role.mention': roleMention,
        'slot.name': slot ? slot.name : '',
        'slot.emoji': slot ? slot.emoji : ''
    };
}

/**
 * Send the confirmation DM and apply role/channel side effects.
 *
 * Failures are logged but never abort the registration -> the registration
 * itself is already persisted at this point.
 *
 * @param {Object} params -> Notification input.
 * @param {Object} params.user -> The registering user ({ id, displayName }).
 * @param {string} params.eventId -> The event document ID.
 * @param {Object} params.event -> The event document data.
 * @param {string} params.status -> The resulting registration status.
 * @param {Object|null} [params.slot] -> The slot the user got.
 * @param {boolean} [params.isAlt] -> Whether the slot is a fallback role.
 * @returns {Promise<void>} -> Resolves once all notifications were attempted.
 */
async function notifyRegistration({ user, eventId, event, status, slot = null, isAlt = false }) {
    try {
        const templateSnap = await getDoc(doc(db, 'botMessages', 'templates'));
        const globalTemplates = templateSnap.exists() ? templateSnap.data() : {};
        const customMessages = event.customBotMessages || {};
        const vars = await buildTemplateVars({ user, eventId, event, slot });
        const slotLine = slot ? `\n🎯 Dein Slot: **${formatSlotLabel(slot)}**${isAlt ? ' (Ausweichrolle)' : ''}` : '';

        if (status === REGISTRATION_STATUS.WAITLISTED) {
            const text = getSlots(event).length > 0
                ? `📋 Für **${event.title}** sind gerade alle gewünschten Slots belegt. Du wurdest auf die **Warteliste** gesetzt und rückst automatisch nach, sobald ein passender Platz frei wird!`
                : `📋 Das Event **${event.title}** ist aktuell voll. Du wurdest auf die **Warteliste** gesetzt. Wir benachrichtigen dich, sobald ein Platz frei wird!`;
            await sendDM(user.id, text);
            return;
        }

        if (status === REGISTRATION_STATUS.ACCEPTED) {
            const template = customMessages.accepted || globalTemplates.accepted;
            const message = template
                ? parseTemplate(template, vars)
                : `✅ Du wurdest automatisch für **${event.title}** angenommen!${slotLine}`;
            await sendDM(user.id, message);

            if (event.assignRoleId) {
                await assignRole(user.id, event.assignRoleId, process.env.DISCORD_GUILD_ID);
            }
            if (event.discordChannelId || event.discordTextChannelId) {
                await addParticipantToEventChannels(event, user.id);
            }
            return;
        }

        const template = customMessages.registration || globalTemplates.registration;
        const message = template
            ? parseTemplate(template, vars)
            : `📋 Deine Anfrage für **${event.title}** ist eingegangen. Bitte warte auf die Bestätigung.${slotLine}`;
        await sendDM(user.id, message);
    } catch (err) {
        console.error('[registrationService] notifyRegistration failed:', err.message);
    }
}

/**
 * Success message including the slot, e.g.
 * "Erfolgreich angemeldet! Dein Slot: 💚 Heiler (🛡️ Tank war voll)."
 *
 * @param {string} status -> Resulting status.
 * @param {Object|null} slot -> Slot the user got.
 * @param {Object|null} fullPreferredSlot -> Main role that was full, if a fallback was used.
 * @returns {string} -> German message.
 */
function buildStatusMessage(status, slot, fullPreferredSlot) {
    const base = STATUS_MESSAGES[status];
    if (!slot) return base;
    const note = fullPreferredSlot ? ` (${formatSlotLabel(fullPreferredSlot)} war voll)` : '';
    return `${base} Dein Slot: ${formatSlotLabel(slot)}${note}.`;
}

/**
 * Validate a registration and write it. The caller holds the event lock.
 *
 * @param {Object} params -> Same input as registerUserForEvent().
 * @returns {Promise<Object>} -> `{ ok: true, event, registrationId, registration }` or a failure.
 */
async function createRegistration({ eventId, user, formAnswers, guests, source, slotId, altSlotIds }) {
    const eventSnap = await getDoc(doc(db, 'events', eventId));
    if (!eventSnap.exists()) {
        return buildFailure(REGISTRATION_ERROR.NOT_FOUND, 'Event nicht gefunden');
    }

    const event = eventSnap.data();

    if (event.status && event.status !== 'active') {
        return buildFailure(REGISTRATION_ERROR.INACTIVE, 'Dieses Event akzeptiert keine Anmeldungen.');
    }

    const registrations = await loadEventRegistrations(eventId);
    if (registrations.some(registration => registration.userId === user.id)) {
        return buildFailure(REGISTRATION_ERROR.ALREADY_REGISTERED, 'Du bist bereits registriert.');
    }

    if (event.accessMode === 'role-required' && Array.isArray(event.requiredRoles) && event.requiredRoles.length > 0) {
        const userRoles = Array.isArray(user.roles) ? user.roles : [];
        const hasRole = event.requiredRoles.some(roleId => userRoles.includes(roleId));
        if (!hasRole) {
            return buildFailure(REGISTRATION_ERROR.MISSING_ROLE, 'Du hast nicht die erforderliche Rolle.');
        }
    }

    const slots = getSlots(event);
    const rawGuests = Array.isArray(guests) ? guests : [];
    if ((event.allowGuests === false || slots.length > 0) && rawGuests.length > 0) {
        return buildFailure(REGISTRATION_ERROR.GUESTS_NOT_ALLOWED, 'Gäste sind für dieses Event nicht zugelassen.');
    }

    const formFields = Array.isArray(event.formFields) ? event.formFields : [];
    const missingFields = findMissingRequiredFields(formFields, formAnswers);
    if (missingFields.length > 0) {
        return buildFailure(
            REGISTRATION_ERROR.MISSING_FIELDS,
            `Bitte fülle alle Pflichtfelder aus: ${missingFields.join(', ')}`
        );
    }

    // Guests reserve a place each until they accept or decline the invitation
    const incomingGuests = rawGuests.filter(guest => guest && typeof guest.id === 'string' && guest.id.trim());

    let isWaitlisted = false;
    let slotFields = {};
    if (slots.length > 0) {
        const preferredSlot = findSlot(slots, slotId);
        if (!preferredSlot) {
            return buildFailure(REGISTRATION_ERROR.INVALID_SLOT, 'Bitte wähle einen gültigen Slot.');
        }
        const cleanAltSlotIds = sanitizeAltSlotIds(slots, preferredSlot.id, altSlotIds);
        const assignedSlotId = pickSlot(slots, countSlotOccupancy(slots, registrations), preferredSlot.id, cleanAltSlotIds);
        slotFields = { slotId: assignedSlotId, preferredSlotId: preferredSlot.id, altSlotIds: cleanAltSlotIds };
        isWaitlisted = !assignedSlotId;
    } else if (event.maxParticipants > 0) {
        isWaitlisted = countOccupiedPlaces(registrations) + 1 + incomingGuests.length > event.maxParticipants;
    }

    let status;
    if (isWaitlisted) {
        status = REGISTRATION_STATUS.WAITLISTED;
    } else {
        status = event.approvalMode === 'instant' ? REGISTRATION_STATUS.ACCEPTED : REGISTRATION_STATUS.PENDING;
    }

    const pendingGuests = incomingGuests.map(guest => ({
        userId: guest.id,
        displayName: guest.displayName || guest.id,
        avatar: guest.avatar || '',
        status: REGISTRATION_STATUS.PENDING
    }));

    const registration = {
        eventId,
        userId: user.id,
        userName: user.displayName,
        status,
        formAnswers,
        guests: [],
        pendingGuests,
        source,
        createdAt: new Date().toISOString(),
        ...slotFields
    };

    const registrationRef = await addDoc(collection(db, 'registrations'), registration);
    return { ok: true, event, registrationId: registrationRef.id, registration };
}

/**
 * Register a user for an event after validating every access condition.
 *
 * This is the single source of truth for registrations -> both the web UI and
 * the Discord buttons call it, so the same conditions (event status, role
 * requirement, guest rules, required form fields, slots, capacity and
 * approval mode) apply everywhere. Validation and writing run under the
 * event lock, notifications afterwards.
 *
 * @param {Object} params -> Registration input.
 * @param {string} params.eventId -> The event document ID.
 * @param {Object} params.user -> The registering user ({ id, displayName, roles }).
 * @param {Object} [params.formAnswers] -> Answers keyed by form field label.
 * @param {Array<Object>} [params.guests] -> Guests to invite ({ id, displayName, avatar }).
 * @param {string} [params.source] -> Where the registration came from ("web" or "discord").
 * @param {string|null} [params.slotId] -> Wanted main role of a slot event.
 * @param {string[]} [params.altSlotIds] -> Fallback roles of a slot event.
 * @returns {Promise<Object>} -> `{ ok: true, id, status, message, event, slotId, isAlt }` on success,
 *   `{ ok: false, code, httpStatus, error }` when a condition is not met.
 * @example
 * const result = await registerUserForEvent({
 *     eventId: 'abc123',
 *     user: { id: '1234', displayName: 'Mori', roles: ['5678'] },
 *     slotId: 'tank',
 *     altSlotIds: ['heal'],
 *     source: 'discord'
 * });
 */
async function registerUserForEvent({ eventId, user, formAnswers = {}, guests = [], source = REGISTRATION_SOURCE.WEB, slotId = null, altSlotIds = [] }) {
    debugLog('registrationService.register', { eventId, userId: user?.id, source, slotId });

    const outcome = await withEventLock(eventId, () =>
        createRegistration({ eventId, user, formAnswers, guests, source, slotId, altSlotIds }));
    if (!outcome.ok) return outcome;

    const { event, registrationId, registration } = outcome;

    // Guest invitations are fire and forget -> a failing DM must not block the registration
    const eventData = { id: eventId, title: event.title, startDate: event.startDate };
    for (const guest of registration.pendingGuests) {
        sendGuestInvitation(guest.userId, { id: user.id, displayName: user.displayName }, eventData, registrationId)
            .catch(err => console.error('[registrationService] sendGuestInvitation failed:', err.message));
    }

    const slots = getSlots(event);
    const slot = findSlot(slots, registration.slotId);
    const isAlt = !!slot && registration.slotId !== registration.preferredSlotId;
    await notifyRegistration({ user, eventId, event, status: registration.status, slot, isAlt });
    notifyRegistrationsChanged(eventId);

    return {
        ok: true,
        id: registrationId,
        status: registration.status,
        message: buildStatusMessage(registration.status, slot, isAlt ? findSlot(slots, registration.preferredSlotId) : null),
        event,
        slotId: registration.slotId || null,
        isAlt
    };
}

/**
 * Let a member move into another slot of the same event.
 *
 * Only free slots are allowed. The chosen slot becomes the new main role;
 * a waitlisted member gets the place directly. The freed place goes to the
 * waitlist.
 *
 * @param {Object} params -> Switch input.
 * @param {string} params.eventId -> The event document ID.
 * @param {string} params.userId -> Discord user ID.
 * @param {string} params.slotId -> Target slot.
 * @returns {Promise<Object>} -> `{ ok: true, status, slotId, message }` or a failure.
 */
async function switchOwnSlot({ eventId, userId, slotId }) {
    const outcome = await withEventLock(eventId, async () => {
        const eventSnap = await getDoc(doc(db, 'events', eventId));
        if (!eventSnap.exists()) {
            return buildFailure(REGISTRATION_ERROR.NOT_FOUND, 'Event nicht gefunden');
        }
        const event = eventSnap.data();
        if (event.status && event.status !== 'active') {
            return buildFailure(REGISTRATION_ERROR.INACTIVE, 'Dieses Event akzeptiert keine Anmeldungen.');
        }

        const slots = getSlots(event);
        const target = findSlot(slots, slotId);
        if (!target) {
            return buildFailure(REGISTRATION_ERROR.INVALID_SLOT, 'Bitte wähle einen gültigen Slot.');
        }

        const registrations = await loadEventRegistrations(eventId);
        const registration = registrations.find(entry => entry.userId === userId);
        if (!registration || registration.status === 'rejected') {
            return buildFailure(REGISTRATION_ERROR.NOT_REGISTERED, 'Du bist für dieses Event nicht angemeldet.');
        }
        if (registration.slotId === target.id) {
            return { ok: true, event, registration, changed: false, wasWaitlisted: false, promotions: [] };
        }
        if (!hasFreePlace(target, countSlotOccupancy(slots, registrations))) {
            return buildFailure(REGISTRATION_ERROR.SLOT_FULL, 'Dieser Slot ist bereits voll.');
        }

        const wasWaitlisted = registration.status === REGISTRATION_STATUS.WAITLISTED;
        const update = {
            slotId: target.id,
            preferredSlotId: target.id,
            altSlotIds: (registration.altSlotIds || []).filter(id => id !== target.id)
        };
        if (wasWaitlisted) {
            update.status = event.approvalMode === 'instant' ? REGISTRATION_STATUS.ACCEPTED : REGISTRATION_STATUS.PENDING;
        }
        await updateDoc(doc(db, 'registrations', registration.id), update);

        const promotions = wasWaitlisted ? [] : await promoteFromWaitlistLocked(eventId, event);
        return { ok: true, event, registration: { ...registration, ...update }, changed: true, wasWaitlisted, promotions };
    });
    if (!outcome.ok) return outcome;

    const { event, registration } = outcome;
    const slot = findSlot(getSlots(event), registration.slotId);
    if (outcome.changed) {
        if (outcome.wasWaitlisted) {
            await notifyRegistration({
                user: { id: userId, displayName: registration.userName },
                eventId, event, status: registration.status, slot
            });
        }
        await announcePromotions(eventId, event, outcome.promotions);
        notifyRegistrationsChanged(eventId);
    }

    return {
        ok: true,
        status: registration.status,
        slotId: slot.id,
        message: `Du bist jetzt als ${formatSlotLabel(slot)} eingeplant.`
    };
}

/**
 * Move a registration into another slot (admin action).
 *
 * Admins may overbook a slot on purpose; the result then carries a warning.
 * The freed place goes to the waitlist.
 *
 * @param {Object} params -> Move input.
 * @param {string} params.registrationId -> Registration document ID.
 * @param {string} params.slotId -> Target slot.
 * @returns {Promise<Object>} -> `{ ok: true, slotId, slotName, userName, warning }` or a failure.
 */
async function moveRegistrationToSlot({ registrationId, slotId }) {
    const registrationSnap = await getDoc(doc(db, 'registrations', registrationId));
    if (!registrationSnap.exists()) {
        return buildFailure(REGISTRATION_ERROR.NOT_REGISTERED, 'Anmeldung nicht gefunden');
    }
    const { eventId } = registrationSnap.data();

    const outcome = await withEventLock(eventId, async () => {
        const eventSnap = await getDoc(doc(db, 'events', eventId));
        if (!eventSnap.exists()) {
            return buildFailure(REGISTRATION_ERROR.NOT_FOUND, 'Event nicht gefunden');
        }
        const event = eventSnap.data();
        const slots = getSlots(event);
        const target = findSlot(slots, slotId);
        if (!target) {
            return buildFailure(REGISTRATION_ERROR.INVALID_SLOT, 'Bitte wähle einen gültigen Slot.');
        }

        const registrations = await loadEventRegistrations(eventId);
        const registration = registrations.find(entry => entry.id === registrationId);
        if (!registration) {
            return buildFailure(REGISTRATION_ERROR.NOT_REGISTERED, 'Anmeldung nicht gefunden');
        }
        if (!OCCUPYING_STATUSES.includes(registration.status)) {
            return buildFailure(REGISTRATION_ERROR.NOT_MOVABLE, 'Nur angenommene oder ausstehende Anmeldungen können verschoben werden.');
        }
        if (registration.slotId === target.id) {
            return { ok: true, event, registration, target, warning: null, promotions: [] };
        }

        const overbooked = !hasFreePlace(target, countSlotOccupancy(slots, registrations));
        await updateDoc(doc(db, 'registrations', registrationId), { slotId: target.id });
        const promotions = await promoteFromWaitlistLocked(eventId, event);
        return {
            ok: true, event, registration, target, promotions,
            warning: overbooked ? `Slot „${target.name}“ ist jetzt überbucht.` : null
        };
    });
    if (!outcome.ok) return outcome;

    await announcePromotions(eventId, outcome.event, outcome.promotions);
    notifyRegistrationsChanged(eventId);

    return {
        ok: true,
        slotId: outcome.target.id,
        slotName: outcome.target.name,
        userName: outcome.registration.userName,
        warning: outcome.warning
    };
}

/**
 * Remove the registration of a user (web, /unregister and the Discord button).
 *
 * Accepted members lose the event role and the access to the event channels;
 * a freed place goes to the waitlist.
 *
 * @param {Object} params -> Unregister input.
 * @param {string} params.eventId -> The event document ID.
 * @param {string} params.userId -> Discord user ID.
 * @returns {Promise<Object>} -> `{ ok: true, registration, event }` or a failure.
 */
async function unregisterUserFromEvent({ eventId, userId }) {
    const outcome = await withEventLock(eventId, async () => {
        const registrations = await loadEventRegistrations(eventId);
        const registration = registrations.find(entry => entry.userId === userId);
        if (!registration) {
            return buildFailure(REGISTRATION_ERROR.NOT_REGISTERED, 'Du bist für dieses Event nicht angemeldet.');
        }
        await deleteDoc(doc(db, 'registrations', registration.id));
        return { ok: true, registration };
    });
    if (!outcome.ok) return outcome;

    const { registration } = outcome;
    debugLog('registrationService.unregister', { eventId, userId, status: registration.status });

    const eventSnap = await getDoc(doc(db, 'events', eventId));
    const event = eventSnap.exists() ? eventSnap.data() : null;
    if (event) {
        try {
            if (registration.status === REGISTRATION_STATUS.ACCEPTED) {
                if (event.assignRoleId) {
                    await removeRole(userId, event.assignRoleId, process.env.DISCORD_GUILD_ID);
                }
                if (event.discordChannelId || event.discordTextChannelId) {
                    await removeParticipantFromEventChannels(event, userId);
                }
            }
        } catch (err) {
            console.error('[registrationService] cleanup after unregister failed:', err.message);
        }
        if (OCCUPYING_STATUSES.includes(registration.status)) {
            await promoteFromWaitlist(eventId, event);
        }
    }

    notifyRegistrationsChanged(eventId);
    return { ok: true, registration, event };
}

/**
 * Build a normalized failure result.
 *
 * @param {string} code -> One of REGISTRATION_ERROR.
 * @param {string} error -> German message shown to the user.
 * @returns {Object} -> `{ ok: false, code, httpStatus, error }`.
 */
function buildFailure(code, error) {
    return {
        ok: false,
        code,
        httpStatus: ERROR_HTTP_STATUS[code] || 400,
        error
    };
}

module.exports = {
    registerUserForEvent,
    switchOwnSlot,
    moveRegistrationToSlot,
    unregisterUserFromEvent,
    buildTemplateVars,
    REGISTRATION_SOURCE,
    REGISTRATION_STATUS,
    REGISTRATION_ERROR
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/registrationService.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add utils/registrationService.js test/registrationService.test.js
git commit -m "Register, switch and leave slots in the registration service" -m "Web, Discord and admin actions share one implementation of the slot rules. Everything that changes places runs under the event lock, so two simultaneous clicks on the last place cannot both win; unregistering now also removes the channel access in every path." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018hAdfGQGsteU1Kwt1KHJg7"
```

---

### Task 8: Admin — Slot-Events anlegen und bearbeiten

**Files:**
- Modify: `routes/admin.js` (`POST /events`, `PUT /events/:id`, `PUT /events/:id/status`, `PUT /events/:id/cancel`, `POST /events/:id/start`, `POST /events/:id/end`, `POST /events/:id/duplicate`)
- Test: `test/devServer.test.js`

**Interfaces:**
- Consumes: Task 1/2 (`normalizeSlots`, `sumCapacity`, `getSlots`, `validateSlotChange`), Task 3 (`notifyRegistrationsChanged`), Task 6 (`loadEventRegistrations`, `promoteFromWaitlist`)
- Produces: Events speichern `slots`; bei Slot-Events `maxParticipants = Σ capacity`, `allowGuests = false`; Duplikate mit `announcements: []`. Test-Helfer `createSlotEvent(admin, title, slots, fields)` und Konstante `RAID_SLOTS` in `test/devServer.test.js` (von Task 9 und 10 genutzt).

- [ ] **Step 1: Write the failing tests** — in `test/devServer.test.js` am Dateiende anhängen:

```js
// ── Role slots ──────────────────────────────────────────────────────────

const RAID_SLOTS = [
    { name: 'Tank', emoji: '🛡️', capacity: 1 },
    { name: 'Heiler', emoji: '💚', capacity: 1 }
];

/** Create an active instant-approval event with role slots; returns the API response. */
async function createSlotEvent(admin, title, slots, fields = {}) {
    const res = await admin.send('POST', '/api/admin/events', {
        title, status: 'active', accessMode: 'open', approvalMode: 'instant', slots, ...fields
    });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    return body;
}

test('admins create events with role slots', async () => {
    const admin = await loginAs('admin');
    const created = await createSlotEvent(admin, 'Slot-Anlage', [
        { name: 'Tank', emoji: '🛡️', capacity: 2 },
        { name: 'Heiler', emoji: '💚', capacity: 3 }
    ], { maxParticipants: 99, allowGuests: true });

    assert.equal(created.maxParticipants, 5);
    assert.equal(created.allowGuests, false);
    assert.deepEqual(created.slots.map(slot => slot.name), ['Tank', 'Heiler']);
    assert.ok(created.slots.every(slot => /^[0-9a-f]{8}$/.test(slot.id)));

    const detail = await (await admin.request(`/api/events/${created.id}`)).json();
    assert.deepEqual(detail.slots, created.slots);
});

test('invalid slots are rejected with a German message', async () => {
    const admin = await loginAs('admin');
    const res = await admin.send('POST', '/api/admin/events', {
        title: 'Kaputte Slots', status: 'active', slots: [{ name: 'Tank', emoji: ':shield:', capacity: 1 }]
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'Das Emoji von Slot „Tank“ muss ein einzelnes Emoji sein.');
});

test('slots cannot be switched on while people are registered', async () => {
    const admin = await loginAs('admin');
    const event = await (await admin.request(`/api/events/${EVENT_ID.OPEN}`)).json();
    const res = await admin.send('PUT', `/api/admin/events/${EVENT_ID.OPEN}`, { ...event, slots: [{ name: 'Tank', capacity: 2 }] });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'Slots können nur aktiviert werden, solange es keine Anmeldungen gibt.');
});

test('duplicating keeps the slots but not the announcements', async () => {
    const admin = await loginAs('admin');
    const created = await createSlotEvent(admin, 'Slot-Kopie', RAID_SLOTS);
    assert.equal((await admin.send('POST', `/api/admin/events/${created.id}/announce`, {})).status, 200);

    const copy = await (await admin.send('POST', `/api/admin/events/${created.id}/duplicate`)).json();
    assert.deepEqual(copy.slots, created.slots);
    assert.deepEqual(copy.announcements, []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/devServer.test.js`
Expected: FAIL (`maxParticipants` 99 statt 5, `slots` fehlen, ungültiges Emoji → 200, Duplikat behält `announcements`).

- [ ] **Step 3: Implement in `routes/admin.js`**

Imports ergänzen bzw. ersetzen:

```js
const { promoteFromWaitlist, addAuditLog, loadEventRoster, loadEventRegistrations } = require('../utils/eventUtils');
const { getSlots, normalizeSlots, sumCapacity, validateSlotChange } = require('../utils/slotService');
const { notifyRegistrationsChanged } = require('../utils/announcementRefresh');
```

`POST /events` — direkt nach dem `const { ... } = req.body;`-Block:

```js
        const slotResult = normalizeSlots(req.body.slots);
        if (slotResult.error) {
            return res.status(400).json({ error: slotResult.error });
        }
        const { slots } = slotResult;
```

In `baseEvent` die Zeilen `maxParticipants` und `allowGuests` ersetzen und `slots` ergänzen:

```js
            maxParticipants: slots.length > 0 ? sumCapacity(slots) : (parseInt(maxParticipants) || 0),
            allowGuests: slots.length > 0 ? false : allowGuests !== false,
            slots,
```

`PUT /events/:id` — nach dem `req.body`-Block:

```js
        const slotResult = normalizeSlots(req.body.slots, getSlots(oldEvent));
        if (slotResult.error) {
            return res.status(400).json({ error: slotResult.error });
        }
        const { slots } = slotResult;
        const registrations = await loadEventRegistrations(req.params.id);
        const slotError = validateSlotChange({ oldSlots: getSlots(oldEvent), newSlots: slots, registrations });
        if (slotError) {
            return res.status(400).json({ error: slotError });
        }
```

In `updates` dieselben drei Zeilen wie bei `baseEvent`. Direkt vor `res.json({ id: req.params.id, ...updates });`:

```js
        // More places or new slots can let waitlisted members move up
        await promoteFromWaitlist(req.params.id, { ...oldEvent, ...updates });
        notifyRegistrationsChanged(req.params.id);
```

Statuswechsel — jeweils direkt nach der `addAuditLog(...)`-Zeile:
- `PUT /events/:id/status`: `notifyRegistrationsChanged(req.params.id);`
- `PUT /events/:id/cancel`, `POST /events/:id/start`, `POST /events/:id/end`: `notifyRegistrationsChanged(eventId);`

`POST /events/:id/duplicate`: im `duplicate`-Objekt nach `checkinCode: '',` ergänzen: `announcements: [],  // Each copy is announced on its own`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/devServer.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add routes/admin.js test/devServer.test.js
git commit -m "Let admins create and edit events with role slots" -m "Slots are validated on both create and update, capacity follows the slot sizes, and edits that would orphan registrations are refused. Status changes refresh the live announcement so the buttons disappear on inactive events." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018hAdfGQGsteU1Kwt1KHJg7"
```

---

### Task 9: Event-API — Anmelden, Wechseln, Abmelden, Aufstellung

**Files:**
- Modify: `routes/events.js`
- Test: `test/devServer.test.js`

**Interfaces:**
- Consumes: Task 2 (`hasSlots`, `withSlotSummary`), Task 4 (`loadEventRoster`), Task 7 (`registerUserForEvent`, `switchOwnSlot`, `unregisterUserFromEvent`), Task 8 (`createSlotEvent`, `RAID_SLOTS`)
- Produces:
  - `POST /api/events/:id/register` Body `{ formAnswers, guests, slotId, altSlotIds }` → `{ id, status, message, slotId, isAlt }`
  - `PUT /api/events/:id/register/slot` Body `{ slotId }` → `{ status, slotId, message }` (404/400/409)
  - `GET /api/events`, `/series/:seriesId`, `/:id` → zusätzlich `slotSummary` bei Slot-Events
  - `GET /api/events/:id/participants` → zusätzlich `slots` und `waitlist` bei Slot-Events

- [ ] **Step 1: Write the failing tests** — in `test/devServer.test.js` anhängen:

```js
test('a full main role falls back to the alternative, then to the waitlist', async () => {
    const admin = await loginAs('admin');
    const event = await createSlotEvent(admin, 'Raid-Ausweich', RAID_SLOTS);
    const [tank, heal] = event.slots;
    const raider = await loginAs('raider');
    const member = await loginAs('member');
    const newbie = await loginAs('newbie');

    const first = await (await raider.send('POST', `/api/events/${event.id}/register`, { slotId: tank.id })).json();
    assert.deepEqual([first.status, first.slotId, first.isAlt], ['accepted', tank.id, false]);

    const second = await (await member.send('POST', `/api/events/${event.id}/register`, { slotId: tank.id, altSlotIds: [heal.id] })).json();
    assert.deepEqual([second.slotId, second.isAlt], [heal.id, true]);
    assert.ok(second.message.includes('🛡️ Tank war voll'));

    const third = await (await newbie.send('POST', `/api/events/${event.id}/register`, { slotId: tank.id, altSlotIds: [heal.id] })).json();
    assert.equal(third.status, 'waitlisted');

    const detail = await (await raider.request(`/api/events/${event.id}`)).json();
    assert.deepEqual(detail.slotSummary.map(slot => slot.taken), [1, 1]);

    assert.equal((await member.send('DELETE', `/api/events/${event.id}/register`)).status, 200);
    const promoted = await (await newbie.request(`/api/events/${event.id}/my-registration`)).json();
    assert.deepEqual([promoted.status, promoted.slotId], ['accepted', heal.id]);
});

test('registering for a slot event needs a valid slot', async () => {
    const admin = await loginAs('admin');
    const event = await createSlotEvent(admin, 'Raid-Pflichtslot', RAID_SLOTS);
    const member = await loginAs('member');
    const res = await member.send('POST', `/api/events/${event.id}/register`, {});
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'Bitte wähle einen gültigen Slot.');
});

test('members switch into free slots only and the line-up follows', async () => {
    const admin = await loginAs('admin');
    const event = await createSlotEvent(admin, 'Raid-Wechsel', [
        { name: 'Alpha', capacity: 1 }, { name: 'Beta', capacity: 1 }, { name: 'Gamma', capacity: 1 }
    ]);
    const [alpha, beta, gamma] = event.slots;
    const raider = await loginAs('raider');
    const member = await loginAs('member');
    await raider.send('POST', `/api/events/${event.id}/register`, { slotId: alpha.id });
    await member.send('POST', `/api/events/${event.id}/register`, { slotId: beta.id });

    const full = await raider.send('PUT', `/api/events/${event.id}/register/slot`, { slotId: beta.id });
    assert.equal(full.status, 409);
    assert.equal((await full.json()).error, 'Dieser Slot ist bereits voll.');

    const moved = await raider.send('PUT', `/api/events/${event.id}/register/slot`, { slotId: gamma.id });
    assert.equal(moved.status, 200);
    assert.equal((await moved.json()).slotId, gamma.id);

    const participants = await (await raider.request(`/api/events/${event.id}/participants`)).json();
    assert.deepEqual(participants.slots.map(slot => slot.taken), [0, 1, 1]);
    assert.equal(participants.slots[2].members[0].displayName, personaById('raider').displayName);
    assert.deepEqual(participants.waitlist, []);
});

test('a slot that still has registrations cannot be removed', async () => {
    const admin = await loginAs('admin');
    const event = await createSlotEvent(admin, 'Raid-Umbau', RAID_SLOTS);
    const raider = await loginAs('raider');
    await raider.send('POST', `/api/events/${event.id}/register`, { slotId: event.slots[0].id });

    const removed = await admin.send('PUT', `/api/admin/events/${event.id}`, { ...event, slots: event.slots.slice(1) });
    assert.equal(removed.status, 400);
    assert.equal((await removed.json()).error, 'Slot „Tank“ hat noch 1 Anmeldung – bitte zuerst verschieben.');

    const grown = await admin.send('PUT', `/api/admin/events/${event.id}`, {
        ...event, slots: event.slots.map(slot => ({ ...slot, capacity: 3 }))
    });
    assert.equal(grown.status, 200);
    assert.equal((await grown.json()).maxParticipants, 6);
});

test('a new registration refreshes the live announcement', async () => {
    const admin = await loginAs('admin');
    const event = await createSlotEvent(admin, 'Live-Embed-Test', RAID_SLOTS);
    assert.equal((await admin.send('POST', `/api/admin/events/${event.id}/announce`, {})).status, 200);

    const raider = await loginAs('raider');
    await raider.send('POST', `/api/events/${event.id}/register`, { slotId: event.slots[0].id });
    await server.waitForOutput('Ankündigung von "Live-Embed-Test" aktualisiert', 6000);
});
```

Hinweis: `personaById('raider').displayName` ist „Lena“; die Aufstellung nimmt den Namen aus dem Nutzerprofil (`users`), das der Persona-Login anlegt.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/devServer.test.js`
Expected: FAIL (Route ignoriert `slotId` → `invalid_slot`, `PUT .../register/slot` → 404, keine `slotSummary`).

- [ ] **Step 3: Implement in `routes/events.js`**

Imports anpassen:

```js
const { getGuildRoles, getPublicGuildChannels } = require('../bot');
const { loadEventRoster } = require('../utils/eventUtils');
const { registerUserForEvent, switchOwnSlot, unregisterUserFromEvent, REGISTRATION_SOURCE } = require('../utils/registrationService');
const { hasSlots, withSlotSummary } = require('../utils/slotService');
```

(Danach `grep -n "removeRole\|removeParticipantFromEventChannels\|promoteFromWaitlist" routes/events.js` ausführen: Nach Schritt „DELETE ersetzen“ unten darf es keine Fundstelle mehr geben; falls doch, den Import für diese Stelle behalten.)

`GET /` und `GET /series/:seriesId` — die Zählschleife jeweils ersetzen durch:

```js
        const regSnapshot = await getDocs(collection(db, 'registrations'));
        const participantCounts = {};
        const registrationsByEvent = {};
        regSnapshot.forEach(regDoc => {
            const data = regDoc.data();
            (registrationsByEvent[data.eventId] ||= []).push(data);
            if (data.status === 'accepted' || data.status === 'pending') {
                const guestCount = Array.isArray(data.guests) ? data.guests.length : 0;
                participantCounts[data.eventId] = (participantCounts[data.eventId] || 0) + 1 + guestCount;
            }
        });
```

und das anschließende Mapping in `GET /` durch:

```js
        events = events.map(e => withSlotSummary({
            ...e,
            currentParticipants: participantCounts[e.id] || 0
        }, registrationsByEvent[e.id] || []));
```

bzw. in `GET /series/:seriesId` durch:

```js
        const result = seriesEvents.map(e => withSlotSummary({
            ...e,
            currentParticipants: participantCounts[e.id] || 0
        }, registrationsByEvent[e.id] || []));
```

`GET /:id` — die Zählschleife ersetzen durch:

```js
        let currentParticipants = 0;
        const occupyingRegistrations = [];
        regSnap.forEach(regDoc => {
            const r = regDoc.data();
            occupyingRegistrations.push(r);
            currentParticipants += 1 + (Array.isArray(r.guests) ? r.guests.length : 0);
        });
```

und die Antwort durch:

```js
        res.json(withSlotSummary({
            id: docSnap.id,
            ...safe,
            checkinEnabled: !!safe.checkinEnabled,
            currentParticipants,
            waitlistCount: waitSnap.size,
            createdByName
        }, occupyingRegistrations));
```

`POST /:id/register` — Aufruf und Antwort:

```js
        const result = await registerUserForEvent({
            eventId: req.params.id,
            user: { id: user.id, displayName: user.displayName, roles: user.roles },
            formAnswers: req.body.formAnswers || {},
            guests: Array.isArray(req.body.guests) ? req.body.guests : [],
            source: REGISTRATION_SOURCE.WEB,
            slotId: typeof req.body.slotId === 'string' ? req.body.slotId : null,
            altSlotIds: Array.isArray(req.body.altSlotIds) ? req.body.altSlotIds : []
        });
```

```js
        res.json({ id: result.id, status: result.status, message: result.message, slotId: result.slotId, isAlt: result.isAlt });
```

Direkt nach `POST /:id/register` neu:

```js
/**
 * PUT /api/events/:id/register/slot — Switch the own registration into a free slot
 */
router.put('/:id/register/slot', requireAuth, checkRegistrationAllowed, async (req, res) => {
    try {
        const result = await switchOwnSlot({
            eventId: req.params.id,
            userId: req.session.user.id,
            slotId: typeof req.body.slotId === 'string' ? req.body.slotId : ''
        });
        if (!result.ok) {
            return res.status(result.httpStatus).json({ error: result.error });
        }
        debugLog('events.switchSlot', { eventId: req.params.id, userId: req.session.user.id, slotId: result.slotId });
        res.json({ status: result.status, slotId: result.slotId, message: result.message });
    } catch (err) {
        console.error('Switch slot error:', err);
        res.status(500).json({ error: 'Fehler beim Wechseln des Slots' });
    }
});
```

`DELETE /:id/register` komplett ersetzen:

```js
router.delete('/:id/register', requireAuth, async (req, res) => {
    try {
        const result = await unregisterUserFromEvent({ eventId: req.params.id, userId: req.session.user.id });
        if (!result.ok) {
            return res.status(result.httpStatus).json({ error: result.error });
        }
        debugLog('events.cancelRegistration', { eventId: req.params.id, userId: req.session.user.id });
        res.json({ success: true, message: 'Abmeldung erfolgreich.' });
    } catch (err) {
        console.error('Unregister error:', err);
        res.status(500).json({ error: 'Fehler bei der Abmeldung' });
    }
});
```

`GET /:id/participants` — am Anfang des `try` das Event laden:

```js
        const eventSnap = await getDoc(doc(db, 'events', req.params.id));
        const event = eventSnap.exists() ? eventSnap.data() : null;
```

und `res.json({ participants, total });` ersetzen durch:

```js
        const payload = { participants, total };
        if (event && hasSlots(event)) {
            const roster = await loadEventRoster(req.params.id, event, { withProfiles: true });
            payload.slots = roster.slots;
            payload.waitlist = roster.waitlist;
        }
        res.json(payload);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/devServer.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add routes/events.js test/devServer.test.js
git commit -m "Register, switch and show slots through the event API" -m "The website can now pick a main and fallback role, switch into free slots and render the line-up; event lists carry a per-slot summary for the cards. Unregistering goes through the shared service." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018hAdfGQGsteU1Kwt1KHJg7"
```

---

### Task 10: Admin — Anmeldungen verwalten, Export, Account-Löschung

**Files:**
- Modify: `routes/admin.js` (`GET /events/:id/registrations`, `GET /events/:id/registrations/export`, `PUT /registrations/:id/status`, neu `PUT /registrations/:id/slot`), `routes/user.js` (`DELETE /account`)
- Test: `test/devServer.test.js`

**Interfaces:**
- Consumes: Task 2 (`resolveAcceptanceSlot`, `findSlot`, `formatSlotLabel`), Task 3 (`withEventLock`), Task 7 (`moveRegistrationToSlot`, `buildTemplateVars`)
- Produces:
  - `GET /api/admin/events/:id/registrations` → `{ data, meta, slots }`
  - `PUT /api/admin/registrations/:id/status` → `{ id, status, slotId, warning? }`
  - `PUT /api/admin/registrations/:id/slot` Body `{ slotId }` → `{ id, slotId, warning? }`, Audit `MOVE_REGISTRATION_SLOT`
  - CSV-Spalten „Slot“, „Wunschrolle“ bei Slot-Events

- [ ] **Step 1: Write the failing tests** — in `test/devServer.test.js` anhängen (der Account-Test muss der **letzte** Test der Datei bleiben, weil er das Konto der Newbie-Persona löscht):

```js
/** Registration of a persona in the admin list of an event. */
async function adminRegistrationOf(admin, eventId, personaId) {
    const result = await (await admin.request(`/api/admin/events/${eventId}/registrations`)).json();
    return { registration: result.data.find(entry => entry.userId === personaById(personaId).userId), slots: result.slots };
}

test('admins move a registration into a full slot with a warning', async () => {
    const admin = await loginAs('admin');
    const event = await createSlotEvent(admin, 'Raid-Verschieben', RAID_SLOTS);
    const [tank, heal] = event.slots;
    await (await loginAs('raider')).send('POST', `/api/events/${event.id}/register`, { slotId: tank.id });
    await (await loginAs('member')).send('POST', `/api/events/${event.id}/register`, { slotId: heal.id });

    const { registration, slots } = await adminRegistrationOf(admin, event.id, 'member');
    assert.deepEqual(slots, event.slots);
    const res = await admin.send('PUT', `/api/admin/registrations/${registration.id}/slot`, { slotId: tank.id });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).warning, 'Slot „Tank“ ist jetzt überbucht.');

    const detail = await (await admin.request(`/api/events/${event.id}`)).json();
    assert.deepEqual(detail.slotSummary.map(slot => slot.taken), [2, 0]);
});

test('accepting a waitlisted registration gives it a slot', async () => {
    const admin = await loginAs('admin');
    const event = await createSlotEvent(admin, 'Raid-Annehmen', RAID_SLOTS);
    const [tank] = event.slots;
    await (await loginAs('raider')).send('POST', `/api/events/${event.id}/register`, { slotId: tank.id });
    await (await loginAs('member')).send('POST', `/api/events/${event.id}/register`, { slotId: tank.id });

    const { registration } = await adminRegistrationOf(admin, event.id, 'member');
    assert.equal(registration.status, 'waitlisted');
    const res = await admin.send('PUT', `/api/admin/registrations/${registration.id}/status`, { status: 'accepted' });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.slotId, tank.id);
    assert.equal(body.warning, 'Slot „Tank“ ist jetzt überbucht.');
});

test('the export lists slot and wish of every registration', async () => {
    const admin = await loginAs('admin');
    const event = await createSlotEvent(admin, 'Raid-Export', RAID_SLOTS);
    await (await loginAs('raider')).send('POST', `/api/events/${event.id}/register`, { slotId: event.slots[0].id });

    const csv = await (await admin.request(`/api/admin/events/${event.id}/registrations/export`)).text();
    assert.ok(csv.split('\n')[0].includes('Slot,Wunschrolle'));
    assert.ok(csv.includes('"🛡️ Tank","🛡️ Tank"'));
});

// Keep this test last -> it deletes the newbie persona's account
test('deleting an account lets the waitlist move up', async () => {
    const admin = await loginAs('admin');
    const event = await createSlotEvent(admin, 'Raid-Konto', [{ name: 'Tank', emoji: '🛡️', capacity: 1 }]);
    const slotId = event.slots[0].id;
    const newbie = await loginAs('newbie');
    const member = await loginAs('member');
    await newbie.send('POST', `/api/events/${event.id}/register`, { slotId });
    await member.send('POST', `/api/events/${event.id}/register`, { slotId });

    assert.equal((await newbie.send('DELETE', '/api/user/account')).status, 200);
    const promoted = await (await member.request(`/api/events/${event.id}/my-registration`)).json();
    assert.deepEqual([promoted.status, promoted.slotId], ['accepted', slotId]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/devServer.test.js`
Expected: FAIL (`slots` fehlt in der Liste, `/slot`-Route 404, Status-Antwort ohne `slotId`, CSV ohne Spalten, Member bleibt auf der Warteliste).

- [ ] **Step 3: Implement in `routes/admin.js`**

Den `slotService`-Import aus Task 8 ersetzen und zwei Imports ergänzen:

```js
const { getSlots, findSlot, formatSlotLabel, normalizeSlots, sumCapacity, validateSlotChange, resolveAcceptanceSlot } = require('../utils/slotService');
const { withEventLock } = require('../utils/eventLock');
const { moveRegistrationToSlot, buildTemplateVars } = require('../utils/registrationService');
```

`GET /events/:id/registrations` — die Antwort ersetzen durch:

```js
        const eventSnap = await getDoc(doc(db, 'events', req.params.id));
        const slots = eventSnap.exists() ? getSlots(eventSnap.data()) : [];

        res.json({
            data: paginatedRegs,
            meta: { total, page, limit, totalPages },
            slots
        });
```

`GET /events/:id/registrations/export` — die ersten beiden Zeilen im `try` (`eventSnap`, `eventTitle`) ersetzen durch:

```js
        const eventSnap = await getDoc(doc(db, 'events', req.params.id));
        const event = eventSnap.exists() ? eventSnap.data() : {};
        const eventTitle = event.title || 'Event';
        const slots = getSlots(event);
        const slotLabel = (slotId) => `"${formatSlotLabel(findSlot(slots, slotId)).replace(/"/g, '""')}"`;
```

die `headers`-Zeile durch:

```js
        const slotHeaders = slots.length > 0 ? ['Slot', 'Wunschrolle'] : [];
        const headers = ['User', 'UserID', 'Status', 'Quelle', 'Datum', 'Gäste (Anzahl)', 'Gäste IDs', ...slotHeaders, ...formKeysArr];
```

und im `rows`-Mapping `return [...base, ...formVals].join(',');` durch:

```js
            const slotValues = slots.length > 0 ? [slotLabel(r.slotId), slotLabel(r.preferredSlotId)] : [];
            return [...base, ...slotValues, ...formVals].join(',');
```

`PUT /registrations/:id/status` komplett ersetzen (die frühere Kopie der Template-Variablen entfällt zugunsten von `buildTemplateVars`) und die neue Route direkt dahinter einfügen:

```js
router.put('/registrations/:id/status', validateRegStatus, async (req, res) => {
    try {
        const { status } = req.body;
        const regSnap = await getDoc(doc(db, 'registrations', req.params.id));
        if (!regSnap.exists()) {
            return res.status(404).json({ error: 'Anmeldung nicht gefunden' });
        }

        const reg = { id: req.params.id, ...regSnap.data() };
        const eventSnap = await getDoc(doc(db, 'events', reg.eventId));
        const event = eventSnap.exists() ? eventSnap.data() : {};
        const slots = getSlots(event);

        // Status and slot change under the event lock -> no race with new registrations
        const { slotId, warning } = await withEventLock(reg.eventId, async () => {
            const update = { status };
            let overbookedWarning = null;
            if (slots.length > 0 && status === 'waitlisted') {
                update.slotId = null;
            }
            if (slots.length > 0 && status === 'accepted' && !findSlot(slots, reg.slotId)) {
                const registrations = await loadEventRegistrations(reg.eventId);
                const choice = resolveAcceptanceSlot(slots, registrations, reg);
                update.slotId = choice.slotId;
                if (choice.overbooked) {
                    overbookedWarning = `Slot „${findSlot(slots, choice.slotId).name}“ ist jetzt überbucht.`;
                }
            }
            await updateDoc(doc(db, 'registrations', req.params.id), update);
            return { slotId: 'slotId' in update ? update.slotId : reg.slotId, warning: overbookedWarning };
        });
        debugLog('admin.updateRegStatus', { regId: req.params.id, newStatus: status });

        const templateSnap = await getDoc(doc(db, 'botMessages', 'templates'));
        const globalTemplates = templateSnap.exists() ? templateSnap.data() : {};
        const customMsgs = event.customBotMessages || {};
        const slot = findSlot(slots, slotId);
        const vars = await buildTemplateVars({
            user: { id: reg.userId, displayName: reg.userName },
            eventId: reg.eventId,
            event,
            slot
        });
        const slotLine = slot ? `\n🎯 Dein Slot: **${formatSlotLabel(slot)}**` : '';

        if (status === 'accepted') {
            const template = customMsgs.accepted || globalTemplates.accepted;
            const msg = template
                ? parseTemplate(template, vars)
                : `✅ Du wurdest für **${event.title}** angenommen! Willkommen dabei!${slotLine}`;
            await sendDM(reg.userId, msg);

            if (event.assignRoleId) {
                await assignRole(reg.userId, event.assignRoleId, process.env.DISCORD_GUILD_ID);
            }
        } else if (status === 'rejected') {
            const template = customMsgs.rejected || globalTemplates.rejected;
            const msg = template
                ? parseTemplate(template, vars)
                : `❌ Leider wurde deine Anfrage für **${event.title}** abgelehnt.`;
            await sendDM(reg.userId, msg);

            await promoteFromWaitlist(reg.eventId, event);
        }

        notifyRegistrationsChanged(reg.eventId);
        await addAuditLog('UPDATE_REGISTRATION_STATUS', req.session.user.id, `Set status to ${status} for user ${reg.userName}`, req.params.id);

        res.json({ id: req.params.id, status, slotId: slotId || null, ...(warning ? { warning } : {}) });
    } catch (err) {
        console.error('Update registration status error:', err);
        res.status(500).json({ error: 'Fehler beim Aktualisieren des Status' });
    }
});

/**
 * PUT /api/admin/registrations/:id/slot — Move a registration into another slot
 */
router.put('/registrations/:id/slot', async (req, res) => {
    try {
        const result = await moveRegistrationToSlot({
            registrationId: req.params.id,
            slotId: typeof req.body.slotId === 'string' ? req.body.slotId : ''
        });
        if (!result.ok) {
            return res.status(result.httpStatus).json({ error: result.error });
        }
        await addAuditLog('MOVE_REGISTRATION_SLOT', req.session.user.id, `Moved ${result.userName} to slot "${result.slotName}"`, req.params.id);
        res.json({ id: req.params.id, slotId: result.slotId, ...(result.warning ? { warning: result.warning } : {}) });
    } catch (err) {
        console.error('Move registration slot error:', err);
        res.status(500).json({ error: 'Fehler beim Verschieben' });
    }
});
```

- [ ] **Step 4: Implement in `routes/user.js`** — Imports ergänzen:

```js
const { promoteFromWaitlist } = require('../utils/eventUtils');
const { notifyRegistrationsChanged } = require('../utils/announcementRefresh');
const { OCCUPYING_STATUSES } = require('../utils/capacity');
```

In `DELETE /account` die Zeilen von `// Delete all registrations` bis einschließlich `await batch.commit();` ersetzen durch:

```js
        // Delete all registrations
        const regQ = query(collection(db, 'registrations'), where('userId', '==', userId));
        const regSnap = await getDocs(regQ);
        const touchedEventIds = new Set();
        const freedEventIds = new Set();
        regSnap.forEach(regDoc => {
            const registration = regDoc.data();
            batch.delete(regDoc.ref);
            touchedEventIds.add(registration.eventId);
            if (OCCUPYING_STATUSES.includes(registration.status)) freedEventIds.add(registration.eventId);
        });

        // Delete user document
        batch.delete(doc(db, 'users', userId));
        await batch.commit();

        // Freed places go to the waitlist; announcements show the new numbers
        for (const eventId of touchedEventIds) {
            try {
                if (freedEventIds.has(eventId)) {
                    const eventSnap = await getDoc(doc(db, 'events', eventId));
                    if (eventSnap.exists()) await promoteFromWaitlist(eventId, eventSnap.data());
                }
                notifyRegistrationsChanged(eventId);
            } catch (followUpErr) {
                console.error('Follow-up after account deletion failed:', followUpErr.message);
            }
        }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/devServer.test.js && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add routes/admin.js routes/user.js test/devServer.test.js
git commit -m "Let admins manage the slots of registrations" -m "Raid leaders can move people between slots (even into full ones, with a warning), accepting a waitlisted member gives them a slot, the CSV export shows slot and wish, and deleted accounts free their places for the waitlist." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018hAdfGQGsteU1Kwt1KHJg7"
```

---

### Task 11: Discord — Slot-Buttons, Modal, Wechseln und Abmelden

**Files:**
- Modify: `bot.js`
- Test: `test/eventComponents.test.js`

**Interfaces:**
- Consumes: Task 4 (Konstanten `SLOT_*`, `ALT_SLOTS_FIELD_ID`, `getModalFieldLimit`), Task 6 (`loadEventRegistrations`), Task 7 (`registerUserForEvent` mit `slotId`/`altSlotIds`, `switchOwnSlot`, `unregisterUserFromEvent`), Task 3 (`notifyRegistrationsChanged`)
- Produces (exportiert für Tests): `buildSlotModal(event, eventId, slot): ModalBuilder`, `buildRegisteredSlotReply(event, eventId, registration, clickedSlot, registrations): { content, components, flags }`. Interne Handler: `handleEventSlotButton`, `handleEventSlotModal`, `handleSlotSwitchButton`, `handleSlotLeaveButton`, `replyWithFailure`, `addFormFieldLabels`, `readAltSlotIds`.

- [ ] **Step 1: Write the failing tests** — in `test/eventComponents.test.js` anhängen:

```js
const COMPONENT_TYPE = { TEXT_DISPLAY: 10, LABEL: 18 };
const EPHEMERAL = 64;

test('the slot modal offers the other slots as fallback roles', () => {
    const modal = bot.buildSlotModal(slotEvent({ formFields: [textField('Ingame-Name')] }), 'evt1', SLOTS[0]).toJSON();
    assert.equal(modal.custom_id, 'event_slot_modal:evt1:tank');
    assert.deepEqual(modal.components.map(component => component.type), [COMPONENT_TYPE.TEXT_DISPLAY, COMPONENT_TYPE.LABEL, COMPONENT_TYPE.LABEL]);

    const altSelect = modal.components[1].component;
    assert.equal(altSelect.custom_id, 'alt_slots');
    assert.deepEqual(altSelect.options.map(option => option.value), ['heal', 'dps']);
    assert.equal(altSelect.options[0].emoji.name, '💚');
    assert.equal(altSelect.min_values, 0);
    assert.equal(altSelect.max_values, 2);
    assert.equal(modal.components[2].component.custom_id, 'field:0');
});

test('four form fields leave no room for the intro text', () => {
    const fields = ['A', 'B', 'C', 'D'].map(textField);
    const modal = bot.buildSlotModal(slotEvent({ formFields: fields }), 'evt1', SLOTS[0]).toJSON();
    assert.equal(modal.components.length, 5);
    assert.ok(modal.components.every(component => component.type === COMPONENT_TYPE.LABEL));
});

test('a single-slot event has no fallback select', () => {
    const modal = bot.buildSlotModal(slotEvent({ slots: [SLOTS[0]], formFields: [textField('A')] }), 'evt1', SLOTS[0]).toJSON();
    assert.ok(!modal.components.some(component => component.component && component.component.custom_id === 'alt_slots'));
});

test('registered members can switch into a free slot or leave', () => {
    const own = { id: 'r1', userId: 'u1', status: 'accepted', slotId: 'tank', preferredSlotId: 'tank', altSlotIds: [] };
    const reply = bot.buildRegisteredSlotReply(slotEvent(), 'evt1', own, SLOTS[1], [own]);
    assert.equal(reply.flags, EPHEMERAL);
    assert.ok(reply.content.includes('als **🛡️ Tank** eingeplant'));
    const buttons = reply.components[0].toJSON().components;
    assert.deepEqual(buttons.map(button => button.custom_id), ['slot_switch:evt1:heal', 'slot_leave:evt1']);
    assert.equal(buttons[0].label, 'Zu Heiler wechseln');

    const ownSlot = bot.buildRegisteredSlotReply(slotEvent(), 'evt1', own, SLOTS[0], [own]);
    assert.deepEqual(ownSlot.components[0].toJSON().components.map(button => button.custom_id), ['slot_leave:evt1']);

    const healers = [own, member('heal', 'X'), member('heal', 'Y')];
    const fullTarget = bot.buildRegisteredSlotReply(slotEvent(), 'evt1', own, SLOTS[1], healers);
    assert.deepEqual(fullTarget.components[0].toJSON().components.map(button => button.custom_id), ['slot_leave:evt1']);
});

test('waitlisted and rejected members get a matching answer', () => {
    const waiting = { id: 'r2', userId: 'u2', status: 'waitlisted', slotId: null, preferredSlotId: 'tank', altSlotIds: [] };
    assert.ok(bot.buildRegisteredSlotReply(slotEvent(), 'evt1', waiting, SLOTS[0], [waiting]).content.includes('Warteliste'));

    const rejected = { ...waiting, status: 'rejected' };
    const reply = bot.buildRegisteredSlotReply(slotEvent(), 'evt1', rejected, SLOTS[0], [rejected]);
    assert.ok(reply.content.includes('abgelehnt'));
    assert.deepEqual(reply.components, []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/eventComponents.test.js`
Expected: FAIL (`bot.buildSlotModal is not a function`).

- [ ] **Step 3: Modal-Bausteine in `bot.js`**

1. Neuer Helfer vor `buildRegistrationModal`:

```js
/**
 * Add one label per form field to a modal.
 *
 * @param {ModalBuilder} modal -> The modal to extend.
 * @param {Array<Object>} fields -> Form fields that fit into the modal.
 * @returns {void}
 */
function addFormFieldLabels(modal, fields) {
    fields.forEach((field, index) => {
        const label = new LabelBuilder()
            .setLabel(String(field.label).substring(0, MODAL_LABEL_MAX_LENGTH))
            .setDescription(buildFieldDescription(field));

        modal.addLabelComponents(applyFieldComponent(label, field, index));
    });
}
```

In `buildRegistrationModal`: `getFormFields(event).slice(0, MODAL_MAX_FIELDS)` → `getFormFields(event).slice(0, getModalFieldLimit(event))` und die `fields.forEach(...)`-Schleife durch `addFormFieldLabels(modal, fields);` ersetzen. In `parseModalAnswers` ebenfalls `.slice(0, MODAL_MAX_FIELDS)` → `.slice(0, getModalFieldLimit(event))`.

2. Nach `buildRegistrationModal` einfügen:

```js
/**
 * Build the registration modal behind a slot button.
 *
 * It starts with a select for the fallback roles (all other slots) when the
 * event has more than one slot, followed by the form fields. The intro text
 * is only added while one of the five component places is left.
 *
 * @param {Object} event -> The event document data.
 * @param {string} eventId -> The event document ID.
 * @param {Object} slot -> The slot the user clicked.
 * @returns {ModalBuilder} -> Modal ready for interaction.showModal().
 */
function buildSlotModal(event, eventId, slot) {
    const modal = new ModalBuilder()
        .setCustomId(`${SLOT_MODAL_PREFIX}:${eventId}:${slot.id}`)
        .setTitle(`${slot.name}: ${event.title}`.substring(0, MODAL_TITLE_MAX_LENGTH));

    const otherSlots = getSlots(event).filter(entry => entry.id !== slot.id);
    const fields = getFormFields(event).slice(0, getModalFieldLimit(event));
    const usedComponents = fields.length + (otherSlots.length > 0 ? 1 : 0);

    if (usedComponents < MODAL_MAX_FIELDS) {
        modal.addTextDisplayComponents(buildModalIntro(event));
    }

    if (otherSlots.length > 0) {
        const select = new StringSelectMenuBuilder()
            .setCustomId(ALT_SLOTS_FIELD_ID)
            .setPlaceholder('Keine Ausweichrolle')
            .setRequired(false)
            .setMinValues(0)
            .setMaxValues(otherSlots.length)
            .addOptions(otherSlots.map(entry => ({
                label: entry.name,
                value: entry.id,
                ...(entry.emoji ? { emoji: { name: entry.emoji } } : {})
            })));
        modal.addLabelComponents(
            new LabelBuilder()
                .setLabel('Ausweichrollen (optional)')
                .setDescription(`Falls ${slot.name} voll ist, wirst du hier eingeplant.`.substring(0, MODAL_DESCRIPTION_MAX_LENGTH))
                .setStringSelectMenuComponent(select)
        );
    }

    addFormFieldLabels(modal, fields);
    return modal;
}

/**
 * Read the fallback roles chosen in a slot modal.
 *
 * @param {import('discord.js').ModalSubmitInteraction} interaction -> The submitted modal.
 * @returns {string[]} -> Selected slot IDs, empty when the select is missing.
 */
function readAltSlotIds(interaction) {
    try {
        return interaction.fields.getStringSelectValues(ALT_SLOTS_FIELD_ID) || [];
    } catch {
        return [];
    }
}

/**
 * Answer for a member who clicks a slot button while already registered.
 *
 * @param {Object} event -> The event document data.
 * @param {string} eventId -> The event document ID.
 * @param {Object} registration -> The member's registration.
 * @param {Object} clickedSlot -> The slot behind the clicked button.
 * @param {Array<Object>} registrations -> All registrations of the event.
 * @returns {Object} -> Ephemeral reply payload.
 */
function buildRegisteredSlotReply(event, eventId, registration, clickedSlot, registrations) {
    const slots = getSlots(event);

    if (registration.status === 'rejected') {
        return {
            content: `❌ Deine Anmeldung für **${event.title}** wurde abgelehnt.`,
            components: [],
            flags: MessageFlags.Ephemeral
        };
    }

    const current = findSlot(slots, registration.slotId);
    const content = registration.status === 'waitlisted' || !current
        ? `⏳ Du stehst für **${event.title}** auf der Warteliste.`
        : `Du bist für **${event.title}** als **${formatSlotLabel(current)}** eingeplant${registration.status === 'pending' ? ' (Anfrage ausstehend)' : ''}.`;

    const row = new ActionRowBuilder();
    const canSwitch = clickedSlot.id !== registration.slotId
        && hasFreePlace(clickedSlot, countSlotOccupancy(slots, registrations));
    if (canSwitch) {
        const switchButton = new ButtonBuilder()
            .setCustomId(`${SLOT_SWITCH_PREFIX}:${eventId}:${clickedSlot.id}`)
            .setLabel(`Zu ${clickedSlot.name} wechseln`)
            .setStyle(ButtonStyle.Primary);
        if (clickedSlot.emoji) switchButton.setEmoji(clickedSlot.emoji);
        row.addComponents(switchButton);
    }
    row.addComponents(
        new ButtonBuilder()
            .setCustomId(`${SLOT_LEAVE_PREFIX}:${eventId}`)
            .setLabel('Abmelden')
            .setStyle(ButtonStyle.Danger)
    );

    return { content, components: [row], flags: MessageFlags.Ephemeral };
}
```

3. `module.exports` um `buildSlotModal` und `buildRegisteredSlotReply` ergänzen.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/eventComponents.test.js`
Expected: PASS.

- [ ] **Step 5: Handler, Dispatcher, `/unregister`, Gäste-Absage in `bot.js`**

1. `completeDiscordRegistration` — Signatur auf `async function completeDiscordRegistration(interaction, { eventId, event, roleIds, formAnswers, slotId = null, altSlotIds = [] })` ändern, im `registerUserForEvent`-Aufruf `slotId,` und `altSlotIds,` ergänzen und das Objekt `statusDescriptions` ersetzen durch:

```js
    const slots = getSlots(event);
    const slot = findSlot(slots, result.slotId);
    const wantedSlot = findSlot(slots, slotId);
    const placement = slot ? ` als **${formatSlotLabel(slot)}**` : '';
    const altNote = result.isAlt && wantedSlot ? ` (${formatSlotLabel(wantedSlot)} war voll)` : '';
    const statusDescriptions = {
        accepted: `Du bist für **${event.title}**${placement} angemeldet${altNote}. Deine Anmeldung ist ab sofort auch im Event-System sichtbar.`,
        pending: `Deine Anfrage für **${event.title}**${placement}${altNote} ist eingegangen und wartet auf Bestätigung. Du siehst den Status im Event-System.`,
        waitlisted: slots.length > 0
            ? `Für **${event.title}** sind gerade alle gewünschten Slots belegt — du stehst auf der Warteliste und rückst automatisch nach.`
            : `**${event.title}** ist aktuell voll — du stehst auf der Warteliste und rückst automatisch nach.`
    };
```

2. Nach `handleEventRegisterModal` einfügen:

```js
/**
 * Answer a failed interaction without throwing.
 *
 * @param {import('discord.js').Interaction} interaction -> The interaction.
 * @returns {Promise<void>}
 */
async function replyWithFailure(interaction) {
    const content = '❌ Fehler bei der Anmeldung.';
    try {
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content });
        } else {
            await interaction.reply({ content, flags: MessageFlags.Ephemeral });
        }
    } catch { /* interaction already expired */ }
}

/**
 * Handle a click on a slot button of an event announcement.
 *
 * Registered members get their status with switch/leave buttons; everybody
 * else is checked and gets the slot modal (or is registered directly when
 * there is nothing to ask).
 *
 * @param {import('discord.js').ButtonInteraction} interaction -> The button interaction.
 * @param {string} eventId -> The event document ID.
 * @param {string} slotId -> The clicked slot.
 * @returns {Promise<void>}
 */
async function handleEventSlotButton(interaction, eventId, slotId) {
    debugLog('bot.slotButton', { eventId, slotId, userId: interaction.user.id });

    const eventSnap = await getDoc(doc(db, 'events', eventId));
    if (!eventSnap.exists()) {
        return interaction.reply({ content: '❌ Event nicht gefunden.', flags: MessageFlags.Ephemeral });
    }
    const event = eventSnap.data();
    const slot = findSlot(getSlots(event), slotId);
    if (!slot) {
        return interaction.reply({
            content: `❌ Diesen Slot gibt es nicht mehr. Bitte melde dich hier an: ${buildEventUrl(eventId)}`,
            flags: MessageFlags.Ephemeral
        });
    }

    const { loadEventRegistrations } = require('./utils/eventUtils');
    const registrations = await loadEventRegistrations(eventId);
    const registration = registrations.find(entry => entry.userId === interaction.user.id);
    if (registration) {
        return interaction.reply(buildRegisteredSlotReply(event, eventId, registration, slot, registrations));
    }

    const roleIds = await resolveInteractionRoles(interaction);
    const conditionError = await checkRegistrationConditions({ event, eventId, userId: interaction.user.id, roleIds });
    if (conditionError) {
        return interaction.reply({ content: `❌ ${conditionError}`, flags: MessageFlags.Ephemeral });
    }

    const needsModal = getFormFields(event).length > 0 || getSlots(event).length > 1;
    if (needsModal) {
        if (!fitsIntoDiscordModal(event)) {
            return interaction.reply({
                content: `📝 Für dieses Event ist das Formular zu umfangreich für Discord (max. ${getModalFieldLimit(event)} Felder). Bitte melde dich hier an: ${buildEventUrl(eventId)}`,
                flags: MessageFlags.Ephemeral
            });
        }
        return interaction.showModal(buildSlotModal(event, eventId, slot));
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await completeDiscordRegistration(interaction, { eventId, event, roleIds, formAnswers: {}, slotId, altSlotIds: [] });
}

/**
 * Handle the submitted slot modal.
 *
 * @param {import('discord.js').ModalSubmitInteraction} interaction -> The submitted modal.
 * @param {string} eventId -> The event document ID.
 * @param {string} slotId -> The slot of the clicked button.
 * @returns {Promise<void>}
 */
async function handleEventSlotModal(interaction, eventId, slotId) {
    debugLog('bot.slotModal', { eventId, slotId, userId: interaction.user.id });

    const eventSnap = await getDoc(doc(db, 'events', eventId));
    if (!eventSnap.exists()) {
        return interaction.reply({ content: '❌ Event nicht gefunden.', flags: MessageFlags.Ephemeral });
    }
    const event = eventSnap.data();

    // Slots or the form may have changed while the modal was open
    if (!canRegisterViaDiscord(event) || !findSlot(getSlots(event), slotId)) {
        return interaction.reply({
            content: `📝 Das Event hat sich geändert. Bitte melde dich hier an: ${buildEventUrl(eventId)}`,
            flags: MessageFlags.Ephemeral
        });
    }

    const { answers, errors } = parseModalAnswers(interaction, event);
    if (errors.length > 0) {
        return interaction.reply({
            content: `❌ Bitte korrigiere deine Angaben:\n${errors.map(e => `• ${e}`).join('\n')}`,
            flags: MessageFlags.Ephemeral
        });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const roleIds = await resolveInteractionRoles(interaction);
    const conditionError = await checkRegistrationConditions({ event, eventId, userId: interaction.user.id, roleIds });
    if (conditionError) {
        return interaction.editReply({ content: `❌ ${conditionError}` });
    }

    await completeDiscordRegistration(interaction, {
        eventId, event, roleIds, formAnswers: answers, slotId, altSlotIds: readAltSlotIds(interaction)
    });
}

/**
 * Handle "Zu <Slot> wechseln" in the ephemeral status answer.
 *
 * @param {import('discord.js').ButtonInteraction} interaction -> The button interaction.
 * @param {string} eventId -> The event document ID.
 * @param {string} slotId -> Target slot.
 * @returns {Promise<void>}
 */
async function handleSlotSwitchButton(interaction, eventId, slotId) {
    if (await isRegistrationBlocked()) {
        return interaction.update({ content: '❌ Event-Registrierungen sind wegen Wartungsarbeiten vorübergehend deaktiviert.', components: [] });
    }
    const { switchOwnSlot } = require('./utils/registrationService');
    const result = await switchOwnSlot({ eventId, userId: interaction.user.id, slotId });
    await interaction.update({ content: result.ok ? `✅ ${result.message}` : `❌ ${result.error}`, components: [] });
}

/**
 * Handle "Abmelden" in the ephemeral status answer.
 *
 * @param {import('discord.js').ButtonInteraction} interaction -> The button interaction.
 * @param {string} eventId -> The event document ID.
 * @returns {Promise<void>}
 */
async function handleSlotLeaveButton(interaction, eventId) {
    const { unregisterUserFromEvent } = require('./utils/registrationService');
    const result = await unregisterUserFromEvent({ eventId, userId: interaction.user.id });
    const title = result.event && result.event.title ? result.event.title : 'dem Event';
    await interaction.update({
        content: result.ok ? `✅ Du wurdest von **${title}** abgemeldet.` : `❌ ${result.error}`,
        components: []
    });
}
```

3. Dispatcher — im Modal-Zweig die Zeile `const [modalAction, modalEventId] = interaction.customId.split(':');` ersetzen durch:

```js
        const [modalAction, modalEventId, modalSlotId] = interaction.customId.split(':');
        if (modalAction === SLOT_MODAL_PREFIX && modalEventId && modalSlotId) {
            try {
                await handleEventSlotModal(interaction, modalEventId, modalSlotId);
            } catch (err) {
                console.error('Event slot modal error:', err);
                await replyWithFailure(interaction);
            }
            return;
        }
```

Im Button-Zweig direkt nach `if (interaction.isButton()) {` (vor `const [action, registrationId, guestId] = ...`):

```js
        const [buttonAction, buttonEventId, buttonSlotId] = interaction.customId.split(':');
        if ([SLOT_BUTTON_PREFIX, SLOT_SWITCH_PREFIX, SLOT_LEAVE_PREFIX].includes(buttonAction) && buttonEventId) {
            try {
                if (buttonAction === SLOT_BUTTON_PREFIX) {
                    await handleEventSlotButton(interaction, buttonEventId, buttonSlotId);
                } else if (buttonAction === SLOT_SWITCH_PREFIX) {
                    await handleSlotSwitchButton(interaction, buttonEventId, buttonSlotId);
                } else {
                    await handleSlotLeaveButton(interaction, buttonEventId);
                }
            } catch (err) {
                console.error('Slot button error:', err);
                await replyWithFailure(interaction);
            }
            return;
        }
```

4. `/unregister` — im `try` des Befehls alles ab `// Find user's registration` bis einschließlich des Blocks unter `// Promote from waitlist if a spot opened up` ersetzen durch:

```js
            const { unregisterUserFromEvent } = require('./utils/registrationService');
            const result = await unregisterUserFromEvent({ eventId, userId });
            if (!result.ok) {
                return interaction.reply({ content: `⚠️ ${result.error}`, flags: MessageFlags.Ephemeral });
            }
```

(Das Laden des Events davor und das Erfolgs-Embed danach bleiben.)

5. Gäste-Absage — im `else`-Zweig (Ablehnung) direkt nach `await updateDoc(regRef, { pendingGuests });`:

```js
                    // The open invitation no longer reserves a place
                    require('./utils/announcementRefresh').notifyRegistrationsChanged(reg.eventId);
```

- [ ] **Step 6: Run all tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Manuelle Prüfung (nur mit Test-Discord und Bot-Token)**

`npm run dev` mit echter `.env`, Slot-Event anlegen und ankündigen. Prüfen: Slot-Button öffnet Modal mit Ausweichrollen; nach Absenden ephemerale Antwort mit Slot; das Embed aktualisiert sich nach ~2 s; erneuter Klick zeigt „Zu … wechseln“/„Abmelden“; `/unregister` funktioniert. Ohne Test-Server: Schritt überspringen und im PR unter „Verifikation“ vermerken.

- [ ] **Step 8: Commit**

```bash
git add bot.js test/eventComponents.test.js
git commit -m "Join, switch and leave role slots from Discord" -m "Each slot button opens a modal with the fallback roles; members who are already registered get their status with a switch and a leave button. /unregister and the new button share the web unregister path." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018hAdfGQGsteU1Kwt1KHJg7"
```

---
### Task 12: Dev-Mock-Daten — Raid-Event mit Slots

**Files:**
- Modify: `dev/seedData.js`
- Test: `test/seed.test.js`

**Interfaces:**
- Consumes: Datenfelder aus Task 7 (`slotId`, `preferredSlotId`, `altSlotIds`)
- Produces: `EVENT_ID.ROLE` („Raid: Schattenfestung“) mit Slots `tank` (1), `heal` (2), `dps` (3); Ben = Tank, Kira = Heiler als Ausweich (wollte Tank), Felix = Warteliste (will Tank). Lena (Persona `raider`) ist frei zum Ausprobieren. Anzahl der Dokumente bleibt gleich (`registrations: 32`).

- [ ] **Step 1: Write the failing test** — in `test/seed.test.js` nach `the full event is exactly full` einfügen:

```js
test('the raid event has a line-up with a fallback role and a waitlist', async () => {
    const raid = await getEvent(EVENT_ID.ROLE);
    assert.deepEqual(raid.slots.map(slot => slot.id), ['tank', 'heal', 'dps']);
    assert.equal(raid.maxParticipants, 6);
    assert.equal(raid.allowGuests, false);

    const registrations = await registrationsOf(EVENT_ID.ROLE);
    assert.ok(registrations.some(r => r.status === 'accepted' && r.slotId !== r.preferredSlotId));
    assert.ok(registrations.some(r => r.status === 'waitlisted' && r.slotId === null && r.preferredSlotId === 'tank'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/seed.test.js`
Expected: FAIL (`raid.slots` ist `undefined`).

- [ ] **Step 3: Implement in `dev/seedData.js`**

Nach `SERIES_EVENT_IDS` einfügen:

```js
/** Role slots of the raid event. */
const RAID_SLOT_ID = { TANK: 'tank', HEAL: 'heal', DPS: 'dps' };
```

Im Event `[EVENT_ID.ROLE]` die Zeile `maxParticipants: 10,` ersetzen durch:

```js
            maxParticipants: 6,
            allowGuests: false,
            slots: [
                { id: RAID_SLOT_ID.TANK, name: 'Tank', emoji: '🛡️', capacity: 1 },
                { id: RAID_SLOT_ID.HEAL, name: 'Heiler', emoji: '💚', capacity: 2 },
                { id: RAID_SLOT_ID.DPS, name: 'Schaden', emoji: '⚔️', capacity: 3 }
            ],
```

In `buildRegistrations` die drei Einträge unter `// Role event -> Raid-Team members only` ersetzen durch:

```js
        // Raid with role slots -> the tank slot is full, Kira plays her fallback role,
        // Felix waits for the tank slot; Lena (raider persona) can still pick a role
        entry('role-ben', EVENT_ID.ROLE, ben, {
            slotId: RAID_SLOT_ID.TANK, preferredSlotId: RAID_SLOT_ID.TANK, altSlotIds: [], createdAt: clock.offset(-4 * DAY)
        }),
        entry('role-kira', EVENT_ID.ROLE, kira, {
            source: 'discord', slotId: RAID_SLOT_ID.HEAL, preferredSlotId: RAID_SLOT_ID.TANK,
            altSlotIds: [RAID_SLOT_ID.HEAL], createdAt: clock.offset(-3 * DAY)
        }),
        entry('role-felix', EVENT_ID.ROLE, felix, {
            status: 'waitlisted', slotId: null, preferredSlotId: RAID_SLOT_ID.TANK, altSlotIds: [], createdAt: clock.offset(-2 * DAY)
        }),
```

`module.exports` um `RAID_SLOT_ID` erweitern.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/seed.test.js test/devServer.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dev/seedData.js test/seed.test.js
git commit -m "Seed the raid event with role slots" -m "npm run dev:mock should show the new feature right away: a full tank slot, a member in her fallback role and someone on the waitlist, with the raider persona still free to try it." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018hAdfGQGsteU1Kwt1KHJg7"
```

---

### Task 13: Frontend — Slot-Editor im Wizard und Chips auf den Event-Karten

**Files:**
- Modify: `public/index.html` (Wizard Schritt 3), `public/js/app.js` (`showCreateEventModal`, `editEvent`, `saveEvent`, Karten-Template in `showEventsSection`, neue Funktionen), `public/css/style.css` (neuer Abschnitt am Dateiende)

**Interfaces:**
- Consumes: `POST/PUT /api/admin/events` mit `slots` (Task 8), `slotSummary` in `GET /api/events` (Task 9)
- Produces: globale Funktionen `renderSlotEditor(slots)`, `toggleSlotEditor()`, `addSlotRow(slot)`, `removeSlotRow(button)`, `applySlotPreset(name)`, `getSlotsFromEditor()`, `updateSlotTotals()`, `renderSlotChips(slotSummary)`, `formatSlotLabel(slot)`; Konstanten `MAX_SLOTS_PER_EVENT`, `SLOT_PRESETS`

Kein automatisierter UI-Test (das Projekt hat keine Browser-Tests); Verifikation manuell im Mock-Modus.

- [ ] **Step 1: Markup in `public/index.html`**

Im Wizard-Schritt 3 (`<div class="wizard-page" id="wizard-page-3"`) direkt **nach** der ersten `<div class="row g-3 mb-3">…</div>` (Max. Teilnehmer / Erinnerung) einfügen:

```html
              <div class="mb-3">
                <div class="form-check form-switch">
                  <input class="form-check-input" type="checkbox" id="event-use-slots" onchange="toggleSlotEditor()">
                  <label class="form-check-label" for="event-use-slots"><i class="bi bi-diagram-3 me-1"></i>Rollen-Slots verwenden</label>
                </div>
                <div id="slot-editor-area" style="display:none;">
                  <div id="slot-editor-rows" class="slot-editor-rows"></div>
                  <div class="d-flex flex-wrap gap-2 mt-2">
                    <button type="button" class="btn btn-sm btn-outline-light" onclick="addSlotRow()"><i class="bi bi-plus-lg me-1"></i>Slot</button>
                    <button type="button" class="btn btn-sm btn-outline-secondary" onclick="applySlotPreset('mmo-raid')"><i class="bi bi-magic me-1"></i>Vorlage: MMO-Raid</button>
                  </div>
                  <small class="text-muted d-block mt-1">Max. 10 Slots. Die Teilnehmerzahl ergibt sich aus der Summe der Plätze.</small>
                </div>
              </div>
```

Unter dem Gäste-Schalter (nach `<label class="form-check-label" for="event-allow-guests">Gäste zulassen</label>` und dem schließenden `</div>` des `form-check`) einfügen:

```html
                  <small class="text-muted" id="event-guests-slot-hint" style="display:none;">Bei Slot-Events nicht verfügbar</small>
```

- [ ] **Step 2: Wizard-Logik in `public/js/app.js`**

Direkt nach der Funktion `getFormFieldsFromBuilder` (`grep -n "^function getFormFieldsFromBuilder" public/js/app.js`) einfügen:

```js
// ─── Role Slots (wizard) ─────────────────────────
const MAX_SLOTS_PER_EVENT = 10;
const SLOT_PRESETS = {
    'mmo-raid': [
        { emoji: '🛡️', name: 'Tank', capacity: 2 },
        { emoji: '💚', name: 'Heiler', capacity: 3 },
        { emoji: '⚔️', name: 'Schaden', capacity: 10 }
    ]
};

function formatSlotLabel(slot) {
    if (!slot) return '';
    return slot.emoji ? `${slot.emoji} ${slot.name}` : slot.name;
}

function renderSlotEditor(slots) {
    const list = Array.isArray(slots) ? slots : [];
    document.getElementById('event-use-slots').checked = list.length > 0;
    document.getElementById('slot-editor-rows').innerHTML = '';
    list.forEach(slot => addSlotRow(slot));
    toggleSlotEditor();
}

function toggleSlotEditor() {
    const enabled = document.getElementById('event-use-slots').checked;
    document.getElementById('slot-editor-area').style.display = enabled ? 'block' : 'none';
    if (enabled && document.querySelectorAll('#slot-editor-rows .slot-editor-row').length === 0) {
        addSlotRow();
    }
    updateSlotTotals();
}

function addSlotRow(slot = {}) {
    const rows = document.getElementById('slot-editor-rows');
    if (rows.querySelectorAll('.slot-editor-row').length >= MAX_SLOTS_PER_EVENT) {
        showToast(`Es sind höchstens ${MAX_SLOTS_PER_EVENT} Slots möglich.`, 'warning');
        return;
    }
    const row = document.createElement('div');
    row.className = 'slot-editor-row';
    row.dataset.slotId = slot.id || '';
    row.innerHTML = `
        <input type="text" class="form-control slot-emoji-input" maxlength="8" placeholder="🎯" value="${escapeHtml(slot.emoji || '')}" aria-label="Emoji">
        <input type="text" class="form-control slot-name-input" maxlength="30" placeholder="Name, z. B. Tank" value="${escapeHtml(slot.name || '')}" aria-label="Slot-Name">
        <input type="number" class="form-control slot-capacity-input" min="1" max="100" value="${escapeHtml(String(slot.capacity || 1))}" aria-label="Plätze" oninput="updateSlotTotals()">
        <button type="button" class="btn btn-sm btn-outline-danger" onclick="removeSlotRow(this)" title="Slot entfernen"><i class="bi bi-trash"></i></button>`;
    rows.appendChild(row);
    updateSlotTotals();
}

function removeSlotRow(button) {
    const row = button.closest('.slot-editor-row');
    if (row) row.remove();
    updateSlotTotals();
}

function applySlotPreset(presetName) {
    const preset = SLOT_PRESETS[presetName];
    if (!preset) return;
    document.getElementById('slot-editor-rows').innerHTML = '';
    preset.forEach(slot => addSlotRow(slot));
}

function getSlotsFromEditor() {
    if (!document.getElementById('event-use-slots').checked) return [];
    return [...document.querySelectorAll('#slot-editor-rows .slot-editor-row')].map(row => ({
        id: row.dataset.slotId || undefined,
        emoji: row.querySelector('.slot-emoji-input').value.trim(),
        name: row.querySelector('.slot-name-input').value.trim(),
        capacity: parseInt(row.querySelector('.slot-capacity-input').value, 10) || 0
    }));
}

function updateSlotTotals() {
    const enabled = document.getElementById('event-use-slots').checked;
    const maxInput = document.getElementById('event-max');
    const guestToggle = document.getElementById('event-allow-guests');
    const guestHint = document.getElementById('event-guests-slot-hint');
    maxInput.disabled = enabled;
    guestToggle.disabled = enabled;
    if (guestHint) guestHint.style.display = enabled ? 'block' : 'none';
    if (enabled) {
        maxInput.value = getSlotsFromEditor().reduce((sum, slot) => sum + Math.max(0, slot.capacity), 0);
        guestToggle.checked = false;
    }
}
```

In `showCreateEventModal` direkt nach `document.getElementById('event-allow-guests').checked = true;`: `renderSlotEditor([]);`

In `editEvent` direkt nach `document.getElementById('event-allow-guests').checked = event.allowGuests !== false;`: `renderSlotEditor(event.slots || []);`

In `saveEvent` im `data`-Objekt nach `allowGuests: ...,`: `slots: getSlotsFromEditor(),`

- [ ] **Step 3: Chips auf den Event-Karten**

Nach der Funktion `getParticipantWarningBadge` einfügen:

```js
function renderSlotChips(slotSummary) {
    if (!Array.isArray(slotSummary) || slotSummary.length === 0) return '';
    const chips = slotSummary.map(slot => {
        const free = slot.capacity - slot.taken;
        const text = free > 0 ? `${free} frei` : 'voll';
        return `<span class="slot-chip${free > 0 ? '' : ' full'}" title="${escapeHtml(slot.name)}: ${slot.taken}/${slot.capacity}">${escapeHtml(slot.emoji || slot.name)} ${text}</span>`;
    }).join('');
    return `<div class="slot-chips">${chips}</div>`;
}
```

Im Karten-Template von `showEventsSection` direkt nach `${getParticipantWarningBadge(event)}` die Zeile `${renderSlotChips(event.slotSummary)}` einfügen.

- [ ] **Step 4: CSS** — am Ende von `public/css/style.css` anhängen:

```css
/* ============================================ */
/* ROLE SLOTS                                   */
/* ============================================ */
.slot-editor-rows {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.slot-editor-row {
  display: grid;
  grid-template-columns: 4rem 1fr 6rem auto;
  gap: 0.5rem;
  align-items: center;
}

.slot-emoji-input {
  text-align: center;
}

@media (max-width: 576px) {
  .slot-editor-row {
    grid-template-columns: 3.5rem 1fr 4.5rem auto;
  }
}

.slot-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  width: 100%;
  margin-top: 0.35rem;
}

.slot-chip {
  font-size: 0.75rem;
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  background: rgba(139, 92, 246, 0.12);
  border: 1px solid var(--border-accent);
  color: var(--text-primary);
  white-space: nowrap;
}

.slot-chip.full {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.35);
  color: var(--text-secondary);
}
```

- [ ] **Step 5: Manuell prüfen**

Run: `npm run dev:reset && npm run dev:mock`, dann `http://localhost:3000` → Persona „Admin“.
Expected:
- Event-Übersicht: „Raid: Schattenfestung“ zeigt Chips `🛡️ voll · 💚 1 frei · ⚔️ 3 frei`.
- Admin → „Neues Event“ → Schritt 3: Schalter „Rollen-Slots verwenden“ blendet den Editor ein; „Vorlage: MMO-Raid“ füllt drei Zeilen; „Max. Teilnehmer“ zeigt 15 und ist gesperrt; Gäste-Schalter aus und gesperrt, Hinweis sichtbar.
- Speichern mit Emoji `abc` → roter Toast „Das Emoji von Slot „…“ muss ein einzelnes Emoji sein.“; mit gültigen Werten → Event angelegt.
- Event bearbeiten → Slots erscheinen wieder im Editor.
- Browser-Konsole ohne Fehler; bei ~400 px Breite brechen die Editor-Zeilen nicht aus dem Modal aus.

Zusätzlich: `npm test` → PASS.

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/js/app.js public/css/style.css
git commit -m "Add the slot editor to the event wizard and slot chips to the cards" -m "Admins define roles with emoji, name and places (or start from the MMO raid preset); the event list shows at a glance which roles still need people." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018hAdfGQGsteU1Kwt1KHJg7"
```

---

### Task 14: Frontend — Aufstellung, Slot-Wahl und eigener Slot auf der Event-Seite

**Files:**
- Modify: `public/index.html` (Teilnehmer-Sektion, Anmeldeformular, „Bereits registriert“), `public/js/app.js` (`renderSidebarAction`, `loadDetailParticipants`, `showEventDetail`, `submitRegistration`, neue Funktionen), `public/css/style.css`

**Interfaces:**
- Consumes: `GET /api/events/:id` (`slots`, `slotSummary`), `GET /api/events/:id/participants` (`slots`, `waitlist`), `GET /api/events/:id/my-registration` (`slotId`, `preferredSlotId`, `altSlotIds`), `POST /api/events/:id/register` (`slotId`, `altSlotIds`), `PUT /api/events/:id/register/slot` (Task 9); `formatSlotLabel` (Task 13)
- Produces: globale Funktionen `eventHasSlots(event)`, `renderSlotPicker(event)`, `selectPrimarySlot(slotId)`, `renderAltSlotChips()`, `toggleAltSlot(slotId)`, `renderRoster(data)`, `renderRosterAvatar(person)`, `renderOwnSlot(event, registration)`, `switchMySlot(eventId)`; Globals `selectedSlotId`, `selectedAltSlotIds`, `slotPickerSlots`

- [ ] **Step 1: Markup in `public/index.html`**

In `#detail-participants-section` das Wort `TEILNEHMER` in ein Span mit ID fassen und die Aufstellung ergänzen:

```html
              <h6 class="section-label mb-3">
                <i class="bi bi-people me-2"></i><span id="detail-participants-title">TEILNEHMER</span>
                <span id="detail-participants-count" class="ms-1 fw-normal text-secondary"></span>
              </h6>
              <div id="detail-participants-avatars" class="participants-avatar-stack"></div>
              <div id="detail-roster" style="display:none;"></div>
```

Im `#registration-form` direkt vor `<div id="dynamic-form-fields"></div>`:

```html
                  <div id="slot-picker-area" class="mb-3" style="display:none;"></div>
```

In `#detail-registered` nach `<p class="text-secondary mb-0">Status: <span id="detail-reg-status" class="fw-bold"></span></p>`:

```html
                    <div id="detail-reg-slot" class="mt-2"></div>
```

- [ ] **Step 2: Neue Funktionen in `public/js/app.js`**

Direkt nach `loadDetailParticipants` einfügen:

```js
// ─── Role Slots (event page) ─────────────────────
let selectedSlotId = null;
let selectedAltSlotIds = [];
let slotPickerSlots = [];

function eventHasSlots(event) {
    return !!event && Array.isArray(event.slots) && event.slots.length > 0;
}

function renderSlotPicker(event) {
    const area = document.getElementById('slot-picker-area');
    if (!area) return;
    selectedSlotId = null;
    selectedAltSlotIds = [];
    slotPickerSlots = eventHasSlots(event) ? event.slots : [];
    if (slotPickerSlots.length === 0) {
        area.style.display = 'none';
        area.innerHTML = '';
        return;
    }

    const summary = Array.isArray(event.slotSummary)
        ? event.slotSummary
        : event.slots.map(slot => ({ ...slot, taken: 0 }));
    area.style.display = 'block';
    area.innerHTML = `
        <label class="form-label mb-2"><i class="bi bi-diagram-3 me-1"></i>Deine Rolle <span class="text-danger">*</span></label>
        <div class="slot-picker" id="slot-picker-cards">
            ${summary.map(slot => {
                const full = slot.taken >= slot.capacity;
                return `
                <button type="button" class="slot-card${full ? ' full' : ''}" data-slot-id="${escapeHtml(slot.id)}" onclick="selectPrimarySlot(this.dataset.slotId)">
                    <span class="slot-card-emoji">${escapeHtml(slot.emoji || '🎯')}</span>
                    <span class="slot-card-name">${escapeHtml(slot.name)}</span>
                    <span class="slot-card-count">${slot.taken}/${slot.capacity}</span>
                    ${full ? '<span class="slot-card-hint">voll – Ausweich/Warteliste</span>' : ''}
                </button>`;
            }).join('')}
        </div>
        <div id="slot-alt-area" class="mt-3" style="display:none;">
            <label class="form-label mb-1">Ausweichrollen <small class="text-muted">(optional – falls deine Rolle voll ist)</small></label>
            <div class="d-flex flex-wrap gap-2" id="slot-alt-chips"></div>
        </div>`;
}

function selectPrimarySlot(slotId) {
    selectedSlotId = slotId;
    selectedAltSlotIds = selectedAltSlotIds.filter(id => id !== slotId);
    document.querySelectorAll('#slot-picker-cards .slot-card').forEach(card => {
        card.classList.toggle('selected', card.dataset.slotId === slotId);
    });
    renderAltSlotChips();
}

function renderAltSlotChips() {
    const area = document.getElementById('slot-alt-area');
    const chips = document.getElementById('slot-alt-chips');
    if (!area || !chips) return;
    const others = slotPickerSlots.filter(slot => slot.id !== selectedSlotId);
    if (!selectedSlotId || others.length === 0) {
        area.style.display = 'none';
        return;
    }
    area.style.display = 'block';
    chips.innerHTML = others.map(slot => `
        <button type="button" class="slot-alt-chip${selectedAltSlotIds.includes(slot.id) ? ' selected' : ''}" data-slot-id="${escapeHtml(slot.id)}" onclick="toggleAltSlot(this.dataset.slotId)">
            ${escapeHtml(formatSlotLabel(slot))}
        </button>`).join('');
}

function toggleAltSlot(slotId) {
    selectedAltSlotIds = selectedAltSlotIds.includes(slotId)
        ? selectedAltSlotIds.filter(id => id !== slotId)
        : [...selectedAltSlotIds, slotId];
    renderAltSlotChips();
}

function renderRosterAvatar(person) {
    const initial = escapeHtml((person.displayName || '?').charAt(0).toUpperCase());
    if (person.avatar) {
        return `<img src="${escapeHtml(person.avatar)}" class="roster-avatar" alt="" onerror="this.style.visibility='hidden'">`;
    }
    return `<span class="roster-avatar roster-avatar-fallback">${initial}</span>`;
}

function renderRoster(data) {
    const maxFreeSeats = 5;
    const slotsHtml = data.slots.map(slot => {
        const overbooked = slot.taken > slot.capacity;
        const pct = Math.min(100, Math.round((slot.taken / slot.capacity) * 100));
        const members = slot.members.map(member => `
            <div class="roster-member">
                ${renderRosterAvatar(member)}
                <span class="roster-name">${escapeHtml(member.displayName)}</span>
                ${member.pending ? '<span class="roster-tag" title="Anfrage ausstehend">⏳</span>' : ''}
                ${member.isAlt ? '<span class="roster-tag roster-tag-alt">Ausweich</span>' : ''}
            </div>`).join('');
        const freeSeats = Math.max(0, slot.capacity - slot.taken);
        const seats = Array.from({ length: Math.min(freeSeats, maxFreeSeats) }, () =>
            '<div class="roster-member roster-seat-free"><span class="roster-seat-dot"></span><span class="roster-name text-muted">frei</span></div>'
        ).join('');
        const moreFree = freeSeats > maxFreeSeats
            ? `<div class="text-muted small">+${freeSeats - maxFreeSeats} weitere freie Plätze</div>`
            : '';
        return `
            <div class="roster-slot${overbooked ? ' overbooked' : ''}">
                <div class="roster-slot-head">
                    <span>${escapeHtml(formatSlotLabel(slot))}</span>
                    <span class="roster-slot-count">${slot.taken}/${slot.capacity}</span>
                </div>
                <div class="capacity-progress"><div class="capacity-progress-bar${pct >= 100 ? ' danger' : ''}" style="width:${pct}%"></div></div>
                <div class="roster-members">${members}${seats}${moreFree}</div>
            </div>`;
    }).join('');

    const slotById = Object.fromEntries(data.slots.map(slot => [slot.id, slot]));
    const waitlist = data.waitlist.length === 0 ? '' : `
        <div class="mt-3">
            <div class="section-label mb-2"><i class="bi bi-hourglass-split me-1"></i>WARTELISTE (${data.waitlist.length})</div>
            ${data.waitlist.map(entry => {
                const wishes = [entry.preferredSlotId, ...entry.altSlotIds]
                    .map(id => slotById[id])
                    .filter(Boolean)
                    .map(slot => escapeHtml(slot.emoji || slot.name))
                    .join(' ');
                return `<div class="roster-member">${renderRosterAvatar(entry)}<span class="roster-name">${escapeHtml(entry.displayName)}</span><span class="roster-wishes">${wishes}</span></div>`;
            }).join('')}
        </div>`;

    return `<div class="roster-grid">${slotsHtml}</div>${waitlist}`;
}

function renderOwnSlot(event, registration) {
    const area = document.getElementById('detail-reg-slot');
    if (!area) return;
    if (!eventHasSlots(event) || registration.asGuest || registration.status === 'rejected') {
        area.innerHTML = '';
        return;
    }
    const summary = Array.isArray(event.slotSummary) ? event.slotSummary : [];
    const current = summary.find(slot => slot.id === registration.slotId);
    const isAlt = !!current && registration.slotId !== registration.preferredSlotId;
    const freeSlots = summary.filter(slot => slot.id !== registration.slotId && slot.taken < slot.capacity);
    const placement = current
        ? `Du bist als <strong>${escapeHtml(formatSlotLabel(current))}</strong> eingeplant${isAlt ? ' <span class="roster-tag roster-tag-alt">Ausweich</span>' : ''}.`
        : 'Du stehst auf der Warteliste.';
    const switcher = freeSlots.length === 0 ? '' : `
        <div class="input-group input-group-sm mt-2">
            <select class="form-select" id="own-slot-select" aria-label="Neuer Slot">
                ${freeSlots.map(slot => `<option value="${escapeHtml(slot.id)}">${escapeHtml(formatSlotLabel(slot))} (${slot.taken}/${slot.capacity})</option>`).join('')}
            </select>
            <button class="btn btn-outline-light" type="button" data-event-id="${escapeHtml(event.id)}" onclick="switchMySlot(this.dataset.eventId)">Slot wechseln</button>
        </div>`;
    area.innerHTML = `<div class="small">${placement}</div>${switcher}`;
}

async function switchMySlot(eventId) {
    const select = document.getElementById('own-slot-select');
    if (!select || !select.value) return;
    try {
        const res = await fetch(`/api/events/${eventId}/register/slot`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrfToken },
            body: JSON.stringify({ slotId: select.value })
        });
        const result = await res.json();
        if (res.ok) {
            showToast(result.message || 'Slot gewechselt.', 'success');
            showEventDetail(eventId);
        } else {
            showToast(result.error || 'Slot konnte nicht gewechselt werden.', 'danger');
        }
    } catch {
        showToast('Netzwerkfehler.', 'danger');
    }
}
```

- [ ] **Step 3: Bestehende Funktionen anpassen**

`loadDetailParticipants` — direkt nach `section.style.display = 'block';` einfügen:

```js
        const rosterEl = document.getElementById('detail-roster');
        const titleEl = document.getElementById('detail-participants-title');
        if (Array.isArray(data.slots)) {
            if (titleEl) titleEl.textContent = 'AUFSTELLUNG';
            avatarsEl.style.display = 'none';
            rosterEl.style.display = 'block';
            rosterEl.innerHTML = renderRoster(data);
            if (countEl) countEl.textContent = `(${data.slots.reduce((sum, slot) => sum + slot.taken, 0)})`;
            return;
        }
        if (titleEl) titleEl.textContent = 'TEILNEHMER';
        avatarsEl.style.display = '';
        if (rosterEl) {
            rosterEl.style.display = 'none';
            rosterEl.innerHTML = '';
        }
```

`renderSidebarAction` — die Zeile mit `const hasFormFields = ...` ersetzen durch:

```js
    // Slot events need the role picker in the form -> the sidebar scrolls there instead of submitting
    const hasFormFields = event && ((Array.isArray(event.formFields) && event.formFields.length > 0) || eventHasSlots(event));
```

`showEventDetail`:
- Im Zweig `if (regData.registered) {` nach dem Setzen von `statusEl.className = ...`: `renderOwnSlot(event, regData);`
- Die Zeile `const isFull = event.maxParticipants > 0 && event.currentParticipants >= event.maxParticipants;` ersetzen durch:
  ```js
        // Slot events always show the form -> the server picks slot, fallback or waitlist
        const isFull = !eventHasSlots(event) && event.maxParticipants > 0 && event.currentParticipants >= event.maxParticipants;
  ```
- Im `else`-Zweig (Formular anzeigen) direkt nach `renderFormFields(event.formFields || []);`: `renderSlotPicker(event);`
- Dort `guestArea.style.display = event.allowGuests === false ? 'none' : 'block';` ersetzen durch:
  ```js
                guestArea.style.display = event.allowGuests === false || eventHasSlots(event) ? 'none' : 'block';
  ```

`submitRegistration` — nach dem Block mit `if (missingFields.length > 0) { ... return; }` einfügen:

```js
    const usesSlots = eventHasSlots(event) && formContainerId === 'dynamic-form-fields';
    if (usesSlots && !selectedSlotId) {
        showToast('Bitte wähle eine Rolle aus.', 'danger');
        document.getElementById('slot-picker-area')?.scrollIntoView({ behavior: 'smooth' });
        return;
    }
```

die Bedingung `if (formContainerId === 'dynamic-form-fields') {` (Gäste) ersetzen durch `if (formContainerId === 'dynamic-form-fields' && !eventHasSlots(event)) {`, und den Request-Body durch:

```js
            body: JSON.stringify({
                formAnswers,
                guests,
                slotId: usesSlots ? selectedSlotId : undefined,
                altSlotIds: usesSlots ? selectedAltSlotIds : undefined
            }),
```

- [ ] **Step 4: CSS** — an den Abschnitt „ROLE SLOTS“ in `public/css/style.css` anhängen:

```css
.slot-picker {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr));
  gap: 0.6rem;
}

.slot-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.15rem;
  padding: 0.75rem 0.5rem;
  border-radius: var(--radius);
  border: 1px solid var(--border-subtle);
  background: var(--bg-glass);
  color: var(--text-primary);
  transition: var(--transition);
}

.slot-card:hover {
  border-color: var(--border-accent);
}

.slot-card.selected {
  border-color: var(--accent);
  background: rgba(139, 92, 246, 0.12);
  box-shadow: var(--shadow-glow);
}

.slot-card.full {
  opacity: 0.7;
}

.slot-card-emoji {
  font-size: 1.5rem;
  line-height: 1;
}

.slot-card-name {
  font-weight: 600;
}

.slot-card-count {
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.slot-card-hint {
  font-size: 0.7rem;
  color: var(--warning);
  text-align: center;
}

.slot-alt-chip {
  padding: 0.25rem 0.75rem;
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
  background: transparent;
  color: var(--text-secondary);
  transition: var(--transition);
}

.slot-alt-chip.selected {
  border-color: var(--accent);
  background: rgba(139, 92, 246, 0.15);
  color: var(--text-primary);
}

.roster-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
  gap: 0.85rem;
}

.roster-slot {
  padding: 0.75rem;
  border-radius: var(--radius);
  border: 1px solid var(--border-subtle);
  background: rgba(255, 255, 255, 0.02);
}

.roster-slot.overbooked {
  border-color: rgba(239, 68, 68, 0.5);
}

.roster-slot-head {
  display: flex;
  justify-content: space-between;
  font-weight: 600;
  margin-bottom: 0.4rem;
}

.roster-slot-count {
  color: var(--text-secondary);
  font-weight: 500;
}

.roster-slot.overbooked .roster-slot-count {
  color: var(--danger);
}

.roster-members {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-top: 0.6rem;
}

.roster-member {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 1.75rem;
}

.roster-avatar {
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.roster-avatar-fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--accent-dark);
  color: #fff;
  font-size: 0.8rem;
  font-weight: 600;
}

.roster-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.roster-tag {
  font-size: 0.7rem;
}

.roster-tag-alt {
  padding: 0.05rem 0.4rem;
  border-radius: 999px;
  background: rgba(234, 179, 8, 0.15);
  color: var(--warning);
}

.roster-seat-dot {
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 50%;
  border: 1px dashed var(--text-muted);
  flex-shrink: 0;
}

.roster-wishes {
  margin-left: auto;
  font-size: 0.85rem;
}
```

- [ ] **Step 5: Manuell prüfen**

Run: `npm run dev:reset && npm run dev:mock`, Persona „Raider“ (Lena), Event „Raid: Schattenfestung“ öffnen.
Expected:
- Sektion „AUFSTELLUNG“: drei Spalten; Tank `1/1` mit Ben; Heiler `1/2` mit Kira + Badge „Ausweich“ + ein freier, gestrichelter Platz; Schaden `0/3` mit drei freien Plätzen; „WARTELISTE (1)“ mit Felix und 🛡️.
- Anmeldeformular: drei Slot-Karten, Tank „voll – Ausweich/Warteliste“; ohne Auswahl → Toast „Bitte wähle eine Rolle aus.“; Tank wählen → Ausweich-Chips 💚/⚔️ erscheinen; mit Ausweich 💚 absenden → Toast „Erfolgreich angemeldet! Dein Slot: 💚 Heiler (🛡️ Tank war voll).“
- Danach „Bereits registriert“ mit „Du bist als 💚 Heiler eingeplant“ + Badge „Ausweich“ und Dropdown mit „⚔️ Schaden (0/3)“; wechseln → Toast „Du bist jetzt als ⚔️ Schaden eingeplant.“, Aufstellung aktualisiert.
- Gäste-Bereich ist bei diesem Event ausgeblendet; bei einem normalen Event (z. B. „Community-Spieleabend“) sieht alles aus wie vorher.
- Breite ~400 px: Slot-Karten und Aufstellung umbrechen sauber.

Zusätzlich: `npm test` → PASS.

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/js/app.js public/css/style.css
git commit -m "Show the line-up and the slot picker on the event page" -m "Members see who plays which role and where places are free, pick a main role with optional fallbacks, and can switch into a free slot after registering." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018hAdfGQGsteU1Kwt1KHJg7"
```

---

### Task 15: Frontend — Slot-Spalte in der Admin-Tabelle und Template-Hilfe

**Files:**
- Modify: `public/index.html` (Tabellenkopf `#registrationsModal`, Template-Hilfetexte), `public/js/app.js` (`showRegistrations`, `updateRegStatus`, neue Funktionen)

**Interfaces:**
- Consumes: `GET /api/admin/events/:id/registrations` (`slots`), `PUT /api/admin/registrations/:id/slot`, `PUT /api/admin/registrations/:id/status` (`warning`) aus Task 10; `formatSlotLabel` (Task 13)
- Produces: globale Funktionen `renderRegistrationSlotCell(reg, slots, eventId, eventTitle)`, `moveRegistrationSlot(select)`

- [ ] **Step 1: Markup** — in `public/index.html` im Tabellenkopf des Anmeldungs-Modals nach `<th>Status</th>` einfügen: `<th>Slot</th>`.

Template-Hilfe: `grep -n "{role.name}, {role.mention}" public/index.html` — an jeder Fundstelle `{role.name}, {role.mention}` durch `{role.name}, {role.mention}, {slot.name}, {slot.emoji}` ersetzen. Falls es weitere Hilfetexte mit `{event.url}` gibt (`grep -n "{event.url}" public/index.html`), dort ebenfalls `{slot.name}, {slot.emoji}` ergänzen.

- [ ] **Step 2: `public/js/app.js`**

Nach `updateRegStatus` einfügen:

```js
function renderRegistrationSlotCell(reg, slots, eventId, eventTitle) {
    if (slots.length === 0) return '<span class="text-muted">—</span>';
    const preferred = slots.find(slot => slot.id === reg.preferredSlotId);
    const wish = preferred && reg.preferredSlotId !== reg.slotId
        ? `<br><small class="text-muted">Wunsch: ${escapeHtml(formatSlotLabel(preferred))}</small>`
        : '';
    if (reg.status !== 'accepted' && reg.status !== 'pending') {
        return `<span class="text-muted">—</span>${wish}`;
    }
    const options = slots.map(slot =>
        `<option value="${escapeHtml(slot.id)}"${slot.id === reg.slotId ? ' selected' : ''}>${escapeHtml(formatSlotLabel(slot))}</option>`
    ).join('');
    return `<select class="form-select form-select-sm" aria-label="Slot"
        data-reg-id="${escapeHtml(reg.id)}" data-event-id="${escapeHtml(eventId)}" data-event-title="${escapeHtml(eventTitle)}"
        onchange="moveRegistrationSlot(this)">${options}</select>${wish}`;
}

async function moveRegistrationSlot(select) {
    const { regId, eventId, eventTitle } = select.dataset;
    try {
        const res = await fetch(`/api/admin/registrations/${regId}/slot`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrfToken },
            body: JSON.stringify({ slotId: select.value })
        });
        const result = await res.json();
        if (res.ok) {
            showToast(result.warning || 'Slot geändert.', result.warning ? 'warning' : 'success');
        } else {
            showToast(result.error || 'Slot konnte nicht geändert werden.', 'danger');
        }
    } catch {
        showToast('Netzwerkfehler.', 'danger');
    }
    showRegistrations(eventId, eventTitle);
}
```

In `showRegistrations`:
- nach `const regs = result.data || result;`: `const slots = Array.isArray(result.slots) ? result.slots : [];`
- in der Zeile nach der Status-Zelle (`</td>` hinter `${statusTexts[reg.status] || reg.status}` … `</span>`) eine neue Zelle einfügen:
  ```html
        <td>
          ${renderRegistrationSlotCell(reg, slots, eventId, eventTitle)}
        </td>
  ```
- die beiden `colspan="5"` (Lade- und Fehlerzeile) auf `colspan="7"` setzen.

In `updateRegStatus` den `if (res.ok) {`-Zweig ersetzen durch:

```js
        if (res.ok) {
            const result = await res.json();
            showToast(status === 'accepted' ? 'Angenommen!' : 'Abgelehnt.', status === 'accepted' ? 'success' : 'warning');
            if (result.warning) showToast(result.warning, 'warning');
            showRegistrations(eventId, eventTitle);
        } else {
```

- [ ] **Step 3: Manuell prüfen**

Run: `npm run dev:reset && npm run dev:mock`, Persona „Admin“ → Admin-Bereich → „Raid: Schattenfestung“ → Anmeldungen.
Expected:
- Spalte „Slot“: Ben `🛡️ Tank`, Kira `💚 Heiler` mit „Wunsch: 🛡️ Tank“, Felix „—“ mit „Wunsch: 🛡️ Tank“.
- Kira auf „🛡️ Tank“ stellen → gelber Toast „Slot „Tank“ ist jetzt überbucht.“, Tabelle lädt neu; Event-Seite zeigt Tank `2/1` rot markiert.
- Felix annehmen (✓) → Toast „Angenommen!“; Felix bekommt einen freien Slot (Heiler wurde frei) bzw. bei vollem Tank zusätzlich die Überbuchungs-Warnung.
- Bot-Nachrichten-Dialog und Event-Wizard zeigen `{slot.name}, {slot.emoji}` in der Hilfe.
- Normale Events: Spalte „Slot“ zeigt „—“.

Zusätzlich: `npm test` → PASS.

- [ ] **Step 4: Commit**

```bash
git add public/index.html public/js/app.js
git commit -m "Let admins move registrations between slots in the registration list" -m "Raid leaders adjust the line-up right where they accept and reject requests; overbooking warnings from the server are shown as toasts." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018hAdfGQGsteU1Kwt1KHJg7"
```

---

### Task 16: Wiki, What's New und Release 2.6.0

**Files:**
- Create: `docs/wiki/concepts/role-slots.md`
- Modify: `docs/wiki/concepts/data-model.md`, `docs/wiki/concepts/registration-flow.md`, `docs/wiki/concepts/discord-integration.md`, `docs/wiki/modules/bot.md`, `docs/wiki/modules/frontend-app.md`, `docs/wiki/modules/routes-events.md`, `docs/wiki/modules/routes-admin.md`, `docs/wiki/modules/utils.md`, `docs/wiki/modules/dev-mock-mode.md`, `docs/wiki/reference/api-index.md`, `docs/wiki/reference/known-issues.md`, `docs/wiki/index.md`, `docs/wiki/graph.json` (generiert), `updates.json`, `package.json`, `package-lock.json`
- Test: `test/wiki.test.js` (bestehend, über `npm test`)

**Interfaces:**
- Consumes: alles Vorherige
- Produces: aktuelles Wiki, Version 2.6.0

- [ ] **Step 1: Neuer Knoten `docs/wiki/concepts/role-slots.md`**

```markdown
---
id: role-slots
title: Role slots — line-ups with main and fallback roles
type: concept
tags: [slots, roles, raid, lineup, waitlist, fallback, announcements, live-embed, lock]
sources: [utils/slotService.js, utils/capacity.js, utils/eventLock.js, utils/announcementRefresh.js, utils/registrationService.js, utils/eventUtils.js, bot.js, routes/events.js, routes/admin.js, public/js/app.js]
depends_on: [data-model, registration-flow]
see_also: [discord-integration, event-lifecycle, bot, frontend-app]
---
# Role slots — line-ups with main and fallback roles

> TL;DR: An event can define up to 10 slots (`{ id, name, emoji, capacity }`, e.g. Tank 2 / Heiler 3 / Schaden 10). Members pick a main role plus optional fallback roles; `registerUserForEvent` gives them the main role, else the first free fallback (slot order), else the waitlist. Freed places go to the oldest waitlist entry that wants that slot. Every change refreshes the stored Discord announcements (debounced 2 s); all place-changing work runs under an in-memory lock per event.

## Data

- Event: `slots[]`; with slots `maxParticipants = Σ capacity` and `allowGuests = false` (enforced in `POST/PUT /api/admin/events`). `announcements: [{ channelId, messageId }]` (max 5) are the messages kept up to date.
- Registration: `slotId` (taken slot, `null` on the waitlist), `preferredSlotId` (main role), `altSlotIds` (fallbacks, slot order). "Fallback" = `slotId !== preferredSlotId`.

## Rules (`utils/slotService.js`, pure)

| Function | Rule |
|---|---|
| `normalizeSlots` | ≤10 slots, name 1–30 chars and unique, emoji empty or one Unicode emoji, capacity 1–100; IDs kept only if they already belong to the event |
| `pickSlot` | main role → first free fallback → `null` (waitlist) |
| `pickWaitlistPromotions` | waitlist oldest first; everyone whose main role or fallback has a free place moves up; overbooked slots stay closed |
| `resolveAcceptanceSlot` | admin accepts a slot-less registration: free wanted slot, else the main role overbooked (+ warning) |
| `validateSlotChange` | refuses removing a slot with pending/accepted registrations and switching slots on while open registrations exist |
| `buildRoster` | line-up for the event page and the embed |

Normal events use `utils/capacity.js`: places = 1 + guests + open invitations; promotion moves up every waitlisted registration that still fits (fixes the old guest overbooking).

## Flows

| Action | Entry points | Service |
|---|---|---|
| Register | web form (slot cards + fallback chips), Discord slot button → modal | `registerUserForEvent({ slotId, altSlotIds })` |
| Switch own slot (free slots only) | web "Slot wechseln", Discord "Zu … wechseln" | `switchOwnSlot` |
| Move (admin, may overbook) | admin registration list | `moveRegistrationToSlot`, audit `MOVE_REGISTRATION_SLOT` |
| Unregister | web, `/unregister`, Discord "Abmelden" | `unregisterUserFromEvent` |
| Promote | after unregister, reject, switch, move, capacity increase, account deletion | `promoteFromWaitlist` / `promoteFromWaitlistLocked` + `announcePromotions` |

## Discord

`buildEventComponents` renders one button per slot (`event_slot:<eventId>:<slotId>`, "(voll)" when full, 5 per row, link button last). The modal (`event_slot_modal:…`) starts with the fallback select `alt_slots` when there is more than one slot → slot events allow 4 form fields in Discord (`getModalFieldLimit`). Already registered members get an ephemeral answer with `slot_switch:<eventId>:<slotId>` and `slot_leave:<eventId>`. `refreshEventAnnouncements` edits the stored messages; deleted ones (Discord errors 10003/10008) are dropped.

## Concurrency

`withEventLock(eventId, fn)` (`utils/eventLock.js`) serializes registration, switch, move, admin status change and promotion per event. It is not reentrant: inside the lock call `promoteFromWaitlistLocked`, then `announcePromotions` after releasing it.

## Gotchas

- Guests are not possible on slot events.
- Nobody is moved back from a fallback to the main role automatically.
- Turning slots on is only allowed while the event has no open registrations.
- Live announcements need the message stored at announce time; announcements sent before 2.6.0 stay static.
```

- [ ] **Step 2: Bestehende Knoten aktualisieren**

- `data-model.md`: Tabelle `events` um Zeilen `slots` (`[{ id, name, emoji, capacity }]`, siehe [role-slots](role-slots.md)) und `announcements` (`[{ channelId, messageId }]`, max. 5) ergänzen; `registrations`-Zeile um `slotId?, preferredSlotId?, altSlotIds?` ergänzen; Audit-Action `MOVE_REGISTRATION_SLOT` ergänzen.
- `registration-flow.md`: im TL;DR und in „Checks in order“ nach Schritt 6 einen Schritt „Slot events: `slotId` must exist (`invalid_slot`), no guests; `pickSlot` decides slot or waitlist“ einfügen; Schritt 7 (Kapazität) auf „places = 1 + guests + open invitations (`utils/capacity.js`)“ ändern; Abschnitt „Entry points“ um `PUT /api/events/:id/register/slot` und die Discord-Slot-Buttons ergänzen; Unregister-Zeile auf `unregisterUserFromEvent` (web, `/unregister`, Button) ändern; in „Gotchas“ die Zeile zu `promoteFromWaitlist` ohne Gäste löschen und „Double click guarded only in memory“ ersetzen durch „Registrations of one event are serialized by `withEventLock` (in-memory, single process)“. `see_also` um `role-slots` ergänzen.
- `discord-integration.md`: Feature-Tabelle — Zeile „Announcement“ um „stores `{ channelId, messageId }` in `event.announcements`; `refreshEventAnnouncements` keeps embed + buttons live“ ergänzen, neue Zeile „Slot buttons“ (`event_slot:*`, Modal mit `alt_slots`, `slot_switch:*`, `slot_leave:*`), Template-Variablen `{slot.name}`, `{slot.emoji}`.
- `bot.md`: Funktionsliste um `buildSlotButton`, `formatParticipantCount`, `formatRosterSlotTitle`, `formatRosterMembers`, `buildSlotModal`, `addFormFieldLabels`, `readAltSlotIds`, `buildRegisteredSlotReply`, `handleEventSlotButton`, `handleEventSlotModal`, `handleSlotSwitchButton`, `handleSlotLeaveButton`, `replyWithFailure`, `refreshEventAnnouncements`, `isGoneDiscordError` ergänzen; Custom-ID-Tabelle um die vier neuen IDs; Exports um `refreshEventAnnouncements, isGoneDiscordError, buildSlotModal, buildRegisteredSlotReply`; Gotcha: `sendChannelMessage` liefert jetzt `{ channelId, messageId }`.
- `frontend-app.md`: Funktions-Tabelle um eine Zeile „Role slots“ mit `renderSlotEditor`, `toggleSlotEditor`, `addSlotRow`, `removeSlotRow`, `applySlotPreset`, `getSlotsFromEditor`, `updateSlotTotals`, `renderSlotChips`, `formatSlotLabel`, `eventHasSlots`, `renderSlotPicker`, `selectPrimarySlot`, `renderAltSlotChips`, `toggleAltSlot`, `renderRoster`, `renderRosterAvatar`, `renderOwnSlot`, `switchMySlot`, `renderRegistrationSlotCell`, `moveRegistrationSlot`; Globals `selectedSlotId`, `selectedAltSlotIds`, `slotPickerSlots`.
- `routes-events.md`, `routes-admin.md`, `api-index.md`: neue Endpunkte `PUT /api/events/:id/register/slot` (U) und `PUT /api/admin/registrations/:id/slot` (A); geänderte Antworten (`slotSummary`, `slots`/`waitlist` in participants, `slots` in der Admin-Liste, `warning`).
- `utils.md`: Module `capacity.js`, `slotService.js`, `eventLock.js`, `announcementRefresh.js` mit je einer Zeile; `registrationService.js` um `switchOwnSlot`, `moveRegistrationToSlot`, `unregisterUserFromEvent`, `buildTemplateVars`; `eventUtils.js` um `loadEventRegistrations`, `findUserRegistration`, `loadEventRoster`, `promoteFromWaitlistLocked`, `announcePromotions`; `sources` um die vier neuen Dateien.
- `dev-mock-mode.md`: Raid-Event mit Slots (Ben Tank, Kira Ausweich-Heiler, Felix Warteliste) und Mock `refreshEventAnnouncements` (Log „Ankündigung von "…" aktualisiert“).
- `known-issues.md`: Zeile #6 (`promoteFromWaitlist` counts registrations without guests) löschen (Nummern der anderen Zeilen bleiben).
- `index.md`: Knotenliste „concept“ um `[role-slots](concepts/role-slots.md)`; Task-Tabelle um „role slots / line-ups | role-slots, registration-flow“; Datei-Tabelle um `utils/slotService.js`, `utils/capacity.js`, `utils/eventLock.js`, `utils/announcementRefresh.js` → `role-slots, utils`.

- [ ] **Step 3: Graph erzeugen und prüfen**

Run: `npm run wiki && npm test`
Expected: `graph.json` aktualisiert, alle Tests PASS (inkl. `test/wiki.test.js`: keine kaputten Kanten, Quellen oder Links).

- [ ] **Step 4: What's New und Version**

`updates.json` ersetzen durch:

```json
{
    "version": "2.6.0",
    "date": "2026-10-02",
    "news": [
        {
            "title": "🛡️ Rollen-Slots für Raids & Teams",
            "content": "Events können jetzt Rollen wie Tank, Heiler oder Schaden mit eigener Platzzahl haben. Du wählst deine Hauptrolle und optional Ausweichrollen – ist deine Rolle voll, wirst du automatisch in einer freien Ausweichrolle eingeplant oder rückst später passend nach."
        },
        {
            "title": "🔄 Live-Ankündigungen in Discord",
            "content": "Die Event-Ankündigung zeigt die Aufstellung mit Namen und aktualisiert sich bei jeder An- und Abmeldung von selbst. Pro Rolle gibt es einen eigenen Button."
        },
        {
            "title": "↔️ Slot wechseln & Abmelden per Klick",
            "content": "Auf der Event-Seite und direkt in Discord kannst du in einen freien Slot wechseln oder dich abmelden – ganz ohne Befehl."
        }
    ]
}
```

Run: `npm version 2.6.0 --no-git-tag-version`
Expected: `package.json` und `package-lock.json` zeigen `2.6.0`.

- [ ] **Step 5: Gesamtprüfung**

Run: `npm test`
Expected: PASS.

Run: `npm run dev:reset && npm run dev:mock` → einmal den Ablauf aus Task 13–15 durchklicken (Admin legt Slot-Event an, kündigt es an; Raider meldet sich mit Ausweichrolle an; Konsole zeigt nach ~2 s `[MOCK-DISCORD] Ankündigung von "…" aktualisiert`; „What's New“-Dialog zeigt 2.6.0).

- [ ] **Step 6: Commit**

```bash
git add docs/wiki updates.json package.json package-lock.json
git commit -m "Document role slots and release 2.6.0" -m "The wiki describes the slot rules, the live announcements and the event lock, known issue #6 is gone, and the What's New dialog tells members about the new line-ups." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018hAdfGQGsteU1Kwt1KHJg7"
```

---

## Abschluss

Nach Task 16: `superpowers:finishing-a-development-branch` — PR auf Deutsch (Problem / Ursache / Änderung / Verifikation), in „Verifikation“ angeben, ob die Discord-Interaktionen (Task 11, Step 7) mit einem echten Test-Server geprüft wurden.
