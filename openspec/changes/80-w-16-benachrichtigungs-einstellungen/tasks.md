# Tasks

## 1. Preferences module and settings API

- [x] 1.1 Write failing unit tests in a new `test/notificationPrefs.test.js` (own mock database like `test/eventChangeNotice.test.js`): `normalizeNotificationPrefs` gives all three kinds `true` for `undefined`, `{}`, `null`, strings and partial objects, and `false` only for an explicit `false`; `filterByPreference` keeps order, drops users with the kind off, keeps users without a document, returns the number left out and asks each user once; `wantsDm` for stored off, stored on and missing user. Verify they fail.
- [x] 1.2 Implement `utils/notificationPrefs.js` (design decision 2; data access through `firebaseAdmin.js`, read errors logged and treated as "on"). Verify 1.1 passes.
- [x] 1.3 Write failing server tests in `test/devServer.test.js` with the `newbie` persona: `GET /api/user/settings` returns `notifications` all `true` by default; `PUT { notifications: { waitlist: false } }` answers the new settings and keeps `acceptInvitations` and the other kinds; `PUT { acceptInvitations: false }` keeps the stored kinds; a later `PUT { notifications: { changes: false } }` keeps `acceptInvitations: false`; `"false"` as text and unknown keys change nothing; without CSRF token 403. Verify they fail.
- [x] 1.4 Implement `GET`/`PUT /settings` in `routes/user.js` (design decision 4). Verify 1.3 passes and the existing settings tests (`test/devServer.test.js`, `test/theme.test.js`) stay green.
- [x] 1.5 Update `docs/wiki/modules/routes-user.md` (settings endpoints), `docs/wiki/concepts/data-model.md` (`users.notifications`), `docs/wiki/modules/utils.md` (new module), `docs/wiki/ops/testing.md`; run `npm run wiki` and verify `node --test test/wiki.test.js`.

## 2. Respect the choices where the DMs are sent

- [x] 2.1 Write failing tests: `test/reminderScheduler.test.js` — with two accepted participants and one users document `{ notifications: { reminders: false } }`, a due reminder and the start notification reach only the other participant and the reminder is still stored as sent; `test/eventChangeNotice.test.js` — `notifyEventChange` skips a recipient with `changes: false` and returns `optedOut: 1`. Verify they fail.
- [x] 2.2 Implement the filter in `messageAcceptedParticipants` (`bot.js`) and in `notifyEventChange` (design decision 3). Verify 2.1 passes.
- [x] 2.3 Write failing server tests in `test/devServer.test.js` on events the tests create: a flagged change of an event with two accepted members, one with `changes: false` set through her own `PUT /api/user/settings`, answers `notifiedCount: 1` and the audit detail ends with `1 opted out`; `PUT /api/admin/events/:id/cancel` skips the same member, still DMs the others and cancels the event; the member persona with `waitlist: false` registering for a full event is waitlisted without a waitlist DM, and when a place frees up still gets the move-up DM; an accepted DM still reaches a member with all three kinds off. Verify the new tests fail. (The W-04 seed test is updated together with Kira's seeded choice in 3.3, so it is never red in between.)
- [x] 2.4 Implement in `routes/admin.js` (`PUT /events/:id` audit detail, `PUT /events/:id/cancel`) and `utils/registrationService.js` (`notifyRegistration`, waitlisted branch). Verify 2.3 passes and `node --test test/devServer.test.js test/registrationService.test.js test/eventChangeNotice.test.js test/reminderScheduler.test.js` is green.
- [x] 2.5 Update `docs/wiki/concepts/reminders-presence.md`, `docs/wiki/concepts/event-lifecycle.md` (change DMs, cancel row), `docs/wiki/concepts/discord-integration.md` (status DMs and which ones members can switch off), `docs/wiki/concepts/registration-flow.md` (waitlist DM), `docs/wiki/modules/routes-admin.md` (cancel), `docs/wiki/ops/testing.md`; run `npm run wiki` and verify `node --test test/wiki.test.js`.

## 3. Profile switches and seed data

- [x] 3.1 Write failing fake-DOM tests (run with `node --experimental-vm-modules --test`, new `test/notificationSettings.test.js`): `loadAccountSettings` sets the three switches from `notifications`; `saveNotificationSetting` on `#notify-changes-toggle` sends `PUT /api/user/settings` with `{ notifications: { changes: false } }` and the CSRF header and toasts "Änderungen per DM aus."; a failed answer puts the switch back and toasts "Einstellung konnte nicht gespeichert werden."; the markup has the three switches with `role="switch"`, `aria-label`, `data-kind` and German texts, no emoji. Verify they fail.
- [x] 3.2 Add the block to `#account-settings-card` in `public/index.html` and implement `loadAccountSettings`/`saveNotificationSetting` in `public/js/pages/profile.js` (design decision 5). Verify 3.1 passes and `test/actionAttributes.test.js`, `test/cssRules.test.js`, `test/frontendCsp.test.js`, `test/frontendModules.test.js`, `test/theme.test.js` stay green.
- [x] 3.3 Seed Kira `{ changes: false }` and Jonas `{ reminders: false }` in `dev/seedData.js` (design decision 6). Verify `test/seed.test.js` and the updated W-04 seed test pass.
- [x] 3.4 Add an e2e check to `e2e/profile.spec.js`: the member persona sees "Discord-Nachrichten" with three switches on, turns "Warteliste" off, gets the toast, and after a reload the switch is still off (switch it back on at the end so other specs see the defaults). Verify with `npx playwright test e2e/profile.spec.js`.
- [x] 3.5 Update `docs/wiki/modules/frontend-app.md` (profile module), `docs/wiki/modules/frontend-markup.md` if it lists the settings card, `docs/wiki/modules/dev-mock-mode.md` (seeded choices) and `docs/wiki/ops/testing.md`; run `npm run wiki` and verify `node --test test/wiki.test.js`.

## 4. Integration

- [x] 4.1 Mock mode check on a scratch DB: as admin create an event with one place and enter one member (the seeded "Koop-Abend (5 Plätze)" is full but past its registration deadline); as the member persona switch "Warteliste" off in the profile, reload, register for that event and confirm the registration is waitlisted and the mock log shows no waitlist DM; as admin change the location of "Community-Spieleabend" with notification and confirm Kira gets no DM, the toast counts the others and the audit entry ends with "1 opted out".
- [x] 4.2 Run `npm test` and `npm run test:e2e` and verify both are green (apart from known-issues #22 on macOS).

## Workflow follow-up

- Commit planning and code separately on `feature/80-w-16-benachrichtigungs-einstellungen`, push, open the MR "W-16: Benachrichtigungs-Einstellungen" (German: Problem / Ursache / Änderung / Verifikation, `Closes #80`).
- After the merge: `/opsx:archive` on a `chore/` branch from `origin/main`.
