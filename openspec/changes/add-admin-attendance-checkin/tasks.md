# Tasks

## 1. Admin check-in endpoint

- [x] 1.1 Write failing tests in `test/devServer.test.js` (admin persona, seed event `EVENT_ID.RUNNING` / `EVENT_ID.ARCHIVED`): admin checks in an accepted registration without a code (200, `checkedIn: true`, `checkedInAt` set), repeats it (still checked in, time unchanged), takes it back (`checkedIn: false`, `checkedInAt: null`), checks in on the archived event; 400 for a pending registration, 400 for a missing/non-boolean `checkedIn`, 404 for an unknown id; member persona is refused; an audit entry exists for set and clear. Verify they fail with `node --test test/devServer.test.js`.
- [x] 1.2 Add `PUT /registrations/:id/checkin` to `routes/admin.js` (own try/catch, German errors, `addAuditLog` `CHECKIN_REGISTRATION` / `UNDO_CHECKIN_REGISTRATION`) and add both actions to the audit chip map in `public/js/admin/dashboard.js`. Verify the 1.1 tests pass.
- [x] 1.3 Write a failing test that a check-in set by the admin raises the member persona's profile check-in count (`/api/user/profile` stats) and shows `checkedIn: true` in the member's registration for the event, and that a member can check in again with `CHECKIN_CODE` after the admin cleared it; make it pass (expected to pass without code changes once 1.2 is in — if so, keep it as a guard).
- [x] 1.4 Update `docs/wiki/modules/routes-admin.md` (route table), `docs/wiki/reference/api-index.md` and the Check-in section of `docs/wiki/concepts/event-lifecycle.md` (admin path, any time, counts like the code); run `npm run wiki` and verify `node --test test/wiki*.test.js` (or `npm test`) passes.

## 2. Status change clears the check-in, CSV column

- [x] 2.1 Write failing tests in `test/devServer.test.js`: setting a checked-in registration to `waitlisted` (and one to `rejected`) clears `checkedIn`/`checkedInAt`; the CSV export has the header "Eingecheckt" after "Status" with `Ja` for a checked-in and `Nein` for another registration. Adjust existing CSV assertions that depend on column positions. Verify they fail.
- [x] 2.2 Implement both in `routes/admin.js` (`PUT /registrations/:id/status` update, export headers/rows through `csvCell`). Verify the 2.1 tests pass.
- [x] 2.3 Update `docs/wiki/modules/routes-admin.md` (status route: clears the check-in; export columns) and `docs/wiki/concepts/data-model.md` if it describes `checkedIn`/`checkedInAt`; run `npm run wiki`.

## 3. Check-in column in the registrations dialog

- [x] 3.1 Write a failing test for the rendering (fake DOM like `test/adminEventTable.test.js`, or a pure render helper exported from `public/js/admin/registrations.js`): an accepted, not checked-in row has a `data-click="toggleRegCheckin"` button with "Abhaken" and `aria-pressed="false"`, a checked-in row shows "Eingecheckt" with `aria-pressed="true"`, a pending row has no such button; registration ids are escaped. Verify it fails.
- [x] 3.2 Add the "Check-in" header to `#registrationsModal` in `public/index.html`, the column and the `toggleRegCheckin` action (CSRF header, toasts, dialog reload) in `public/js/admin/registrations.js`, colspans 7 → 8. Verify 3.1 passes and `node --test test/actionAttributes.test.js test/cssRules.test.js` stays green.
- [x] 3.3 Add an e2e test to `e2e/admin.spec.js`: admin opens the registrations of the running event, ticks off the not-checked-in member, sees the toast and the "Eingecheckt" state, ticks it back. Verify with `npx playwright test e2e/admin.spec.js`.
- [x] 3.4 Update `docs/wiki/modules/frontend-app.md` (`admin/registrations.js`: `toggleRegCheckin`) and the `#registrationsModal` note in `docs/wiki/modules/frontend-markup.md` if columns are listed; run `npm run wiki`.

## 4. Integration

- [x] 4.1 Browser check in mock mode on a scratch DB (`DEV_SQLITE_PATH`): admin ticks a member off in the dialog, the member persona sees "Eingecheckt" on the event page and the higher count on the profile; the audit log on the dashboard shows the entry.
- [x] 4.2 Run `npm test` and `npm run test:e2e` (three times, shared-DB races) and verify everything is green.

## Workflow follow-up

- Commit planning and code separately, push, open the MR "W-07: Anwesenheit abhaken" (text only, `Closes #71`).
- After the merge: archive this change with `/opsx:archive` (and the still open `add-registration-deadline` from W-03).
