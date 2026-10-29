# Design

## Context

Registration from Discord already exists for announcement clicks (`docs/wiki/modules/bot.md`):

- `handleEventRegisterButton(interaction, eventId)` in `bot/registration.js` loads the event, runs `checkRegistrationConditions`, then opens `buildRegistrationModal` (form), answers with the website link (form too big, `fitsIntoDiscordModal`) or defers and calls `completeDiscordRegistration`.
- Slot events have no "Anmelden" button; each slot has `buildSlotButton` (`bot/messages.js`, custom ID `event_slot:<eventId>:<slotId>`), handled by `handleEventSlotButton`.
- `/register` in `bot/commands.js` (`handleChatCommand`) only replies with a website-link embed; `registerSlashCommands` defines `register`/`unregister` without localizations.

Everything `handleEventRegisterButton` calls on the interaction (`reply`, `showModal`, `deferReply`, `editReply`, `user`, `member`) exists on a chat input command interaction too, and the dispatcher in `bot/interactions.js` routes `event_slot:` buttons no matter which message carries them (also an ephemeral reply).

## Goals / Non-Goals

**Goals:**
- One registration flow for button and command: no second copy of the checks or the modal logic.
- Slot choice for `/register` that ends in the unchanged slot flow.

**Non-Goals:**
- No change to `/unregister` behaviour, the autocomplete or the announcement layout.
- No new export through `bot.js` and therefore no new twin in `dev/mockBot.js` (the command handlers are internal to `bot/`; tests drive them through `client.emit('interactionCreate', …)` as today).
- No new env variables.

## Decisions

1. **`/register` delegates instead of duplicating.** `handleChatCommand` loads nothing itself for `register`: it hands the event ID to a new `handleRegisterCommand(interaction, eventId)` in `bot/commands.js` (not `bot/registration.js`: that module would pass the 500-line limit of `test/botModules.test.js`; `checkRegistrationConditions` gets exported from there instead). That function loads the event (unknown → "❌ Event nicht gefunden."), and
   - for an event without slots calls `handleEventRegisterButton(interaction, eventId)` unchanged;
   - for a slot event runs `resolveInteractionRoles` + `checkRegistrationConditions` (same messages as the button), then `fitsIntoDiscordModal` (too big → the same link text as `handleEventSlotButton`, with `getModalFieldLimit`), then replies privately with the slot buttons.
   *Alternative:* fake a button interaction / reuse the handler via custom ID parsing — rejected, hides the command path and breaks the debug log.
   *Alternative:* open a select menu of slots — rejected, buttons reuse `handleEventSlotButton` 1:1 and match the announcement.

2. **Slot choice message.** Ephemeral reply with `content: "Wähle deine Rolle für **<title>**:"` and classic `ActionRowBuilder` rows of up to 5 `buildSlotButton(eventId, slot, roster)` each (max 10 slots → 2 rows). The roster comes from `buildRoster(event, await loadEventRegistrations(eventId))` so "(voll)" matches the announcement. `buildSlotButton` gets exported from `bot/messages.js` (module export only). No Components V2 here: the ephemeral answers of the slot flow (`buildRegisteredSlotReply`) are classic messages too, and a click replaces nothing — it opens the modal or answers on its own.

3. **German names through Discord localization.** `SlashCommandBuilder.setNameLocalizations({ de: 'anmelden' })` / `{ de: 'abmelden' }`; descriptions stay German (base) and get the same German text as `de` localization. Discord still sends `commandName: 'register'` / `'unregister'`, so `handleAutocomplete`, `handleChatCommand` and the tests keep their names. *Alternative:* rename the commands to German — rejected, members with other client languages would lose the English names and the routing would change.

4. **Errors.** The `register` branch of `handleChatCommand` keeps its `try/catch`; the catch answers with `replyWithFailure(interaction)` (handles deferred/replied states) instead of the bare `reply`, because the flow may already have deferred.

## Risks / Trade-offs

- [Discord caches command definitions per guild] → `registerSlashCommands` overwrites the guild commands on every ready; German names show after the next bot start without user action.
- [The slot answer can go stale while it is open] → a click re-checks everything in `handleEventSlotButton`; the answer itself is private and short-lived.
- [Test double lacks `showModal`] → extend `createFakeInteraction` in `test/helpers.js` to record `showModal` as an answer.

## Migration Plan

Deploy normally; on the first ready event the bot re-registers the commands with localizations. Rollback: redeploy the previous version (commands are overwritten again).
