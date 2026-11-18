# Design

## Context

See proposal.md for the why. Today every member registration goes through `registerUserForEvent()` → `createRegistration()` in `utils/registrationService.js` (checks, place decision, write under `withEventLock`) and then `notifyRegistration()` (DM, role, channels) and `notifyRegistrationsChanged()` (announcement refresh). Places are counted only for `OCCUPYING_STATUSES = ['pending', 'accepted']` (`utils/capacity.js`); slot occupancy (`utils/slotService.js`) uses the same list; reminders, check-in and event change notices already filter on `accepted`. So a new status outside these lists takes no place and gets no reminder without touching those paths.

Status lists that must learn the new status (found by grepping `waitlisted`): `utils/eventListing.js#OWN_STATUSES`, `utils/profileEvents.js#WISH_STATUSES`, `utils/participantMessage.js#MESSAGE_GROUPS.all`, `utils/bulkRegistrations.js`, `routes/admin.js` (stats ~l.122, CSV), `routes/user.js` (stats), `bot/settings.js` (registration stats), `bot/myEvents.js`, `bot/registration.js` status labels, and the frontend label maps (`events/cards.js`, `events/detail.js`, `pages/profile-view.js`, `admin/registrations.js`, `admin/registration-bulk.js`, `admin/member-view.js`, `admin/dashboard.js`).

Size limits: `bot/registration.js` (477 lines) and `utils/registrationService.js` (775) are full; new code goes into new modules.

## Goals / Non-Goals

**Goals:**
- One status value `tentative` in the existing `registrations` collection, so every list, export and admin view sees the bench without a second collection.
- Reuse the registration checks unchanged for the „Vielleicht“ answer and the place decision unchanged for „Fest zusagen“.

**Non-Goals:**
- „Fest zusagen“ from Discord (`/meine-events` only shows the status; confirming is on the website or by an admin). Can follow as a small change.
- Notifying the bench when a place frees.
- A bench limit or a bench order shown to members.

## Decisions

### D1 — `tentative` is a registration status, not a separate collection or flag
A flag on `pending`/`waitlisted` would leak into every capacity count; a second collection would duplicate the duplicate check, the role check and the form. A status outside `OCCUPYING_STATUSES` gets "no place, no promotion, no reminder, no check-in" for free. Constant `REGISTRATION_STATUS.TENTATIVE = 'tentative'` in `utils/registrationService.js`; `utils/capacity.js` exports `TENTATIVE_STATUS` so pure helpers do not import the service.

### D2 — Answering reuses `createRegistration` with a `tentative` option
`registerUserForEvent({ …, tentative: true })` passes the option through. `createRegistration` runs all checks as today, plus: refuse with new code `tentative_not_allowed` (400, „Für dieses Event gibt es kein „Vielleicht“.“) when `event.allowTentative !== true`; refuse guests (`guests_not_allowed`). On slot events it validates the wanted role and sanitizes fallbacks but does **not** call `pickSlot`; it stores `slotId: null, preferredSlotId, altSlotIds`. Status `tentative`, plus `tentativeAt = createdAt`. After the write, `registerUserForEvent` skips `notifyRegistration` and `postApprovalRequest` for `tentative` but still calls `notifyRegistrationsChanged`. Message: „Du stehst auf der Ersatzbank.“.
Alternative: a separate `answerTentative()` copying the checks — rejected, the checks would drift.

### D3 — „Fest zusagen“ lives in a new `utils/tentativeRegistration.js`
`confirmTentativeRegistration({ eventId, userId })` under `withEventLock`: load event and own registration; refuse `not_tentative` (400, „Du stehst nicht auf der Ersatzbank.“) unless status is `tentative`; then event active, `isEventOver` → `event_ended`, `isRegistrationClosed` → `registration_closed` (existing messages). Place decision as in `createRegistration`: slot events `pickSlot(slots, countSlotOccupancy(...), preferredSlotId, altSlotIds)`, else `countOccupiedPlaces + 1 > maxParticipants` → waitlisted, else by `approvalMode`. Update `{ status, slotId, createdAt: now }` (keep `tentativeAt`). After the lock: `notifyRegistration` (same DMs, role, channels as a new registration), `postApprovalRequest` for pending, `notifyRegistrationsChanged`.
To share the place decision without a second copy, extract `decideStatus(event, registrations, { slotId, altSlotIds, extraPlaces })` from `createRegistration` into `utils/slotService.js` (pure, unit-tested) and use it in both.

### D4 — Leaving the bench resets `createdAt`
The waitlist order (`waitlistPositions`, `pickCapacityPromotions`, slot promotion, bulk accept) sorts by `createdAt`. A member who answered „Vielleicht“ two weeks ago must not jump ahead of people who registered bindingly since. So every move out of `tentative` (confirm, admin single status change, bulk) sets `createdAt` to the time of the move; `tentativeAt` keeps the first answer for the admin dialog.
Alternative: a new `queuedAt` sort key — rejected, it would touch four sort sites and every existing registration.

### D5 — Withdrawing skips the unregister deadline
`unregisterUserFromEvent` checks `isUnregisterClosed` only when the registration is not `tentative`. It still removes role/channels (no-ops) and promotes the waitlist (no-op, nothing freed) — no special path.

### D6 — Admin decisions reuse `changeRegistrationStatus`
`PUT /api/admin/registrations/:id/status` keeps its targets (`accepted`, `rejected`, `waitlisted`) and now accepts them from `tentative`. `changeRegistrationStatus` sets `createdAt` (D4) when `reg.status === 'tentative'`. Accepting on slot events already calls `resolveAcceptanceSlot` (free wanted role or overbook with warning). `closeApprovalRequest` only runs for `pending`, so nothing to change there. `utils/bulkRegistrations.js`: add `tentative` to the source lists of accept, waitlist, reject; unselected tentative registrations already hold no place because `planBulkAction` counts `OCCUPYING_STATUSES`; set `createdAt` for moves out of `tentative`.

### D7 — Bench in places and roster
`summarizePlaces` gains `bench` (count of `tentative`), `describePlaces` gains `benchText` („2 auf der Ersatzbank“, empty for 0). `formatPlaces` stays unchanged (the sentence counts places). `buildRoster` (`utils/slotService.js`) gains `benchCount` (used by the Discord facts). Names follow the existing split in `routes/events.js` (every event route needs a login): `GET /api/events/:id` carries only `places` (now with `bench`/`benchText`, via `withPlaces`), while the logged-in `GET /api/events/:id/participants` (`requireAuth`) gains `bench: [{ displayName, avatar, preferredSlotId }]` for all events, oldest answer first, built from the `users` profiles like `participants` — no ids, times or form answers.

### D8 — Event field and template
`allowTentative` in the destructuring and in the built object of both `POST /api/admin/events` and `PUT /api/admin/events/:id` (`routes/admin.js`, the `allowGuests` neighbours ~l.368/399/432): `allowTentative === true`. Add to `TEMPLATE_FIELDS` and the normalizer in `utils/eventTemplates.js`. Wizard: one switch „Vielleicht / Ersatzbank erlauben“ next to „Gäste erlauben“ in `public/index.html`, read/written in the wizard module; the Discord preview shows the button.

### D9 — Website
`POST /api/events/:id/register` reads `req.body.tentative === true` and passes it through. New `POST /api/events/:id/register/confirm` (`requireAuth`, `checkRegistrationAllowed`, CSRF via the existing middleware) → `confirmTentativeRegistration`; answer `{ status, message, slotId }`; errors as `{ error }` with the service's HTTP status. Frontend: `registration-form.js` — `submitRegistration(…, { tentative })`, second button „Vielleicht“ (`data-click`) shown when `event.allowTentative`; guest picker hidden for the tentative submit. `detail.js` — own status „Vielleicht (Ersatzbank)“ with „Fest zusagen“ (`data-click="confirmTentative"`, registered in the owning module) and „Abmelden“; `benchText` next to the places; bench list (avatar helper + names, wanted role label on slot events) under the line-up in `slots.js` or the participants block for events without slots. Only existing components (chip, button, avatar) and tokens; icon `bi-question-circle` for „Vielleicht“.

### D10 — Discord
- `bot/constants.js`: `TENTATIVE_BUTTON_PREFIX = 'event_maybe'`, `TENTATIVE_MODAL_PREFIX = 'event_maybe_modal'`.
- `bot/messages.js`: `buildAnnouncementButtons` adds „Vielleicht“ (`ButtonStyle.Secondary`, emoji 🤔) when `joinable && event.allowTentative === true`; `buildEventFacts` adds `🤔 **Ersatzbank:** N` after the waitlist line when `roster.benchCount > 0`.
- New `bot/tentative.js`: `handleTentativeButton` (pre-checks via `checkRegistrationConditions` plus the `allowTentative` check; no form and no slots → register at once; else show the modal), `handleTentativeModal` (read answers with `parseModalAnswers`, wanted role from a single select built like the `alt_slots` select of `buildSlotModal`, then `registerUserForEvent({ tentative: true, source: 'discord' })`, `ensureUserProfile`, ephemeral reply). Routed in `bot/interactions.js`.
- `bot/myEvents.js` and `bot/registration.js` status labels: `tentative: '🤔 Vielleicht (Ersatzbank)'`.
- No new Discord API call: buttons and modals use the interaction, DMs go through existing helpers. Therefore no new `bot.js` export and no `dev/mockBot.js` twin; mock mode exercises the path through the existing interaction simulation.

### D11 — Mock data
`dev/seedData.js`: the raid (`EVENT_ID.ROLE`) gets `allowTentative: true` and one tentative registration (e.g. Felix or a new seed member) with wanted role „Heiler“ and `tentativeAt`; the open game night stays without the switch so both states are visible.

## Risks / Trade-offs

- [A new status value reaches code that switches on known statuses and silently treats it as "other"] → The context list above is the complete grep result; tasks go through it, and a `node:test` asserts each status helper (`summarizePlaces`, `messageRecipients`, `planBulkAction`, `ownStatus`) handles `tentative`.
- [Resetting `createdAt` changes the "registered at" shown to admins] → The admin dialog shows `tentativeAt` as „Vielleicht seit …“ for registrations that came from the bench; the CSV keeps `createdAt` as the binding registration time.
- [Old clients/announcements without the button] → Announcements are re-rendered on every registration change; until then the event page offers the answer.
- [Members ignore the bench and never confirm] → Accepted risk; admins see the bench and can accept from it.

## Migration Plan

No data migration: `allowTentative` missing means off, no registration has `tentative`. Rollback: revert the code; tentative registrations left in the database would show as an unknown status — before a rollback admins reject or delete them (or a one-off script deletes `status == 'tentative'`).
