# Design

## Context

See proposal.md (Why). Observed state:

- `bot.js#getBotSettings()` returns the stored `botSettings/config` document as it is (no defaults for missing keys) and reads the database on every call; defaults only apply when no document exists. `saveBotSettings()` writes the whole document and calls `applyBotSettings()`.
- `applyBotSettings()` starts/stops `reminderInterval` with `reminderEnabled`. `checkReminders()` does three things per pass: deadline refresh of announcements (W-03), reminder DMs, start DM — so `reminderEnabled: false` also stops the deadline refresh, and on re-enable every reminder still unsent before the start goes out at once (`findDueReminders` only checks "due and not sent").
- Automatic DMs are sent through `sendDM` from `utils/registrationService.js` (`notifyRegistration`, `notifyStatusChange`), `utils/eventUtils.js#announcePromotions`, `utils/pollStore.js` (poll result to creator and voters), `utils/eventChangeNotice.js#notifyEventChange` (via `send`), and inside `bot.js` (guest invitation buttons). Admin-triggered: `routes/admin.js` cancel (`sendDM` directly) and `sendParticipantMessage` (W-09, `send: sendDM`).
- `createEventChannels` is called from four places in `routes/admin.js` (create, series dates, status change, update); it has a twin in `dev/mockBot.js`. In mock mode bot.js merges the mock exports over its own, so code outside bot.js that calls `require('../bot').sendDM` reaches the mock.
- Announcements: `POST /events/:id/announce` and `POST /polls/:id/announce` read `process.env.DISCORD_ANNOUNCE_CHANNEL_ID`. `GET /api/admin/channels` (`getGuildChannels`) lists voice/text channels (forum counted as `text`).
- `users/<id>` documents exist for everyone who registered (web login or `ensureUserProfile` in the bot). `setDoc` in the SQLite adapter replaces whole documents, so flags go through `updateDoc`.

## Goals / Non-Goals

**Goals:**
- One module answers "is X switched on" with defaults, so no caller reads the raw document.
- One DM gate for automatic DMs; admin-triggered sends keep calling `sendDM` directly, so the split is visible at the call site.
- No behaviour change when every switch is on (the default).

**Non-Goals:**
- No refactor of `bot.js` beyond the touched functions (that is B-01).
- No change to the W-16 per-member choices; the global switch is checked first, the member choice after it.

## Decisions

### D1 — `utils/botSettings.js` (database only, no Discord)
- `DEFAULT_BOT_SETTINGS` (moved from `getBotSettings`) and `normalizeBotSettings(raw)` → defaults merged with the stored keys, booleans coerced like the PUT route does.
- `loadBotSettings()` → normalized settings, cached in memory; `rememberBotSettings(settings)` replaces the cache after a save. Single process (like `utils/eventLock.js`), so a cache invalidated on save is exact; the first read after start loads from the database. A read error returns the defaults (fail open, like maintenance settings) and is logged.
- `sendAutomaticDM(userId, message)` → `false` without sending when `dmNotifications` is off, else `require('../bot').sendDM(userId, message)` (lazy require: avoids the bot ↔ utils cycle and reaches the mock in mock mode). Because it only wraps `sendDM`, it needs no twin in `dev/mockBot.js`.
- `announceChannelId(settings)` → `settings.announceChannel || process.env.DISCORD_ANNOUNCE_CHANNEL_ID || ''`.
- `sendWelcomeOnce(user, registrationId)` (`{ id, displayName }`): returns without effect when the message is empty or DMs are off; reads `users/<id>`; a member counts as already welcomed when the document has `welcomeSentAt` **or** another of their registrations (`where('userId', '==', id)`, filtered in memory) is `accepted` — so members accepted before this change never get a "welcome". Otherwise, when the document exists, it writes `welcomeSentAt` first (like the reminder flags, so a crash or a parallel acceptance cannot send twice in the common case) and then sends the text with `{user.name}` / `{user.mention}` replaced. Missing user document → nothing (every registrant has one). Never throws.
`bot.js#getBotSettings` becomes `loadBotSettings`, `saveBotSettings` calls `rememberBotSettings` after the write. Alternative: read the database per DM — rejected, a bulk action of 50 registrations would read the settings 50 times.

### D2 — Which call sites use the gate
`sendAutomaticDM` replaces `sendDM` in: `notifyRegistration`, `notifyStatusChange`, `announcePromotions`, poll result DMs in `pollStore.js`, the three answers to guest invitations in `bot.js` (the invitation itself, `sendGuestInvitation`, is always sent: guests can only answer through its buttons — decided while implementing), and the default `send` of `notifyEventChange`. The welcome hook `sendWelcomeOnce` runs right after the "accepted" DM in `notifyRegistration`, `notifyStatusChange` and `announcePromotions` (covers instant approval, admin/bulk acceptance, admin entry via `addRegistrationByAdmin` → `notifyRegistration`, and moving up). Cancellation, W-09 and `sendGuestInvitation` stay outside the gate. A test greps the remaining direct `sendDM(` calls outside `bot.js` and expects exactly the two admin-triggered ones, so a new automatic DM cannot bypass the gate by accident.

### D3 — Scheduler and the two timed switches
`applyBotSettings` no longer starts/stops the reminder interval; `server.js` keeps starting it once. In `checkReminders` the deadline refresh always runs. Due reminders are always marked `sent`; the DM goes out only with `reminderEnabled`. The start flag `eventStartNotificationSent` is always set in the start window; the DM goes out only with `eventStartNotifications`. So nothing is sent late after a switch is turned back on. `checkReminders` gets an optional `settings` override for tests (like `send` and `now`). `getBotStatus` keeps reporting the scheduler as running.

### D4 — Channel lock
New helper `createEventChannelsAllowed(event)` in `routes/admin.js` (one function used by the four call sites): `loadBotSettings()` → if `autoChannelCreation` is off, log once and return `null` without calling `createEventChannels`. The event keeps `autoCreateChannels`. Deleting channels is untouched. The wizard reads `GET /api/admin/bot/settings` when it opens (`showCreateEventModal`/`editEvent`); with the lock on it disables `#event-auto-create-channels` and shows `#event-channels-locked` ("In der Bot-Zentrale ausgeschaltet."). A failed read counts as "on" (current behaviour).

### D5 — Announcement channel
- Bot center: `<select id="bot-announce-channel">` in the settings form, filled from `GET /api/admin/channels` (only `type === 'text'`), first option "Standard aus .env" (value `''`). `loadBotSettings`/`saveBotSettingsForm` in `public/js/admin/bot-control.js` read and send `announceChannel`.
- `PUT /api/admin/bot/settings`: an `announceChannel` that is not `''` and not the stored value is checked against `getGuildChannels(DISCORD_GUILD_ID)` text channels; not found → 400 "Ankündigungskanal nicht gefunden.". An empty list (bot offline or no guild) accepts only `''` or the stored value; anything else → the same 400.
- Both announce routes use `announceChannelId(await loadBotSettings())`; empty → 400 "Kein Ankündigungskanal festgelegt – bitte in der Bot-Zentrale wählen.".
- Forum channels are listed by `getGuildChannels` as `text` but cannot take a message; filtering them needs the Discord type. Accepted limitation (see Risks); the dropdown label says "Textkanal".

### D6 — Change notices and the wizard switch
`PUT /events/:id` passes the request flag only when `dmNotifications` is on; otherwise `notifiedCount` is 0 (D2 gate would also block it, but checking early keeps the count honest). `admin/wizard-notify.js#updateNotifySwitch` hides `#wizard-notify` while the loaded bot settings say DMs are off (same settings read as D4, kept in `state.botSettings`).

### D7 — Bot center texts
The helper text of the DM switch names what it covers ("Automatische Nachrichten: Anmeldung, Annahme, Warteliste, Gäste, Änderungen, Abstimmungen. Absagen und Nachrichten des Teams gehen immer raus."); the reminder switch says that due reminders are skipped while it is off. The welcome message hint stays ("…zum ersten Mal akzeptiert…") and mentions `{user.name}`.

## Risks / Trade-offs

- [Two acceptances of the same new member in the same instant could both pass the `welcomeSentAt` check] → The flag is written before sending; the window is milliseconds, and a doubled welcome is harmless. No lock.
- [Settings cache stale when a second process writes the settings] → DEMS runs as one process; documented in the wiki next to the cache.
- [Forum channel chosen as announcement channel] → sending fails with the existing error toast; rare, documented. Fix possible later in B-11 with the Discord channel type.
- [Dropping reminders while off surprises an admin who expected a catch-up] → Spelled out in the bot center hint and the spec.
- [The `sendDM` grep test is brittle against renames] → It checks a behaviour the spec relies on; the failure message names the rule.

## Migration Plan

No data migration: missing settings keys take defaults, `welcomeSentAt` is optional. Existing members have no `welcomeSentAt`, but an earlier accepted registration counts as "already welcomed" (D1), so only members who are accepted for the first time get the text. Rollback = revert; the extra field is ignored by older code.
