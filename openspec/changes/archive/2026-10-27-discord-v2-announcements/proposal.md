# Proposal

## Why

Event announcements and date polls in Discord are classic embeds: a purple bar, a wall of inline fields and all buttons crammed below the message, regardless of the event's colour (B-05, issue 88). Discussion about an event has no place either: members reply in the announcement channel, where the talk about several events mixes (B-14, issue 97). discord.js 14.27 (already installed) supports Components V2, so both can be fixed together without a new dependency.

## What Changes

- Event announcements are sent as a Components V2 message: a container in the event's colour (`accentColor`, fallback the DEMS accent), the banner as a media gallery, title and facts as text, the line-up as one section per slot with that slot's button next to it, and the "Anmelden"/"Zum Event" buttons at the end.
- Date poll messages (posted, refreshed, marked deleted) use the same container style.
- Role pings, `@everyone` and the admin's custom text sit in a text block above the container. They are stored with the announcement so live updates keep them (an edit replaces every component).
- Live updates (registrations, deadlines, archive, event changes) re-render the new layout. Announcements posted before this change are converted to the new layout on their next update; if Discord refuses that, the message stays as it is and the failure is logged.
- **BREAKING (internal)**: `buildEventEmbed`, `buildEventComponents`, `buildPollEmbed`, `buildPollComponents` and the signature `sendChannelMessage(channelId, embed, options)` are replaced by message builders that return a whole V2 payload. All callers are inside the repo (routes, mock bot, wizard preview).
- The wizard preview (D-10) draws the new layout instead of an embed.
- New: announcing an event opens a public discussion thread on the announcement message (one thread per event; re-announcing reuses it while it exists, otherwise opens a new one on the new message).
- New bot center switch "Diskussions-Thread zu Ankündigungen" (default on).
- The event page shows a "Diskussion" row linking to the thread when there is one.
- Duplicated events, series copies and new events never inherit a thread.

## Capabilities

### New Capabilities
- `discord-announcements`: how event announcements and date poll messages look in Discord (Components V2 layout, colours, banner, line-up with per-slot buttons, pings) and how posted messages are kept up to date, including old embed messages.
- `announcement-threads`: the discussion thread of an event announcement — when it is opened, reused or replaced, the bot center switch, and the link on the event page.

### Modified Capabilities
- `bot-center-settings`: the defaults requirement lists the new thread switch (on by default).
- `event-banners`: "Discord shows uploaded banners" talks about the embed image; it becomes the announcement's banner image.

## Impact

- Code: `bot/messages.js` (layout builders, `sendChannelMessage`, refresh, new thread helper), `bot/polls.js`, `bot/constants.js`, `bot.js` exports, `dev/mockBot.js` twins, `routes/admin.js` (`/events/preview`, `/events/:id/announce`, `/polls/:id/announce`, duplicate/series/new event resets, bot settings save), `utils/botSettings.js`, `utils/botPermissions.js` (Create Public Threads), `public/js/admin/discord-preview.js` + "DISCORD PREVIEW" block in `public/css/style.css`, `public/js/admin/bot-control.js` + bot center markup in `public/index.html`, `public/js/events/detail.js` + sidebar row markup, `dev/seedData.js`.
- Data: event announcement records gain the ping data; events gain `discordThread` (`{ guildId, threadId }` or null). No migration; old records keep working.
- Discord: the bot needs the "Öffentliche Threads erstellen" permission; existing installs must re-invite or grant it (otherwise the announcement still goes out, without a thread).
- Tests: `test/botModules.test.js` export list, bot message tests, `test/devServer.test.js` (announce, preview, settings), frontend preview tests, e2e wizard preview.
- Wiki: `docs/wiki/modules/bot.md`, `docs/wiki/concepts/discord-integration.md`, `docs/wiki/concepts/data-model.md`, `docs/wiki/modules/routes-admin.md` (or the node owning the announce/preview routes), `docs/wiki/modules/frontend-app.md`, `docs/wiki/modules/dev-mock-mode.md`.
- Tickets: B-05 (issue 88) and B-14 (issue 97), one branch and MR.
