# Design

## Context

- Check-in today: `POST /api/admin/events/:id/generate-checkin` sets `checkinCode` (6 digits) and `checkinEnabled: true` (audit `GENERATE_CHECKIN`); a new code replaces the old one. `POST /api/events/:id/checkin` (`routes/events.js`, `checkinLimiter`: 10 failed tries / 15 min) checks `checkinEnabled && checkinCode`, the code and an `accepted` registration, then sets `checkedIn: true`, `checkedInAt`; a repeat answers `alreadyCheckedIn: true`. It has no time window. W-07 added `PUT /api/admin/registrations/:id/checkin`. Profile, badges, event page, stats, export and W-14 read `registration.checkedIn`; `utils/profileEvents.js` treats check-in as available when `checkinEnabled && checkinCode`.
- `bot/scheduler.js` `checkReminders({ now, send, refresh, settings })` runs every 5 min. The start DM goes out once in the first 5 minutes after `startDate` (`eventStartNotificationSent`, flag written first), only with `eventStartNotifications` on and only to members who want „Erinnerungen“ (`messageAcceptedParticipants` → `filterByPreference`). It calls `sendDM` from `bot/messages.js` directly, so in mock mode these DMs are not simulated (internal call, `state.isReady` false).
- `sendDM(userId, message)` passes `message` to `user.send`, so a `{ content, components }` payload with a classic action row works.
- `isEventOver(event, now)` (`utils/eventListing.js`): end, else start + 2 h. `withEventLock(key, fn)` (`utils/eventLock.js`) serializes work per key inside the process.
- Button interactions are routed by custom ID prefix in `bot/interactions.js`; in a DM `interaction.member` is null, the user is `interaction.user`.

## Goals / Non-Goals

**Goals:**
- One place for the check-in rules, shared by the button and the code route.
- At most one invitation per registration, no double DM when the scheduler and the code generation run at the same time.

**Non-Goals:**
- No change to the start DM text or to reminders.
- No time window for the code check-in (it keeps its current behaviour; only the button checks start and end).
- Invitations do not honour the global `dmNotifications` switch, like the start DM today (it is about automatic registration DMs).

## Decisions

1. **Shared rules in `utils/checkin.js`** (no discord.js, usable by routes, bot and mock):
   - `isCheckinActive(event)` → `event.status === 'active' && event.checkinEnabled && event.checkinCode`.
   - `isCheckinRunning(event, now)` → active, `now >= start`, `!isEventOver(event, now)`.
   - `findAcceptedRegistration(eventId, userId)` → `{ id, data }` or `null`.
   - `checkInMember({ eventId, userId, now })` → `{ ok: true, alreadyCheckedIn, checkedInAt, event }` or `{ ok: false, code }` with codes `not_found`, `not_active`, `disabled`, `not_started`, `over`, `no_registration`. Sets `checkedIn: true`, `checkedInAt` (a repeat keeps the first time). Takes an option `requireRunning` (button: true; code route: false).
   - `listCheckinInvitees(eventId)` → accepted registrations without `checkedIn` and without `checkinInvitedAt`; `markInvited(registrationId, now)` writes `checkinInvitedAt`.
   The code route keeps the code compare and the limiter and calls `checkInMember({ requireRunning: false })` for the rest; its answers stay byte for byte (pinned by existing devServer tests).
   *Alternative:* copy the checks into the bot — rejected, two places would drift.

2. **Per-registration flag `checkinInvitedAt`** instead of an event flag. It covers members accepted during the event and codes generated after the start with the same rule ("running + not invited + not checked in"), and survives restarts. It is written before the DM (same at-most-once rule as the reminder flags). Regenerating the code does not reset it.
   *Alternative:* `checkinInvitationsSent` on the event — rejected, late accepts would never get a button.

3. **Bot area module `bot/checkin.js`:**
   - `buildCheckinInvitation(event, eventId, { startText })` → `{ content, components: [ActionRow(Button event_checkin:<eventId> „Einchecken“ Success, Link „Zum Event“ buildEventUrl)] }`. Content: with `startText` (start DM wanted) the existing start text "🎯 **<Titel>** hat gerade begonnen! Viel Spaß!" + "📍 Checke jetzt ein:"; without it "📍 **<Titel>** läuft – checke jetzt ein!". The code is never put in the DM.
   - `inviteToCheckin(eventId, event, { now, send, startRecipients })` — under `withEventLock('checkin:' + eventId)`: `listCheckinInvitees`, for each: `markInvited`, then `send(userId, buildCheckinInvitation(..., { startText: startRecipients.has(userId) }))`. Returns the set of invited user ids. Internal (scheduler and `sendCheckinInvitations`).
   - `sendCheckinInvitations(eventId)` — exported through `bot.js`: `if (!state.isReady) return 0`; loads the event, returns 0 unless `isCheckinRunning`; then `inviteToCheckin` with the real `sendDM`; `try/catch`, logs, never throws. Called fire-and-forget by `generate-checkin`.
   - `handleCheckinButton(interaction, eventId)` — `checkInMember({ eventId, userId: interaction.user.id, now, requireRunning: true })`. Success / already / over → `interaction.update({ content: <original content> + "\n\n" + result line (+ "\n" + checkinMessage on success), components: [link row only] })` so the button disappears; other failures → `reply({ content, flags: Ephemeral })`, the button stays. Lines as in the spec. `not_started` → "⏳ Der Check-in startet mit dem Event." (only reachable with a forwarded message).
   - Prefix `CHECKIN_BUTTON_PREFIX = 'event_checkin'` in `bot/constants.js`, routed in `bot/interactions.js` before the generic button branch; errors → `replyWithFailure(interaction, '❌ Fehler beim Check-in.')`.
   - `dev/mockBot.js` twin of `sendCheckinInvitations`: same `isCheckinRunning` check, marks invitees with `checkinInvitedAt`, logs `[MOCK-DISCORD] Check-in-Einladung an <Name> ("<Titel>")` per member, returns the count. `buildCheckinInvitation` stays module-internal (tests require `bot/checkin.js`).

4. **Scheduler merge.** In `checkReminders`, per active event:
   - Start branch as today, but the recipients of the start DM are computed first (`eventStartNotifications` on → accepted members who want reminders) and kept as `startRecipients`.
   - If `isCheckinRunning(event, now)` and the bot can send (new option `canInvite`, default `() => state.isReady`; tests pass `() => true`), call `inviteToCheckin` with `startRecipients`; the returned set is removed from the plain start DM. So a member gets either the start DM with button or the plain start DM, never both; members without the start DM get the plain invitation.
   - When `canInvite()` is false nothing is marked; the next pass with the bot online sends them while the event runs.
   `messageAcceptedParticipants` is split into `acceptedReminderRecipients(eventId)` + sending so the set can be reused.

5. **Data.** Registration field `checkinInvitedAt` (ISO string, optional). Not secret; never contains the code. Documented in `docs/wiki/concepts/data-model.md`.

## Risks / Trade-offs

- [Scheduler pass and code generation at the same time] → both go through `withEventLock('checkin:<eventId>')` and re-read invitees inside it, so one of them finds nobody left.
- [Crash between mark and DM] → that member gets no invitation (at most once, like reminders); the code and admin check-in remain.
- [Member has DMs closed] → `sendDM` fails and logs; the registration counts as invited. Website code stays the fallback.
- [Many participants] → DMs go out one by one in the pass (same as reminders today); fine for community sizes.
- [Old DM clicked after the member left] → the click re-checks everything live and refuses.
- [Mock mode] → the scheduler does not invite (bot not ready, internal call); generating a code for the running seed event goes through the mock twin and shows the log, and the button is covered by `dispatchInteraction` tests.

## Migration Plan

No migration: existing registrations have no `checkinInvitedAt`, so the next pass invites accepted members of events that run at deploy time and have check-in on. Rollback: remove the code; the extra field is ignored.
