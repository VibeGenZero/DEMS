---
id: registration-flow
title: Registration flow — rules, statuses, waitlist, guests
type: concept
tags: [registration, waitlist, guests, approval, capacity, discord, web]
sources: [utils/registrationService.js, utils/eventUtils.js, routes/events.js, routes/admin.js, bot.js, bot/registration.js]
depends_on: [data-model, form-fields, maintenance-mode]
see_also: [discord-integration, routes-events, event-lifecycle, role-slots]
---
# Registration flow — rules, statuses, waitlist, guests

> TL;DR: Every registration by a member (web or Discord) goes through `registerUserForEvent()` in `utils/registrationService.js`; admins add members with `addRegistrationByAdmin()` (accepted at once, member rules skipped, W-06). It checks event status, duplicates, role requirement, guest permission and required form fields, then decides the status (slot events: main role, else first free fallback role, else waitlist): `waitlisted` when capacity (incl. guests) is exceeded, otherwise `accepted` (instant approval) or `pending` (manual). Admins move registrations between statuses; freed places promote the oldest waitlisted registration that fits.

## Checks in order (`registerUserForEvent`)

1. Event exists → else `event_not_found` (404).
2. `status === 'active'` (or unset) → else `event_inactive`; then the event must not be over (`isEventOver`: end, else start + 2 h) → else `event_ended` (400, "Das Event ist schon vorbei.", W-01); then the optional `registrationDeadline` must not be reached (`isRegistrationClosed` in `utils/eventListing.js`) → else `registration_closed` (400, "Die Anmeldung für dieses Event ist geschlossen.", W-03).
3. No registration with same `eventId` + `userId` → else `already_registered`.
4. `accessMode === 'role-required'` → user must have one of `requiredRoles` (`missing_role`, 403). Web: roles from the session; Discord: live member roles.
5. Guests sent but `allowGuests === false` → `guests_not_allowed`.
6. `findMissingRequiredFields(formFields, formAnswers)` → `missing_fields` (checkbox must be `true`, others non-empty).
7. Slot events: `slotId` must be a slot of the event (`invalid_slot`, 400) and guests are refused (`guests_not_allowed`); `pickSlot` gives the main role, else the first free fallback (`altSlotIds`, slot order), else `waitlisted` — see [role-slots](role-slots.md).
8. Events without slots, capacity (only if `maxParticipants > 0`): occupied = `countOccupiedPlaces` (`utils/capacity.js`: 1 + guests + open guest invitations per pending/accepted registration); if `occupied + 1 + newGuests > max` → `waitlisted`. The same count is what members see: `summarizePlaces`/`formatPlaces` build the sentence "5 von 20 Plätzen belegt (inkl. 1 Gast, 1 Anfrage offen)" for the event page, the overview cards and Discord.
9. Otherwise `approvalMode === 'instant'` → `accepted`, else `pending`.
10. Write the registration (`source: web|discord`; admin entries use `admin`, see below), send guest invitation DMs, then `notifyRegistration` (DM by status; accepted → `assignRole` + event channel access; the waitlisted DM is skipped for members who switched "Warteliste" off, W-16 — the move-up DM of `announcePromotions` always goes out) and `notifyRegistrationsChanged` (live announcement).

Steps 1–10 up to the write run under `withEventLock(eventId)` (one registration per event at a time); DMs and the announcement refresh run after the lock is released.

Maintenance: `registrationDisabled`/`panicMode` block registrations before step 1 (web: `checkRegistrationAllowed` → 503; Discord: `checkRegistrationConditions`).

## Waitlist position (W-05)

A waitlisted registration's place is its rank among the event's waitlisted registrations by `createdAt`, oldest first (ties by id) — `waitlistPositions` in `utils/capacity.js`, the same order the promotion walks. Slot events use the same single list, although a later registration whose wanted role frees up can move up first; the event page says so. Members see only their own place: "Platz 2 von 3 auf der Warteliste" on the event page, "Warteliste · Platz 2 von 3" in the profile's upcoming list; admins see "Warteliste · Platz 2" in the registrations dialog. Discord texts carry no place.

## Status transitions

```mermaid
stateDiagram-v2
  [*] --> pending: manual approval
  [*] --> accepted: instant approval
  [*] --> waitlisted: event full
  pending --> accepted: admin
  pending --> rejected: admin (DM, promotes waitlist)
  pending --> waitlisted: admin
  accepted --> waitlisted: admin bulk (W-08)
  accepted --> rejected: admin bulk (W-08)
  waitlisted --> accepted: promoteFromWaitlist (instant)
  waitlisted --> pending: promoteFromWaitlist (manual)
  accepted --> [*]: unregister (role/channel removed, promotes waitlist)
  pending --> [*]: unregister (promotes waitlist)
```

Admin changes go through `PUT /api/admin/registrations/:id/status` (allowed targets: `accepted`, `rejected`, `waitlisted`; DMs for accepted and rejected via `notifyStatusChange` in `utils/registrationService.js`, no DM for waitlisted). On slot events, accepting a registration without a slot picks a free wanted slot or overbooks the main role (response `warning`); rejecting and waitlisting clear `slotId`. Slots change via `PUT /api/admin/registrations/:id/slot` (admin, may overbook) and `PUT /api/events/:id/register/slot` (member, free slots only, `event_ended` once the event is over, `registration_closed` once the registration deadline is reached).

Discord after the end: `canRegisterViaDiscord` is false, so a refreshed announcement keeps only "Zum Event"; an old button (`checkRegistrationConditions`) and a modal sent after the end (`handleEventRegisterModal`, `handleEventSlotModal`) answer ephemerally "Das Event ist schon vorbei.". After the registration deadline the same places answer "Die Anmeldung für dieses Event ist geschlossen." (W-03).

## Bulk actions (W-08)

`POST /api/admin/events/:id/registrations/bulk` changes up to 200 registrations of one event at once (dialog: checkboxes + action bar). Accept applies to pending/waitlisted, waitlist to pending/accepted, reject to all three; the rest is skipped. Accept goes oldest first and **never overbooks**, unlike the single ✓: it fills `maxParticipants` next to the places of the unselected pending/accepted registrations (guests and open invitations count), on slot events the main or a fallback role with a free place; what does not fit goes on the waitlist (`full`). Every changed member gets the DM of the single action, and a newly waitlisted one the waitlist DM (W-16 choice respected). Waitlisting alone moves nobody up; rejections promote the waitlist once. Rules: `planBulkAction` in [utils](../modules/utils.md).

## Entry points

| Channel | Path |
|---|---|
| Web | `POST /api/events/:id/register` → `submitRegistration()` in `public/js/events/registration-form.js` |
| Discord button | `event_register:<eventId>` → `handleEventRegisterButton` → pre-checks → modal if the event has form fields that fit (≤5) → `handleEventRegisterModal` → `completeDiscordRegistration` → `registerUserForEvent({ source: 'discord' })` → `ensureUserProfile` |
| Discord slot button | `event_slot:<eventId>:<slotId>` → `handleEventSlotButton` → slot modal (`alt_slots` select + form) → `handleEventSlotModal` → `completeDiscordRegistration({ slotId, altSlotIds })` |
| Admin entry (W-06) | registrations dialog → `GET /api/admin/events/:id/member-search?q=` (Discord member search, hits marked `alreadyRegistered`) → `POST /api/admin/events/:id/registrations { userId, slotId? }` → `fetchGuildMember` (404 no member, 503 Discord unreachable) → `addRegistrationByAdmin` (see below) |
| Unregister | `unregisterUserFromEvent`: web `DELETE /api/events/:id/register`, Discord `/unregister` and the "Abmelden" button; refused with `unregister_closed` (400, "Abmelden ist nicht mehr möglich. Wende dich an einen Admin.") once the optional `unregisterDeadline` is reached (`isUnregisterClosed`). Without that deadline members can unregister any time, even after the end. |

## Admin entry (W-06)

`addRegistrationByAdmin({ eventId, member, slotId })` in `utils/registrationService.js` is the second writer next to `registerUserForEvent`, also under `withEventLock`. It skips the member rules on purpose: no role, required-field, deadline, end or archive check. Only `draft` and `cancelled` refuse it (`admin_add_not_allowed`, 400). A member who already has a registration or is a guest (accepted or invited) of one is refused with `already_registered` ("Dieses Mitglied ist schon angemeldet."; shared check `isOnRegistrationList`). The registration is written as `status: accepted`, `source: admin`, empty `formAnswers`, no guests; slot events need an existing `slotId` (else `invalid_slot`) and keep it even when full. A full event or slot is overbooked and the answer carries `warning` ("Das Event ist jetzt überbucht (2 von 1 Plätzen)." / "Slot „Tank“ ist jetzt überbucht."). Before the end `notifyRegistration` sends the accepted message and grants role and channels; after the end nothing is sent. Always `notifyRegistrationsChanged`; the route logs `ADD_REGISTRATION`.

## Guests

- Inviting: the registrant picks users via `GET /api/user/search` (only users with `acceptInvitations !== false`); they are stored in `pendingGuests` with `status: 'pending'` and receive a DM with `guest_accept` / `guest_decline` buttons.
- Accept → `pendingGuests[i].status = 'accepted'` and user id pushed to `guests`; decline → removed from `pendingGuests` and the waitlist may move up (the invitation no longer reserves a place). Only the invited user can press the buttons.
- Pending invitations already reserve a slot.
- An accepted guest has no registration of their own: `GET /api/events/:id/my-registration` answers `{ registered: true, asGuest: true, id, status }` with the id and status of the inviting registration and nothing else from it.

## Message templates

DM texts come from `event.customBotMessages[status]`, else `botMessages/templates[status]`, else a German default. Variables: `{user.id}`, `{user.name}`, `{user.mention}`, `{event.title}`, `{event.url}`, `{role.name}`, `{role.mention}`, `{slot.name}`, `{slot.emoji}` (replaced by `parseTemplate`).

## Gotchas

- Registrations of one event are serialized by `withEventLock` (in memory, single process); a second server process would need a real transaction.
- Promotion moves up every waitlisted registration that still fits (guests counted), oldest first — but never once the event is over (`promoteFromWaitlistLocked` returns no promotion, W-01).
- The registration deadline (W-03) only stops new registrations and own slot switches; waitlist promotion, guest invitation answers and admin changes go on until the end. The unregister deadline only stops members; admins still reject, waitlist or move registrations.
