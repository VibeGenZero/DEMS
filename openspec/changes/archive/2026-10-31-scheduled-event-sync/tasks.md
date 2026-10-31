# Tasks

## 1. Module and field builder

- [x] 1.1 Move `createScheduledEvent` and `getGuildScheduledEvents` from `bot/channels.js` to the new `bot/scheduledEvents.js` (imports in `bot.js` adjusted, export list unchanged). Verify `test/botModules.test.js`, `test/botRealExports.test.js` and `npm test` stay green.
- [x] 1.2 Tests first (RED) in the new `test/scheduledEventSync.test.js` for `buildScheduledEventFields`: name and description cut to 100/1000; end after start (missing or earlier end → start + 2 h); voice with `discordChannelId`; voice with a voice `location`; external with `location.text` (≤ 100), „Discord“ without location; never "TBD". Implement it and use it in `createScheduledEvent`; verify green.

## 2. Discord helpers

- [x] 2.1 Tests first (RED) with a stubbed client (ready state, `guilds.fetch` → guild stub with `scheduledEvents.fetch/delete`): `updateScheduledEvent` edits the fields, leaves out the start for an ACTIVE event or a past start, sets the image only with `bannerChanged`, returns `'gone'` on 10070 and `false` (logged) on other errors or for COMPLETED/CANCELED; `removeScheduledEvent` deletes and treats 10070 as success; `setScheduledEventStatus` goes SCHEDULED → ACTIVE, SCHEDULED → ACTIVE → COMPLETED for `'completed'`, makes no call when already there, `'gone'` on 10070. Real exports answer `false` while not ready (`test/botRealExports.test.js`). Implement (design 1), export through `bot.js` (extend both pinned lists), add the mock twins; verify green.

## 3. Routes

- [x] 3.1 Tests first (RED) in `test/devServer.test.js` with a synced seed event and the mock log: saving it logs „Server-Event … aktualisiert“; a series save with „following“ updates each synced date; cancel and „back to draft“ log „entfernt“ and clear `discordScheduledEventId` (the admin list offers sync again); delete and series delete log „entfernt“; „Starten“ logs „läuft“ and stores `active`, „Beenden“ logs „beendet“ and stores `completed`; `sync-discord` stores `scheduled`; an unsynced event logs nothing. Implement `syncScheduledEventAfterChange` and the calls (design 3); verify green.
- [x] 3.2 Tests first (RED): a twin answering `'gone'` (test hook in the mock, e.g. a set of gone ids) makes a save clear the id and status. Implement; verify green.
- [x] 3.3 Tests first (RED): duplicating a synced event and extending a synced series give dates without `discordScheduledEventId`/`discordScheduledEventStatus`. Fix `duplicate` and `extendSeries` (design 5); verify green.

## 4. Scheduler

- [x] 4.1 Tests first (RED) in `test/reminderScheduler.test.js` with an injected `scheduledStatus` stub: a started synced event → `'active'` stored; an over one (by end, and by start + 2 h without end) → `'completed'` stored; already `active` and running → no call; `false` (offline) stores nothing and the next pass calls again; `'gone'` clears the id; unsynced events → no call. Implement design 4; verify the whole scheduler test file is green.

## 5. Seed, wiki, verification

- [x] 5.1 Seed: give the open event and the running event a `discordScheduledEventId` with `scheduled` / `active`, so the admin list shows them as synced and saving/ending shows the mock log. Verify `node --test test/seed.test.js` and `npm run dev:reset`.
- [x] 5.2 Wiki: `docs/wiki/modules/bot.md` (module `bot/scheduledEvents.js`, moved functions, exports), `docs/wiki/concepts/discord-integration.md` (sync row: updates, removal, status, location), `docs/wiki/concepts/reminders-presence.md` (status pass), `docs/wiki/concepts/event-lifecycle.md`, `docs/wiki/modules/routes-admin.md`, `docs/wiki/concepts/data-model.md` (`discordScheduledEventStatus`), `docs/wiki/modules/dev-mock-mode.md`; run `npm run wiki` and verify `node --test test/wiki.test.js`.
- [x] 5.3 Run `npm test` (no website change beyond data, so `npm run test:e2e` only if `public/` was touched) and verify it passes; in `npm run dev:mock` save the open event and end the running one as Mori and check the mock log.

## Workflow follow-up

- PR from `92-b-09-server-events-synchron-halten` into `feature/m4-discord-funktionen` (German: Problem / Ursache / Änderung / Verifikation); note the duplicate/series fix and the test-server check (edit, cancel, start/end, delete in Discord).
- Archive the change with `/opsx:archive` after review.
