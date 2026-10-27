# Design

## Context

See proposal.md (Why). Current state:

- `bot/messages.js` builds the event embed (`buildEventEmbed`) and the button rows (`buildEventComponents`) separately; `sendChannelMessage(channelId, embed, { text, roleIds, pingEveryone, components })` puts pings and text into `content`. `refreshEventAnnouncements` and `refreshPollMessages` re-render with `editStoredMessages(announcements, payload)` — one payload for every stored message.
- `bot/polls.js` has the same pair for polls (`buildPollEmbed`, `buildPollComponents`) plus `markPollMessagesDeleted`.
- Announcement records are `{ channelId, messageId }` in `event.announcements` / `poll.announcements` (at most `MAX_TRACKED_ANNOUNCEMENTS` = 5, `routes/admin.js`). The pings are not stored.
- `POST /api/admin/events/preview` returns `{ embed, components }` JSON that `public/js/admin/discord-preview.js` draws.
- Callers only `require('./bot')`; `dev/mockBot.js` replaces Discord-facing exports in mock mode, pure builders stay real.
- discord.js 14.27.0 is installed and has `ContainerBuilder`, `SectionBuilder`, `TextDisplayBuilder`, `MediaGalleryBuilder`, `SeparatorBuilder`, `MessageFlags.IsComponentsV2`, `ThreadAutoArchiveDuration` and `PermissionsBitField.Flags.CreatePublicThreads` (checked).

Discord rules for a Components V2 message that shape the design: no `content` and no `embeds`; at most 40 components counted with nesting; at most 4000 characters of text over all text displays; a section needs an accessory (button or thumbnail); mentions inside a text display ping according to `allowed_mentions`; once a message has the V2 flag it keeps it.

## Goals / Non-Goals

**Goals:**
- One builder per message kind that returns a complete V2 payload, used for posting, refreshing, the mock log and the wizard preview, so all four always show the same message.
- Pings survive edits; old embed messages are converted on their next refresh.
- One thread per event, opened by the announce route, behind a bot center switch.

**Non-Goals:**
- Threads for polls, deleting or archiving the thread when the event is cancelled, archived or deleted (B-10/B-16 own clean-up and comment sync), posting into the thread (B-16).
- Changing DMs (guest invitation, reminders) or the ephemeral answers to V2; they stay as they are.
- A per-event announcement channel (B-11).

## Decisions

### D1 Message builders return whole payloads

`buildEventAnnouncement(event, eventId, roster, intro = '')` and `buildPollMessage(poll, tally, intro = '')` return `{ flags: MessageFlags.IsComponentsV2, components: [...] }` with builder objects. `buildPollDeletedMessage(poll)` replaces the inline embed of `markPollMessagesDeleted`. `bot.js` exports `buildEventAnnouncement`, `buildPollMessage` and `buildAnnouncementIntro` instead of `buildEventEmbed`, `buildEventComponents`, `buildPollEmbed`, `buildPollComponents`; `test/botModules.test.js` pins the new list.

*Alternative:* keep embed + component builders and add a converter. Rejected: two shapes of the same message, and the preview would still draw the old one.

### D2 Layout of an event announcement

```
[TextDisplay intro]                       ← only when there are pings/text, outside the container
Container (accent = event colour)
  MediaGallery (banner)                   ← only with a banner (bannerForDiscord, unchanged rules)
  TextDisplay  "## 🎉 <title>\n<description>"
  TextDisplay  facts, one line each: 🗓️ date · 👥 places · 🔓 access · ⏳ waitlist · 🏷️ category · ⏰ deadlines
  Separator
  per slot:  Section [TextDisplay "**<label> 2/3 ✅**\nNames"] + accessory slot button   ← while joinable
             TextDisplay "**<label> 2/3 ✅**\nNames"                                     ← registration closed
  ActionRow  [Anmelden]? [Zum Event (link)]
```

- Colour: `accentColor` matching `/^#[0-9a-f]{6}$/i` → integer; otherwise `0x8b5cf6` (D-02 `--accent`). One helper `toAccentColor` in a new pure module `bot/layout.js` (shared by messages and polls, with the text budget helper and the intro builder).
- The "📋 Anmeldung / Hier anmelden" field goes away: the "Zum Event" link button does the same.
- Component budget with the maximum of 10 slots: intro 1 + container 1 + gallery 1 + 2 texts + separator 1 + 10 × 3 + row 1 + 1 link button = 38 ≤ 40. A test pins the count for a 10-slot event with banner, intro and the "Anmelden"-less row, and one for an open non-slot event.
- Text budget: everything except the description is measured first, the description gets the rest of 4000 (`fitText(text, max)` cuts with "…" and never splits a surrogate pair, the logic of today's `cutForEmbed`). Slot names stay limited by `ROSTER_NAMES_MAX`.
- Existing helpers `formatParticipantCount`, `formatRosterSlotTitle`, `formatRosterMembers`, `canRegisterViaDiscord`, `buildSlotButton` are kept and reused.

### D3 Poll layout

Container (accent: open `0x8b5cf6`, decided `0x22c55e`, closed/deleted `0x6b7280`) with: TextDisplay title + description or chosen date; one TextDisplay with all options (`**<marker><option>**\n✅ n · 🤔 m\n<names>` blocks); TextDisplay footer line (deadline / end state + vote count); ActionRow with today's buttons from `buildPollComponents` logic. One text display for all options keeps the component count independent of the option count; the description is cut against the 4000 budget like D2.

### D4 Pings are stored as rendered intro text

`buildAnnouncementIntro({ text, roleIds, pingEveryone })` renders `<@&id> … @everyone\n<text>` ('' when empty). The announce routes store `{ channelId, messageId, intro }`; `sendChannelMessage(channelId, payload, { roleIds, pingEveryone })` sets `allowed_mentions` exactly as today. Refreshes pass the stored `intro` back into the builder and send `allowedMentions: { parse: [] }` (edits never notify anyway; this makes it explicit).

*Alternative:* store `text/roleIds/pingEveryone` raw. Rejected: old messages only have their rendered `content` (D5), so one rendered field covers both.

### D5 Refresh per record, converting old messages

`editStoredMessages(announcements, buildPayload)` takes a function `(announcement, message) => payload` and returns the kept records (possibly updated). For a record without `intro` (posted before this change), the intro is taken from the fetched `message.content` and written back into the record. The edit payload for every record is `{ ...payload, content: null, embeds: [], allowedMentions: { parse: [] } }`, so an old message drops its content and embed and gets the V2 flag in the same edit. When Discord refuses the edit with any non-"gone" error, the record is logged and kept unchanged (today's rule) — the old message keeps its last embed. `refreshEventAnnouncements` / `refreshPollMessages` write the records back when the list or any `intro` changed. `markPollMessagesDeleted` uses the same path without intro.

### D6 Thread helper

New module `bot/threads.js` with `ensureAnnouncementThread({ channelId, messageId }, title, existing)`:

1. `if (!state.isReady) return null`.
2. When `existing?.threadId` resolves via `client.channels.fetch` → return `existing` (no new thread).
3. Only a "gone" error (`isGoneDiscordError`) or a `null` fetch result counts as "thread no longer exists"; any other fetch error returns `existing` unchanged (do not open a second thread because Discord hiccupped).
4. Otherwise fetch the message and `message.startThread({ name: title.slice(0, 100), autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek })` → `{ guildId, threadId }`.
5. `try/catch`: on failure log and return `null`.

Exported through `bot.js`; mock twin returns `existing` when it has a `threadId`, else `{ guildId: GUILD.id, threadId: fakeSnowflake() }`, and logs. `sendChannelMessage` now also returns `guildId` so the route needs no extra call.

### D7 Announce route

`POST /events/:id/announce`: build payload with the intro → `sendChannelMessage` → push `{ channelId, messageId, intro }` → when `loadBotSettings().announcementThreads` is on, `ensureAnnouncementThread(sent, event.title, event.discordThread)` → `updateDoc` with `announcements` and `discordThread` (only when it changed, and only a non-null result replaces a stored thread). Answer and audit log as today; the thread result never changes the HTTP status. `POST /polls/:id/announce` stores `intro` the same way, no thread.

### D8 Event field `discordThread`

`{ guildId, threadId }` or absent/null. Not accepted from `POST`/`PUT /events` bodies (bot-owned, like `announcements`); set to `null` in duplicate and both series creation paths next to `announcements: []`. Public event responses include it (it is no secret; the thread is visible in Discord anyway). Not part of templates (`TEMPLATE_FIELDS` whitelist already excludes it).

### D9 Event page row

`index.html` gets `#sidebar-thread-row` in the details card; `renderSidebarDetails` calls a small `renderThreadRow(event)` that shows the row with `Diskussion` / link text "Im Discord-Thread mitreden" and `bi-chat-dots` only when both ids are snowflakes (`/^\d{17,20}$/`), building `https://discord.com/channels/<guildId>/<threadId>` (`target="_blank" rel="noopener"`), else hides it. Using `https://` rather than `discord://` (used by the location row) works without the desktop app. `resetEventDetailAreas` hides it like the other rows.

### D10 Bot center switch

`utils/botSettings.js`: `announcementThreads: true` in `DEFAULT_BOT_SETTINGS` and `ON_BY_DEFAULT`; `PUT /api/admin/bot/settings` whitelists it like `autoChannelCreation`; bot center markup gets a switch `#bot-announcement-threads` "Diskussions-Thread zu Ankündigungen" with a hint "Öffnet beim Ankündigen eines Events einen Thread für Fragen und Absprachen."; `bot-control.js` reads/writes it.

### D11 Wizard preview

`POST /events/preview` returns `{ message: { components: [...json] }, places, bot }` (the payload's components as JSON). `discord-preview.js` gets a small renderer over component types (17 container, 10 text display, 9 section, 12 media gallery, 14 separator, 1 action row, 2 button): container border colour via `data-style-border-color` (as today), text via `renderMarkdownSafe` (headings `##` and bold are what the builders use; no `-#` subtext is used, so the renderer needs nothing Discord-specific), section = flex row of text + button. Styles extend the "DISCORD PREVIEW" block in `style.css` with tokens only.

### D12 Permissions

`BOT_PERMISSIONS` gains `CreatePublicThreads` ("Diskussions-Threads zu Ankündigungen eröffnen"). Existing installs without it: the thread step fails, gets logged, announcement works (spec).

### D13 Seed data

`dev/seedData.js`: the announced sample event gets `announcements: [{ channelId, messageId, intro }]` and a `discordThread` with mock-guild ids, so `npm run dev:mock` shows the "Diskussion" row and the mock log shows the V2 payload on the next registration.

No new env variables.

## Risks / Trade-offs

- [Discord might refuse turning an old embed message into V2] → the record is kept and logged (D5); the old message just stays on its last state. It can be checked once on the real server (task 8.x); old records also age out after 5 new announcements.
- [A refused conversion is retried on every refresh and logs each time] → acceptable noise for a few old messages; not worth a "legacy" marker.
- [40-component limit] → pinned by a test at the maximum slot count; `MAX_SLOTS` (10) caps it.
- [Banner URL with a localhost `BASE_URL`] → same as today: Discord cannot fetch it and shows no image; the message is still accepted.
- [Bot lacks the thread permission on existing servers] → logged, announcement unaffected; the invite URL asks for it, the wiki tells admins to grant it.
- [Signature change of `sendChannelMessage`] → only two callers (announce routes) and the mock twin; covered by `test/devServer.test.js` and the real-export test.
- [Mock mode cannot see whether a thread still exists] → the twin keeps an existing thread; "thread deleted" is covered by unit tests of `ensureAnnouncementThread` with a fake client.

## Migration Plan

No data migration. On deploy, new announcements use V2; old records are converted on their next refresh. Rollback: old code can still edit records (it ignores `intro`), but would send embeds into V2 messages, which Discord refuses — such messages would stop updating until re-announced. Acceptable for a release candidate.
