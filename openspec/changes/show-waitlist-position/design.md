# Design

## Context

See proposal.md for the motivation and specs/waitlist-position/spec.md for the behaviour. Current state:

- Promotion order: `pickCapacityPromotions` (`utils/capacity.js`) and `pickWaitlistPromotions` (`utils/slotService.js`) both walk waitlisted registrations sorted with `byCreatedAt` (ISO string compare). Slot events skip a waitlisted registration whose roles are all full, so a later one can move up first.
- `GET /api/events/:id/my-registration` (`routes/events.js`) returns the member's registration document spread (`{ registered, id, ...data }`), or for a guest only `{ registered, asGuest, id, status }`.
- `GET /api/user/profile` builds entries with `toProfileEntry` (`utils/profileEvents.js`) and splits them into `upcoming`/`history`; a server test pins the entry keys.
- `GET /api/admin/events/:id/registrations` loads all registrations of the event before paginating.
- Frontend: status line in `public/js/events/detail.js` (`statusTexts`), slot area in `renderOwnSlot` (`public/js/events/slots.js`), profile chips in `public/js/pages/profile-view.js` (`renderUpcomingRow` → `renderStatusChip`), admin status badge in `public/js/admin/registrations.js`.

## Goals / Non-Goals

**Goals:**
- One pure helper that defines the position, used by all three endpoints.
- No extra reads where the registrations are already loaded.

**Non-Goals:**
- Discord texts (user decision).
- Per-role positions on slot events (user decision: one list).
- A guarantee of the promotion order: on slot events the position is the registration order, not a prediction.

## Decisions

1. **Helper `waitlistPositions(registrations)`** in `utils/capacity.js`: filters `status === 'waitlisted'`, sorts with `byCreatedAt` (tie → registration id, so the order is stable), returns a `Map<registrationId, { position, total }>`. Callers look up their id. Pure and unit-tested in `test/capacity.test.js`.
   - Alternative considered: storing a position field — rejected, it would need updating on every status change.

2. **`my-registration`:** for an own registration with `status === 'waitlisted'`, load the event's registrations (`loadEventRegistrations`) and add `waitlistPosition`. Not for guests and not for other statuses, so other members' times never leave the server.

3. **Profile:** `toProfileEntry(registration, event, waitlistPosition = null)` always sets `waitlistPosition` (`{ position, total }` or `null`), so the entry shape stays fixed (the key test gets the new key). `routes/user.js` loads the registrations only of events where the member is waitlisted and the event is still upcoming-relevant (status `active`), one `loadEventRegistrations` per such event (usually zero or one). History entries keep `null`.

4. **Admin list:** compute `waitlistPositions(allRegs)` once before pagination and add `waitlistPosition` to each waitlisted entry.

5. **Texts (German):**
   - Event page status (`detail.js`): waitlisted with position → `Platz 2 von 3 auf der Warteliste`; without position (fallback) → `Warteliste`.
   - Slot area (`renderOwnSlot`): `Du stehst auf Platz 2 von 3 der Warteliste.` plus a muted second line `Wer eine freie Wunschrolle hat, kann früher nachrücken.`; fallback `Du stehst auf der Warteliste.`
   - Profile chip: `Warteliste · Platz 2 von 3` (same chip tone and icon as today, label only); the chip helper gets an optional label override instead of a new chip style.
   - Admin badge: `📋 Warteliste · Platz 2` (keeps the existing status text style of the dialog).
   All values are numbers from the server, still passed through `escapeHtml` where interpolated into HTML.

## Risks / Trade-offs

- [On slot events a member at "Platz 1" may see someone behind them move up first] → The slot area says so explicitly; the admin sees the same registration order.
- [Two registrations with the same `createdAt`] → Tie broken by id, so the numbering is stable across calls.
- [Profile load gets one extra read per waitlisted upcoming event] → Usually zero or one event; acceptable.
