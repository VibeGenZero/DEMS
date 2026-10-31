---
id: event-lifecycle
title: Event lifecycle — status, series, check-in
type: concept
tags: [events, status, draft, archive, auto-archive, ended, cancel, series, recurring, checkin, duplicate]
sources: [routes/admin.js, bot/scheduledEvents.js, routes/events.js, public/js/admin/event-actions.js, public/js/admin/wizard.js, public/js/admin/wizard-notify.js, utils/eventArchive.js, utils/eventListing.js, utils/eventChangeNotice.js, utils/checkin.js, bot/checkin.js]
depends_on: [data-model]
see_also: [routes-admin, reminders-presence, registration-flow]
---
# Event lifecycle — status, series, check-in

> TL;DR: Events have four statuses: `draft` → `active` → `archived`, plus `cancelled`. Only `active` events are listed publicly and accept registrations, and only until their end or an optional registration deadline; the server archives an active event 24 hours after its end. Admins create/edit through a 5-step wizard; recurring events are stored as independent instances sharing a `seriesId`. Check-in uses a 6-digit code the admin generates and members type in on the event page, or admins tick members off in the registrations dialog.

## Statuses and transitions

| Action (admin) | Endpoint | Result / side effects |
|---|---|---|
| Create | `POST /api/admin/events` | status from wizard (default `active`); channels if `autoCreateChannels` + active |
| Edit | `PUT /api/admin/events/:id` | full replace of whitelisted fields; channels created/deleted on activation changes; optional change DM (see below) |
| Change status | `PUT /api/admin/events/:id/status` | any of the 4 statuses; channel create/delete |
| Start | `POST /api/admin/events/:id/start` | `active`, `startDate = now` if empty; synced Discord server event → running (B-09) |
| End | `POST /api/admin/events/:id/end` | `archived`, `endDate = now`, channels deleted; synced Discord server event → completed (B-09) |
| Cancel | `PUT /api/admin/events/:id/cancel` | `cancelled`, DM to accepted + pending except members with "Änderungen" off (W-16), channels deleted; synced Discord server event removed and unlinked (B-09) |
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

## Change DMs (W-04)

- When an admin edits an event and start, end or location differ from the loaded values while the status "Aktiv" is selected, the wizard shows "Teilnehmer benachrichtigen" next to "Speichern" (last step), switched on (`admin/wizard-notify.js`). Creating an event never shows it.
- Saving with the switch on sends `notifyParticipants: true`. The server checks again: "DM-Benachrichtigungen" on in the bot center (B-02; off → no DM, no `NOTIFY_EVENT_CHANGE` entry, `notifiedCount` 0, and the wizard does not show the switch), event `active` after the save and at least one change by `describeEventChanges` (dates as points in time, location by text + channel; other fields never count). Then every accepted registrant and every accepted guest gets one DM, unless they switched "Änderungen" off in the profile (W-16): event title, each change as ~~before~~ → **after** ("nicht festgelegt" for a missing value), link via `buildEventUrl`. Pending, waitlisted and invited guests get nothing.
- The toast says "Event aktualisiert – n Teilnehmer benachrichtigt."; the audit log gets `NOTIFY_EVENT_CHANGE` ("Notified n of m participants about changed Beginn, Ort", plus "; k opted out" when members switched change DMs off; no entry without any participant). DMs that fail are not counted and never fail the save.
- Status changes, start/end buttons and cancellations do not send this DM (cancelling has its own).

## Deadlines (W-03)

- Optional `registrationDeadline` (Anmeldeschluss) and `unregisterDeadline` (Abmeldeschluss), set in wizard step "Datum & Zeit"; both must lie before the end (`validateEvent` and `admin/wizard-checks.js`). A recurring event gives every date the same distance between deadline and start.
- After the registration deadline the event behaves like an ended one for new registrations and own slot switches (`registration_closed`, "Die Anmeldung für dieses Event ist geschlossen."); the waitlist, guest answers and admin changes go on until the end. After the unregister deadline members cannot unregister themselves — see [registration-flow](registration-flow.md).

## Series (recurring events)

- Created in one `POST /api/admin/events` with `recurring: true`, `recurringInterval` (`weekly`, `biweekly`, anything else = monthly) and `recurringUntil` (date, inclusive).
- Each date becomes its own event document with the same `seriesId` (uuid) and the same settings.
- Editing a date (W-11): the wizard asks "Nur dieser Termin" (default, only this document) or "Dieser und alle folgenden Termine" (`applyTo: 'following'`). "Following" are the later dates of the series that are not over and are `draft` or `active`; cancelled, archived and ended dates stay. They take the shared settings (`SERIES_FIELDS` in `utils/eventSeries.js`: title, description, banner, colour, location, category, places and slots, access, approval, role, form, reminders, check-in message, bot messages, channels, guests) and the edited date's local start time and duration on their own day in `TIMEZONE` (also across a daylight saving change); deadlines keep the edited distance to the start. Status, registrations and check-in stay per date. A slot that a later date still uses refuses the whole save with „Termin TT.MM.: …“. With "Teilnehmer benachrichtigen" every changed active date sends its own change DMs (one DM per date and member). Toast: "Event und n folgende Termine aktualisiert!".
- A series date keeps `recurring` and its interval whatever the request says.
- Extending (W-11): a later "Wiederholen bis" on any date (either scope) creates the missing dates after the last one in the series' interval, up to and including the new end day, at the local time of the copied date. Each new date copies the last `draft`/`active` date (else the edited one) with no registrations, check-in code, announcements or channels and nothing marked as sent; channels are not created for them (as when a series is created). The new end is stored on every date. An earlier "Wiederholen bis" is refused („„Wiederholen bis“ kann nur verlängert werden. …“); single dates are deleted from the date list. Toast adds "k neue Termine angelegt."
- Public list shows one card per series (next upcoming instance + `seriesDates[]`); detail page lists all dates via `GET /api/events/series/:seriesId`.
- `DELETE /api/admin/events/series/:seriesId` removes all instances.

## Check-in

1. Admin: `POST /api/admin/events/:id/generate-checkin` → `checkinCode` (6 digits) + `checkinEnabled: true`; `GET .../checkin-stats` shows `{ total, checkedIn, code }`.
2. Member with an `accepted` registration: event page → `POST /api/events/:id/checkin { code }` → `checkedIn: true`, `checkedInAt`; optional `checkinMessage` shown.
3. Admin (W-07): registrations dialog, column "Check-in" → `PUT /api/admin/registrations/:id/checkin { checkedIn }` ticks an `accepted` registration off or takes it back — at any time (also after the end and for archived events), without a code; audit log `CHECKIN_REGISTRATION` / `UNDO_CHECKIN_REGISTRATION`. It writes the same fields as the code check-in.
4. Discord (B-07): while an event with check-in runs, every accepted participant gets one DM with „Einchecken“ (scheduler, or right away when the code is generated during the event); the click checks in until the event is over. Rules shared with the code route in `utils/checkin.js`; details in [discord-integration](discord-integration.md).
5. Check-ins (code, admin or Discord) feed the profile number "Check-ins", the badge `perfect-attendance`, the "Eingecheckt" chips and `checkin-stats`.

## Time handling

Dates are stored as ISO strings; the wizard uses Flatpickr (German locale). Bot texts format with `toLocaleString('de-DE', { timeZone: TIMEZONE })`.

## Gotchas

- `draft` and `archived` events do not exist for non-admins: every `/api/events/:id…` route answers 404, series answers leave them out (`isEventVisibleTo`); `cancelled` events stay readable by id — see [security](security.md).
- Deleting an event does not delete its auto-created Discord channels (order bug in `DELETE /events/:id`).
