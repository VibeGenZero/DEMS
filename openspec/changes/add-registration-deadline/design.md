# Design

## Context

- All registrations go through `registerUserForEvent()` → `createRegistration()` in `utils/registrationService.js`; the end check (`isEventOver`, W-01) sits there, in `switchOwnSlot()`, and on the Discord side in `canRegisterViaDiscord()`, `checkRegistrationConditions()`, `handleEventRegisterModal()` and `handleEventSlotModal()` (`bot.js`). Adding a deadline check at exactly these places covers every channel.
- `unregisterUserFromEvent()` has no time check at all today. It is called by `DELETE /api/events/:id/register`, `/unregister` and the "Abmelden" button (`SLOT_LEAVE_PREFIX` / status answer in `bot.js`). Admin removals use other code paths (`routes/admin.js`), so a check in this function only hits members.
- Event fields are whitelisted twice in `routes/admin.js` (known trap 3). Series instances are built in `POST /events` from `baseEvent` with `endDate` shifted by the start-to-end duration.
- Discord announcements lose their buttons only when they are refreshed; today that happens on registration changes and at archive time.
- `checkReminders()` in `bot.js` runs every 5 minutes over active events and already uses "flag stored in the event, written before acting" (`eventStartNotificationSent`) to act exactly once.

## Goals / Non-Goals

**Goals:**
- One rule per deadline, enforced in the service layer so web and Discord cannot drift apart.
- Pure, unit-testable helpers for "is registration open / is unregistering open".
- Members see the deadlines before they hit them.

**Non-Goals:**
- Relative deadlines ("24 h before start") — the user chose fixed dates.
- DMs or reminders about an upcoming deadline.
- Changing the deadline automatically when an admin moves the start date of an existing event (the wizard check will flag a deadline that ends up after the end).
- A "late unregister" marker — after the unregister deadline it is simply blocked.
- Migration script (ticket R-01): missing fields already mean "no deadline".

## Decisions

1. **Field names and format.** `registrationDeadline` and `unregisterDeadline`, ISO strings, `''` when unset (same convention as `endDate`). Alternative "one object `deadlines: {…}`" rejected: every other date on the event is a flat string, and the whitelist/wizard code is written for flat fields.

2. **Helpers in `utils/eventListing.js`.** `isRegistrationClosed(event, now)` → true when the event is over or `registrationDeadline` is a valid date ≤ now; `isUnregisterClosed(event, now)` → true when `unregisterDeadline` is a valid date ≤ now. Invalid stored values count as "no deadline" (fail open, like `eventEndTime` does for a bad end). They live next to `isEventOver` because the bot, the routes and `profileEvents.js` already import from there. The frontend gets twins in `public/js/events/cards.js` next to `eventEnd()` (the browser cannot import CommonJS), covered by the same test cases.

3. **Service checks and messages.** New codes `REGISTRATION_ERROR.CLOSED = 'registration_closed'` and `UNREGISTER_CLOSED = 'unregister_closed'` (HTTP 400). Order in `createRegistration`: status → over (`event_ended`, keeps W-01 wording) → deadline (`registration_closed`). `switchOwnSlot` gets the same deadline check. `unregisterUserFromEvent` loads the event inside the lock and refuses with `unregister_closed`; it does not check the end (unchanged behaviour after the end, unless a deadline is set). Messages: "Die Anmeldung für dieses Event ist geschlossen." and "Abmelden ist nicht mehr möglich. Wende dich an einen Admin."

4. **Discord.** `canRegisterViaDiscord` uses `isRegistrationClosed` instead of `isEventOver`, so a refreshed announcement drops the register and slot buttons. `checkRegistrationConditions` and the two modal handlers answer the deadline message when the event is not over but closed. `/unregister` and the "Abmelden" button already forward `result.error` from the service, so they need no own check; the ephemeral status answer hides "Abmelden" once `isUnregisterClosed`. `buildEventEmbed` adds an inline field "⏰ Anmeldung bis" (and "Abmeldung bis") formatted like "🗓️ Datum" (`toLocaleString('de-DE', { timeZone: TIMEZONE })`). No new Discord API call → no new `bot.js` helper and no `dev/mockBot.js` twin needed.

5. **One refresh when the deadline passes.** `checkReminders()` gets one more step per active event: when `isRegistrationClosed` by deadline (not by end) and `registrationClosedRefreshed !== true`, it writes `registrationClosedRefreshed: true` first and then calls the existing announcement refresh for the event. `PUT /events/:id` resets the flag to `false` whenever `registrationDeadline` changes. Alternative "own interval" rejected: the 5-minute scheduler already exists and is started with the bot; a delay of up to 5 minutes is fine because old buttons answer with the deadline message anyway.

6. **Admin API.** Both fields go into `baseEvent` (POST) and `updates` (PUT). `validateEvent` refuses an unparsable date and a deadline after the event end (end date, else start + 2 h, via `eventEndTime`). Series: `offset = deadline − startDate` of the first date, applied to every instance like the `endDate` duration; an empty deadline stays empty. Duplicates copy the document as today (they are drafts; the admin edits dates anyway).

7. **Wizard.** Step 2 "Datum & Zeit" gets two flatpickr inputs (`#event-registration-deadline`, `#event-unregister-deadline`) with the same config as the end date, each with a short German hint ("Leer = Anmeldung bis zum Ende"). `collectEventDraft`, `editEvent`, `showCreateEventModal` handle them; `checkWizardStep` (`admin/wizard-checks.js`) adds "deadline after end" messages to step 2. `buildPreviewEvent` passes the fields so the Discord preview shows them.

8. **Event page and cards.** `renderSidebarDetails` adds rows "Anmeldung bis" / "Abmeldung bis" (icon `bi-alarm`). In `showEventDetail`, after the "over" branch, a new branch shows a closed box (`#detail-registration-closed`, same markup pattern as `#detail-ended`) when registration is closed by deadline. Registered members past the unregister deadline get no "Abmelden" button and a muted hint. Overview cards show a chip "Anmeldung geschlossen" while the event is not over but registration is closed. All markup uses existing components, tokens and `.is-hidden`; no inline styles.

9. **Seed data.** `dev/seedData.js#buildEvent` defaults both fields to `''`; one upcoming seed event gets a passed registration deadline and one a future unregister deadline, so mock mode shows every state. `EXPECTED_COUNTS` stays unchanged (no new documents).

## Risks / Trade-offs

- [Time zones: the wizard sends `toISOString()` from the admin's browser, Discord formats in `TIMEZONE`] → same path as start/end dates today; no new risk.
- [Start moved after a deadline was set, so the deadline lies after the new end] → the wizard check and `validateEvent` refuse the save until the admin fixes the deadline.
- [Up to 5 minutes of visible "Anmelden" buttons after the deadline] → every click and modal re-checks on the server and answers with the deadline message.
- [A member past the unregister deadline asks an admin] → admins already reject/remove registrations; no new admin UI needed.
- [Frontend and backend helper twins could drift] → shared test cases for both in one test file.

## Migration Plan

No data migration: events without the fields behave as before. Rollback = revert the commit; stored deadline fields are ignored by the old code.
