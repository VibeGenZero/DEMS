# Design

## Context

- `PUT /api/admin/registrations/:id/status` (`routes/admin.js`) holds the whole status change inline: under `withEventLock` it clears the slot on waitlist/reject, clears check-ins, picks a slot on acceptance (`resolveAcceptanceSlot`, overbooking warning), then `notifyStatusChange` (accepted/rejected DM, role), `promoteFromWaitlist` after a rejection, `notifyRegistrationsChanged`, `addAuditLog`. `validateRegStatus` allows `accepted`, `rejected`, `waitlisted`.
- `POST /events/:id/registrations/bulk` plans with `planBulkAction` and applies changes itself; `PUT /events/:id/cancel`, `DELETE /events/:id` and `DELETE /events/series/:seriesId` end events (delete removes the registrations).
- Pending comes from `createRegistration` (manual events, `notifyRegistration` with status `pending`) and from `promoteFromWaitlistLocked` (status `pending` in manual events, announced by `announcePromotions`). `unregisterUserFromEvent` deletes the registration and returns it.
- Bot settings: `utils/botSettings.js` (`DEFAULT_BOT_SETTINGS`, cached `loadBotSettings`), saved by `PUT /api/admin/bot/settings`, which validates `announceChannel` against `getGuildChannels` only when it changed. Bot center UI: `public/js/admin/bot-control.js` (`announceChannelOptions`), markup in `public/index.html` (`#bot-announce-channel`).
- Discord: `sendChannelMessage(channelId, payload, { roleIds })` returns `{ channelId, messageId, guildId }` with `allowedMentions.parse: ['roles']` (users are not pinged); `editStoredMessages` edits V2 messages and drops deleted ones (`isGoneDiscordError`). `resolveInteractionRoles(interaction)` reads the clicking member's live roles. The admin check of the website (`routes/auth.js`, `createRoleRefresh`) compares roles with `DISCORD_ADMIN_ROLE_ID`.

## Goals / Non-Goals

**Goals:**
- One status-change implementation for website single action and Discord buttons.
- Request messages that never offer buttons for a request that is no longer open.

**Non-Goals:**
- Bulk actions keep their own loop (they already batch under one lock); they only close the messages afterwards.
- No closing for events that end or get archived by time (a click then still works like on the website).
- No new env variable (decision 5).

## Decisions

1. **Shared service `utils/registrationStatus.js`.** `changeRegistrationStatus({ registrationId, status, actor, expectStatus })` → `{ ok, registration, event, status, slotId, warning }` or `{ ok: false, code, error }`. It is the route body moved out unchanged (lock, slot, check-in, DM, waitlist, refresh, audit log with `actor.id`), plus: `expectStatus` (Discord passes `'pending'`; under the lock a different current status returns `{ ok: false, code: 'already_decided', registration }`), and at the end `closeApprovalRequest(registration, { status, actorName })`. `actor` is `{ id, displayName }` (session user or Discord member). The route keeps its answers byte for byte (pinned by existing `test/devServer.test.js` tests).
   *Alternative:* the bot calls the HTTP route — rejected, needs a session and CSRF for the bot.

2. **Bot area module `bot/approvals.js`** with:
   - `buildApprovalMessage(registration, event, closed = null)` — V2 container (accent `#f59e0b` while open, grey `#6b7280` when closed): `## 📋 Neue Anfrage: <Titel>`, start, member `<@userId>` + name, slot wish, guests (`guests` + `pendingGuests` names), form answers `**<Label>:** <Antwort>` (each ≤ 300 chars, whole text via `fitText` within `MESSAGE_TEXT_MAX`), then either the action row `approval_accept:<regId>` „Annehmen“ (Success), `approval_reject:<regId>` „Ablehnen“ (Danger), `approval_waitlist:<regId>` „Warteliste“ (Secondary), link „Zum Event“ — or, when `closed`, a result line instead of the action buttons (link stays).
   - `sendApprovalRequest(registrationId)` — `if (!state.isReady) return null`; reads `loadBotSettings().approvalChannel` (empty → `null`), loads registration + event, posts with `sendChannelMessage(channel, payload, { roleIds: [] })` and stores `approvalMessage: { channelId, messageId }` on the registration. `try/catch`, logs, never throws.
   - `closeApprovalRequest(registration, outcome)` — `if (!state.isReady) return false`; no `approvalMessage` → `false`; edits the message to `buildApprovalMessage(registration, event, outcome)` via a small `editChannelMessage(channelId, messageId, payload)` in `bot/messages.js` (same edit options as `editStoredMessages`; gone message → `false`). Takes the registration data, not its ID, so it also works after the registration was deleted.
   - `handleApprovalButton(interaction, action, registrationId)` — `deferReply({ ephemeral })` first (DMs, role and promotions can pass 3 s); live check `resolveInteractionRoles(interaction).includes(process.env.DISCORD_ADMIN_ROLE_ID)` (unset env → nobody, like the website); then `changeRegistrationStatus({ …, expectStatus: 'pending', actor: { id: interaction.user.id, displayName: member display name } })`; answers privately "✅ Angenommen." / "❌ Abgelehnt." / "🕒 Auf die Warteliste gesetzt." (+ overbooking warning), "ℹ️ Bereits entschieden: <Status>." (and closes the message with the current status) or the error.
   Outcome lines: accepted "✅ Angenommen von <Name>", rejected "❌ Abgelehnt von <Name>", waitlisted "🕒 Auf die Warteliste gesetzt von <Name>", withdrawn "↩️ Vom Mitglied zurückgezogen", cancelled "🚫 Event abgesagt", deleted "🗑️ Event gelöscht".
   The data side without discord.js — `loadApprovalRequest`, `storeApprovalMessage`, `storedApprovalMessage`, `eventForClosing`, `formatOutcome`, `closePendingRequests`, `actorName` — lives in `utils/approvalRequests.js`: `test/botModules.test.js` forbids `dev/` and `utils/` to require `bot/` modules, and the mock twins need these helpers too.
   `sendApprovalRequest` and `closeApprovalRequest` are exported through `bot.js` (appended to the pinned list in `test/botModules.test.js`); `dev/mockBot.js` gets twins that log `[MOCK-DISCORD]`, store a fake `approvalMessage` and record calls for tests. `buildApprovalMessage` stays module-internal (tests require `bot/approvals.js`).

3. **Where requests are posted and closed.**
   - Post: `registerUserForEvent` after `notifyRegistration` when the status is `pending`; `announcePromotions` for promotions with status `pending`. Both call `sendApprovalRequest(id)` fire-and-forget (`.catch(log)`), like guest invitations.
   - Close: `changeRegistrationStatus` (covers route + Discord); bulk route after its loop for every changed registration that was pending; `unregisterUserFromEvent` with "withdrawn" when the deleted registration was pending; `PUT /events/:id/cancel` and both delete routes for every pending registration of the event(s) ("cancelled"/"deleted"; delete loads them before deleting). Only registrations with `approvalMessage` cost a Discord call.

4. **Setting `approvalChannel`.** Added to `DEFAULT_BOT_SETTINGS` (`''`), to the body of `PUT /api/admin/bot/settings` and its validation (same rule as `announceChannel`, error "Freigabe-Kanal nicht gefunden."). Bot center: a second select `#bot-approval-channel` below the announcement channel with the first option "Keiner – Freigaben nur auf der Website" and the help text "Neue Anfragen erscheinen dort mit Buttons zum Annehmen, Ablehnen und für die Warteliste."; `bot-control.js` gets `approvalChannelOptions(channels, selected)` (same shape as `announceChannelOptions`). Tokens/components only, no inline styles.

5. **Custom IDs** in `bot/constants.js`: `APPROVAL_ACCEPT_PREFIX = 'approval_accept'`, `APPROVAL_REJECT_PREFIX = 'approval_reject'`, `APPROVAL_WAITLIST_PREFIX = 'approval_waitlist'`; routed in `bot/interactions.js` before the generic button branch, errors → `replyWithFailure(interaction, '❌ Fehler bei der Freigabe.')`.

6. **Data.** Registrations get the optional field `approvalMessage` `{ channelId, messageId }`; it is never sent to members (`toPublicEvent` is unaffected; registration lists for admins may show it, it is not secret). Documented in `docs/wiki/concepts/data-model.md`.

## Risks / Trade-offs

- [Moving the route body could change its behaviour] → move it first with the existing devServer tests green, then add `expectStatus` and closing with new tests.
- [Bot offline while a request is created] → no message; the request is still decided on the website. Requests are not re-posted later.
- [Admin role env unset] → nobody can decide in Discord (same as the website, where nobody is admin); the request message is still posted so admins see it.
- [Edits fail with other errors] → logged; the decision itself is never rolled back.
- [Member mention] → `allowedMentions` has no `users`, so the mention renders without notifying the member.
