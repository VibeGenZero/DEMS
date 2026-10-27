# Design

## Context

See proposal.md (Why). Facts from reading `bot.js` (3076 lines) that shape the cut:

- **Callers** use only the facade: `server.js`, `routes/admin.js`, `routes/events.js`, `utils/eventUtils.js`, `utils/registrationService.js`, `utils/pollStore.js` (destructured at load time), `utils/announcementRefresh.js`, `utils/botSettings.js`, `dev/mockBot.js` (lazy `require('../bot')` inside functions), and 16 test files (`const bot = require('../bot')`, then `bot.client`, `bot.<export>`; no test reassigns an export).
- **Load-order cycles** are avoided today by lazy requires inside functions: `bot.js` requires `utils/registrationService`, `utils/eventUtils`, `utils/pollStore` and `utils/announcementRefresh` only inside function bodies, because those utils require `bot.js` at load time.
- **Mock mode**: the last line `Object.assign(module.exports, require('./dev/mockBot'))` swaps the Discord-facing exports; calls inside `bot.js` still reach the real functions (wiki rule "Internal calls inside bot.js use the real function even in mock mode"). `require('./dev/mockMode')` must run before `firebaseAdmin.js` is loaded.
- **Shared mutable state**: `isReady` (read in messages, polls, guild, channels, settings, lifecycle), `botStartedAt`, `dmsSentCount` (written by `sendDM`, read by `getBotStatus`), `commandsProcessedCount` (written by the dispatcher), `presenceUpdateInterval` (owned by `applyBotSettings`, cleared by `stopBot`, read by `getBotStatus`), `reminderInterval` (owned by `startReminderScheduler`, cleared by `stopBot`, read by `getBotStatus`), `pendingDiscordRegistrations` (registration only), the settle promise (lifecycle only).
- **Cross-area references** (computed from the source): the only cycle is the ready handler, which calls `registerSlashCommands`, `logBotInviteUrl` and `applyBotSettings`. Polls use `resolveInteractionRoles`/`ensureUserProfile` from registration; registration uses `getUserRoles` (guild), `canRegisterViaDiscord` (messages) and the modal builders; the dispatcher calls the registration, slot and poll handlers. `getBotStatus` reads both intervals.
- Two tests read `bot.js` as text: `test/eventUrl.test.js` (no hand-built event links in `bot.js`, `routes/`, `utils/`, `dev/`) and `test/reminderScheduler.test.js` (`applyBotSettings` must not touch the reminder scheduler, B-02).

## Goals / Non-Goals

**Goals:**
- Each `bot/` module ≤ 500 lines with one area, readable whole by a person or an agent.
- Byte-for-byte the same observable behaviour, including mock mode and the existing tests unchanged in what they assert.
- A module graph without load-time cycles, so later B tickets add a file instead of growing one.

**Non-Goals:**
- Renaming functions, changing signatures, return values, messages or custom IDs.
- Restructuring `dev/mockBot.js` (it keeps mirroring the facade's export names).
- Moving pure helpers out to `utils/` (possible later; not needed for the split).

## Decisions

### 1. `bot/` folder plus a thin `bot.js` facade

`bot.js` keeps its name and its export object; Node resolves `require('./bot')` to the file `bot.js` before the folder `bot/`, so nothing outside changes. Alternative `bot/index.js` with all callers updated: more diff, no behaviour gain, and `require('./bot')` would silently switch from file to folder resolution (user picked the facade).

Facade content, in this order: `require('./dev/mockMode')` (first, as today), the `bot/` modules, `wireClient()` from `bot/lifecycle.js` (attaches `ClientReady`, `error` and `interactionCreate` once), `module.exports = { …same 44 names in the same order… }`, the mock overlay line.

### 2. Module map

| Module | Takes from `bot.js` today | Approx. lines |
|---|---|---|
| `bot/constants.js` | `TIMEZONE`, modal/select limits, checkbox values, `SELECTABLE_CHANNEL_TYPES`, all custom ID prefixes, `BUTTONS_PER_ROW`, roster/poll limits | 75 |
| `bot/client.js` | `client` (intents unchanged), `state = { isReady, startedAt, dmsSent, commandsProcessed }` | 40 |
| `bot/lifecycle.js` | ready + error handlers (via `wireClient`), `startBot`, `whenBotSettled`, `stopBot`, `logBotInviteUrl`, settle promise | 120 |
| `bot/commands.js` | `registerSlashCommands`; autocomplete branch → `handleAutocomplete`; `/events`, `/register`, `/unregister` → `handleChatCommand` | 260 |
| `bot/interactions.js` | the remaining dispatcher → `handleInteraction(interaction)`: counter, autocomplete, modal submit, select, button routing by custom ID, chat commands | 120 |
| `bot/guests.js` | `sendGuestInvitation`, guest accept/decline branch → `handleGuestButton` | 150 |
| `bot/messages.js` | `sendDM` … `refreshEventAnnouncements` (embed, roster, components, gone errors, stored messages) | 360 |
| `bot/polls.js` | poll embed/components/reply/refresh/mark deleted, `handlePollVoteButton`, `handlePollVoteSelect` | 240 |
| `bot/registrationModal.js` | `buildFieldCustomId` … `parseModalAnswers` (modal build + read, slot modal, slot reply) | 445 |
| `bot/registration.js` | `resolveInteractionRoles` … `handleSlotLeaveButton`, `replyWithFailure`, `pendingDiscordRegistrations` | 450 |
| `bot/guild.js` | `assignRole` … `getPublicGuildChannels`, `toMemberInfo` | 255 |
| `bot/channels.js` | `getGuildScheduledEvents`, `createScheduledEvent`, event channel create/add/remove/delete | 275 |
| `bot/scheduler.js` | `messageAcceptedParticipants`, `checkReminders`, `startReminderScheduler` + new `stopReminderScheduler`, `isReminderSchedulerRunning` | 115 |
| `bot/settings.js` | `getBotStatus`, `getBotSettings`, `saveBotSettings`, `buildActivityVariables`, `applyBotSettings`, `getRunningEvents` + new `stopPresenceUpdates`, `isPresenceAutoUpdating` | 270 |

Alternative "exactly four modules" (commands, interactions, messages, scheduler, as the ticket words it): modules of 700–1000 lines, so the file still cannot be read whole (user picked the finer cut). If a module ends up above 500 lines while moving, split it along its existing sections rather than raising the limit.

Dependency direction (no load-time cycle): `constants`, `client` ← `messages`, `guild`, `channels`, `registrationModal` ← `registration` ← `polls`, `guests` ← `interactions`, `commands` ← `scheduler`, `settings` ← `lifecycle` ← `bot.js`. `lifecycle` requires `commands`, `settings`, `scheduler` and `interactions` to wire the ready and interaction handlers, which removes the ready-handler cycle.

### 3. Shared state: one object for flags and counters, intervals stay with their owner

`let isReady` cannot be shared through `require` (a destructured copy would freeze at `false`). `bot/client.js` exports a mutable `state` object; modules read `state.isReady` and update `state.dmsSent += 1`. The intervals are not put into `state`: `scheduler` and `settings` keep them private and export `stop…`/`is…Running` functions, which `stopBot` and `getBotStatus` call. That keeps each timer under one owner and keeps `getBotStatus` output identical (`reminderSchedulerActive`, `presenceAutoUpdate`). Alternative getter functions (`isReady()`) everywhere: more churn at ~40 call sites for no gain.

### 4. Dispatcher becomes a router; the branch bodies move unchanged

`client.on('interactionCreate', …)` is attached once in `wireClient` and calls `handleInteraction`. The branch order stays exactly as today (autocomplete → modal submit → string select → button → chat command), as does the counter increment and the error replies. Branch bodies are cut and pasted into named functions; only identifiers change (`isReady` → `state.isReady`, `commandsProcessedCount++` → `state.commandsProcessed++`, `require('./utils/…')` → `require('../utils/…')`).

### 5. Keep every lazy require lazy

Requires of `utils/registrationService`, `utils/eventUtils`, `utils/pollStore` and `utils/announcementRefresh` stay inside function bodies, with the path adjusted to `../utils/…`. Hoisting them would bring back the load-time cycle with utils that destructure `require('../bot')` at load.

### 6. Mock mode unchanged by construction

`bot/` modules require each other, never the facade, so internal calls keep reaching the real functions, exactly like local calls inside today's `bot.js`. Utils and routes still get the mocked exports through the facade. No new Discord-facing export, so `dev/mockBot.js` needs no new twin; its two lazy `require('../bot')` calls keep working.

### 7. Tests as the safety net (TDD for a refactor)

- New `test/botModules.test.js`, written first:
  - export names of `require('../bot')` equal a pinned list of today's 44 names (green before and after: guards the facade);
  - every `bot/*.js` ≤ 500 lines and `bot.js` ≤ 150 lines; `new Client(` appears only in `bot/client.js`; no `bot/` module requires `../bot` (red before the move);
  - no file outside `bot.js` and `bot/` requires a `bot/` module (keeps the facade the only door, so `dev/mockMode` always loads first).
- `test/eventUrl.test.js` scans `bot.js` plus every file in `bot/`; `test/reminderScheduler.test.js` reads `applyBotSettings` from `bot/settings.js` and also rejects `stopReminderScheduler(`.
- The 16 behaviour test files that drive `bot.client` and exports run unchanged; they are the main proof. Plus `npm run test:e2e` and a mock-mode start (`npm run dev:mock`, register via website, bot center status page) as a smoke test.

## Risks / Trade-offs

- [A moved function references a name that is no longer in scope → `ReferenceError` only when that path runs] → move one area per step and run `npm test` after each; a scratch script that lists free identifiers per module (the one used for this design) is run on the new files before the last step; untested paths (slash commands, guest buttons) get a direct dispatch test via `dispatchInteraction` if none exists.
- [Load-order cycle reappears through a hoisted require] → Decision 5 plus the "no `bot/` module requires `../bot`" test; a cycle would surface as `undefined` destructured exports in `utils/registrationService.js`, which the existing registration tests catch.
- [Listener attached twice (module loaded through two paths)] → listeners are attached only in `wireClient`, called once from the facade; the guard test forbids direct requires of `bot/` from outside.
- [Large diff hides an accidental edit] → pure moves, one commit per area is not needed but the MR text lists the identifier-only changes; reviewers can compare with `git diff --color-moved`.
- [Wiki nodes point to `bot.js` for functions that moved] → `npm test` (wiki validation) checks source paths; the function → module table in `docs/wiki/modules/bot.md` replaces the old function map.

## Migration Plan

Nothing to migrate: no data, API or config change. Deploy as usual; rollback = revert the merge.
