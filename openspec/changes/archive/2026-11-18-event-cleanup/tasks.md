# Tasks

## 1. Bot helper

- [x] 1.1 Tests first (RED): `removeRoleFromMembers` answers `false` while the bot is not ready (`test/botRealExports.test.js`); with a stubbed ready client it fetches the guild once, removes the role per member and counts a member that cannot be fetched as `failed` (new `test/eventCleanup.test.js` or next to the existing guild tests). Implement it in `bot/guild.js` (design 2), export it through `bot.js` (extend both pinned lists in `test/botModules.test.js` / `test/botRealExports.test.js`), add the twin in `dev/mockBot.js` (`test/mockBot.test.js` if it pins exports); verify green.

## 2. Clean-up module

- [x] 2.1 Tests first (RED) in `test/eventCleanup.test.js` (mock mode, own SQLite, injected `bot` stub): `cleanupEvent` takes the role only from `accepted` registrations; keeps members accepted for another `draft`/`active` event with the same role, not for an archived/cancelled one; deletes channels when ids are stored; nothing to do → `'nothing'`, no write, no audit entry; stub answering `false` → `'pending'` stored, no audit entry; success → `'done'` and one `DISCORD_CLEANUP` entry by `system` naming the member count; a `failed` member still ends `'done'`. Implement `cleanupEvent` (design 1, 3); verify green.
- [x] 2.2 Tests first (RED): `retryPendingCleanups` runs pending clean-ups of archived/cancelled events only, never `'done'` ones or a pending one on an `active` event; `restoreEventRole` assigns the role to accepted members after `'done'`, assigns nothing after `'pending'`, and clears the marker in both cases. Implement; verify green.

## 3. Archive scheduler

- [x] 3.1 Tests first (RED) in `test/eventArchive.test.js`: an auto-archived event with role and channels is cleaned up (mock log / stored `discordCleanup: 'done'`, channel ids cleared); a pass retries a pending clean-up; an archived event without marker is left alone. Implement in `archiveEndedEvents` (design 4); verify the whole file is green.

## 4. Admin routes

- [x] 4.1 Tests first (RED) in `test/devServer.test.js` with an event created by `admin` with `assignRoleId` and an accepted `raider`: „Jetzt beenden“, `PUT …/status` `archived`, `PUT …/cancel` each log „Rolle … von 1 Mitgliedern entfernt“ and store `discordCleanup: 'done'`; `PUT …/status` `draft` logs no removal; saving the event with status `archived` cleans up; reactivating a cleaned-up event logs „Rolle … an … vergeben“ and clears the marker. Implement the call sites (design 4); verify green.
- [x] 4.2 Tests first (RED): deleting an event and a series with role and accepted members logs the removal before the event is gone; duplicating an event with `discordCleanup` gives a copy without it. Implement (delete routes, `duplicate`, `extendSeries` if needed); verify green.

## 5. Seed, wiki, verification

- [x] 5.1 Seed: mock role „Event-Teilnehmer“ (`ROLE_ID.EVENT`) in `dev/mockGuild.js`; `EVENT_ID.RUNNING` and `EVENT_ID.PAST` get `assignRoleId: ROLE_ID.EVENT` and fake channel ids (design 6). Verify `node --test test/seed.test.js test/mockBot.test.js` and `npm run dev:reset`.
- [x] 5.2 Wiki: `docs/wiki/concepts/event-lifecycle.md` (table rows end/cancel/status/delete/auto archive, new section "Clean-up after the event (B-10)", drop the stale delete gotcha), `docs/wiki/concepts/discord-integration.md`, `docs/wiki/modules/bot.md` (`removeRoleFromMembers`), `docs/wiki/modules/routes-admin.md`, `docs/wiki/concepts/data-model.md` (`discordCleanup`), `docs/wiki/concepts/reminders-presence.md` (archive pass), `docs/wiki/modules/dev-mock-mode.md` (role, seed); add `utils/eventCleanup.js` to the file → node table in `docs/wiki/index.md` and the sources of `event-lifecycle`; run `npm run wiki` and verify `node --test test/wiki.test.js`.
- [x] 5.3 Run `npm test` (no `public/` change, so no `npm run test:e2e`) and verify it passes; in `npm run dev:mock` check the mock log at start (past event archived and cleaned up) and „Jetzt beenden“ on the running event as Mori.

## Workflow follow-up

- PR from `93-b-10-aufräumen-nach-dem-event` into `feature/m4-discord-funktionen` (German: Problem / Ursache / Änderung / Verifikation); mention the test-server check (archive, cancel, reactivate with a real role).
- Archive the change with `/opsx:archive` after review.
