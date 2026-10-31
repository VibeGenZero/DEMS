# Tasks

## 1. Switch and data side

- [x] 1.1 Tests first (RED) in the new `test/threadSync.test.js` (mock mode, own SQLite): `isThreadSyncEnabled` follows `DISCORD_THREAD_SYNC`; `formatDiscordContent` turns `<@id>`, `<@!id>`, `<@&id>`, `<#id>`, `<:name:id>`, `<a:name:id>` into readable text, appends attachment URLs, cuts 1800 characters to 1000 ending with "…", returns '' for an empty message; `webhookName` ("Lena" → "Lena (Web)", "DiscordFan" without "discord", '' → "Mitglied (Web)", ≤ 80); `topLevelReplyTarget`; `findEventByThreadId` finds the event of a `discordThread` and null otherwise; `commentByDiscordMessageId`. Implement `utils/threadSync.js` (design 2); verify green.
- [x] 1.2 Intent and partials only with the switch: test that loading `bot/client.js` in a child process (`runNode` from `test/helpers.js`) with `DISCORD_THREAD_SYNC=true` has `MessageContent` in `client.options.intents` and the message partial, and without it neither. Implement in `bot/client.js`; set the default `true` in `dev/mockMode.js` (only when unset). Verify green plus `test/botModules.test.js`.

## 2. Website → thread

- [x] 2.1 Tests first (RED) for the payload: `buildThreadPost(comment, answered)` (require `bot/threadSync.js`) → content is the text; with an answered comment the first line is "-# ↪ Antwort an **Kira**" plus the jump link when it has `discordMessageId`; `allowedMentions.parse` is empty; username via `webhookName`; avatar = `userAvatar`; `threadId` set. Implement it and `getChannelWebhook` (find own webhook, else create; drop + retry once on "Unknown Webhook", tested with a stub channel); verify green and the 500-line cap.
- [x] 2.2 Tests first (RED): `mirrorCommentToThread` real (`test/botRealExports.test.js`) answers `null` while not ready; mock twin: with the switch it logs the post as „<Name> (Web)“ and stores a fake `discordMessageId`, without the switch or without `discordThread` it does nothing. devServer: `POST /api/events/:id/comments` on the seed event with thread stores `source: 'web'` and gets a `discordMessageId`; on an event without thread none; the answer keeps its fields. Implement `mirrorCommentToThread` (real + twin), export through `bot.js` (extend both pinned lists), call it in the route; verify green.

## 3. Thread → website

- [x] 3.1 Tests first (RED) by emitting `messageCreate` on `bot.client` with fake message objects: a member message in the event's thread creates a comment with name, avatar, `source: 'discord'`, `discordMessageId`, `isAdmin` from the admin role; mentions and an attachment are converted; a bot message, a webhook message, a system message, a message in another thread and an empty message create nothing; the same message twice creates one comment; a reply to a mirrored message becomes a reply to its top comment, a reply to an unknown message a top comment. Implement `handleThreadMessage` and the listener in `bot/lifecycle.js`; verify green.
- [x] 3.2 Tests first (RED): `messageUpdate` of a mirrored Discord message updates `text` and sets `editedAt` (a partial old message is fine); an update to empty text keeps the old text; an update of an unknown message changes nothing. `messageDelete` of a mirrored message (Discord or web origin) deletes its comment; unknown → nothing. Implement `handleThreadMessageUpdate` / `handleThreadMessageDelete` + listeners; verify green.

## 4. Deletions from the website

- [x] 4.1 Tests first (RED): `deleteMirroredMessage` real answers `false` while not ready; mock twin logs the deletion for a comment with `discordMessageId` and does nothing without one; with a stub webhook/thread the real function uses `webhook.deleteMessage` for web comments and `thread.messages.delete` for Discord comments and returns `false` (logged) when Discord refuses. devServer: `DELETE /api/events/:id/comments/:commentId` still answers `{ success: true }` and calls the twin (mock log). Implement (real + twin), export through `bot.js`, call it in the route; verify green.

## 5. Website display, permissions, seed

- [x] 5.1 Frontend test first (RED) with `loadFrontendApp`: a comment with `source: 'discord'` shows the „Discord“ chip (`bi-discord`), one without does not; `editedAt` shows "(bearbeitet)". Implement in `public/js/events/comments.js` with existing component classes; verify green plus `test/cssRules.test.js`, `test/frontendCsp.test.js`, `test/actionAttributes.test.js`.
- [x] 5.2 Tests first (RED) in `test/botPermissions.test.js`: the invite asks for `ManageWebhooks` and `ManageMessages`. Add both with German reasons to `utils/botPermissions.js`; verify green.
- [x] 5.3 Seed: on the event with `discordThread` add one comment from Discord (`source: 'discord'`, `discordMessageId`) and one website reply to it with `discordMessageId`. Verify `node --test test/seed.test.js` and `npm run dev:reset`.

## 6. Config and wiki

- [x] 6.1 `.env.example`: `DISCORD_THREAD_SYNC=` with German comments (Message Content Intent im Developer Portal zuerst einschalten, Rechte „Webhooks verwalten“ und „Nachrichten verwalten“). `docs/wiki/ops/configuration.md`: row + the login error "Used disallowed intents". Verify `node --test test/wiki.test.js` after 6.2.
- [x] 6.2 Wiki: `docs/wiki/modules/bot.md` (module `bot/threadSync.js`, listeners, exports), `docs/wiki/concepts/discord-integration.md` (comment sync section), `docs/wiki/concepts/data-model.md` (comment fields), `docs/wiki/modules/routes-events.md`, `docs/wiki/modules/utils.md` (`utils/threadSync.js`), `docs/wiki/modules/frontend-app.md` (chip), `docs/wiki/modules/dev-mock-mode.md` (twins, default, seed), `docs/wiki/concepts/security.md` (token only in memory, no pings), file → node row in `docs/wiki/index.md`; run `npm run wiki`.

## 7. Verification

- [x] 7.1 Run `npm test` and `npm run test:e2e` (the comment view changes) and verify both pass.
- [x] 7.2 Start `npm run dev:mock`, open the seed event with thread, check the „Discord“ chip and write a comment; verify the mock log shows the post as „<Name> (Web)“; delete it and verify the log shows the deletion. Note in the PR what must be checked on the test server (intent on, rights, both directions, delete, edit).

## Workflow follow-up

- PR from `99-b-16-kommentare-und-thread-synchronisieren` into `feature/m4-discord-funktionen` (German: Problem / Ursache / Änderung / Verifikation).
- R-06 (#106): list the intent and the two permissions in the upgrade guide.
- Archive the change with `/opsx:archive` after review and the test-server check.
