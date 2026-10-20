# Design

## Context

See proposal.md for the motivation and specs/attendance-checkin/spec.md for the behaviour. Current state:

- `POST /api/events/:id/checkin` (`routes/events.js`) is the only writer of `registrations.checkedIn` / `checkedInAt`; it needs `checkinEnabled` + `checkinCode` and an accepted registration of the caller.
- Readers already use only `checkedIn === true`: `GET /api/admin/events/:id/checkin-stats` (accepted registrations), `GET /api/user/profile` stats and the `perfect-attendance` badge (`routes/user.js`, counts `checkedIn` regardless of status), `utils/profileEvents.js`, `public/js/events/checkin.js` and `public/js/pages/profile-view.js`.
- The admin registrations dialog (`public/js/admin/registrations.js`, `#registrationsModal` in `public/index.html`) renders a 7-column table from `GET /api/admin/events/:id/registrations`, which already returns `checkedIn` with each registration. Status changes go through `PUT /api/admin/registrations/:id/status` and reload the dialog.

## Goals / Non-Goals

**Goals:**
- One admin write path for the check-in that reuses the stored fields, so every reader counts admin check-ins without changes.
- Keep `checkedIn` meaningful: only accepted registrations carry it.

**Non-Goals:**
- A "checked in by admin vs. code" marker — W-14 needs only present/absent; the audit log tells who did it.
- A check-in counter in the dialog header (the dialog shows only the first 50 registrations, a counter would be wrong for big events; the event page already shows `x / y`).
- Bulk check-in, Discord check-in (B-07), guest check-in.
- Touching the Discord announcement: it does not show check-ins, so no `notifyRegistrationsChanged` call.

## Decisions

1. **Endpoint `PUT /api/admin/registrations/:id/checkin` with body `{ checkedIn: boolean }`.** Next to the existing `PUT /registrations/:id/status` and `/slot`, so the route lives in `routes/admin.js` behind the existing admin guard and CSRF check. An explicit target value (not a "toggle" endpoint) makes the call idempotent: a double click or two admins at once end in the state they meant. Response `{ id, checkedIn, checkedInAt }`.
   - Errors (German): 400 `Bitte gib an, ob eingecheckt werden soll.` when `checkedIn` is not a boolean; 404 `Anmeldung nicht gefunden`; 400 `Nur angenommene Anmeldungen können eingecheckt werden.` for other statuses (also for clearing — a non-accepted registration has no check-in after decision 3).
   - No time or event-status check and no `checkinCode` check (user decision: any time).
   - Write: set → `{ checkedIn: true, checkedInAt: <now ISO> }`, but keep an existing `checkedInAt` when the registration is already checked in (repeat request does not move the time); clear → `{ checkedIn: false, checkedInAt: null }`.
   - Audit: `CHECKIN_REGISTRATION` / `UNDO_CHECKIN_REGISTRATION` with `Checked in <userName>` / `Took back check-in of <userName>` and the registration id as target. Both get a chip colour in `public/js/admin/dashboard.js` (`chip-success`, `chip-warning`).
   - Alternative considered: reuse `PUT /registrations/:id/status` with an extra field — rejected, that route sends DMs and assigns roles.

2. **No lock.** A single-document update with an explicit target value cannot race into a wrong count; `withEventLock` is only needed where places are counted.

3. **Clear on leaving "accepted".** In `PUT /registrations/:id/status`, when the new status is `rejected` or `waitlisted` and the registration is checked in, add `checkedIn: false, checkedInAt: null` to the same update. Without this the badge in `routes/user.js` would count a check-in of a rejected registration.

4. **Dialog column "Check-in"** between "Status" and "Slot" (header in `public/index.html`, colspans 7 → 8 in the spinner/error rows). Accepted rows get one button with `data-click="toggleRegCheckin"` and `data-reg-id`, `data-checked-in`, `data-event-id`, `data-event-title` (all through `escapeHtml`), `aria-pressed`:
   - not checked in: `btn btn-sm btn-outline-secondary`, `bi-square`, text "Abhaken";
   - checked in: `btn btn-sm btn-success`, `bi-check2-square`, text "Eingecheckt".
   Other statuses: `—`. Handler `toggleRegCheckin` sends the opposite value with `X-CSRF-TOKEN`, toasts `Eingecheckt.` (success) / `Check-in zurückgenommen.` (info) or the API error (danger), then reloads the dialog like `updateRegStatus`. Existing Bootstrap button classes only; no new CSS, so no token or contrast work.

5. **CSV column "Eingecheckt"** after "Status", values `Ja`/`Nein`, through `csvCell` like every cell.

## Risks / Trade-offs

- [The dialog reloads the whole list after each tick, at the door with many members this is a round trip per click] → Acceptable for size S; the reload keeps status, slot and check-in consistent. Optimistic in-place update can come with W-14/B-07 if needed.
- [Existing CSV tests compare columns by position] → Update them in the same task group; the new column goes after "Status" so form-answer columns stay at the end.
- [A registration that was checked in, rejected (check-in cleared) and accepted again loses its old check-in] → Intended: the admin can tick it again.

## Migration Plan

None. Existing data keeps its meaning; stale `checkedIn: true` on already rejected registrations (possible only through old data) stays and is not cleaned up.
