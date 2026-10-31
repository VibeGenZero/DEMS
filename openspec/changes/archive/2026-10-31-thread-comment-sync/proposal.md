# Proposal

## Why

Ticket **B-16** (#99, milestone M4 · Discord-Funktionen, depends on B-14). Since B-14 every announced event has a Discord discussion thread, and the event page has its own comments. The talk about one event is split in two places: members on the website do not see what was said in Discord and the other way round.

## What Changes

- New opt-in env variable **`DISCORD_THREAD_SYNC`**. Only with `true` does the bot request Discord's privileged *Message Content* intent (it must be switched on in the Developer Portal first, otherwise Discord refuses the login) and mirror comments. Without it everything stays as today.
- **Website → thread:** a new comment on an event with a discussion thread is posted into the thread through a webhook the bot creates itself on the announcement channel (no manual setup). It shows as „<Name> (Web)“ with the member's avatar and never pings anybody. A reply on the website carries a line „↪ Antwort an <Name>“ with a link to the answered message (webhooks cannot send real Discord replies).
- **Thread → website:** a member's message in the thread becomes a comment on the event page with their Discord name, avatar, admin badge (admin role) and a „Discord“ chip. Mentions, channels and custom emojis become readable text; attachments become links; text is cut to the comment limit of 1000 characters. A Discord reply becomes a reply to the matching comment. Messages of bots and webhooks are not mirrored (no loops).
- **Deleting** a comment on the website removes its message in the thread; deleting a message in the thread removes its comment. **Editing** a message in Discord updates its comment (the website has no editing).
- The bot needs two more permissions: **„Webhooks verwalten“** (create its webhook) and **„Nachrichten verwalten“** (remove a member's Discord message when its comment is deleted on the website). Without them the comment stays on its side and the failure is logged.
- Dev mock mode switches the sync on and simulates the Discord side in the log; seed data contains comments from both sides.

Out of scope: comments written before the sync was switched on (no backfill), events without a discussion thread, reactions, threads that are not an event's discussion thread, editing comments on the website.

## Capabilities

### New Capabilities
- `comment-thread-sync`: mirroring between the comments of an event page and the event's Discord discussion thread — switch, both directions, replies, deletions, edits, how mirrored comments look.

### Modified Capabilities
_None._ `announcement-threads` (how threads are opened and linked) is unchanged.

## Impact

- Code: new bot area module `bot/threadSync.js` (webhook per channel, mirror/delete web comments, handlers for thread messages, edits and deletions), data side in new `utils/threadSync.js` (switch, event of a thread, Discord message → comment text, reply target), `bot/client.js` (intent + message partials only with the switch), `bot/lifecycle.js` (message listeners), `bot.js` exports `mirrorCommentToThread`, `deleteMirroredMessage` with twins in `dev/mockBot.js`, `routes/events.js` (post and delete comments call them; answers unchanged), `utils/botPermissions.js` (two permissions), `public/js/events/comments.js` („Discord“ chip), `dev/mockMode.js` + `dev/seedData.js`.
- Data: comments get optional `source` (`web` | `discord`, missing = web), `discordMessageId`, `editedAt`.
- Config: `DISCORD_THREAD_SYNC` in `.env.example` (German comment) and `docs/wiki/ops/configuration.md`; new bot permissions for R-06 (upgrade guide).
- Tests: new `test/threadSync.test.js`, `test/devServer.test.js` (comment routes), `test/botModules.test.js` + `test/botRealExports.test.js` (exports), frontend view test for the chip.
- No new dependency.
- Wiki: `docs/wiki/modules/bot.md`, `docs/wiki/concepts/discord-integration.md`, `docs/wiki/concepts/data-model.md`, `docs/wiki/modules/routes-events.md`, `docs/wiki/modules/utils.md`, `docs/wiki/modules/frontend-app.md`, `docs/wiki/modules/dev-mock-mode.md`, `docs/wiki/ops/configuration.md`, `docs/wiki/concepts/security.md` (webhook token never stored, no pings).
