---
id: event-lifecycle
title: Event lifecycle — status, series, check-in
type: concept
tags: [events, status, draft, archive, cancel, series, recurring, checkin, duplicate]
sources: [routes/admin.js, routes/events.js, public/js/admin/event-actions.js, public/js/admin/wizard.js]
depends_on: [data-model]
see_also: [routes-admin, reminders-presence, registration-flow]
---
# Event lifecycle — status, series, check-in

> TL;DR: Events have four statuses: `draft` → `active` → `archived`, plus `cancelled`. Only `active` events are listed publicly and accept registrations. Admins create/edit through a 5-step wizard; recurring events are stored as independent instances sharing a `seriesId`. Check-in uses a 6-digit code the admin generates and members type in on the event page.

## Statuses and transitions

| Action (admin) | Endpoint | Result / side effects |
|---|---|---|
| Create | `POST /api/admin/events` | status from wizard (default `active`); channels if `autoCreateChannels` + active |
| Edit | `PUT /api/admin/events/:id` | full replace of whitelisted fields; channels created/deleted on activation changes |
| Change status | `PUT /api/admin/events/:id/status` | any of the 4 statuses; channel create/delete |
| Start | `POST /api/admin/events/:id/start` | `active`, `startDate = now` if empty |
| End | `POST /api/admin/events/:id/end` | `archived`, `endDate = now`, channels deleted |
| Cancel | `PUT /api/admin/events/:id/cancel` | `cancelled`, DM to accepted + pending, channels deleted |
| Duplicate | `POST /api/admin/events/:id/duplicate` | new `draft` "(Kopie)", check-in code cleared |
| Delete | `DELETE /api/admin/events/:id` | event + registrations deleted (comments stay) |

Visibility: `GET /api/events` returns only `active` (admins may pass `?status=`); `GET /api/admin/all-events` returns everything.

## Series (recurring events)

- Created in one `POST /api/admin/events` with `recurring: true`, `recurringInterval` (`weekly`, `biweekly`, anything else = monthly) and `recurringUntil` (date, inclusive).
- Each date becomes its own event document with the same `seriesId` (uuid) and the same settings; editing changes only one instance.
- Public list shows one card per series (next upcoming instance + `seriesDates[]`); detail page lists all dates via `GET /api/events/series/:seriesId`.
- `DELETE /api/admin/events/series/:seriesId` removes all instances.

## Check-in

1. Admin: `POST /api/admin/events/:id/generate-checkin` → `checkinCode` (6 digits) + `checkinEnabled: true`; `GET .../checkin-stats` shows `{ total, checkedIn, code }`.
2. Member with an `accepted` registration: event page → `POST /api/events/:id/checkin { code }` → `checkedIn: true`, `checkedInAt`; optional `checkinMessage` shown.
3. Check-ins feed the profile badge `perfect-attendance`.

## Time handling

Dates are stored as ISO strings; the wizard uses Flatpickr (German locale). Bot texts format with `toLocaleString('de-DE', { timeZone: TIMEZONE })`.

## Gotchas

- `draft` and `archived` events do not exist for non-admins: every `/api/events/:id…` route answers 404, series answers leave them out (`isEventVisibleTo`); `cancelled` events stay readable by id — see [security](security.md).
- Deleting an event does not delete its auto-created Discord channels (order bug in `DELETE /events/:id`).
