# Tasks

## 1. Discord helpers

- [x] 1.1 Write failing tests for the mock twins in `test/mockBot.test.js`: prefix and substring queries (e.g. `gre`, `ena`) find personas and members with `{ id, username, displayName, avatar }`, at most 10, `[]` for no hit; `fetchGuildMember` returns the member or `false`. Verify they fail.
- [x] 1.2 Add `searchGuildMembers` and `fetchGuildMember` to `bot.js` (`isReady` guard, `try/catch`, exported) and their logging twins to `dev/mockBot.js`. Verify 1.1 passes and the bot/mock export parity test (if any) stays green.
- [x] 1.3 Update `docs/wiki/modules/bot.md` (and `docs/wiki/concepts/discord-integration.md` if it lists helpers); run `npm run wiki`.

## 2. Search and entry API

- [x] 2.1 Write failing tests in `test/devServer.test.js` for `GET /api/admin/events/:id/member-search`: a member who never logged in (e.g. Greta) is found, an already registered member and a guest are marked `alreadyRegistered`, `q` of one character gives `[]`, the member persona gets 403. Verify they fail.
- [x] 2.2 Write failing tests for `POST /api/admin/events/:id/registrations`: manual-approval event → `accepted`, `source: 'admin'`, 201; role-required event after its registration deadline → accepted; archived event → accepted; draft and cancelled → 400; already registered → 400; unknown user id → 404; missing `userId` → 400; full event → accepted with warning; slot event: missing slot → 400, full slot → slot kept with warning; DM in the server output before the end and none for an ended event; audit entry `ADD_REGISTRATION`; member persona → 403. Verify they fail.
- [x] 2.3 Implement `REGISTRATION_SOURCE.ADMIN`, the failure code and `addRegistrationByAdmin` in `utils/registrationService.js`, the two routes and `eventStatus` in `GET /events/:id/registrations` in `routes/admin.js`, the CSV source label and the `ADD_REGISTRATION` chip in `public/js/admin/dashboard.js`. Verify 2.1 and 2.2 pass and `node --test test/devServer.test.js` is green.
- [x] 2.4 Update `docs/wiki/concepts/registration-flow.md` (entry points, admin entry rules), `docs/wiki/modules/routes-admin.md`, `docs/wiki/reference/api-index.md`, `docs/wiki/concepts/data-model.md` (`source: web|discord|admin`); run `npm run wiki` and verify `test/wiki.test.js`.

## 3. Registrations dialog

- [x] 3.1 Write failing frontend tests in `test/adminRegistrations.test.js` (run with `node --experimental-vm-modules --test`): the search block shows for `active`/`archived` and stays hidden for `draft`; a query renders hits with escaped names, `alreadyRegistered` hits are disabled; a slot event shows the slot select; adding posts `{ userId, slotId }` with the CSRF token, toasts the confirmation and the warning, reloads the list; the source badge "Admin" shows for `source: 'admin'`. Verify they fail for the right reason.
- [x] 3.2 Add the markup to `#registrationsModal` in `public/index.html` and the actions `searchRegistrationMembers` / `addRegistrationMember` in `public/js/admin/registrations.js`. Verify 3.1 passes and `test/actionAttributes.test.js`, `test/cssRules.test.js` stay green.
- [x] 3.3 Add an e2e test to `e2e/admin.spec.js`: on a fresh active event the admin searches a mock member, adds them, sees the toast and the row with "Admin", and the hit is then marked as already registered. Verify with `npx playwright test e2e/admin.spec.js`.
- [x] 3.4 Update `docs/wiki/modules/frontend-app.md`, `docs/wiki/modules/frontend-markup.md` and `docs/wiki/ops/testing.md`; run `npm run wiki`.

## 4. Integration

- [x] 4.1 Browser check in mock mode on a scratch DB: admin adds a member who never logged in to an upcoming event (DM in the server log), to a full event (warning), to an archived event (no DM); the member persona then sees the event as registered on the profile; audit log shows the entry.
- [x] 4.2 Run `npm test` and `npm run test:e2e` three times and verify everything is green.

## Workflow follow-up

- Commit planning and code separately, push, open the MR "W-06: Mitglieder manuell eintragen" (text only, `Closes #70`).
- After the merge: `/opsx:archive` on a `chore/` branch from `origin/main`.
