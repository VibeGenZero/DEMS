---
id: event-lifecycle
title: Event lifecycle — status, series, check-in
type: concept
tags: [events, status, draft, archive, auto-archive, ended, cancel, series, recurring, checkin, duplicate]
sources: [routes/admin.js, routes/events.js, public/js/admin/event-actions.js, public/js/admin/wizard.js, utils/eventArchive.js, utils/eventListing.js]
depends_on: [data-model]
see_also: [routes-admin, reminders-presence, registration-flow]
---
# Event lifecycle — status, series, check-in

> TL;DR: Events have four statuses: `draft` → `active` → `archived`, plus `cancelled`. Only `active` events are listed publicly and accept registrations, and only until their end or an optional registration deadline; the server archives an active event 24 hours after its end. Admins create/edit through a 5-step wizard; recurring events are stored as independent instances sharing a `seriesId`. Check-in uses a 6-digit code the admin generates and members type in on the event page.

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
| Archive (automatic) | scheduler `archiveEndedEvents` (`utils/eventArchive.js`) | `archived` 24 h after the end; audit log `AUTO_ARCHIVE_EVENT` with adminId `system` (shown as "System"); stored announcements refreshed (buttons go away); channels and event role stay |

Active events need a `startDate`: creating, editing and publishing through `/status` refuse one without it, drafts may wait (D-10). The wizard checks each step before „Weiter“ (`admin/wizard-checks.js`) and previews the overview card and the Discord announcement of the unsaved input (`POST /api/admin/events/preview`).

The admin table names these actions by what they do (`admin/event-rows.js` decides which a row offers): "Veröffentlichen" and "Wieder aktivieren" send `PUT …/status` with `active`, "Zurück in Entwürfe" with `draft`, "Archivieren" with `archived`. "Jetzt starten …" (`POST …/start`) is only offered for a draft without a start date, "Jetzt beenden …" (`POST …/end`) only while the event runs, because it writes the end date. `cancel` has no button; cancelled events show in the archive tab with the chip "Abgesagt".

Visibility: `GET /api/events` returns only `active` (admins may pass `?status=`); `GET /api/admin/all-events` returns everything.

## End of an event (W-01)

- The end is `endDate`, else start + 2 h (`eventEndTime` in `utils/eventListing.js`, `eventEnd` in `public/js/events/cards.js`). An `endDate` before the start counts as missing; an event without a start has no end and never counts as over.
- From the end on, an event takes no registration and no slot change: web and Discord answer "Das Event ist schon vorbei." (`event_ended`, see [registration-flow](registration-flow.md)), the Discord announcement keeps only "Zum Event", the event page shows "Dieses Event ist vorbei." instead of the form and the countdown. Registered members still see their own status. Unregistering stays possible, but nobody moves up from the waitlist any more (no promotion after the end).
- 24 h after the end the archive scheduler sets `archived` (table row above). It runs once at server start, so events that ended while the server was down are caught up, then every 5 minutes — see [reminders-presence](reminders-presence.md). Until then the admin table shows the event as "Vorbei" with the main action "Archivieren".
- Events that never become `active` (drafts, cancelled) are not touched; an event that is already archived stays archived.

## Deadlines (W-03)

- Optional `registrationDeadline` (Anmeldeschluss) and `unregisterDeadline` (Abmeldeschluss), set in wizard step "Datum & Zeit"; both must lie before the end (`validateEvent` and `admin/wizard-checks.js`). A recurring event gives every date the same distance between deadline and start.
- After the registration deadline the event behaves like an ended one for new registrations and own slot switches (`registration_closed`, "Die Anmeldung für dieses Event ist geschlossen."); the waitlist, guest answers and admin changes go on until the end. After the unregister deadline members cannot unregister themselves — see [registration-flow](registration-flow.md).

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
