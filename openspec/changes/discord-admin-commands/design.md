# Design

## Context

- Slash commands are defined in `bot/commands.js` (`buildSlashCommands`, English base names + German `setNameLocalizations`, registered per guild on ready) and routed by `bot/interactions.js` (autocomplete → modal submit → select → button → command). Discord keeps sending the base name as `commandName`.
- Admin check on Discord today: `bot/approvals.js` reads the interaction roles (`resolveInteractionRoles`) and compares with `DISCORD_ADMIN_ROLE_ID`; mock mode sets that id to the persona role `ROLE_ID.ADMIN`.
- Creating an event, announcing it, creating a poll and posting it live inside `routes/admin.js` handlers. `bot/` modules must not require `routes/`, and calls between `bot/` modules use the real helpers even in mock mode (`docs/wiki/modules/bot.md`), so a bot module that posts through `bot/messages.js` directly would send nothing in mock mode.
- Zone math (`zonedParts`, `fromZonedParts`) exists privately in `utils/eventSeries.js`. Templates: collection `eventTemplates`, `{ name, settings }` with `settings` already in the shape of `pickTemplateSettings`.

## Goals / Non-Goals

**Goals:**
- One code path per action for web and Discord, so rules and audit entries cannot drift.
- Everything reachable in mock mode tests through fake interactions; posts show up as `[MOCK-DISCORD]` lines.

**Non-Goals:**
- No new `bot.js` export (and so no new mock twin) — the commands only answer the interaction and call shared utils.
- No change of the web UI.

## Decisions

### 1. Shared actions in `utils/adminActions.js`

Moved out of `routes/admin.js`, called by the routes and by the bot:

- `buildNewEvent(input, createdBy)` → the `baseEvent` of `POST /events` (defaults, slots → places, reminder merge). The route keeps validation, series and poll decision; it only calls this builder.
- `createEventChannelsAllowed(event)` (moved as is, the route imports it).
- `publishDraft(eventId, adminId, { via })` → `{ ok, event }` or `{ ok: false, code: 'not_draft'|'missing'|'no_start' }`: status `active`, `updatedAt`, audit `UPDATE_EVENT_STATUS` ("Changed status to active in Discord"), channels via `createEventChannelsAllowed` when `autoCreateChannels`, `notifyRegistrationsChanged`. Only drafts (a web publish has its own route and side effects for other statuses).
- `announceEvent(eventId, adminId, { pings, via })` → `{ ok, sent }` or `{ ok: false, error }` with the German texts of today's route (target from `announceTarget`, roster, `sendChannelMessage`, stored announcement record, thread per bot center switch, audit `ANNOUNCE_EVENT`). The route maps `ok: false` to 400/404/500 as today.
- `createPoll(input, adminId, { via })` and `announcePoll(pollId, adminId, { pings, via })` likewise for `POST /polls` and `POST /polls/:id/announce`.

`via: 'discord'` appends " in Discord" to the audit detail. Bot helpers are reached with `require('../bot')` inside the functions (lazy), as `utils/announcementRefresh.js` does — so mock mode gets the twins and `bot/` loading stays free of cycles. `bot/adminCommands.js` requires `../utils/adminActions` lazily inside its handlers for the same reason.

Alternative considered: posting from a new `bot/` module. Rejected — it would call the real `sendChannelMessage` in mock mode (nothing posted) and duplicate the route logic.

### 2. Commands and routing

- `buildSlashCommands` adds `event` (subcommand `create`, de `erstellen`, string option `template`, de `vorlage`, autocomplete, optional) and `poll` (de `abstimmung`, subcommand `create`, de `erstellen`).
- `handleChatCommand` routes `event`/`poll` with subcommand `create` to `bot/adminCommands.js`; `handleAutocomplete` routes `event` to `handleTemplateAutocomplete` (admins only, name contains the typed text, ≤ 25, value = template id).
- Custom IDs (`bot/constants.js`): `admin_event_modal:<templateId|->`, `admin_poll_modal`, `admin_event_publish:<eventId>`, `admin_event_activate:<eventId>`, `admin_retry:<key>`. `bot/interactions.js` routes the modal and button prefixes; errors answer with `replyWithFailure`.

### 3. `bot/adminCommands.js`

- `hasAdminRole(interaction)`: `resolveInteractionRoles` contains `DISCORD_ADMIN_ROLE_ID` (none configured → false). Every entry point checks it first.
- Modals: `buildEventModal(values, { withPlaces })` and `buildPollModal(values)` with `LabelBuilder` + `TextInputBuilder` like the registration modal (Titel ≤ 200, Beschreibung paragraph ≤ 4000, Termine paragraph). Placeholders show the format („24.12.2026 19:30“).
- Event submit: `deferReply` ephemeral → parse (decision 4) → template settings (stored, else none) → `buildNewEvent({ ...settings, title, description, maxParticipants (unless slots), startDate, endDate, status: 'draft' })` → `checkEventFields` (same validator as the route) → `addDoc` + audit `CREATE_EVENT` → answer: summary (title, start in `TIMEZONE`, places text via `formatPlaces`/`summarizePlaces`, "Entwurf") + buttons.
- Buttons: `deferUpdate` → admin check → `publishDraft`; for publish+announce then `announceEvent`; `editReply` with the result line and only the link button left. A refused announcement keeps the event active and shows the reason.
- Poll submit: parse lines → `createPoll` (runs `normalizePollInput`) → `announcePoll` → answer with the message link `https://discord.com/channels/<guild>/<channel>/<message>`.
- Corrections: refused input is stored in a `Map` key (random 8 chars) → `{ kind, templateId, values, userId, expires }`, 15 minutes, pruned on each write; „Korrigieren“ (`admin_retry:<key>`) is only valid for the same user and reopens the modal with the values (`showModal`, no defer). Expired → „Die Eingabe ist abgelaufen. Starte den Befehl neu.“

### 4. `utils/localDateTime.js`

`parseLocalDateTime(text, timeZone)` → `Date|null` for `D.M.YYYY H:MM` / `D.M.YY H:MM` (also `HH.MM`? no — colon only), validating calendar values (31.02. → null) through a round trip of `zonedParts`. `parseEndInput(text, start, timeZone)`: empty → null; `H:MM` → start day, +1 day when not after start; else `parseLocalDateTime`. `parsePollLines(text, timeZone)` → `[{ startDate, endDate }]` or `{ error, line }`; separator `–`, `-` or `bis`. Errors are German and name the line. Uses `zonedParts`/`fromZonedParts`, now exported from `utils/eventSeries.js`.

### 5. Event defaults without a template

Same as a web event created with an empty wizard: `buildNewEvent` defaults (`accessMode: 'open'`, `approvalMode: 'manual'`, guests allowed, reminders default of `mergeReminderHours`). `createdBy` = Discord user id.

## Risks / Trade-offs

- [Discord's 3-second limit] → submits and buttons defer first; `showModal` paths do only the admin check and one template read before answering.
- [Corrections store is in memory] → lost on restart; the button then says so. Acceptable for a 15-minute convenience.
- [A template referencing a deleted role or channel] → same behaviour as applying it in the wizard; the event is a draft and can be fixed on the website.
- [Refactor of four routes] → `test/devServer.test.js` covers create, announce, poll create and poll announce today; they must stay green unchanged.

## Migration Plan

None. New commands register with the next bot start (guild commands update at once).
