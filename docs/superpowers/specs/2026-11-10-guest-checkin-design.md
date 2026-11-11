# Guest view: real status label and check-in for guests (#110)

## Intent

A member can bring guests: other DEMS users who accepted the invitation. They are
listed in `guests` of the inviting registration and have no registration of their
own. Two things are broken for them today:

1. The event page always says „Angenommen (Gast)“, also while the inviting
   registration is `pending` or on the waitlist (the colour follows the real
   status, the text does not).
2. With check-in running, a guest sees the code field, but
   `POST /api/events/:id/checkin` answers „Keine akzeptierte Anmeldung gefunden.“

The owner decided: **guests check in themselves** (they type the code on the event
page, like every participant), and **guests count like participants of their own**
everywhere attendance is counted. The owner uses the check-in numbers for
statistics and evaluations, so a guest who came must show up as a person who came.

## Goals

- The guest view shows the real status: „Ausstehend (Gast)“, „Angenommen (Gast)“,
  „Warteliste (Gast)“, and so on for every status of the inviting registration.
- An accepted guest (the inviting registration is `accepted`) checks in with the
  code on the event page and with the Discord button „Einchecken“. Same rules,
  same answers, same check-in message as for participants.
- Guests get the Discord check-in invitation DM like participants (once per guest).
- Admins tick guests off and take their check-in back in the registrations dialog,
  like participants.
- Every count of attendance treats an accepted guest as one participant:
  - event page check-in box for admins („3 / 5 eingecheckt“),
  - evaluations (`utils/insights.js`): accepted, checked in, no-shows, attendance
    rate per event, per category and in total; top members,
  - member overview (`utils/memberOverview.js`): Teilnahmen, Check-ins, No-Shows
    and the history of the guest,
  - the guest's own profile: numbers „Teilnahmen“ and „Check-ins“, the badges, and
    the event lists (the entry is marked as guest).

## Non-goals

- The inviting member does not check in their guests, and their own check-in does
  not check in the guests (each person counts for themself).
- No check-in for open guest invitations (`pendingGuests` with status `pending`):
  only guests listed in `guests` count.
- Slot events take no guests, so nothing changes there.
- No change to capacity: guests already hold places (`utils/capacity.js`).
- No migration: a registration without guest check-ins simply has none.

## Anti-goals

- A guest must never see or receive data of the inviting registration beyond what
  `my-registration` returns today (id and status) plus their own check-in fields.
- The check-in code must never leave the server in any response (security rule).
- Numbers must not mix persons and registrations (no „3 von 1 erschienen“).

## Data

A guest's check-in lives on the inviting registration, in a map keyed by the
guest's user id, with the same field names as a registration:

```js
guestCheckins: {
  '<guestUserId>': { checkedIn: true, checkedInAt: '<ISO>', checkinInvitedAt: '<ISO>' }
}
```

- Only entries whose id is in `guests` count; an entry of a guest who is no longer
  listed is ignored everywhere (and may be dropped on the next write).
- Writes to the map run inside `withEventLock(eventId, …)` (`utils/eventLock.js`),
  read the registration fresh and write the whole map, because the guest buttons
  (`bot/guests.js`) write the same document under the same lock.
- When the inviting registration leaves `accepted`, the guest check-ins are cleared
  together with the own one (same places that clear `checkedIn` today:
  `utils/registrationStatus.js`, the `clearCheckin` path in `routes/admin.js`,
  bulk actions). `checkinInvitedAt` stays, like on registrations.

## One view per person

A pure helper (new, in `utils/`) turns registrations into **participations**, one
per person:

- the registration itself for its member (unchanged fields), and
- one entry per guest in `guests`: `{ eventId, status (of the inviting
  registration), createdAt, source, userId: guestId, userName / avatar from
  `pendingGuests` when present, checkedIn / checkedInAt from `guestCheckins`,
  asGuest: true, registrationId, hostUserId }`.

Evaluations, member overview, profile numbers and the admin check-in box count
participations instead of registrations. Code that needs the registration itself
(status changes, form answers, capacity) stays on registrations.

Loading for one person (profile, member history) = own registrations plus the
registrations whose `guests` contain the person (`where('guests', 'array-contains', id)`,
as `my-registration` does), expanded and filtered to that person.

## Behaviour

### Event page (guest)

- `GET /api/events/:id/my-registration` for a guest also returns `checkedIn` and
  `checkedInAt` of the guest (nothing else new).
- Status line: `<status text> (Gast)` from the same texts as for participants
  („Ausstehend“, „Angenommen“, „Warteliste“, „Platz angeboten“, …). A guest of a
  waitlisted registration sees „Warteliste (Gast)“, not a waitlist position.
- Check-in box: exactly as for a participant when the inviting registration is
  `accepted`; otherwise no code field (as for a pending participant today).

### Check-in

- `checkInMember` (`utils/checkin.js`) first looks for the member's own accepted
  registration (unchanged); without one, for an accepted registration of the event
  whose `guests` contain the member, and checks the guest in there. Results and
  error codes are the same, so the code route and the Discord button need no new
  texts. Already checked in → `alreadyCheckedIn`.
- `listCheckinInvitees` also lists accepted guests that are neither checked in nor
  invited; `markInvited` writes the guest's `checkinInvitedAt`. The scheduler and
  `sendCheckinInvitations` send them the same DM.

### Admin

- `GET /api/admin/events/:id/checkin-stats`: `total` and `checkedIn` count persons
  (accepted registrations plus their guests).
- Registrations dialog: each guest of a registration is shown by name (from
  `pendingGuests`, the id as fallback — today the raw ids are shown) with the same
  check-in toggle as participants, for accepted registrations.
- `PUT /api/admin/registrations/:id/checkin` takes an optional `guestId`: then it
  ticks off / takes back that guest (must be in `guests`; the registration must be
  `accepted`, as today). Audit log `CHECKIN_REGISTRATION` /
  `UNDO_CHECKIN_REGISTRATION` naming the guest.
- CSV export: a column with the number of checked-in guests (builder's call on the
  exact header).

### Calls made while writing this (not asked)

- **Profile numbers:** „Anmeldungen“, the badges „Newcomer“ and „Early Bird“ and
  `lastActivity` stay on the person's own registrations (a guest did not register).
  „Teilnahmen“, „Check-ins“ and the badges built on them (Regular, Veteran, Legende,
  Perfect Attendance, Streak) count guest participations.
- **Member overview:** the number „Anmeldungen“ stays own registrations; Teilnahmen,
  Check-ins and No-Shows count guest participations; the history lists them, marked
  as guest.
- **Profile lists:** a guest entry is marked „Gast“ and offers no own-registration
  actions (no unregister, no slot); it links to the event, where the guest checks in.
- **Evaluations:** `accepted` per event becomes persons; `placesTaken` keeps its
  rule (it already counts guests through `placesOf`). Top members count a guest's
  participations for the guest.
- **Guests in other DMs:** only the check-in invitation is new; start reminders and
  change DMs stay as they are.

## Constraints

- Project rules in `CLAUDE.md`: data only through `firebaseAdmin.js`, German user
  texts, `try/catch` per route, admin mutations audited, tests first with
  `node:test`, wiki updated in the same commit, `npm run wiki`.
- Discord calls stay in `bot/` with the mock twin in `dev/mockBot.js`.
- Mock mode should show the case: persona `newbie` (Neo) is a guest of Chiara's
  pending registration for „Streaming-Setup“ (seed). A seeded accepted guest case
  helps to try check-in (builder's call).

## Left to the builder

- Name and file of the participations helper and where the per-person loader lives.
- How the registrations dialog lays out guest rows (existing components only).
- Whether stale `guestCheckins` entries are dropped on write.
- Exact CSV header.
