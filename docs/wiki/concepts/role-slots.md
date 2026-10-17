---
id: role-slots
title: Role slots — line-ups with main and fallback roles
type: concept
tags: [slots, roles, raid, lineup, waitlist, fallback, announcements, live-embed, lock]
sources: [utils/slotService.js, utils/capacity.js, utils/eventLock.js, utils/announcementRefresh.js, utils/registrationService.js, utils/eventUtils.js, bot.js, routes/events.js, routes/admin.js, public/js/events/slots.js, public/js/admin/wizard-builders.js, public/js/admin/registrations.js]
depends_on: [data-model, registration-flow]
see_also: [discord-integration, event-lifecycle, bot, frontend-app]
---
# Role slots — line-ups with main and fallback roles

> TL;DR: An event can define up to 10 slots (`{ id, name, emoji, capacity }`, e.g. Tank 2 / Heiler 3 / Schaden 10). Members pick a main role plus optional fallback roles; `registerUserForEvent` gives them the main role, else the first free fallback (slot order), else the waitlist. Freed places go to the oldest waitlist entry that wants that slot. Every change refreshes the stored Discord announcements (debounced 2 s); all place-changing work runs under an in-memory lock per event.

## Data

- Event: `slots[]`; with slots `maxParticipants = Σ capacity` and `allowGuests = false` (enforced in `POST/PUT /api/admin/events`). `announcements: [{ channelId, messageId }]` (max 5) are the messages kept up to date.
- Registration: `slotId` (taken slot, `null` on the waitlist), `preferredSlotId` (main role), `altSlotIds` (fallbacks, slot order). "Fallback" = `slotId !== preferredSlotId`.

## Rules (`utils/slotService.js`, pure)

| Function | Rule |
|---|---|
| `normalizeSlots` | ≤10 slots, name 1–30 chars and unique, emoji empty or one Unicode emoji, capacity 1–100; IDs kept only if they already belong to the event |
| `pickSlot` | main role → first free fallback → `null` (waitlist) |
| `pickWaitlistPromotions` | waitlist oldest first; everyone whose main role or fallback has a free place moves up; overbooked slots stay closed |
| `resolveAcceptanceSlot` | admin accepts a slot-less registration: free wanted slot, else the main role overbooked (+ warning); an unknown main role falls back to a free slot |
| `validateSlotChange` | refuses removing a slot that has pending/accepted registrations or is the main role of a waitlisted registration, and switching slots on while open registrations exist |
| `buildRoster` | line-up for the event page and the embed |

Normal events use `utils/capacity.js`: places = 1 + guests + open invitations; promotion moves up every waitlisted registration that still fits (fixes the old guest overbooking).

## Flows

| Action | Entry points | Service |
|---|---|---|
| Register | web form (slot cards + fallback chips), Discord slot button → modal | `registerUserForEvent({ slotId, altSlotIds })` |
| Switch own slot (free slots only) | web "Slot wechseln", Discord "Zu … wechseln" | `switchOwnSlot` |
| Move (admin, may overbook) | admin registration list | `moveRegistrationToSlot`, audit `MOVE_REGISTRATION_SLOT` |
| Unregister | web, `/unregister`, Discord "Abmelden" | `unregisterUserFromEvent` |
| Promote | after unregister, reject, switch, move, capacity increase, account deletion; not once the event is over | `promoteFromWaitlist` / `promoteFromWaitlistLocked` + `announcePromotions` |

## Discord

`buildEventComponents` renders one button per slot (`event_slot:<eventId>:<slotId>`, "(voll)" when full, 5 per row, link button last). The modal (`event_slot_modal:…`) starts with the fallback select `alt_slots` when there is more than one slot → slot events allow 4 form fields in Discord (`getModalFieldLimit`). Already registered members get an ephemeral answer with `slot_switch:<eventId>:<slotId>` and `slot_leave:<eventId>`. `refreshEventAnnouncements` edits the stored messages; deleted ones (Discord errors 10003/10008) are dropped.

## Concurrency

`withEventLock(eventId, fn)` (`utils/eventLock.js`) serializes registration, switch, move, admin status change, promotion and slot edits of the event (`saveEventWithSlots`) per event. It is not reentrant: inside the lock call `promoteFromWaitlistLocked`, then `announcePromotions` after releasing it.

## Gotchas

- Guests are not possible on slot events.
- Rejecting or waitlisting a registration clears its `slotId`; a later acceptance picks a slot again.
- The slot buttons and `/unregister` acknowledge the click first (`deferUpdate` / `deferReply`) because role changes and waitlist DMs can exceed Discord's 3 s limit.
- Nobody is moved back from a fallback to the main role automatically.
- Turning slots on is only allowed while the event has no open registrations.
- Live announcements need the message stored at announce time; announcements sent before 2.6.0 stay static.
