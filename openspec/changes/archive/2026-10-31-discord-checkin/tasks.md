# Tasks

## 1. Shared check-in rules

- [x] 1.1 Tests first (RED) in the new `test/discordCheckin.test.js` (mock mode, own SQLite): `isCheckinActive` / `isCheckinRunning` (no code, before start, running, over by end, over by start + 2 h, cancelled); `checkInMember` with `requireRunning: true` → `ok` + `checkedInAt` stored, repeat → `alreadyCheckedIn` with the first time kept, codes `not_found`, `not_active`, `disabled`, `not_started`, `over`, `no_registration` change nothing; `listCheckinInvitees` returns only accepted, not checked-in, not invited registrations. Implement `utils/checkin.js` (design 1); verify green.
- [x] 1.2 Switch `POST /api/events/:id/checkin` to `checkInMember({ requireRunning: false })` after its code compare. Verify the existing code check-in tests in `test/devServer.test.js` stay green unchanged (answers and limiter), plus one new test: a wrong code still answers 400 "Ungültiger Check-in Code.".

## 2. Invitation and button

- [x] 2.1 Tests first (RED) for `buildCheckinInvitation` (require `bot/checkin.js`): button `event_checkin:<eventId>` „Einchecken“ + link `buildEventUrl(eventId)`; with `startText` the content names the start ("hat gerade begonnen"), without it "läuft – checke jetzt ein"; the content never contains the check-in code. Implement it and `CHECKIN_BUTTON_PREFIX` in `bot/constants.js`; verify green and `test/botModules.test.js` (500-line cap).
- [x] 2.2 Tests first (RED) through `dispatchInteraction` with a fake DM interaction (no member): running event + accepted registration → stored as checked in, `update` without the button, content has "✅ Du bist eingecheckt!" and the event's `checkinMessage`; second click → "ℹ️ Du bist bereits eingecheckt.", time unchanged; event over → "⌛ Der Check-in für dieses Event ist vorbei." via `update` without button; unregistered member → private "❌ Du hast keine angenommene Anmeldung für dieses Event."; cancelled event → private "❌ Dieses Event ist nicht mehr aktiv."; check-in off → private "❌ Check-in ist für dieses Event nicht aktiviert.". Implement `handleCheckinButton` and the routing in `bot/interactions.js`; verify green.

## 3. Sending invitations

- [x] 3.1 Tests first (RED) in `test/reminderScheduler.test.js` with `send` stub and `canInvite: () => true`: event with code starts → each accepted, not checked-in member gets one DM with the button and `checkinInvitedAt` is set before it; member who wants reminders with start DMs on → exactly one DM (start text + button); start DMs off → invitation only; member with reminders off → invitation; event without code → plain start DM as before, no button; second pass → no new DM; member accepted later in a running event → invited in the next pass; event over → nobody invited; `canInvite: () => false` → nothing marked, a later pass with `true` invites. Implement design 4 (`inviteToCheckin` in `bot/checkin.js`, split of `messageAcceptedParticipants`); verify green, including the existing scheduler tests.
- [x] 3.2 Tests first (RED): `sendCheckinInvitations` (real, `test/botRealExports.test.js`) returns 0 while not ready; mock twin marks invitees and returns the count, 0 before the start; devServer: `POST /api/admin/events/:id/generate-checkin` for the running seed event invites Tom (mock log / `checkinInvitedAt`) and leaves already invited or checked-in members alone; for a future event nothing is sent. Implement `sendCheckinInvitations` (real + twin in `dev/mockBot.js`), export through `bot.js` (extend the pinned lists in `test/botModules.test.js` and `test/botRealExports.test.js`), call it fire-and-forget in `generate-checkin`; verify green.
- [x] 3.3 Concurrency test: two `inviteToCheckin` calls for the same event started together send one DM per member (`withEventLock('checkin:<id>')`); verify green.

## 4. Mock data and wiki

- [x] 4.1 Seed: give Jonas in the running seed event `checkinInvitedAt` (invited, not checked in yet) and leave Tom uninvited, so generating a code in the admin view shows a mock invitation for Tom. Verify `node --test test/seed.test.js` and `npm run dev:reset`.
- [x] 4.2 Wiki: `docs/wiki/modules/bot.md` (module row `bot/checkin.js`, custom ID `event_checkin:<eventId>`, export list), `docs/wiki/concepts/reminders-presence.md` (check-in invitations in the scheduler, merge with the start DM, independence from the switch and preference), `docs/wiki/concepts/event-lifecycle.md` (check-in paths: code, admin, Discord), `docs/wiki/concepts/discord-integration.md`, `docs/wiki/concepts/data-model.md` (`checkinInvitedAt`), `docs/wiki/modules/utils.md` (`utils/checkin.js`), `docs/wiki/modules/routes-events.md`, `docs/wiki/modules/routes-admin.md` (generate-checkin sends invitations), `docs/wiki/modules/dev-mock-mode.md` (twin, seed), file → node row in `docs/wiki/index.md`; run `npm run wiki` and verify `node --test test/wiki.test.js`.

## 5. Verification

- [x] 5.1 Run `npm test` and verify it passes (no website UI change, so `npm run test:e2e` is not needed; run it anyway if `public/` was touched).
- [x] 5.2 Start `npm run dev:mock`, open the running event as admin, generate a new check-in code and check the mock log shows an invitation for Tom only. Note in the PR that the DM and the button must be clicked through on the test server (start of an event with code, click, click after the end).

## Workflow follow-up

- PR from `90-b-07-check-in-per-discord` into `feature/m4-discord-funktionen` (German: Problem / Ursache / Änderung / Verifikation).
- Archive the change with `/opsx:archive` after review and the test-server check.
