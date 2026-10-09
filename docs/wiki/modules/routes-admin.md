---
id: routes-admin
title: routes/admin.js — admin API
type: module
tags: [api, admin, events, registrations, discord, bot-control, maintenance, audit-log, csv]
sources: [routes/admin.js, middleware/validators.js, utils/eventUtils.js]
part_of: [architecture]
depends_on: [middleware, utils, data-layer, bot]
see_also: [event-lifecycle, maintenance-mode, discord-integration, api-index]
---
# routes/admin.js — admin API

> TL;DR: Mounted at `/api/admin`; every route requires `requireAuth` + `requireAdmin` (`router.use` at the top). Covers event CRUD and lifecycle, registration review, CSV export, Discord announce/sync/import, bot message templates, audit log, full system reset, bot control center and maintenance/panic mode. Most mutations write an audit log entry via `addAuditLog`.

## Endpoints

| Method | Path | Notes | Audit action |
|---|---|---|---|
| GET | `/roles` | guild roles (`getGuildRoles`) | — |
| GET | `/channels` | guild channels for location autocomplete | — |
| GET | `/stats` | counts of events by status and registrations by status (guests counted) | — |
| GET | `/all-events` | all events incl. draft/archived, `orderBy('createdAt','desc')` | — |
| GET | `/import/discord-events` | Discord scheduled events (`getGuildScheduledEvents`) | — |
| POST | `/events` | `validateEvent`; creates one event or, with `recurring` + `recurringUntil`, a series (`seriesId`, weekly/biweekly/monthly); may `createEventChannels`; `slots` via `normalizeSlots` (slot events: `maxParticipants = Σ capacity`, `allowGuests = false`); optional `fromPoll: { pollId, optionId }` (only with status `active`) → `decidePollWithEvent` checks, creates (first instance of a series decides) and decides under the poll lock, event gets `sourcePollId` | `CREATE_EVENT`, `DECIDE_POLL` |
| PUT | `/events/:id` | `validateEvent`; full update; creates/deletes channels when `autoCreateChannels`/status changes; slots validated and written by `saveEventWithSlots` under the event lock; afterwards promotes the waitlist and refreshes announcements; `reminderHours` via `mergeReminderHours` (sent reminders stay sent while `startDate` is unchanged) | `UPDATE_EVENT` |
| PUT | `/events/:id/status` | body `{ status: draft\|active\|archived\|cancelled }` | `UPDATE_EVENT_STATUS` |
| PUT | `/events/:id/cancel` | status `cancelled` + DM to accepted/pending | `CANCEL_EVENT` |
| POST | `/events/:id/start` | status `active`, sets `startDate` if empty | `START_EVENT` |
| POST | `/events/:id/end` | status `archived`, `endDate = now` | `END_EVENT` |
| DELETE | `/events/:id` | `await deleteEventChannels(id)` first (it reads the channel ids from the event), then deletes event + its registrations | `DELETE_EVENT` |
| DELETE | `/events/series/:seriesId` | per event: `await deleteEventChannels(id)`, then event + registrations | `DELETE_SERIES` |
| POST | `/events/:id/duplicate` | copy as `draft`, title `"<title> (Kopie)"`, `checkinCode`, `announcements`, reminder `sent` flags and `eventStartNotificationSent` reset | `DUPLICATE_EVENT` |
| POST | `/events/:id/generate-checkin` | 6-digit code (`Math.random`), `checkinEnabled: true` | `GENERATE_CHECKIN` |
| GET | `/events/:id/checkin-stats` | `{ total, checkedIn, code }` over accepted registrations | — |
| GET | `/events/:id/registrations` | paginated (`page`, `limit` 50), newest first; plus `slots` of the event | — |
| GET | `/events/:id/registrations/export` | CSV with BOM, columns incl. source, "Slot" + "Wunschrolle" (slot events) and all form answers | `EXPORT_REGISTRATIONS` |
| PUT | `/registrations/:id/status` | `validateRegStatus` (`accepted`\|`rejected`\|`waitlisted`); accepted → DM template + `assignRole`; rejected → DM + `promoteFromWaitlist`; slot events: accepting a slot-less registration picks a wanted free slot or overbooks the main role (`warning`), rejecting/waitlisting clears `slotId` | `UPDATE_REGISTRATION_STATUS` |
| PUT | `/registrations/:id/slot` | body `{ slotId }` → `moveRegistrationToSlot` (may overbook → `warning`), promotes the waitlist | `MOVE_REGISTRATION_SLOT` |
| POST | `/events/:id/announce` | body `{ text, roleIds, pingEveryone }` → `sendChannelMessage` to `DISCORD_ANNOUNCE_CHANNEL_ID` with embed + buttons (live line-up); stores `{ channelId, messageId }` in `event.announcements` (max 5) | `ANNOUNCE_EVENT` |
| POST | `/events/:id/sync-discord` | creates a Discord scheduled event once, stores `discordScheduledEventId` | `SYNC_DISCORD_EVENT` |
| GET / PUT | `/bot-messages` | templates `registration`, `accepted`, `rejected` (`validateBotMessages`, ≤2000 chars) | `UPDATE_TEMPLATES` |
| GET | `/audit-log` | paginated, newest first | — |
| DELETE | `/reset` | body `{ password, targets[] }`; `ADMIN_RESET_PASSWORD` required; wipes `events`, `users`, `registrations`, `comments`, `auditLogs`, `polls`, `pollVotes` | (console only) |
| POST | `/polls` | `normalizePollInput` → new open poll | `CREATE_POLL` |
| PUT | `/polls/:id` | `updatePoll` (open polls only; dates with votes stay) | `UPDATE_POLL` |
| POST | `/polls/:id/close` | `closePoll` | `CLOSE_POLL` |
| POST | `/polls/:id/announce` | posts the poll embed + buttons, stores `{ channelId, messageId }` (max 5) | `ANNOUNCE_POLL` |
| DELETE | `/polls/:id` | `deletePoll` (votes too; posted messages become a notice) | `DELETE_POLL` |
| GET | `/bot/status` | `getBotStatus()` | — |
| GET / PUT | `/bot/settings` | presence + feature toggles (`saveBotSettings` → `applyBotSettings`) | `UPDATE_BOT_SETTINGS` |
| GET | `/bot/running-events` | active events with registration stats | — |
| GET / PUT | `/maintenance` | warning, login/registration toggles, planned maintenance (panic state preserved) | `UPDATE_MAINTENANCE` |
| POST | `/maintenance/panic` | lockdown, no password | `PANIC_MODE_ACTIVATED` |
| POST | `/maintenance/panic/deactivate` | body `{ password }` = `ADMIN_RESET_PASSWORD` | `PANIC_MODE_DEACTIVATED` |

## Where in code

grep `router.(get|post|put|delete)('/<path>` in `routes/admin.js`; the file is grouped as: roles/channels/stats → event CRUD → lifecycle → check-in → registrations → announce/sync → templates → audit log → reset → `BOT CONTROL CENTER` → `MAINTENANCE MODE`.

## Gotchas

- `POST /events/:id/start|end` use `doc(collectionRef, id)`; the SQLite adapter supports that form since 2026-09 (it used to 404).
- `deleteEventChannels(id)` reads the channel ids from the event document → call it (and await it) before the event is deleted; it checks for channel ids itself, so no status condition is needed.
- The event payload is whitelisted field by field in POST and PUT (`baseEvent`, `updates`) — adding an event field means editing both. See [add-event-field](../howto/add-event-field.md).
- Status, cancel, start, end and event updates call `notifyRegistrationsChanged`, so announcement buttons disappear on inactive events.
- CSV export does not neutralise `= + - @` (audit L-04, open).
