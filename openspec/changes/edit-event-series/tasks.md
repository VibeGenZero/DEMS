# Tasks

## 1. Pure series helpers

- [x] 1.1 Write `test/eventSeries.test.js` first (RED) for `utils/eventSeries.js`: `followingDates` (only later starts of the same `seriesId`, ended/cancelled/archived left out, drafts kept, sorted); `transferTime` (own day, new wall-clock time and duration in `Europe/Berlin`, no end → no end, deadline offsets kept, empty deadline stays empty, a date after the switch to winter time and one after the switch to summer time keep 19:30 local); `nextSeriesStart` (weekly, biweekly, monthly incl. 31st → shorter month as `setMonth` does today, wall-clock time kept across DST); `planExtension` (later end → starts after the last date up to and including the end day, same end → none, earlier end → error with the German text from the spec); `seriesUpdateFields` (copies the spec's field list, never status, dates, `seriesId`, check-in fields, `createdAt`, `sourcePollId`). Verify that `npm test` fails on the missing module.
- [x] 1.2 Implement `utils/eventSeries.js` as in design decision 2 (`Intl.DateTimeFormat` with `TIMEZONE`, no new dependency). Verify that `node --test test/eventSeries.test.js` is green.
- [x] 1.3 Document the module in `docs/wiki/modules/utils.md` and the file → node table of `docs/wiki/index.md`. Run `npm run wiki` and verify `node --test test/wiki*.test.js` is green.

## 2. Server: save this and the following dates

- [x] 2.1 Tests first in `test/devServer.test.js` with the `admin` persona on a weekly series the test creates (4 dates, future): PUT on date 2 without `applyTo` changes only date 2; with `applyTo: 'following'` dates 2–4 take the new description, places and start time on their own days, date 1 is unchanged, `updatedDates: 2`; a cancelled and a draft later date (status set by the test) behave as in the spec; registrations and check-in code of a following date stay; a slot removed while a member is accepted in it on date 4 → 400 naming date 4, no date changed; with `notifyParticipants` and accepted members on two dates the answer sums `notifiedCount`, the server output shows one DM per date and the audit log has one `NOTIFY_EVENT_CHANGE` per date and one `UPDATE_SERIES`; a request with interval `monthly` keeps the weekly interval; `member` → 403; missing CSRF header → 403. Delete the series at the end. Verify they fail.
- [x] 2.2 Extract `applySavedEvent` from `PUT /api/admin/events/:id` (design decision 3) without behaviour change; verify the existing devServer and `test/eventChangeNotice.test.js` tests stay green.
- [x] 2.3 Implement the `following` path (design decisions 1, 4 steps 1–6 and 6): series lock, pre-check of slots for all following dates, per-date `saveEventWithSlots`, `applySavedEvent` per date, banner release once at the end, `UPDATE_SERIES` audit entry, `updatedDates` in the answer; keep `recurring`/`recurringInterval` from the stored date for series dates. Verify the 2.1 tests are green.
- [x] 2.4 Update `docs/wiki/concepts/event-lifecycle.md` (section "Series": scope choice, following dates, time transfer, slot check, DMs per date), `docs/wiki/modules/routes-admin.md` (PUT row, `UPDATE_SERIES`), `docs/wiki/reference/api-index.md` (`applyTo`, `updatedDates`). Run `npm run wiki`.

## 3. Server: extend a series

- [x] 3.1 Tests first in `test/devServer.test.js`: a weekly series up to day X saved with "Wiederholen bis" X+14 creates two dates (end day inclusive) as copies of the last draft/active date with no registrations, empty check-in code, reminders unsent; every date of the series then has the new `recurringUntil`; works with `applyTo: 'this'` and `'following'`; `createdDates` in the answer; one `EXTEND_SERIES` audit entry; an earlier "Wiederholen bis" → 400 with the German spec text and no date changed or deleted; two parallel extension requests create the new dates only once. Verify they fail.
- [x] 3.2 Implement the extension (design decision 4 step 7–8) in `routes/admin.js` on top of `planExtension`; move the step logic of the creation loop in `POST /events` onto `nextSeriesStart` only if the existing creation tests stay green unchanged, otherwise leave creation as it is (non-goal). Verify the 3.1 tests are green.
- [x] 3.3 Update `docs/wiki/concepts/event-lifecycle.md` (extension, no shortening, no channels for new dates), `docs/wiki/modules/routes-admin.md` (`EXTEND_SERIES`), `docs/wiki/reference/api-index.md` (`createdDates`); remove the bullet "editing changes only one instance" from the Series section. Run `npm run wiki`.

## 4. Wizard: scope choice and series fields

- [x] 4.1 Tests first (frontend tests with `node --experimental-vm-modules --test`, pattern of the existing wizard tests): editing a series date with later changeable dates shows the radio group "Nur dieser Termin" (checked) / "Dieser und alle folgenden Termine (n)" next to "Speichern"; no group for the last date, a single event or a new event; the "Wiederkehrendes Event" switch and the interval are disabled for a series date; `checkWizardStep(2)` reports an earlier "Wiederholen bis" with the spec text; `saveEvent` sends `applyTo` and shows "Event und 3 folgende Termine aktualisiert!", with notification "… – 5 Teilnehmer benachrichtigt." and with created dates "… 2 neue Termine angelegt."; a single-date save keeps today's toasts. Verify they fail.
- [x] 4.2 Implement in `public/js/admin/wizard.js`, `wizard-checks.js` (following-date count twin, until check) and `public/index.html` (radio group with `.is-hidden`, hint under "Wiederholen bis") as in design decision 5; existing form components only, no inline styles or handlers, Bootstrap Icons only. Verify the 4.1 tests, `test/cssRules.test.js`, `test/frontendCsp.test.js` and `test/actionAttributes.test.js` are green.
- [x] 4.3 Extend `e2e/wizard.spec.js`: the admin creates a weekly series, edits its first date with a new start time and description for "Dieser und alle folgenden Termine", sees the toast, and the admin table shows the new time on every date; then extends "Wiederholen bis" by one week and sees one more date. Delete the series at the end. Verify that `npm run test:e2e` is green (run it three times because of the shared DB).
- [x] 4.4 Update `docs/wiki/modules/frontend-app.md` (wizard: scope choice, series fields) and `docs/wiki/modules/frontend-markup.md` (wizard last step, recurring box). Run `npm run wiki`.

## 5. Integration check

- [x] 5.1 In mock mode with a scratch `DEV_SQLITE_PATH`, use a Playwright screenshot script: edit a seed series date with "Dieser und alle folgenden Termine" and notification on, check the toast, the dates in the admin table, the DMs in the server output and the event page of a following date; check the last wizard step at phone width (390 px). Verify with the screenshots.
- [x] 5.2 Run `npm test` and `npm run test:e2e`; verify both are green.

## Workflow follow-up

- After the merge, archive the change with `/opsx:archive` on a `chore/openspec-archive-w11` branch from `origin/main`.
