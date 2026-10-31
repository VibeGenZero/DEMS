# Design

## Context

- `POST /api/admin/events/:id/sync-discord` (`routes/admin.js`) calls `createScheduledEvent` (`bot/channels.js`) once and stores `discordScheduledEventId`; a second call answers 400. The admin list hides „Mit Discord synchronisieren“ for events with that id (`public/js/admin/event-rows.js`). `createScheduledEvent` makes a voice event when `event.discordChannelId` is set, else an external event at "TBD"; uploaded banners go in as a file (`bannerForDiscord`).
- Every event save goes through `applySavedEvent({ eventId, oldEvent, updates, … })` (single save and each date of a series save). Other lifecycle routes: `PUT /events/:id/status`, `PUT /events/:id/cancel`, `POST /events/:id/start` (status active, start = now when empty), `POST /events/:id/end` (status archived, end = now), `DELETE /events/:id`, `DELETE /events/series/:seriesId`, `POST /events/:id/duplicate` (copies all fields except a reset list), `extendSeries` (new dates from the stored date as `base`). Duplicate and `extendSeries` copy `discordScheduledEventId` today.
- Discord rules: a scheduled event's status goes SCHEDULED → ACTIVE → COMPLETED or SCHEDULED → CANCELED; COMPLETED/CANCELED events cannot be edited; a SCHEDULED event's start may not be in the past; an external event needs an end time and a location. Error 10070 = Unknown Guild Scheduled Event. The bot can edit and delete events it created with the `CreateEvents` permission it has since F-13.
- `bot/scheduler.js` `checkReminders` runs every 5 minutes over active events with injectable `send`, `refresh`, `settings`, `canInvite` for tests.
- `event.location = { text, channelId, channelType } | null`.

## Goals / Non-Goals

**Goals:** one field builder for create and update; no Discord call per pass once a status is reached; a lost Discord event never blocks a save.

**Non-Goals:** no automatic sync without the button; no changes from Discord back into DEMS.

## Decisions

1. **New bot area module `bot/scheduledEvents.js`.** `createScheduledEvent` and `getGuildScheduledEvents` move here from `bot/channels.js` (unchanged exports of `bot.js`).
   - `buildScheduledEventFields(event, now)` (pure, exported for tests) → `{ name ≤ 100, description ≤ 1000, scheduledStartTime, scheduledEndTime (end > start, else start + 2 h), entityType, channel, entityMetadata }`: voice (`GuildScheduledEventEntityType.Voice`) with `event.discordChannelId`, else with `location.channelId` when `location.channelType === 'voice'`; otherwise external with `entityMetadata.location = location.text` (≤ 100) or „Discord“.
   - `updateScheduledEvent(event, { bannerChanged })` (exported) → `'updated' | 'gone' | false`: `if (!state.isReady || !event.discordScheduledEventId) return false`; fetch the scheduled event; COMPLETED/CANCELED → `false`; `edit(fields)` without `scheduledStartTime` when the Discord event is ACTIVE or the start lies in the past; `setImage` only with `bannerChanged`. 10070 → `'gone'`. Other errors logged → `false`.
   - `removeScheduledEvent(event)` (exported) → `true` when deleted or already gone, `false` otherwise (logged).
   - `setScheduledEventStatus(event, target)` (exported, `target` `'active' | 'completed'`) → `'active' | 'completed' | 'gone' | false`: SCHEDULED → ACTIVE; to complete a SCHEDULED one it goes ACTIVE first, then COMPLETED; already there → returns the target without a call.
   All four guard `state.isReady`, `try/catch` + `console.error`; twins in `dev/mockBot.js` log `[MOCK-DISCORD] Server-Event "<Titel>" aktualisiert / entfernt / läuft / beendet` and answer like a successful call.

2. **Local status `discordScheduledEventStatus`** (`scheduled` on sync, then `active`, `completed`). Written **after** a successful Discord call (unlike the reminder flags): a failed or offline call is retried in the next pass, and the transitions are idempotent. Cleared together with the id.

3. **Shared route helper `syncScheduledEventAfterChange(eventId, event, { bannerChanged })`** in `routes/admin.js` (fire and forget, never throws): no id → nothing; status `cancelled` or `draft` → `removeScheduledEvent`, then clear `discordScheduledEventId` + status; `archived` → `setScheduledEventStatus(…, 'completed')`; `active` → `updateScheduledEvent`; result `'gone'` → clear id + status. Called from `applySavedEvent` (single and series saves, `bannerChanged = oldEvent.bannerUrl !== updates.bannerUrl`), `PUT …/status` and `PUT …/cancel`. `POST …/start` → `setScheduledEventStatus(…, 'active')`, `POST …/end` → `'completed'` (both store the status / clear on gone). `DELETE` and series delete → `removeScheduledEvent` for every synced event before the documents go. `sync-discord` stores `discordScheduledEventStatus: 'scheduled'`.

4. **Scheduler.** `checkReminders` gets `scheduledStatus = setScheduledEventStatus` (injectable). Per active event with an id: over and status ≠ completed → `'completed'`; else started and status ∉ {active, completed} → `'active'`; store the returned status, clear on `'gone'`; `false` stores nothing. Only active events are looked at (archived ones were completed by „Beenden“ or a pass before their auto-archive 24 h after the end).

5. **Copies.** `duplicate` and `extendSeries` set `discordScheduledEventId: null` and `discordScheduledEventStatus: null`.

## Risks / Trade-offs

- [Start moved into the past for a not yet started Discord event] → the start is left out of the edit; the status pass then sets it running.
- [Rate limits with long series] → one edit per synced date; series are short (≤ the existing extension limits).
- [Image upload on every save] → avoided: only when the banner changed.
- [Bot offline during a cancel/delete] → the Discord event stays (no queue); a moderator removes it by hand. Logged.
- [Mock mode] → the scheduler's calls are the real, not ready functions (internal call) and change nothing; route calls go through the twins and show in the log.
