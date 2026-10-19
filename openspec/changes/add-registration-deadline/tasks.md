# Tasks

## 1. Deadline helpers

- [x] 1.1 Write failing tests in `test/eventListing.test.js` for `isRegistrationClosed` and `isUnregisterClosed` (no deadline, future, past, exactly now, invalid string, event over without deadline); verify they fail with `node --test test/eventListing.test.js`
- [x] 1.2 Implement both helpers in `utils/eventListing.js` and export them; verify 1.1 passes
- [x] 1.3 Add the browser twins next to `eventEnd()` in `public/js/events/cards.js`, run the same cases against them in `test/eventCards.test.js`; verify the test passes

## 2. Registration service

- [x] 2.1 Write failing tests in `test/registrationService.test.js`: register after the registration deadline → `registration_closed`, 400, German message, nothing stored; one minute before → registered; slot switch after the deadline → refused; unregister after the unregister deadline → `unregister_closed`, registration kept; unregister without a deadline after the end → still works; waitlist promotion after the registration deadline still happens (`test/waitlistPromotion.test.js`)
- [x] 2.2 Add `REGISTRATION_ERROR.CLOSED` / `UNREGISTER_CLOSED` with HTTP 400 and the checks in `createRegistration`, `switchOwnSlot` and `unregisterUserFromEvent` (event read inside the lock); verify 2.1 passes
- [x] 2.3 Update `docs/wiki/concepts/registration-flow.md` (check order, unregister rule, Discord after the deadline) and `docs/wiki/modules/routes-events.md` (new 400 answers on register, slot and unregister; `api-index.md` lists guards only); verify `npm run wiki` runs clean

## 3. Admin API and seed data

- [x] 3.1 Write failing tests in `test/devServer.test.js` (persona `admin`): `POST` and `PUT /api/admin/events` store both deadlines, clearing works, a deadline after the end → 400 German error, an invalid date → 400; a weekly series keeps the deadline offset on every date; `PUT` with a changed `registrationDeadline` resets `registrationClosedRefreshed`
- [x] 3.2 Whitelist both fields in `POST /events` (`baseEvent` + series offset) and `PUT /events/:id` in `routes/admin.js`, add the checks to `validateEvent` in `middleware/validators.js`, reset the flag on change; verify 3.1 passes
- [x] 3.3 Write failing member tests in `test/devServer.test.js` (personas `member`, `raider`): register after the deadline → 400; unregister after the unregister deadline → 400 and the registration remains; then confirm they pass with the service from group 2
- [x] 3.4 Default both fields to `''` in `dev/seedData.js#buildEvent`, give one upcoming seed event a passed registration deadline and one a future unregister deadline; verify `node --test test/seed.test.js` still passes unchanged
- [x] 3.5 Add both fields and `registrationClosedRefreshed` to `docs/wiki/concepts/data-model.md`, the German terms "Anmeldeschluss"/"Abmeldeschluss" to `docs/wiki/reference/glossary.md`, and the deadline to `docs/wiki/concepts/event-lifecycle.md`; verify `npm run wiki` runs clean

## 4. Discord

- [x] 4.1 Write failing tests (`test/slotInteractions.test.js` and a bot unit test next to the W-01 end checks): `canRegisterViaDiscord` false after the registration deadline; `checkRegistrationConditions` and both modal handlers answer the deadline message ephemerally; the ephemeral status answer has no "Abmelden" button after the unregister deadline; `buildEventEmbed` shows "Anmeldung bis" / "Abmeldung bis"
- [x] 4.2 Implement the checks and the embed fields in `bot.js` (no new Discord API calls, so no new helper and no `dev/mockBot.js` twin); verify 4.1 passes
- [x] 4.3 Write a failing test in `test/reminderScheduler.test.js`: `checkReminders` sets `registrationClosedRefreshed` once and triggers one announcement refresh after the deadline, none before it, none a second time; implement it in `checkReminders`; verify the test passes
- [x] 4.4 Pass both fields through `buildPreviewEvent` in `utils/eventPreview.js` and cover them in `test/eventPreview.test.js` / `test/discordPreview.test.js`; verify the tests pass
- [x] 4.5 Update `docs/wiki/concepts/discord-integration.md` (embed fields, buttons vanish at the deadline) and `docs/wiki/concepts/reminders-presence.md` (new scheduler step and flag); verify `npm run wiki` runs clean

## 5. Admin wizard

- [x] 5.1 Write failing tests: `checkWizardStep` step 2 flags a deadline after the end (`test/eventForm.test.js` or the wizard-checks test); the markup test finds `#event-registration-deadline` and `#event-unregister-deadline` in step 2
- [x] 5.2 Add both inputs with German labels and hints to step 2 in `public/index.html`, wire them in `editEvent`, `collectEventDraft`, `showCreateEventModal` (`public/js/admin/wizard.js`) and the messages in `public/js/admin/wizard-checks.js`; verify 5.1 passes and `test/cssRules.test.js` / `test/frontendCsp.test.js` stay green
- [x] 5.3 Check `docs/wiki/howto/add-event-field.md` and `docs/wiki/modules/frontend-app.md` still describe the wizard correctly, update if needed; verify `npm run wiki` runs clean

## 6. Event page and overview

- [x] 6.1 Write failing tests (`test/eventEndViews.test.js` pattern): sidebar rows "Anmeldung bis"/"Abmeldung bis"; not-registered member after the registration deadline sees `#detail-registration-closed` and no form; registered member after the unregister deadline sees no `#unregister-btn` and the admin hint; overview card shows "Anmeldung geschlossen"
- [x] 6.2 Implement in `public/index.html`, `public/js/events/detail.js`, `public/js/events/registration-form.js` and the card builder (`public/js/events/cards.js`/`list.js`) using existing components, tokens and `.is-hidden`; verify 6.1 passes
- [x] 6.3 Update `docs/wiki/modules/frontend-app.md` (and `frontend-markup.md` if a new block is added); verify `npm run wiki` runs clean

## 7. Integration checks

- [x] 7.1 Run `npm test`; verify all suites pass, including wiki validation
- [x] 7.2 Run `npm run test:e2e` three times; verify it is green each time
- [x] 7.3 Browser check in mock mode (`npm run dev:mock` on a scratch `DEV_SQLITE_PATH`): create an event with both deadlines in the wizard, see the rows on the event page, see the closed state on the seed event with a passed deadline, and the card chip; verify each state as listed in the spec scenarios

## Workflow follow-up

- Ask before committing; commit on branch `67-w-03-anmeldeschluss-optional-abmeldeschluss`, MR title "W-03: Anmeldeschluss (optional Abmeldeschluss)", German description, `Closes #67`.
- Archive the change with `/opsx:archive` after the MR is merged.
