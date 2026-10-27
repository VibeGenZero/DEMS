# Proposal

Ticket: **B-01 `bot.js` aufteilen** (GitLab work item 84, branch `84-b-01-bot-js-aufteilen`, P1). The prioplan says "Als Erstes erledigen": B-03, B-04, B-05, B-06, B-12 and B-13 build on it.

## Why

`bot.js` has grown to 3076 lines with about 140 functions: the discord.js client, a 380-line interaction dispatcher, slash commands, messages and embeds, date polls, the registration modal, guild data, event channels, the reminder scheduler and the bot control center all live in one file. Every B ticket after this one adds commands, buttons or message layouts to it; in one file those changes collide, the file cannot be read whole, and the wiki's function map drifts (it still says ~2200 lines).

## What Changes

- New folder `bot/` with one module per area, each ≤ ~500 lines (the same rule as the frontend modules): `constants`, `client` (client + shared runtime state), `lifecycle` (ready/error, start, settle, stop, invite URL), `commands` (slash command registration, autocomplete, `/events`, `/register`, `/unregister`), `interactions` (routes modal, select and button interactions by custom ID), `guests` (guest invitation DM and its buttons), `messages` (DMs, channel messages, event embed and buttons, announcement refresh), `polls`, `registrationModal` (building and reading the registration and slot modals), `registration` (registration and slot handlers), `guild` (roles, members, guild data), `channels` (event channels, scheduled events), `scheduler` (reminders), `settings` (status, settings, presence, running events).
- `bot.js` stays as a thin entry point: it loads the modules, wires the client listeners, exports exactly the same 44 names as today and lays `dev/mockBot.js` over them in mock mode. No caller changes (`server.js`, `routes/`, `utils/`, `dev/`, tests keep `require('./bot')`).
- Module-level `let` state (`isReady`, start time, counters) moves into one shared `state` object in `bot/client.js`; the two intervals stay private to their owners (`scheduler`, `settings`) behind small stop/status functions, so `stopBot` and `getBotStatus` keep working.
- The inline branches of the dispatcher (slash commands, autocomplete, guest buttons) become named functions in their modules; their code moves unchanged.
- No behaviour change: same Discord messages, custom IDs, slash commands, return values, guards and log lines. Mock mode keeps its rule that calls inside the bot use the real functions.
- Guard tests: the export list of `bot.js` is pinned, every `bot/` module stays under the size limit, only `bot/client.js` creates a `Client`, no `bot/` module requires the `bot.js` facade. Two existing source-reading tests (`test/eventUrl.test.js`, `test/reminderScheduler.test.js`) are pointed at the new files so they keep guarding.
- Out of scope: new commands or layouts (B-03 ff.), moving `dev/mockBot.js`, changing `utils/` helpers.

## Capabilities

### New Capabilities

None. Pure refactor: no spec-level behaviour changes, so the change sets `skip_specs: true`.

### Modified Capabilities

None.

## Impact

- Code: `bot.js` (becomes the facade), new `bot/*.js` (14 modules), `test/botModules.test.js` (new), `test/eventUrl.test.js` and `test/reminderScheduler.test.js` (read the new files). No route, util, frontend or data change.
- API, data, env variables, dependencies, Docker: unchanged (`COPY . .` already takes the new folder; `.dockerignore` does not exclude it).
- Wiki nodes: `docs/wiki/modules/bot.md` (rewritten as a module map), `docs/wiki/overview/directory-map.md`, `docs/wiki/overview/architecture.md`, `docs/wiki/howto/add-bot-feature.md`, `docs/wiki/modules/dev-mock-mode.md`, plus every node whose `sources` or text points to a function now in `bot/` (`concepts/discord-integration.md`, `concepts/registration-flow.md`, `concepts/date-polls.md`, `concepts/reminders-presence.md`, `concepts/role-slots.md`, `concepts/form-fields.md`, `howto/add-form-field-type.md`, `reference/conventions.md`, `ops/testing.md`), the file → node table in `docs/wiki/index.md`, and `CLAUDE.md` (line count in "Never read these files whole", Discord rule naming `bot.js` helpers).
