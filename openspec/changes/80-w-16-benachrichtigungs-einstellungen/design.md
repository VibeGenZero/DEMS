# Design

## Context

- Member settings live on `users/{id}`: today only `acceptInvitations` (bool). The document is created on the first web login (`utils/userProfile.js` `saveUserProfile`) or on the first Discord interaction (`bot.js`, user upsert); both write `acceptInvitations: true` and nothing else.
- `GET /api/user/settings` returns `{ acceptInvitations }`; `PUT /api/user/settings` writes `acceptInvitations: body.acceptInvitations !== false` — a body without the field turns invitations back on.
- The profile (`public/js/pages/profile.js`, 241 lines) shows one switch `#accept-invitations-toggle` (`data-change="saveAccountSettings"`) in `#account-settings-card`; `loadAccountSettings` fills it.
- The DMs this change governs are sent in four places:
  - Reminders and start notification: `checkReminders` → `messageAcceptedParticipants(eventId, message, send)` in `bot.js` (accepted registrations only; `send` injectable in tests).
  - Change DM (W-04): `notifyEventChange` → `changeRecipients` in `utils/eventChangeNotice.js`.
  - Cancellation: loop over accepted + pending registrations in `PUT /api/admin/events/:id/cancel` (`routes/admin.js`), returns `notifiedCount`.
  - Waitlisted: `notifyRegistration` in `utils/registrationService.js`, `status === waitlisted` branch.
- The move-up DM (`announcePromotions` in `utils/eventUtils.js`) stays untouched.
- Requirements: `specs/dm-preferences/spec.md`, `specs/event-change-notifications/spec.md`.

## Goals / Non-Goals

**Goals:**
- One module decides who wants which DM; call sites only ask it.
- No migration: a missing field means "on".

**Non-Goals:**
- No setting in Discord itself (slash command or button); the choice is made on the website only.
- No per-event choice and no "mute everything" switch.
- Admins do not see members' choices in the registration list.

## Decisions

### 1. Storage: `users/{id}.notifications`
`{ reminders: bool, changes: bool, waitlist: bool }`, written only by `PUT /api/user/settings`. Missing field or missing key = `true`. No change to `saveUserProfile` or the bot upsert: new documents simply have no field. Alternative: flat fields `dmReminders` … — rejected, one object keeps the settings answer and the normalizer in one place.

### 2. New module `utils/notificationPrefs.js`
- `NOTIFICATION_KINDS = ['reminders', 'changes', 'waitlist']`.
- `normalizeNotificationPrefs(raw)` → all three keys; only an explicit `false` turns a kind off.
- `loadNotificationPrefs(userIds)` → `Map(userId → prefs)`, one `getDoc(users/{id})` per unique id (events have well under 100 participants; no `in` query, no composite index); a missing document gives the defaults.
- `filterByPreference(userIds, kind)` → the ids that want `kind`, order kept, plus the number left out.
- `wantsDm(userId, kind)` → bool, for the single-recipient waitlist DM.
- A read error is logged and treated as "on" (the DM is sent): missing a wanted DM is worse than one unwanted DM.

### 3. Call sites
- `messageAcceptedParticipants(eventId, message, send)` (`bot.js`): filter the accepted user ids with `filterByPreference(ids, 'reminders')` before sending; the return value stays the number of recipients actually messaged. Used for both reminders and the start notification. The `sent` flags are still written before sending, so a reminder counts as sent even when every participant opted out. No new Discord call, so no new bot helper or mock twin.
- `notifyEventChange` (`utils/eventChangeNotice.js`): `changeRecipients(...)` stays pure; `notifyEventChange` filters its result with `'changes'` and returns `{ recipients, notified, optedOut }`. `PUT /events/:id` writes `Notified n of m participants about changed …; k opted out` (the `; k opted out` part only when k > 0) and logs only when `m + k > 0`.
- `PUT /events/:id/cancel` (`routes/admin.js`): the accepted + pending user ids go through `filterByPreference(ids, 'changes')`; `notifiedCount` counts delivered DMs; the audit detail adds `k opted out` when k > 0. The cancellation itself is unchanged.
- `notifyRegistration` (`utils/registrationService.js`), waitlisted branch: `if (!(await wantsDm(user.id, 'waitlist'))) return;` before `sendDM`.

### 4. Settings API (`routes/user.js`)
- `GET /settings` → `{ acceptInvitations, notifications: normalizeNotificationPrefs(data.notifications) }`; without a document the defaults.
- `PUT /settings`: `acceptInvitations` is written only when it is a boolean; `notifications` is merged key by key for known kinds with boolean values (unknown keys and non-booleans ignored). The answer is the new effective settings (same shape as `GET`) instead of `{ success: true }`. Existing callers (`saveAccountSettings`, `confirmInvitationPreference`) send a boolean `acceptInvitations` and keep working; the behaviour change is only that a missing `acceptInvitations` no longer resets it.

### 5. Profile UI
- In `#account-settings-card`, between "Einladungen erhalten" and "Account löschen", a block with heading "Discord-Nachrichten" and three rows in the existing row pattern (`d-flex … justify-content-between`, Bootstrap `form-check form-switch`, no new CSS):
  - "Erinnerungen" — "Vor dem Start und wenn das Event beginnt."
  - "Änderungen" — "Neuer Termin, neuer Ort oder Absage."
  - "Warteliste" — "Wenn du auf die Warteliste kommst. Nachrücken melden wir immer."
- Inputs `#notify-reminders-toggle`, `#notify-changes-toggle`, `#notify-waitlist-toggle` with `data-change="saveNotificationSetting"` and `data-kind="reminders|changes|waitlist"`, `role="switch"`, `aria-label`.
- `loadAccountSettings` fills them; new `saveNotificationSetting(el)` sends `PUT { notifications: { [kind]: checked } }`, toasts "Erinnerungen per DM an." / "… aus." (label per kind), and on failure puts the switch back and toasts "Einstellung konnte nicht gespeichert werden." (`danger`).
- Kept in `profile.js` (241 lines → about 280), no new module.

### 6. Seed data
In `dev/seedData.js` `buildUsers`: Kira `notifications: { changes: false }` (she is an accepted participant of "Community-Spieleabend", so the W-04 mock check shows one opted-out member), Jonas `{ reminders: false }`. The personas keep the defaults so they can try the switches.

## Risks / Trade-offs

- [One extra read per recipient for every DM batch] → Reminder and change batches are per event and small; the read is a primary-key `getDoc`. Acceptable without caching.
- [A member who blocks change DMs misses a cancellation] → User decision; the profile text says "Absage" explicitly, and the event page and profile still show "Abgesagt".
- [The W-04 seed check in `test/devServer.test.js` expects 5 recipients on "Community-Spieleabend"] → That test computes the expected set from the registrations; it must also leave out members with `changes: false` (Kira). The task updates it.
- [Discord-only members cannot change anything until they log in on the website] → Defaults keep today's behaviour for them.

## Migration Plan

None needed: missing fields mean "on". Rollback = revert; stored `notifications` fields are ignored by the old code.
