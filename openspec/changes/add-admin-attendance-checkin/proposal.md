# Proposal

Ticket: **W-07 – Anwesenheit abhaken**, GitLab issue 71, size S. Prerequisite for W-14 (Auswertungen) and B-07 (Check-in per Discord).

## Why

Today a member is only marked as present when they type the 6-digit check-in code on the event page themselves, and only after an admin generated a code. Many members never do it, so the `perfect-attendance` badge and any later attendance figures (W-14: no-show rate) undercount. Admins know who was there and need to record it directly in the registration list, also afterwards.

## What Changes

- The admin registrations dialog gets a "Check-in" column: for every accepted registration a toggle that checks the member in or takes the check-in back. Other statuses show "—".
- New admin endpoint to set or clear the check-in of one registration. It works at any time (before, during and after the event, also for archived events) and needs no generated check-in code.
- Only accepted registrations can be checked in by an admin; other statuses are refused with a German error.
- Both directions are written to the audit log.
- An admin check-in is the same stored fact as a code check-in, so it counts for the `perfect-attendance` badge, the profile numbers ("Check-ins"), the profile event chips ("Eingecheckt"), the check-in stats on the event page and later evaluations.
- When an admin moves a checked-in registration to "rejected" or "waitlisted", its check-in is cleared, so only accepted registrations carry a check-in.
- The CSV export of the registrations gets a column "Eingecheckt" (Ja/Nein).
- The member's own code check-in stays unchanged.

## Capabilities

### New Capabilities
- `attendance-checkin`: how attendance of a registration is recorded (member code check-in and admin check-in in the registration list), who may change it, which registrations can carry it, and where it counts.

### Modified Capabilities
- (none — `openspec/specs/` has no capabilities yet; the W-03 change `add-registration-deadline` is not archived and does not touch check-in)

## Impact

- **Code:** `routes/admin.js` (new route `PUT /registrations/:id/checkin`, check-in cleared in `PUT /registrations/:id/status`, CSV column), `public/js/admin/registrations.js` (column, toggle action), `public/index.html` (table header of `#registrationsModal`), `public/js/admin/dashboard.js` (audit chip colour for the new action).
- **API:** one new admin endpoint; the CSV export gains one column. No breaking change.
- **Data:** no new fields — reuses `registrations.checkedIn` and `checkedInAt`; taking a check-in back sets `checkedIn: false` and `checkedInAt: null`. No migration.
- **Discord:** not touched (B-07 adds the Discord button later).
- **Wiki nodes:** `docs/wiki/concepts/event-lifecycle.md` (Check-in section), `docs/wiki/modules/routes-admin.md`, `docs/wiki/reference/api-index.md`, `docs/wiki/modules/frontend-app.md` (`admin/registrations.js`), `docs/wiki/concepts/data-model.md` if it describes `checkedIn`.
- No new dependencies, no new environment variables.
