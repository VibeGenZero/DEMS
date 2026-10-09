---
id: bot
title: bot.js — Discord bot and Discord helpers
type: module
tags: [discord, bot, discordjs, slash-commands, modals, buttons, dm, roles, channels]
sources: [bot.js, dev/mockBot.js]
part_of: [architecture]
depends_on: [data-layer, utils, middleware]
see_also: [discord-integration, reminders-presence, form-fields]
---
# bot.js — Discord bot and Discord helpers

> TL;DR: `bot.js` (~2200 lines) owns the discord.js `Client` and exports ~28 helpers the routes call (DMs, channel messages, roles, guild data, event channels, scheduled events, bot status/settings). It also handles all Discord interactions: `/events`, `/register`, `/unregister`, the "Anmelden" button + registration modal, and guest-invitation buttons. Every helper returns `false`/`[]`/`null` while the bot is not ready. Do not read it whole — jump by function name.

## Function map (grep `function <name>`)

| Area | Functions |
|---|---|
| Setup | constants (`MODAL_*_MAX_LENGTH`, `REGISTER_BUTTON_PREFIX`, `REGISTER_MODAL_PREFIX`, `SELECTABLE_CHANNEL_TYPES`), `client` (intents: Guilds, GuildMembers, GuildMessages, DirectMessages, GuildScheduledEvents), `client.once(Events.ClientReady)` → `registerSlashCommands`, `logBotInviteUrl`, `applyBotSettings` |
| Interaction dispatcher | `client.on('interactionCreate', ...)`: autocomplete → modal submit → buttons → slash commands |
| Messaging | `sendDM`, `sendChannelMessage`, `buildEventEmbed` (+ `formatParticipantCount`, `formatRosterSlotTitle`, `formatRosterMembers`), `buildEventComponents` (+ `buildSlotButton`), `parseTemplate` (from `utils/template.js`, re-exported), `sendGuestInvitation`, `refreshEventAnnouncements`, `isGoneDiscordError`, `editStoredMessages` |
| Date polls | `buildPollEmbed` (+ `formatPollVoters`), `buildPollComponents`, `buildPollVoteReply`, `refreshPollMessages`, `markPollMessagesDeleted`, `handlePollVoteButton`, `handlePollVoteSelect` |
| Registration via Discord | `canRegisterViaDiscord`, `buildRegistrationModal` (+ `buildModalIntro`, `buildFieldDescription`, `applySelectConstraints`, `applyFieldComponent`, `buildFieldCustomId`), `readModalField`, `parseModalAnswers`, `resolveSelectedUserName`, `resolveInteractionRoles`, `ensureUserProfile`, `checkRegistrationConditions`, `completeDiscordRegistration`, `handleEventRegisterButton`, `handleEventRegisterModal`; slots: `addFormFieldLabels`, `buildSlotModal`, `readAltSlotIds`, `buildRegisteredSlotReply`, `handleEventSlotButton`, `handleEventSlotModal`, `handleSlotSwitchButton`, `handleSlotLeaveButton`, `replyWithFailure` |
| Guild data | `getGuildName`, `getGuildRoles`, `getGuildChannels`, `getPublicGuildChannels`, `getUserRoles`, `fetchMemberRoleIds` (`{ isMember, roleIds }` or `null` when Discord cannot answer; for `createRoleRefresh`), `isGuildMember`, `assignRole`, `removeRole` |
| Event channels & scheduled events | `createEventChannels`, `addParticipantToEventChannels`, `removeParticipantFromEventChannels`, `deleteEventChannels`, `getGuildScheduledEvents`, `createScheduledEvent` |
| Reminders | `checkReminders({ now, send })` (exported for tests), `messageAcceptedParticipants`, `startReminderScheduler`; rules in `utils/reminders.js` |
| Bot control center | `getBotStatus`, `getBotSettings`, `saveBotSettings`, `buildActivityVariables`, `applyBotSettings`, `getRunningEvents` |
| Lifecycle | `startBot(token)`, `stopBot()`, `logBotInviteUrl` (URL from `buildBotInviteUrl`, `utils/botPermissions.js`) |

## Interaction custom IDs

| Custom ID | Component | Handler |
|---|---|---|
| `event_register:<eventId>` | "Anmelden" button on announcements | `handleEventRegisterButton` |
| `event_register_modal:<eventId>` | registration modal | `handleEventRegisterModal` |
| `field:<index>` | input inside the modal | `readModalField` |
| `guest_accept:<registrationId>:<guestUserId>` / `guest_decline:...` | buttons in guest-invitation DM | inline in dispatcher |
| `event_slot:<eventId>:<slotId>` | slot button on announcements | `handleEventSlotButton` |
| `event_slot_modal:<eventId>:<slotId>` | slot modal | `handleEventSlotModal` |
| `alt_slots` | fallback-role select inside the slot modal | `readAltSlotIds` |
| `slot_switch:<eventId>:<slotId>` / `slot_leave:<eventId>` | buttons in the ephemeral status answer | `handleSlotSwitchButton` / `handleSlotLeaveButton` |
| `poll_vote:<pollId>` | "Abstimmen" below a poll message | `handlePollVoteButton` |
| `poll_yes:<pollId>` / `poll_maybe:<pollId>` | vote selects in the ephemeral answer (handled before the button branch via `isStringSelectMenu`) | `handlePollVoteSelect` |

Slash commands (guild-scoped, registered on ready): `/events` (list active events, public reply), `/register event:<autocomplete>` (replies with the website link), `/unregister event:<autocomplete>` (deletes the registration, removes role, promotes waitlist).

## Exports

`client, startBot, stopBot, sendDM, sendChannelMessage, buildEventEmbed, assignRole, removeRole, getUserRoles, fetchMemberRoleIds, isGuildMember, getGuildName, getGuildRoles, getGuildChannels, getPublicGuildChannels, getGuildScheduledEvents, parseTemplate, startReminderScheduler, createEventChannels, addParticipantToEventChannels, removeParticipantFromEventChannels, deleteEventChannels, createScheduledEvent, getBotStatus, getBotSettings, saveBotSettings, getRunningEvents, sendGuestInvitation, buildEventComponents, canRegisterViaDiscord, refreshEventAnnouncements, isGoneDiscordError, buildSlotModal, buildRegisteredSlotReply, buildPollEmbed, buildPollComponents, buildPollVoteReply, refreshPollMessages, markPollMessagesDeleted`.

At the end of the file: `if (IS_MOCK_MODE) Object.assign(module.exports, require('./dev/mockBot'))` — in dev mock mode every Discord-facing export is replaced by a logging simulation (see [dev-mock-mode](dev-mock-mode.md)). Pure logic (`parseTemplate`, `buildEventEmbed`, `buildEventComponents`, settings, running events, `stopBot`) stays real.

## Rules for changes

- Guard every new Discord call with `if (!isReady) return <neutral value>;` and `try/catch` + `console.error` — routes must keep working without a bot.
- Use `flags: MessageFlags.Ephemeral` (not the deprecated `ephemeral: true`) and `Events.ClientReady`.
- Modal limits: max 5 top-level components (the intro text display counts; slot events with more than one slot use one for the `alt_slots` select → `getModalFieldLimit`), label ≤45, description/placeholder ≤100 chars.
- New Discord-facing export → also add a mock to `dev/mockBot.js`, otherwise mock mode calls the real (not ready) function.
- Internal calls inside `bot.js` (e.g. `checkReminders` → `sendDM`) use the real function even in mock mode.

## Gotchas

- `sendChannelMessage` returns `{ channelId, messageId }` (it used to return `true`).
- `slot_switch`, `slot_leave` and `/unregister` call `deferUpdate`/`deferReply` first and answer with `editReply` — their side effects can exceed Discord's 3 s limit. A guest decline promotes the waitlist after answering.
- Event links come from `buildEventUrl` in `utils/eventUrl.js` (`#event/<id>`); a hand-built `#events/<id>` would open the event list — see [utils](utils.md).
