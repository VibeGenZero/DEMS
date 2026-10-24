# Proposal

## Why

Ticket W-11 (Prioplan: "Serien gemeinsam bearbeiten", P2, size M). A recurring event is stored as independent dates that share a `seriesId`, and editing one date changes only that date. An admin who wants to move a weekly raid from 20:00 to 19:30, change its description or add a slot has to open and save every date one by one. A series also cannot grow: once "Wiederholen bis" is reached, the only way to continue it is to create a new series with a new `seriesId`.

## What Changes

- When an admin edits a date of a series, the last wizard step offers next to "Speichern" a choice "Nur dieser Termin" (default, as today) or "Dieser und alle folgenden Termine".
- With "alle folgenden Termine", the saved settings (title, description, banner, colour, location, places and slots, access, approval, form, reminders, check-in message, bot messages, channels, guests, category) are copied to every later date of the series that is not over and not cancelled or archived. Each later date keeps its own day, but takes the new start time and duration; deadlines keep the edited date's distance to the start. A different day on the edited date moves only that date. Each date keeps its own status, registrations and check-in data.
- Slot changes are checked against the registrations of every affected date before anything is written; if one date would lose a slot that still has registrations, the whole save is refused with a German message that names the date.
- With "Teilnehmer benachrichtigen" switched on, every affected date whose start, end or location changed notifies its own accepted participants (W-04 rules per date); the answer and the toast report the total.
- Extending a series: a later "Wiederholen bis" on any date of a series creates the missing dates in the series' rhythm, as copies of the last date (no registrations, no check-in code), and stores the new end on every date. An earlier "Wiederholen bis" is refused; single dates are still deleted from the date list. The interval and the "Wiederholen" switch of an existing series can no longer be changed in the wizard.
- New audit entries for applying changes to following dates and for extending a series.

## Capabilities

### New Capabilities
- `event-series-editing`: How admins change several dates of a recurring event at once ("dieser und alle folgenden Termine") and extend a series to a later end date, including which dates and fields are affected, slot checks, change DMs per date and audit entries.

### Modified Capabilities
- `event-change-notifications`: The requirement "Feedback and audit log" changes: a save that covers several dates of a series reports the sum of notified participants over all dates and writes one notification audit entry per notified date.

## Impact

- Ticket: W-11 (GitLab work item 75, branch `75-w-11-serien-gemeinsam-bearbeiten`).
- API: `PUT /api/admin/events/:id` takes an optional `applyTo` (`this` | `following`, default `this`) and answers additionally `updatedDates` and `createdDates`; extension through the stored `recurringUntil`. No new endpoint.
- Server code: `routes/admin.js` (PUT `/events/:id`, series step from POST `/events` moved into a helper), new `utils/eventSeries.js` (following dates, time transfer in the configured time zone, extension plan), `utils/eventUtils.js` (`saveEventWithSlots` reused per date), `utils/eventChangeNotice.js` (unchanged API, called per date).
- Frontend: `public/js/admin/wizard.js`, `public/js/admin/wizard-checks.js`, `public/js/admin/wizard-notify.js` (scope choice next to "Speichern"), `public/index.html` (wizard step markup).
- No bot change, no new env variable, no new dependency.
- Wiki nodes: `docs/wiki/concepts/event-lifecycle.md` (section "Series"), `docs/wiki/modules/routes-admin.md`, `docs/wiki/reference/api-index.md`, `docs/wiki/modules/frontend-app.md` if the wizard module list changes; `docs/wiki/graph.json` via `npm run wiki`.
