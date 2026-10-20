# Proposal

Ticket: **W-05 – Wartelisten-Position anzeigen**, GitLab issue 69, size S.

## Why

A member on the waitlist only reads "Warteliste" (event page, profile) or "Du stehst auf der Warteliste." (slot events). They cannot tell whether a place is likely, so they ask the organisers or unregister early. Admins also cannot see the order in the registration list. The order already exists: the waitlist moves up oldest first.

## What Changes

- The server computes the waitlist position of a waitlisted registration: its place among all waitlisted registrations of the event, ordered by registration time (oldest first), plus how many are waiting. Slot events use the same single list (user decision).
- **Event page:** the own registration status reads "Platz 2 von 3 auf der Warteliste" instead of "Warteliste"; on slot events the slot area says "Du stehst auf Platz 2 von 3 der Warteliste." and adds that members with a free wanted role can move up earlier.
- **Profile ("Meine Events"):** the chip of an upcoming waitlisted event reads "Warteliste · Platz 2 von 3"; the history keeps "Warteliste".
- **Admin registrations dialog:** the status of a waitlisted registration reads "Warteliste · Platz 2".
- Discord texts stay unchanged (user decision).

## Capabilities

### New Capabilities
- `waitlist-position`: how the position of a waitlisted registration is defined and where members and admins see it.

### Modified Capabilities
- (none — `admin-manual-registration` is not archived yet and is not touched; `registration-deadlines` and `attendance-checkin` are unaffected)

## Impact

- **Code:** `utils/capacity.js` (position helper next to `byCreatedAt`), `routes/events.js` (`GET /:id/my-registration`), `routes/user.js` + `utils/profileEvents.js` (profile entries), `routes/admin.js` (`GET /events/:id/registrations`), frontend `public/js/events/detail.js`, `public/js/events/slots.js` (`renderOwnSlot`), `public/js/pages/profile-view.js`, `public/js/admin/registrations.js`.
- **API:** `my-registration` gains `waitlistPosition: { position, total }` for an own waitlisted registration; profile entries gain `waitlistPosition` (`null` unless upcoming and waitlisted); admin registration entries gain `waitlistPosition` when waitlisted. Additive, no breaking change.
- **Data:** none (computed from `status` and `createdAt`).
- **Wiki nodes:** `docs/wiki/concepts/registration-flow.md` (waitlist), `docs/wiki/modules/routes-events.md`, `docs/wiki/modules/routes-admin.md`, `docs/wiki/modules/frontend-app.md`, the profile node that describes profile entries (`docs/wiki/modules/routes-user.md` or similar), `docs/wiki/ops/testing.md`.
- No new dependencies, no new environment variables.
