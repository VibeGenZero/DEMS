# Design

## Context

See proposal.md for the motivation and specs/admin-manual-registration/spec.md for the behaviour. Current state:

- Every registration goes through `registerUserForEvent()` → `createRegistration()` in `utils/registrationService.js` under `withEventLock(eventId)`. It enforces status, end, deadline, duplicates, role, guests, required fields, slots and capacity, writes `source: web|discord`, then `notifyRegistration()` (DM by status; accepted → `assignRole` + `addParticipantToEventChannels`) and `notifyRegistrationsChanged()`.
- The only member search is `GET /api/user/search` over the `users` collection (website logins only, without the searcher and without members who turned invitations off).
- `bot.js` already has the `GuildMembers` intent; Discord helpers follow the pattern `if (!isReady) return <neutral>` + `try/catch`, e.g. `fetchMemberRoleIds` (`{ isMember, roleIds }` or `null`). `dev/mockBot.js` overrides them with data from `dev/mockGuild.js` (`PERSONAS`, `MEMBERS`, `findMember`).
- The registrations dialog (`public/js/admin/registrations.js`, `#registrationsModal`) loads `GET /api/admin/events/:id/registrations` (`{ data, meta, slots }`) and reloads itself after every action. Accepting into a full slot already answers with a `warning` ("Slot „Tank“ ist jetzt überbucht.").

## Goals / Non-Goals

**Goals:**
- One server-side path for admin entries that writes the same registration shape as a self-registration, so lists, places, profile, check-in (W-07) and the Discord announcement treat it like any accepted registration.
- Find members who never used the website.

**Non-Goals:**
- Filling form answers or adding guests for the member (answers stay empty; the member can be asked later).
- Bulk entry, removing registrations as admin (already "Ablehnen"), entries from Discord commands.
- Changing `GET /api/user/search` (members keep their search with the invitation opt-out).

## Decisions

1. **Discord helpers in `bot.js`, twins in `dev/mockBot.js`.**
   - `searchGuildMembers(query, limit = 10)` → `[{ id, username, displayName, avatar }]`; `if (!isReady) return []`, `guild.members.search({ query, limit })` (Discord matches the start of username or nickname), `displayName = member.displayName`, `avatar = member.displayAvatarURL()`; `catch` → `[]`. Bots are left out.
   - `fetchGuildMember(userId)` → the same shape, `false` for Unknown Member/User (codes 10007/10013), `null` when not ready or Discord fails — the same three-way answer as `fetchMemberRoleIds`, so the route can tell 404 from 503.
   - Mock: search over `[...PERSONAS, ...MEMBERS]` with `includes` on lower-cased `displayName`/`username` (substring, friendlier for the persona names), `avatar: ''`; `fetchGuildMember` via `findMember`. Both log with `mockLog` like the other twins.
   - Alternative considered: the `users` collection — rejected by the user (members who never logged in would be missing).

2. **Search route `GET /api/admin/events/:id/member-search?q=`** in `routes/admin.js` (admin guard is global there). Trims `q`; fewer than 2 characters → `[]`. Loads the event's registrations once (`loadEventRegistrations`) and marks each hit `alreadyRegistered: true` when its id is a registration's `userId` or appears in `guests` / `pendingGuests[].userId`. Reads only, no audit entry.

3. **Service function `addRegistrationByAdmin({ eventId, member, slotId })`** in `utils/registrationService.js`, next to `registerUserForEvent`, plus `REGISTRATION_SOURCE.ADMIN = 'admin'` and new failure code `NOT_ALLOWED: 'admin_add_not_allowed'` (400). Under `withEventLock(eventId)`:
   - event missing → `NOT_FOUND`; `status` `draft` or `cancelled` → `NOT_ALLOWED` "Für Entwürfe und abgesagte Events kann niemand eingetragen werden."; `active` and `archived` pass. No end, deadline, role or field check.
   - already registered or guest (same rule as the search) → `ALREADY_REGISTERED` "Dieses Mitglied ist schon angemeldet."
   - slot events: `findSlot(slots, slotId)` or `INVALID_SLOT` "Bitte wähle einen gültigen Slot."; occupancy via `countSlotOccupancy`; if the slot has no free place → warning `Slot „<name>“ ist jetzt überbucht.` Fields `slotId = preferredSlotId = chosen`, `altSlotIds: []`.
   - events without slots and `maxParticipants > 0`: if `countOccupiedPlaces(registrations) + 1 > maxParticipants` → warning `Das Event ist jetzt überbucht (<n> von <max> Plätzen).`
   - writes `{ eventId, userId, userName: member.displayName, status: 'accepted', formAnswers: {}, guests: [], pendingGuests: [], source: 'admin', createdAt, ...slotFields }`.
   After the lock: when `!isEventOver(event)` → `notifyRegistration({ user: { id, displayName }, eventId, event, status: 'accepted', slot })` (accepted DM by template, role, channels — same as an instant self-registration); always `notifyRegistrationsChanged(eventId)`. Returns `{ ok: true, id, status, slotId, warning? }`.
   - Alternative considered: an `override` flag on `createRegistration` — rejected, it would thread admin exceptions through every member check and make the main path harder to read.

4. **Entry route `POST /api/admin/events/:id/registrations`** with `{ userId, slotId? }`: `userId` must be a non-empty string of digits (else 400 "Bitte wähle ein Mitglied aus."); `fetchGuildMember` → `false` 404 "Mitglied nicht gefunden.", `null` 503 "Discord ist gerade nicht erreichbar. Bitte versuche es später erneut."; then the service; failures through `httpStatus`/`error` like the member routes; success → `addAuditLog('ADD_REGISTRATION', adminId, 'Added <displayName> to the event', eventId)` and `201 { id, status, slotId, warning? }`. Static path: it sits next to `GET /events/:id/registrations`, no conflict with `/:id`.

5. **Registrations list returns `eventStatus`** (from the event it already reads for `slots`), so the dialog shows the search only for `active` and `archived`.

6. **Dialog UI** above the table in `#registrationsModal`: a block `#reg-add` (hidden start state `.is-hidden`, shown via `showElement` when allowed) with a label "Mitglied eintragen", search input `#reg-add-search` (`data-input="searchRegistrationMembers"`, debounced 300 ms like the guest search), a slot select `#reg-add-slot` (only for slot events, filled from `slots`), and a result list `#reg-add-results` (`list-group`). Each hit is a button with `avatar()`, name and `@username`; `data-click="addRegistrationMember"`, `data-user-id`, `data-display-name`; hits with `alreadyRegistered` are `disabled` with the note "schon angemeldet". Adding posts `{ userId, slotId }` with `X-CSRF-TOKEN`, toasts `<Name> eingetragen.` (success) plus the `warning` (warning) or the error (danger), clears the search and reloads the dialog, the admin table and the stats (like `updateRegStatus`). Only existing Bootstrap/component classes and tokens; no inline styles.

7. **Source label:** dialog badge `admin` → `<i class="bi bi-person-gear">` "Admin"; CSV source column `discord` → "Discord", `admin` → "Admin", else "Website". Audit chip `ADD_REGISTRATION` → `chip-success`.

## Risks / Trade-offs

- [Discord's member search matches only the start of username or nickname, not the middle of a display name] → Acceptable; the hint under the field says "Name oder Benutzername (Anfang)". The mock uses substring search, so tests must use prefixes to stay valid against both.
- [A member who left the server between search and click] → `fetchGuildMember` answers `false` → 404 with a clear message.
- [Overbooking is now possible from two admin paths] → Intended (user decision); the warning makes it visible, and the places sentence shows "x von y".
- [The member gets a DM they did not ask for] → It is the same accepted message they would get after a self-registration; after the end nothing is sent.

## Migration Plan

None. `source: 'admin'` is a new value; readers that do not know it fall back to "Website" today and get the explicit label with this change.
