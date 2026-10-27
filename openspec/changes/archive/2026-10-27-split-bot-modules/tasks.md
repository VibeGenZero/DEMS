# Tasks

Pure refactor (design.md): after every group `npm test` must be as green as before; the 16 test files that drive `bot.client` and the exports run unchanged. Move code by cut and paste; the only edits inside moved bodies are the identifier changes of design Decisions 3–5 (`state.*`, `../utils/…` in lazy requires, imports).

## 1. Safety net before moving anything

- [x] 1.1 Add characterization tests for the Discord paths no test covers yet, in `test/slotInteractions.test.js` (extend `createFakeInteraction` in `test/helpers.js` with `kind: 'autocomplete'`, `focused` value and a `respond(choices)` that resolves `answered`): `/register` answers with the website link of the chosen event; the `/register` and `/unregister` autocomplete offer matching events; `guest_accept:<registrationId>:<guestId>` accepts the guest and answers. Every other bot test runs in mock mode, where `dev/mockBot.js` replaces the Discord helpers, so a new `test/botRealExports.test.js` loads `bot.js` WITHOUT mock mode and pins the real exports: each Discord helper's neutral value while not ready, `getBotStatus()` with exactly today's keys (`online`, `username`, `avatarUrl`, `uptime`, `startedAt`, `ping`, `guildName`, `guildMemberCount`, `guildId`, `dmsSent`, `commandsProcessed`, `reminderSchedulerActive`, `presenceAutoUpdate`), `commandsProcessed` +1 per chat command, scheduler flag on after `startReminderScheduler` and off after `stopBot`, `startBot('')`/`whenBotSettled` false. They describe today's behaviour, so verify they are GREEN against the unchanged `bot.js` (`node --test test/slotInteractions.test.js test/botRealExports.test.js`).
- [x] 1.2 Write `test/botModules.test.js`: (a) `Object.keys(require('../bot'))` equals the pinned list of today's 44 export names in today's order (GREEN now); (b) `bot.js` has ≤ 150 lines and every `bot/*.js` ≤ 500 lines; (c) `new Client(` appears only in `bot/client.js`; (d) no `bot/*.js` requires `../bot` (the facade); (e) no file in `server.js`, `routes/`, `utils/`, `middleware/`, `dev/` requires a `bot/` module. Verify (a) passes and (b)–(c) fail (RED) with `node --test test/botModules.test.js`.
- [x] 1.3 Make the two source-reading tests follow the code: `test/eventUrl.test.js` scans `bot.js` plus every `.js` file in `bot/` (when the folder exists); `test/reminderScheduler.test.js` finds `applyBotSettings` in whichever of `bot.js`, `bot/*.js` defines it and also rejects `stopReminderScheduler(` in its body. Verify both stay green on the unchanged code and that the eventUrl test fails when a hand-built `#events/` link is put into a temporary `bot/x.js` (then delete it).

## 2. Foundation: constants, client and shared state

- [x] 2.1 Create `bot/constants.js` (everything from the constants block of `bot.js`: `TIMEZONE`, modal/select limits, checkbox values, `SELECTABLE_CHANNEL_TYPES`, custom ID prefixes, `BUTTONS_PER_ROW`, roster and poll limits) and import it in `bot.js`; verify `npm test` green.
- [x] 2.2 Create `bot/client.js` with the `Client` (same intents) and `state = { isReady, startedAt, dmsSent, commandsProcessed }`; in `bot.js` replace `isReady`, `botStartedAt`, `dmsSentCount`, `commandsProcessedCount` by `state.*` (design Decision 3). Verify `npm test` green and `getBotStatus` test from 1.1 unchanged.
- [x] 2.3 Wiki: in `docs/wiki/modules/bot.md` add a "Modules" table with the two new files, add them to `sources`, fix the line count in the TL;DR; add `bot/` to `docs/wiki/overview/directory-map.md` and the file → node table in `docs/wiki/index.md`; run `npm run wiki`, verify `npm test` green.

## 3. Leaf areas: messages, guild, channels

- [x] 3.1 Move `sendDM` … `refreshEventAnnouncements` (incl. `cutForEmbed`, roster helpers, `buildSlotButton`, `isGoneDiscordError`, `editStoredMessages`) to `bot/messages.js`; keep the lazy `require('../utils/eventUtils')`. Verify `npm test` green (`eventComponents`, `eventUpdate`, `botBanner`, `statusNotification` tests in particular).
- [x] 3.2 Move `assignRole` … `getPublicGuildChannels` and `toMemberInfo` to `bot/guild.js`; verify `npm test` green (`mockBot`, `registrationService` tests).
- [x] 3.3 Move `getGuildScheduledEvents`, `createScheduledEvent`, `createEventChannels`, `addParticipantToEventChannels`, `removeParticipantFromEventChannels`, `deleteEventChannels` to `bot/channels.js`; verify `npm test` green (`eventArchive`, `botSettings` channel-lock tests).
- [x] 3.4 Wiki: rows for the three modules in the "Modules" table and `sources` of `docs/wiki/modules/bot.md`; point `docs/wiki/concepts/discord-integration.md` and `docs/wiki/concepts/role-slots.md` at the new files where they name moved functions; run `npm run wiki`, verify `npm test` green.

## 4. Registration, polls and guests

- [x] 4.1 Move `buildFieldCustomId` … `parseModalAnswers` (modal build and read, `buildSlotModal`, `readAltSlotIds`, `buildRegisteredSlotReply`, `resolveSelectedUserName`) to `bot/registrationModal.js`; verify `npm test` green.
- [x] 4.2 Move `resolveInteractionRoles` … `handleSlotLeaveButton` and `replyWithFailure` plus `pendingDiscordRegistrations` to `bot/registration.js`; keep the lazy requires of `utils/registrationService` and `utils/eventUtils` lazy (design Decision 5). Verify `npm test` green (`slotInteractions`, `registrationService`, `waitlistPromotion`).
- [x] 4.3 Move the poll functions (`buildPollEmbed` … `markPollMessagesDeleted`, `handlePollVoteButton`, `handlePollVoteSelect`) to `bot/polls.js`; keep `utils/pollStore` lazy. Verify `npm test` green (`pollComponents`, `pollInteractions`, `pollStore`).
- [x] 4.4 Create `bot/guests.js` with `sendGuestInvitation` and the guest accept/decline branch of the dispatcher as `handleGuestButton(interaction, action, registrationId, guestId)`; the dispatcher calls it. Verify the guest tests from 1.1 and `test/slotInteractions.test.js` green.
- [x] 4.5 Wiki: module rows and `sources` in `docs/wiki/modules/bot.md`; move the custom ID table's "Handler" column to name the module; update `docs/wiki/concepts/registration-flow.md`, `docs/wiki/concepts/form-fields.md`, `docs/wiki/howto/add-form-field-type.md`, `docs/wiki/concepts/date-polls.md` where they point to moved functions; run `npm run wiki`, verify `npm test` green.

## 5. Commands and the interaction router

- [x] 5.1 Create `bot/commands.js` with `registerSlashCommands`, `handleAutocomplete(interaction)` (the autocomplete branch) and `handleChatCommand(interaction)` (`/events`, `/register`, `/unregister`); keep `utils/registrationService` lazy. Verify the command tests (`/events`, `/register`, `/unregister`, autocomplete) green.
- [x] 5.2 Create `bot/interactions.js` with `handleInteraction(interaction)`: today's dispatcher in the same branch order (autocomplete → modal submit → string select → button → chat command), same counter increment, calling the moved handlers. Verify `npm test` green and the `commandsProcessed` assertion from 1.1 unchanged.
- [x] 5.3 Wiki: module rows in `docs/wiki/modules/bot.md`, slash command paragraph names `bot/commands.js`; update `docs/wiki/howto/add-bot-feature.md` (where a new command, button or modal goes now); run `npm run wiki`, verify `npm test` green.

## 6. Scheduler, settings, lifecycle and the facade

- [x] 6.1 Move `messageAcceptedParticipants`, `checkReminders`, `startReminderScheduler` to `bot/scheduler.js` and add `stopReminderScheduler()` and `isReminderSchedulerRunning()` (the interval stays private there, design Decision 3). Verify `test/reminderScheduler.test.js` and `test/notificationPrefs.test.js` green.
- [x] 6.2 Move `getBotStatus`, `getBotSettings`, `saveBotSettings`, `buildActivityVariables`, `applyBotSettings`, `getRunningEvents` to `bot/settings.js`, with the presence interval private and `stopPresenceUpdates()`/`isPresenceAutoUpdating()`; `getBotStatus` reads the scheduler and presence through those functions. Verify `test/botSettings.test.js`, the `getBotStatus` test from 1.1 and the source test from 1.3 green.
- [x] 6.3 Create `bot/lifecycle.js` with `wireClient()` (attaches `ClientReady`, `error`, `interactionCreate` once), `startBot`, `whenBotSettled`, `stopBot` (calls `stopReminderScheduler`, `stopPresenceUpdates`, destroys the client when ready, same log line), `logBotInviteUrl`. Reduce `bot.js` to the facade of design Decision 1 (mockMode first, `wireClient()`, the same export object, the mock overlay). Verify `test/botModules.test.js` is now fully GREEN and `npm test` green.
- [x] 6.4 Run the free-identifier script from the design (scratchpad copy of the analysis script, adapted to read `bot/*.js`) and check every module only uses names it declares or imports; fix anything it finds with a test first if a test can reach it.
- [x] 6.5 Wiki and project docs: finish `docs/wiki/modules/bot.md` (module map replaces the function map, exports section, mock overlay and "internal calls use the real function" rule now about `bot/` modules, rules for changes: new Discord helper goes into its area module, exported through `bot.js`, twin in `dev/mockBot.js`); update `docs/wiki/overview/architecture.md`, `docs/wiki/modules/dev-mock-mode.md`, `docs/wiki/concepts/reminders-presence.md`, `docs/wiki/reference/conventions.md`, `docs/wiki/ops/testing.md` (new `test/botModules.test.js`), and `CLAUDE.md` (drop `bot.js` from "Never read these files whole" or replace it with the module hint; Discord rule: helpers live in `bot/<area>.js` and are exported through `bot.js`). Run `npm run wiki`, verify `npm test` green.

## 7. Integration check

- [x] 7.1 Run `npm test` (all suites incl. wiki validation) and `npm run test:e2e` (three times, shared-DB races) and verify both green.
- [x] 7.2 Smoke test in mock mode: `node dev/start.js` on its own `PORT` with a scratch `DEV_SQLITE_PATH`; poll `/healthz`, then check that the bot center status page loads (`GET /api/admin/bot/status` as `admin`), an event announcement and a website registration log their mocked Discord calls, and the server stops cleanly (`stopBot` log line). Stop the process by port.
- [x] 7.3 Compare the diff with `git diff --color-moved=zebra origin/main -- bot.js bot/` and verify that apart from imports, `state.*`, `../utils/` paths, the new stop/status helpers and the extracted handler signatures, every changed line is a move.

## Workflow follow-up

- Two commits (planning, then code), push, MR text only (title "B-01: `bot.js` aufteilen", German Problem / Ursache / Änderung / Verifikation, `Closes #84`).
- After the merge: `/opsx:archive` on a `chore/openspec-archive-b01` branch from `origin/main` (no spec deltas to sync).
