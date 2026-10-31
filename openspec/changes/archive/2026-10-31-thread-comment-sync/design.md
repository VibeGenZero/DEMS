# Design

## Context

- Comments: `routes/events.js` — `GET /:id/comments` (sorted in memory, `repairAvatarUrl`), `POST /:id/comments` (`{ text ≤ 1000, replyTo }` → `{ eventId, userId, userName, userAvatar, text, isAdmin, replyTo, createdAt }`), `DELETE /:id/comments/:commentId` (owner or admin). Replies are one level deep: the frontend (`public/js/events/comments.js`) shows replies under their top comment and offers „Antworten“ only on top comments. Comment text is rendered with `escapeHtml`.
- Threads (B-14): `event.discordThread = { guildId, threadId }`, opened by `ensureAnnouncementThread` (`bot/threads.js`) on the announcement message; the thread's parent is the announcement channel.
- `bot/client.js` creates the client at load time with intents Guilds, GuildMembers, GuildMessages, DirectMessages, GuildScheduledEvents and no partials. `bot.js` requires `dev/mockMode` before any `bot/` module, so env defaults set there are visible when the client is created. `bot/lifecycle.js` `wireClient()` attaches the listeners once.
- Message content of other members' guild messages needs the privileged `MessageContent` intent; requesting it while it is off in the Developer Portal makes the login fail ("Used disallowed intents").
- Webhooks belong to a text channel; a message goes into a thread with `threadId`, which also unarchives a public thread. Webhook messages cannot carry a reply reference. Webhook usernames may not contain "discord" and are at most 80 characters. A webhook can edit and delete its own messages; deleting a member's message needs `ManageMessages`.
- CSP `img-src` already allows `https:`, so Discord avatar URLs show.

## Goals / Non-Goals

**Goals:**
- No change at all without `DISCORD_THREAD_SYNC=true`, so existing installs keep logging in.
- No loops: the bot never mirrors its own webhook's messages back.
- Webhook token only in memory.

**Non-Goals:**
- No backfill of old comments or messages, no reactions, no sync for threads that are not an event's `discordThread`.
- No bot center switch (the intent decides at login; switching needs a restart anyway).

## Decisions

1. **Switch `isThreadSyncEnabled()`** in `utils/threadSync.js` = `process.env.DISCORD_THREAD_SYNC === 'true'`. `bot/client.js` adds `GatewayIntentBits.MessageContent` and `partials: [Partials.Message, Partials.Channel]` only then (partials make `messageUpdate`/`messageDelete` fire for messages sent before the last restart). `dev/mockMode.js` sets `DISCORD_THREAD_SYNC=true` when unset, so `npm run dev:mock` shows the feature.
   *Alternative:* always request the intent — rejected (user decision: existing bots would go offline).

2. **Data side `utils/threadSync.js`** (no discord.js; used by `bot/threadSync.js`, `dev/mockBot.js`, routes):
   - `findEventByThreadId(threadId)` → `{ id, event }` or `null` (reads `events`, filters in memory; a small in-memory map `threadId → eventId` is filled on miss and dropped when the event's thread changes).
   - `formatDiscordContent({ content, mentions, attachments })` → text: `<@id>`/`<@!id>` → `@<displayName>` (from `mentions.members`/`mentions.users`, unknown → `@unbekannt`), `<@&id>` → `@<role>`, `<#id>` → `#<channel>`, `<a?:name:id>` → `:name:`, then one line per attachment URL; trimmed; cut to 1000 with "…". Pure, tested directly.
   - `commentByDiscordMessageId(messageId)` → `{ id, data }` or `null`.
   - `topLevelReplyTarget(comment)` → `comment.replyTo || comment.id` (one level, like the frontend).
   - `webhookName(displayName)` → `"<name> (Web)"`, max 80 characters; the word "discord" (any case) is removed because Discord refuses it in webhook names, and an empty name becomes „Mitglied“.
   - `storeDiscordMessageId(commentId, messageId)`.

3. **Bot area module `bot/threadSync.js`:**
   - Webhook per channel: `getChannelWebhook(channelId)` — memory cache `Map<channelId, Webhook>`; on miss `channel.fetchWebhooks()` → the one with `owner.id === client.user.id` and a token, else `channel.createWebhook({ name: 'DEMS Kommentare', reason: 'Kommentar-Sync (B-16)' })`. An "Unknown Webhook" error drops the cache entry and retries once.
   - `mirrorCommentToThread(commentId)` (exported) — `if (!state.isReady || !isThreadSyncEnabled()) return null`; loads comment + event; no `discordThread` → `null`; parent channel from `client.channels.fetch(threadId).parentId`; content = optional reply line (`-# ↪ Antwort an **<name>**` + ` · <jump link>` when the answered comment has `discordMessageId`) + text; `webhook.send({ content, username: webhookName(userName), avatarURL: userAvatar, threadId, allowedMentions: { parse: [] } })`; stores `discordMessageId`. `try/catch`, logs, returns the message id or `null`.
   - `deleteMirroredMessage(comment, event)` (exported; takes the data because the comment is already deleted) — `if (!state.isReady || !isThreadSyncEnabled() || !comment.discordMessageId || !event?.discordThread) return false`; web comment → `webhook.deleteMessage(id, threadId)`; Discord comment → `thread.messages.delete(id)` (needs ManageMessages). Gone message → `true`; other errors logged → `false`.
   - `handleThreadMessage(message)` — ignore unless sync on, `message.author.bot`, `message.webhookId`, `message.system`, not in a thread (`message.channel.isThread()`), or `findEventByThreadId` is null. Text via `formatDiscordContent`; empty → ignore. Reply: `message.reference?.messageId` → `commentByDiscordMessageId` → `topLevelReplyTarget`. Writes `{ eventId, userId: author.id, userName: member.displayName || author.globalName || author.username, userAvatar: member.displayAvatarURL() || author.displayAvatarURL(), text, isAdmin: member roles include DISCORD_ADMIN_ROLE_ID, replyTo, createdAt: message.createdAt ISO, source: 'discord', discordMessageId }`. A message id already stored (duplicate event) → ignore.
   - `handleThreadMessageUpdate(oldMessage, newMessage)` — fetch the new message when partial; mirrored comment with `source: 'discord'` → `{ text, editedAt }`; text that becomes empty keeps the old text.
   - `handleThreadMessageDelete(message)` — mirrored comment of any source → delete it (a web comment whose thread copy was deleted by a moderator disappears too, keeping both sides equal).
   - `bot/lifecycle.js` attaches `Events.MessageCreate`, `Events.MessageUpdate`, `Events.MessageDelete` → these handlers inside `try/catch` (always attached; they return at once without the switch).
   - `bot.js` exports `mirrorCommentToThread`, `deleteMirroredMessage` (appended to the pinned list). `dev/mockBot.js` twins: same checks, log `[MOCK-DISCORD] Kommentar in Thread "<Titel>" als „Lena (Web)“: <Text>` / `… gelöscht`, store a fake `discordMessageId`.

4. **Routes.** `POST /:id/comments` adds `source: 'web'` and calls `mirrorCommentToThread(ref.id)` fire-and-forget after saving; the answer is unchanged plus `source`. `DELETE` calls `deleteMirroredMessage(comment, event)` fire-and-forget after deleting (loads the event for its thread). `GET` passes `source`, `discordMessageId`, `editedAt` through (no secrets in them).

5. **Frontend.** `renderComment` shows `<span class="chip chip-sm chip-info"><i class="bi bi-discord me-1"></i>Discord</span>` after the name for `source === 'discord'` and „(bearbeitet)“ next to the date when `editedAt` is set. Existing component classes only, no new CSS values.

6. **Permissions.** `utils/botPermissions.js` gets `ManageWebhooks` („Webhook für den Kommentar-Sync anlegen“) and `ManageMessages` („Gelöschte Kommentare auch im Discord-Thread entfernen“); both pinned in `test/botPermissions.test.js`. R-06 (upgrade guide) must list them and the intent.

7. **Seed.** The seed event with `discordThread` gets one comment with `source: 'discord'` + `discordMessageId` (and a reply from the website with `discordMessageId`), so the chip and the reply line are visible in mock mode.

## Risks / Trade-offs

- [Intent off in the portal but variable set] → login fails; the startup log line and `.env.example` say to switch the intent on first. `configuration.md` names the exact Discord error.
- [Message deleted while the bot was offline] → no delete event; the comment stays. Accepted (no reconciliation job).
- [Comment posted while the bot is offline] → it is not mirrored later (no backfill). Accepted, same as approvals.
- [Webhook deleted by a server admin] → next post gets "Unknown Webhook", the bot creates a new one and retries once.
- [Rate limits (5 posts / 2 s per webhook)] → discord.js queues; comments are not bursty.
- [Spoofing] → the "(Web)" suffix and Discord's "APP" label mark webhook posts; the web chip marks Discord comments. Webhook names never contain "discord".
- [Privacy] → mirrored comments are visible to everyone who sees the thread; the thread lives in the announcement channel, which is the same audience the event is announced to.

## Migration Plan

Deploy without the variable → no change. To enable: switch on *Message Content Intent* in the Developer Portal, grant „Webhooks verwalten“ and „Nachrichten verwalten“ (re-invite with the new URL or set them on the role), set `DISCORD_THREAD_SYNC=true`, restart. Rollback: remove the variable and restart; stored `source`/`discordMessageId` are ignored.
