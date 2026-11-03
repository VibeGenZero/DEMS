# Proposal

## Why

Ticket **B-06** (milestone M4 · Discord-Funktionen). Events with manual approval (`approvalMode` not `instant`) put new registrations on `pending`, and admins can only accept, reject or waitlist them on the website. Admins are in Discord anyway; requests wait longer than needed and nobody sees that one is open.

## What Changes

- New bot center setting **„Freigabe-Kanal“** (`approvalChannel`; decision 5 of the 3.0 plan: a setting, no env variable). Only text channels of the server can be chosen. Empty (default) → nothing is posted, approvals stay on the website only.
- Every registration that becomes `pending` (new registration in a manual event, or moving up from the waitlist in a manual event) gets one message in that channel: event, member (mention without ping), wished slot, guests, form answers by label (cut to fit), and the buttons „Annehmen“, „Ablehnen“, „Warteliste“ plus „Zum Event“.
- A click is allowed only for members who hold the admin role (`DISCORD_ADMIN_ROLE_ID`) at that moment, read from the interaction, not from a cached session. Others get a private German refusal; nothing changes.
- The decision runs the same logic as the website: the status change of `PUT /api/admin/registrations/:id/status` moves into a shared service function (slot choice on acceptance, DM, waitlist moves up after a rejection, live announcement, audit log), used by the route and the bot.
- The message is closed whenever the request is no longer open — decision in Discord, on the website (single or bulk action), the member unregisters, the event is cancelled or deleted: the buttons disappear and the message names the result and who made it (e.g. „✅ Angenommen von Mori“, „↩️ Vom Mitglied zurückgezogen“).
- A click on a request that was already decided elsewhere answers privately with the current status and closes the message.

Out of scope: rejection reasons, re-opening a decided request from Discord, approval of guest invitations, approval channel per event.

## Capabilities

### New Capabilities
- `discord-approvals`: approval requests in a Discord channel — when they are posted, what they show, who may decide, what a decision does, and how the message follows the request.

### Modified Capabilities
- `bot-center-settings`: adds the approval channel setting (chooser, validation, default) next to the announcement channel.

## Impact

- Code: new `utils/registrationStatus.js` (shared status change, extracted from `routes/admin.js`), new bot area module `bot/approvals.js` (build, post, close, button handler) with its data side in `utils/approvalRequests.js`, `bot.js` exports, `dev/mockBot.js` twins, `bot/interactions.js` + `bot/constants.js` (prefixes), `utils/botSettings.js` (`approvalChannel`), `routes/admin.js` (status route uses the service; bulk, event cancel/delete close messages; settings validation), `utils/registrationService.js` (post on `pending`, close on unregister), `utils/eventUtils.js` (post on promotion to `pending`), bot center markup in `public/index.html` + `public/js/admin/bot-control.js`.
- Data: registrations get an optional `approvalMessage` `{ channelId, messageId }`.
- Tests: new `test/discordApprovals.test.js`, `test/devServer.test.js` (route keeps its answers), bot center view test, `test/botModules.test.js` (export list).
- No new env variable, no new dependency.
- Wiki: `docs/wiki/concepts/registration-flow.md`, `docs/wiki/modules/bot.md`, `docs/wiki/concepts/discord-integration.md`, `docs/wiki/modules/routes-admin.md`, `docs/wiki/concepts/data-model.md`, `docs/wiki/concepts/reminders-presence.md` (settings table), `docs/wiki/modules/frontend-markup.md`, `docs/wiki/modules/utils.md`.
