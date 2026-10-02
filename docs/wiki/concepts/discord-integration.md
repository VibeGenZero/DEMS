---
id: discord-integration
title: Discord integration — what DEMS does in Discord
type: concept
tags: [discord, announcements, roles, channels, scheduled-events, dm, slash-commands, permissions, intents]
sources: [bot.js, routes/admin.js, utils/registrationService.js, utils/eventUtils.js]
depends_on: [bot]
see_also: [form-fields, registration-flow, reminders-presence, configuration]
---
# Discord integration — what DEMS does in Discord

> TL;DR: The bot announces events (embed + "Anmelden"/"Zum Event" buttons), lets members register through a modal, offers `/events`, `/register`, `/unregister`, sends DMs for every registration change, assigns/removes an event role, optionally creates private voice/text channels per event, and can create native Discord scheduled events. Everything targets ONE guild (`DISCORD_GUILD_ID`).

## Features

| Feature | Trigger | Implementation |
|---|---|---|
| Announcement | admin "Ankündigen" → `POST /api/admin/events/:id/announce` | `sendChannelMessage(DISCORD_ANNOUNCE_CHANNEL_ID, buildEventEmbed(event, link), { text, roleIds, pingEveryone, components: buildEventComponents(event, id) })` |
| Register button + modal | "Anmelden" on an announcement | `handleEventRegisterButton` / `handleEventRegisterModal` → [registration-flow](registration-flow.md), fields → [form-fields](form-fields.md) |
| Slash commands | `/events`, `/register`, `/unregister` | `registerSlashCommands` (guild commands, on ready); handled in the `interactionCreate` dispatcher |
| Status DMs | registration created / accepted / rejected / waitlisted / promoted / cancelled | `sendDM` with templates (`parseTemplate`) |
| Guest invitations | registrant invites members | `sendGuestInvitation` (DM with accept/decline buttons) |
| Event role | `event.assignRoleId` | `assignRole` on accept, `removeRole` on unregister |
| Private event channels | `event.autoCreateChannels` + `channelConfig.type` (`voice`/`text`/`both`) | `createEventChannels` in `DISCORD_EVENT_CATEGORY_ID`, `@everyone` denied, accepted users allowed; `add/removeParticipantToEventChannels`; `deleteEventChannels` |
| Scheduled event sync | admin "Mit Discord synchronisieren" | `createScheduledEvent` (voice channel if `discordChannelId`, else external location "TBD"; guild-only; banner image) |
| Scheduled event import | admin import dialog | `getGuildScheduledEvents` → prefills the create wizard |
| Reminders / start DMs / presence | scheduler, bot settings | [reminders-presence](reminders-presence.md) |
| Guild data for the UI | role pickers, channel pickers, server name | `getGuildRoles`, `getGuildChannels`, `getPublicGuildChannels`, `getGuildName` |

## Discord application setup

- OAuth2 redirect: `${BASE_URL}/auth/discord/callback`; scopes for users: `identify guilds guilds.members.read`.
- Bot scopes: `bot applications.commands`. The bot logs its invite URL with the needed permissions on startup (`logBotInviteUrl`): ManageRoles, ManageChannels, SendMessages, SendMessagesInThreads, EmbedLinks, MentionEveryone, ViewChannel, ReadMessageHistory, UseExternalEmojis.
- Gateway intents: Guilds, **GuildMembers (privileged — enable "Server Members Intent" in the developer portal)**, GuildMessages, DirectMessages, GuildScheduledEvents.
- The bot's role must be above `assignRoleId` roles to assign them.

## Announcement buttons

`buildEventComponents(event, id)`: "Anmelden" (`event_register:<id>`, only if `canRegisterViaDiscord(event)`: active and form fits into a modal) + "Zum Event" link button. The admin dialog previews this via `renderAnnounceButtonsPreview` (app.js).

## Gotchas

- Without `DISCORD_BOT_TOKEN` the web app runs, but every Discord helper is a no-op (`isReady` false).
- Links in DMs and embeds mostly use `#events/<id>` (opens the list, not the event) — see [known-issues](../reference/known-issues.md).
- `botSettings.announceChannel` is stored but announcements always use `DISCORD_ANNOUNCE_CHANNEL_ID`.
