---
id: routes-events
title: routes/events.js — public and member event endpoints
type: module
tags: [api, events, registration, checkin, comments, series, participants]
sources: [routes/events.js, utils/registrationService.js, utils/eventUtils.js]
part_of: [architecture]
depends_on: [middleware, utils, data-layer, bot]
see_also: [registration-flow, event-lifecycle, api-index]
---
# routes/events.js — public and member event endpoints

> TL;DR: Mounted at `/api/events`. Lists and reads events (publicly), and lets logged-in members register/unregister, check in with a code, see participants and write comments. Registration logic itself lives in `utils/registrationService.js`.

## Endpoints

| Method | Path | Auth | Behaviour |
|---|---|---|---|
| GET | `/` | none | active events (`?status=` other than `active` needs admin → 403), `?category=`, `?search=` (title/description), `?page`/`?limit` (default 20); adds `currentParticipants` (and `slotSummary` for slot events); series collapsed to one representative with `seriesDates[]`; sorted by `startDate` |
| GET | `/series/:seriesId` | none | all events of a series with `currentParticipants` (+ `slotSummary`), sorted by start |
| GET | `/categories` | none | sorted unique `category` values of ALL events |
| GET | `/form-options` | user | `{ roles (non-managed), channels (public only) }` for form pickers; cached 60 s in memory |
| GET | `/:id` | none | event via `toPublicEvent` (no `checkinCode`), plus `checkinEnabled`, `currentParticipants`, `waitlistCount`, `createdByName`, `slotSummary` (slot events) |
| POST | `/:id/register` | user + `checkRegistrationAllowed` | body `{ formAnswers, guests, slotId, altSlotIds }` → `registerUserForEvent` → `{ id, status, message, slotId, isAlt }` or `{ error }` with mapped HTTP status |
| PUT | `/:id/register/slot` | user + `checkRegistrationAllowed` | body `{ slotId }` → `switchOwnSlot` (free slots only, 409 when full) → `{ status, slotId, message }` |
| DELETE | `/:id/register` | user | `unregisterUserFromEvent`: deletes the own registration, removes role/channel access if it was accepted, promotes the waitlist, refreshes announcements |
| GET | `/:id/my-registration` | user | own registration, or `{ asGuest: true, ... }` when the user is an accepted guest of someone else, or `{ registered: false }` |
| GET | `/:id/participants` | user | first 20 accepted participants `{ displayName, avatar }` + `total`; slot events also get `slots` (line-up with members) and `waitlist` |
| POST | `/:id/checkin` | user | body `{ code }`; requires `checkinEnabled` + matching `checkinCode` + own accepted registration; sets `checkedIn`, `checkedInAt` |
| GET | `/:id/comments` | user | comments of the event, sorted by `createdAt` ascending |
| POST | `/:id/comments` | user | body `{ text (≤1000), replyTo }` |
| DELETE | `/:id/comments/:commentId` | user (owner or admin) | deletes one comment |

## Where in code

grep `router.(get|post|put|delete)\('` in `routes/events.js`; handler order matters (see gotchas).

## Gotchas

- **Route order:** `/series/:seriesId`, `/categories` and `/form-options` are declared BEFORE `/:id`; new static paths must also go above `/:id`, otherwise `/:id` swallows them.
- Every handler builds event answers with `toPublicEvent` (`utils/eventUtils.js`), which drops `checkinCode`.
- `GET /:id` does not check `status` — draft/cancelled events are readable by id (rest of audit C-02; the list filter itself is fixed). The frontend's `?status=all` query is ignored there.
- `my-registration` for guests spreads the registrant's whole document (incl. `formAnswers`) into the response (audit H-04, open).
- Comment avatars: `POST /:id/comments` treats `session.user.avatar` as an avatar *hash*, but the session stores a full URL → broken image URL. See [known-issues](../reference/known-issues.md).
- Participant counts include accepted guests (`1 + guests.length`) — keep that rule when adding counters.
