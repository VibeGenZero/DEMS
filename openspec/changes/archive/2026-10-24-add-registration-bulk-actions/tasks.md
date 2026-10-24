# Tasks

## 1. Pure planner

- [x] 1.1 Write `test/bulkRegistrations.test.js` first (RED) for `planBulkAction`: status filter per action (rejected and wrong statuses skipped, ids of other events skipped, duplicates once); accept without limit takes all; accept with limit in registration order with unselected pending/accepted places counted and guests/open invitations counted (spec scenarios "More selected than free" and "Guests do not fit"); a waitlisted registration that does not fit stays unchanged but counts as `full`; slot events: main role, fallback role, slot full → waitlisted without slot, no overbooking, a pending registration keeps its free slot; waitlist/reject clear `slotId` on slot events and set `clearCheckin` for checked-in ones. Verify that `npm test` fails on the missing module.
- [x] 1.2 Implement `utils/bulkRegistrations.js` (`BULK_ACTIONS`, `MAX_BULK_IDS = 200`, `planBulkAction`) on top of `utils/capacity.js` and `utils/slotService.js` as in design decision 2. Verify that `node --test test/bulkRegistrations.test.js` is green.
- [x] 1.3 Document the module in `docs/wiki/modules/utils.md` and in the file → node table of `docs/wiki/index.md`. Run `npm run wiki`.

## 2. Shared status notification

- [x] 2.1 Tests first: a mock-mode test (pattern of `test/botBanner.test.js`) for `notifyStatusChange` in `utils/registrationService.js`: accepted sends the template or default text with the slot line and assigns the event role; rejected sends the rejected text; waitlisted sends the waitlist DM unless the member switched "Warteliste" off (W-16 choice stored in `users`). Read the DMs from the mock bot log. Verify they fail.
- [x] 2.2 Implement `notifyStatusChange` and move the DM part of `PUT /api/admin/registrations/:id/status` onto it (accepted/rejected only, behaviour unchanged), and make `notifyRegistration` use the same waitlist text function. Verify the 2.1 tests and the existing single-status tests in `test/devServer.test.js` are green.
- [x] 2.3 Update `docs/wiki/modules/utils.md` (registrationService exports) and `docs/wiki/concepts/registration-flow.md` (status DMs come from one helper). Run `npm run wiki`.

## 3. Bulk endpoint

- [x] 3.1 Tests first in `test/devServer.test.js` with personas, on events created by the test (so seed counts stay untouched): `admin` accepts three pending registrations → 200 with `{ accepted: 3 }`, statuses changed, one `BULK_UPDATE_REGISTRATIONS` audit entry, accepted DMs in the server output; a limited event accepts up to the limit and reports `full`; reject of a mixed selection reports rejected + skipped and lets the waitlist move up; waitlist clears slot and check-in; a member who switched "Warteliste" off gets no waitlist DM; wrong action, empty list, 201 ids → 400; unknown event → 404; `member` → 403; missing CSRF header → 403. Verify they fail.
- [x] 3.2 Implement `POST /api/admin/events/:id/registrations/bulk` in `routes/admin.js` as in design decisions 1, 3 and 4 (own `try/catch`, German errors, lock + `writeBatch`, notifications after the lock, `promoteFromWaitlist` once after rejections, `notifyRegistrationsChanged` once, one audit entry). Verify the 3.1 tests are green.
- [x] 3.3 Update `docs/wiki/reference/api-index.md`, `docs/wiki/modules/routes-admin.md` (route row, audit action) and `docs/wiki/concepts/registration-flow.md` (bulk transitions, capacity rule, no overbooking unlike the single accept). Run `npm run wiki`.

## 4. Dialog: selection, action bar, result

- [x] 4.1 Tests first in `test/adminRegistrations.test.js` (run with `--experimental-vm-modules`): selectable rows (pending, waitlisted, accepted) have a checkbox, rejected rows none; "Alle auswählen" selects only those; the bar is hidden with nothing selected and shows "<n> ausgewählt"; "Annehmen" is disabled with only accepted rows selected; accept sends one POST with ids, action and `X-CSRF-TOKEN`, shows the `bulkSummary` toast, clears the selection and reloads dialog, admin table and stats once; reject first shows the confirm dialog "4 Anmeldungen ablehnen?" and sends nothing when dismissed; an error answer shows its `error` and keeps the selection. Unit tests for `bulkSummary` cover the spec toast texts. Add a test that the frontend `BULK_ACTIONS` equals the server map. Verify they fail.
- [x] 4.2 Add `public/js/admin/registration-bulk.js` (design decision 5), the checkbox column and header checkbox in `registrations.js` / `public/index.html` (colspans 8 → 9), and the bar `#reg-bulk-bar` with its three buttons (design decision 6). Add a token-only `.reg-bulk-bar` block in `public/css/style.css`. Register the actions with `registerActions`; no inline handlers or styles, Bootstrap Icons only. Verify the 4.1 tests, `test/cssRules.test.js`, `test/frontendCsp.test.js` and `test/actionAttributes.test.js` are green.
- [x] 4.3 Extend `e2e/admin.spec.js`: the admin opens the registrations of an event with several pending requests, selects two, accepts them and sees the toast and the new statuses; then selects one and rejects it through the confirmation. Run against a fresh event the test creates, so shared-DB order does not matter. Verify that `npm run test:e2e` is green.
- [x] 4.4 Update `docs/wiki/modules/frontend-app.md` (new module, changes in `registrations.js`) and `docs/wiki/modules/frontend-markup.md` (registrations dialog: checkbox column, `#reg-bulk-bar`). Run `npm run wiki`.

## 5. Integration check

- [x] 5.1 In mock mode with a scratch `DEV_SQLITE_PATH`, use a Playwright screenshot script to open the registrations of the full seed event and of the raid slot event. Bulk-accept a selection larger than the free places, then check the toast, the statuses, the slots and the DMs in the server output. Check the dialog at phone width (390 px) as well. Verify with the screenshots.
- [x] 5.2 Run `npm test` and `npm run test:e2e` three times (shared-DB races) and verify everything is green.

## Workflow follow-up

- After the merge: `/opsx:archive` on a `chore/openspec-archive-…` branch from `origin/main`, which syncs `registration-bulk-actions` into `openspec/specs/`.
- Follow-up idea for the MR: rejecting or waitlisting an accepted registration (single or bulk) keeps the event role and channel access. A separate ticket can decide on that.
