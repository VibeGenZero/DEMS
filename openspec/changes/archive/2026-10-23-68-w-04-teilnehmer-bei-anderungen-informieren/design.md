# Design

## Context

- `PUT /api/admin/events/:id` (`routes/admin.js`) saves through `saveEventWithSlots`, which returns `{ oldEvent, updates }`; `updates` is built from an explicit field list, so a request field that is not listed is never stored. Afterwards the handler logs `UPDATE_EVENT`, creates or deletes channels, runs `promoteFromWaitlist` and `notifyRegistrationsChanged`.
- The only participant DM for an event edit is in `PUT /events/:id/cancel`: it loops over the registrations and calls `sendDM` (exported by `bot.js`, `isReady` guard and `try/catch` inside, logging twin in `dev/mockBot.js`) and returns `notifiedCount`.
- Event fields involved: `startDate`, `endDate` (ISO string or `''`), `location` (`{ text, channelId, channelType }` or `null`). Accepted guests have no registration of their own; their user ids sit in `guests` of the inviting registration (`pendingGuests` keeps open invitations).
- Wizard (`public/js/admin/wizard.js`, already 531 lines): location on page 1, dates and status on page 2, "Speichern" only on page 5 (`wizardGoTo` toggles `#wizard-btn-save`). `editEvent` loads the event from `GET /api/events/:id?status=all`; `collectEventDraft` builds the request body; `saveEvent` sends it and shows the toast.
- Requirements: see `specs/event-change-notifications/spec.md`.

## Goals / Non-Goals

**Goals:**
- One pure, unit-testable place that decides what changed, who is told and what the DM says.
- The admin's decision travels with the save request; the server re-checks every condition itself.

**Non-Goals:**
- No editable template for the change DM (the bot templates of `UPDATE_TEMPLATES` stay as they are).
- No notice in the announcement channel: the stored announcements are already refreshed after a save (`notifyRegistrationsChanged`) and show the new date.
- No change DM for series-wide edits (each instance is saved alone; W-11 handles series edits), for `PUT /events/:id/status`, `start` or `end`.
- No retry for DMs that fail.

## Decisions

### 1. New module `utils/eventChangeNotice.js`
Exports:
- `describeEventChanges(oldEvent, newEvent)` → `[{ field, label, before, after }]` in the order Beginn, Ende, Ort; `before`/`after` are display strings. Dates compare by `getTime()` (empty or invalid = no value), the location by trimmed `text` plus `channelId` (`null` and empty text = no value).
- `buildEventChangeMessage(title, changes, url)` → the German DM text.
- `changeRecipients(registrations)` → unique user ids: `userId` of each `accepted` registration plus its `guests`.
- `notifyEventChange({ eventId, title, changes, send = sendDM })` → loads the registrations with one `where('eventId', '==', eventId)` (status filtered in memory, no composite index), sends one DM per recipient one after another and returns `{ recipients, notified }`, counting only `send` results that are `true`.

Why not in `bot.js`: there is no new Discord API call, only the existing `sendDM`, so no new helper and no new mock twin are needed; `bot.js` is to be split (B-01) and should not grow; the pure functions are testable without a Discord client. `send` is injectable for tests like `checkReminders({ send })`. Alternative considered: a bot helper `sendEventChangeNotice(userIds, text)` with a twin in `dev/mockBot.js` — rejected as a wrapper around `sendDM` with no own Discord logic.

### 2. Server flow in `PUT /events/:id`
After `promoteFromWaitlist` (so a member promoted by this save is already `accepted` and learns the new time too) and before the response:
1. `changes = describeEventChanges(oldEvent, updates)`.
2. Only when `req.body.notifyParticipants === true` (strict boolean, a string does not count), `updates.status === 'active'` and `changes.length > 0`: `await notifyEventChange(...)`, then `addAuditLog('NOTIFY_EVENT_CHANGE', adminId, 'Notified <n> of <m> participants about changed Beginn, Ort', eventId)`.
3. Response `{ id, ...updates, notifiedCount }` (`0` when nothing was sent).

`notifyParticipants` is read from `req.body` separately and is not added to the field list of `saveEventWithSlots`, so it is never stored. The audit detail stays English like the other entries; the frontend shows details as stored.

Awaiting the DMs (like `cancel`) keeps `notifiedCount` exact for the toast. Alternative: send in the background and answer at once — rejected, the admin would get no reliable count and the audit entry would be written after the response.

### 3. DM text
```
📅 Das Event **<title>** wurde geändert:
**Beginn:** ~~Fr., 24.10.2026, 19:00~~ → **Sa., 25.10.2026, 19:00**
**Ort:** ~~Lobby~~ → **Event-Voice**
Alle Infos: <buildEventUrl(eventId)>
```
Dates via `toLocaleString('de-DE', { timeZone: TIMEZONE, weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })` with `TIMEZONE = process.env.TIMEZONE || 'Europe/Berlin'` (same as `bot.js`); a missing value reads "nicht festgelegt" (not struck through). The location shows its text only.

### 4. Wizard switch (new module `public/js/admin/wizard-notify.js`)
- Markup in the wizard footer before "Speichern": `<div class="form-check form-switch is-hidden" id="wizard-notify">` with checkbox `#event-notify-participants` (checked) and label "Teilnehmer benachrichtigen"; Bootstrap classes only, no new CSS.
- `rememberLoadedEvent(event)` keeps `{ startDate, endDate, location }` of the loaded event in module state (called by `editEvent`; `showCreateEventModal` calls `forgetLoadedEvent()`); both put the checkbox back to checked.
- `updateNotifySwitch(draft)` is called by `wizardGoTo`: visible only on the last step, in edit mode, with `draft.status === 'active'` and `scheduleChanged(loaded, draft)`; otherwise hidden. Visibility does not touch the checked state, so an admin who switched it off and goes back and forth keeps "off".
- `scheduleChanged` mirrors the server comparison (dates by time value, location by text + channel id). The server stays the authority; the frontend copy only decides visibility.
- `saveEvent` adds `notifyParticipants: notifyRequested()` (visible and checked) to the body of a `PUT` only, and shows "Event aktualisiert – <n> Teilnehmer benachrichtigt." when `notifiedCount > 0`, else "Event aktualisiert!".

Why a new module: `wizard.js` is above the ~500 line limit for frontend modules; the switch is one clear concern like `wizard-location.js`.

### 5. Audit chip
`NOTIFY_EVENT_CHANGE: 'chip-info'` in `AUDIT_CHIPS` (`public/js/admin/dashboard.js`); the data-model wiki lists the new action.

### 6. Mock mode
No new mock code: the mock `sendDM` logs every DM. The seeded event "Community-Spieleabend" (`EVENT_ID.OPEN`, location "Lobby") already has accepted registrations and an accepted guest (`open-jonas` with `guests: [greta]`); the implementation checks that this covers the feature and only extends `dev/seedData.js` if it does not.

## Risks / Trade-offs

- [A large event makes the save wait for every DM; discord.js queues DMs by rate limit] → The event is saved before the first DM, so a slow or interrupted send never loses the edit; typical events have well under 100 participants. Background sending stays possible later without a spec change.
- [Members who blocked DMs get nothing] → They are not counted; the admin sees the real number in the toast and the audit log.
- [Location changed only by its linked channel (same text) shows "Lobby → Lobby"] → Rare; it still counts as a change because the place really moved. Acceptable for now.
- [Event title or location text with Discord markdown can change the look of the DM] → Same as all existing DMs that interpolate the title; no new risk.
- [The frontend and server comparisons could drift] → Both are covered by tests with the same cases (same instant in another notation, empty ↔ value, channel only).

## Migration Plan

Additive: no stored data changes, no new env variable. Rollback = revert the commit; old clients simply never send the flag.
