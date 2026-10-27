---
id: discord-integration
title: Discord integration — what DEMS does in Discord
type: concept
tags: [discord, announcements, roles, channels, scheduled-events, dm, slash-commands, permissions, intents]
sources: [bot.js, bot/messages.js, bot/guild.js, bot/channels.js, routes/admin.js, utils/registrationService.js, utils/eventUtils.js, utils/eventUrl.js, utils/botPermissions.js, utils/eventChangeNotice.js, utils/notificationPrefs.js, utils/participantMessage.js, utils/botSettings.js]
depends_on: [bot]
see_also: [form-fields, registration-flow, reminders-presence, configuration]
---
# Discord integration — what DEMS does in Discord

> TL;DR: The bot announces events (embed + "Anmelden"/"Zum Event" buttons), lets members register through a modal, offers `/events`, `/register`, `/unregister`, sends DMs for every registration change, assigns/removes an event role, optionally creates private voice/text channels per event, and can create native Discord scheduled events. Everything targets ONE guild (`DISCORD_GUILD_ID`). The helpers named below live in the area modules of `bot/` (table in [bot](../modules/bot.md)) and are exported through `bot.js`.

## Features

| Feature | Trigger | Implementation |
|---|---|---|
| Announcement | admin "Ankündigen" → `POST /api/admin/events/:id/announce` (channel: bot center "Ankündigungskanal", else `DISCORD_ANNOUNCE_CHANNEL_ID`, B-02; forum channels are listed as text but cannot take a post) | `sendChannelMessage(<announcement channel>, buildEventEmbed(event, link, roster), { text, roleIds, pingEveryone, components: buildEventComponents(event, id, roster) })`; stores `{ channelId, messageId }` in `event.announcements` (max 5) |
| Live announcement | every registration change → `notifyRegistrationsChanged` (2 s debounce) | `refreshEventAnnouncements` edits the stored messages (line-up, counts, buttons); deleted messages (Discord 10003/10008) are dropped |
| Date polls | admin "In Discord posten" → `POST /api/admin/polls/:id/announce` | poll embed (tally, 🏆 favorite) + `poll_vote:<pollId>` → private answer with `poll_yes`/`poll_maybe` selects; live refresh via `notifyPollChanged` → `refreshPollMessages`; deleted polls become a notice — see [date-polls](date-polls.md) |
| Slot buttons | slot events | one button per slot `event_slot:<eventId>:<slotId>` → modal with `alt_slots` + form; registered members get `slot_switch:*` / `slot_leave:*` — see [role-slots](role-slots.md) |
| Register button + modal | "Anmelden" on an announcement | `handleEventRegisterButton` / `handleEventRegisterModal` → [registration-flow](registration-flow.md), fields → [form-fields](form-fields.md) |
| Slash commands | `/events`, `/register`, `/unregister` | `registerSlashCommands` (guild commands, on ready); handled in the `interactionCreate` dispatcher |
| Status DMs | registration created / accepted / rejected / waitlisted / promoted | `sendAutomaticDM` (`utils/botSettings.js`, B-02) with templates (`parseTemplate`); the cancellation DM (admin cancels the event) calls `sendDM` directly |
| Switch "DM-Benachrichtigungen" (B-02) | admin in the bot control center | off → `sendAutomaticDM` sends nothing: status DMs, waitlist and move-up DMs, answers to guest invitations, change DMs, date poll results. Not covered (direct `sendDM` / own function): cancellation, "Nachricht an Teilnehmer" (W-09), the guest invitation itself (only its buttons let a guest answer). Reminders and the start DM have their own switches ([reminders-presence](reminders-presence.md)). `test/botSettings.test.js` fails if another direct `sendDM` call appears outside `bot.js` |
| DM choices (W-16) | member profile → "Discord-Nachrichten" | `utils/notificationPrefs.js`: "Erinnerungen" (reminders + start DM), "Änderungen" (change DM + cancellation), "Warteliste" ("put on the waitlist" DM) can be switched off; every other DM (request received, accepted, rejected, moved up, guest invitations, polls, messages of the team) always goes out; default on — see [routes-user](../modules/routes-user.md) |
| Change DMs | admin saves a new start, end or location with "Teilnehmer benachrichtigen" (W-04) | `notifyEventChange` (`utils/eventChangeNotice.js`) → `sendDM` to accepted participants and accepted guests who want change DMs, fixed German text with before → after — see [event-lifecycle](event-lifecycle.md) |
| Messages of the team | admin writes in "Nachricht an Teilnehmer" (W-09) | `sendParticipantMessage` (`utils/participantMessage.js`) → `sendDM` to the chosen group (accepted only, or accepted + pending + waitlisted) and their accepted guests, plain text with title, the admin's text, sender and event link; not affected by DM choices — see [routes-admin](../modules/routes-admin.md) |
| Welcome message (B-02) | a member is accepted for the first time ever (instant, admin, bulk, admin entry, moving up) and the bot center has a welcome text | `sendWelcomeOnce(user, registrationId)` (`utils/botSettings.js`) after the accepted DM: not when `users.welcomeSentAt` is set or another registration of the member is already accepted; flag written before the DM; `{user.name}`, `{user.mention}`; follows "DM-Benachrichtigungen" |
| Guest invitations | registrant invites members | `sendGuestInvitation` (DM with accept/decline buttons; always sent, also with "DM-Benachrichtigungen" off); the answers to the registrant/guest go through `sendAutomaticDM` |
| Event role | `event.assignRoleId` | `assignRole` on accept, `removeRole` on unregister |
| Private event channels | `event.autoCreateChannels` + `channelConfig.type` (`voice`/`text`/`both`); globally locked while "Auto Channel-Erstellung" is off in the bot center (`createEventChannelsAllowed` in `routes/admin.js`, B-02; the wizard disables the option) | `createEventChannels` in `DISCORD_EVENT_CATEGORY_ID`, `@everyone` denied, accepted users allowed; `add/removeParticipantToEventChannels`; `deleteEventChannels(eventId)` reads the ids from the event → called before an event or series is deleted |
| Scheduled event sync | admin "Mit Discord synchronisieren" | `createScheduledEvent` (voice channel if `discordChannelId`, else external location "TBD"; guild-only; banner image) |
| Scheduled event import | admin import dialog | `getGuildScheduledEvents` → prefills the create wizard |
| Reminders / start DMs / presence | scheduler, bot settings | [reminders-presence](reminders-presence.md) |
| Guild data for the UI | role pickers, channel pickers, server name and icon | `getGuildRoles`, `getGuildChannels`, `getPublicGuildChannels`, `getGuildName`, `getGuildIconUrl` |

## Discord application setup

- OAuth2 redirect: `${BASE_URL}/auth/discord/callback`; scopes for users: `identify guilds guilds.members.read`.
- Bot scopes: `bot applications.commands`. The bot logs its invite URL with the needed permissions on startup (`logBotInviteUrl` → `buildBotInviteUrl`, list with reasons in `utils/botPermissions.js` `BOT_PERMISSIONS`): ManageRoles, ManageChannels, SendMessages, SendMessagesInThreads, EmbedLinks, MentionEveryone, ViewChannel, ReadMessageHistory, UseExternalEmojis, Connect, CreateEvents.
- Discord lets a bot grant only permissions it has itself: everything `addParticipantToEventChannels` allows (ViewChannel, Connect, SendMessages) must be in `BOT_PERMISSIONS`. "Mit Discord synchronisieren" (`createScheduledEvent`) needs CreateEvents. A bot invited with an older URL lacks Connect and CreateEvents → re-invite with the logged URL or grant them to the bot role in the server settings.
- Gateway intents: Guilds, **GuildMembers (privileged — enable "Server Members Intent" in the developer portal)**, GuildMessages, DirectMessages, GuildScheduledEvents.
- The bot's role must be above `assignRoleId` roles to assign them.

## Announcement buttons

`buildEventComponents(event, id, roster)`: slot events get one button per slot (5 per row, "(voll)" when full) instead of "Anmelden"; otherwise "Anmelden" (`event_register:<id>`, only if `canRegisterViaDiscord(event)`: active, neither over nor past its registration deadline, and form fits into a modal) + "Zum Event" link button. The embed shows "⏰ Anmeldung bis" / "⏰ Abmeldung bis" for the optional deadlines (W-03); once the registration deadline passes, the scheduler refreshes the stored announcements once so only "Zum Event" stays, and old buttons or modals answer "Die Anmeldung für dieses Event ist geschlossen.". The ephemeral slot status answer drops the switch button after the registration deadline and "Abmelden" after the unregister deadline. The admin dialog previews this via `renderAnnounceButtonsPreview` (`public/js/admin/event-actions.js`).

## Gotchas

- Without `DISCORD_BOT_TOKEN` the web app runs, but every Discord helper is a no-op (`isReady` false).
- Every event link in embeds, buttons, DMs and `{event.url}` comes from `buildEventUrl` (`utils/eventUrl.js`) and opens `#event/<id>`. Messages sent before v2.5.1 still contain `#events/<id>`; the SPA router rewrites those.
- Announcements sent before 2.6.0 have no stored message ID and stay static.
