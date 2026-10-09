---
id: routes-events
title: routes/events.js — event endpoints for logged-in members
type: module
tags: [api, events, registration, checkin, comments, series, participants]
sources: [routes/events.js, utils/registrationService.js, utils/eventUtils.js]
part_of: [architecture]
depends_on: [middleware, utils, data-layer, bot]
see_also: [registration-flow, event-lifecycle, api-index]
---
# routes/events.js — event endpoints for logged-in members

> TL;DR: Mounted at `/api/events`. Every route needs a login (`router.use(requireAuth)`, no public preview); `router.param('id')` answers 404 to non-admins for `draft`/`archived` events on every `/:id` route. Lists and reads events, and lets members register/unregister, check in with a code, see participants and write comments. Registration logic itself lives in `utils/registrationService.js`.

## Endpoints

| Method | Path | Auth | Behaviour |
|---|---|---|---|
| GET | `/` | user | active events (`?status=` other than `active` needs admin → 403), `?category=`, `?search=` (title/description), `?page`/`?limit` (default 20); adds `currentParticipants` (and `slotSummary` for slot events); series collapsed to one representative with `seriesDates[]`; sorted by `startDate` |
| GET | `/series/:seriesId` | user | all events of a series visible to the user (no `draft`/`archived` for non-admins) with `currentParticipants` (+ `slotSummary`), sorted by start |
| GET | `/categories` | user | sorted unique `category` values of ALL events |
| GET | `/form-options` | user | `{ roles (non-managed), channels (public only) }` for form pickers; cached 60 s in memory |
| GET | `/:id` | user | event via `toPublicEvent` (no `checkinCode`), plus `checkinEnabled`, `currentParticipants`, `waitlistCount`, `createdByName`, `slotSummary` (slot events) |
| POST | `/:id/register` | user + `checkRegistrationAllowed` | body `{ formAnswers, guests, slotId, altSlotIds }` → `registerUserForEvent` → `{ id, status, message, slotId, isAlt }` or `{ error }` with mapped HTTP status |
| PUT | `/:id/register/slot` | user + `checkRegistrationAllowed` | body `{ slotId }` → `switchOwnSlot` (free slots only, 409 when full) → `{ status, slotId, message }` |
| DELETE | `/:id/register` | user | `unregisterUserFromEvent`: deletes the own registration, removes role/channel access if it was accepted, promotes the waitlist, refreshes announcements |
| GET | `/:id/my-registration` | user | own registration, or only `{ registered: true, asGuest: true, id, status }` of the inviting registration when the user is an accepted guest (never its `formAnswers` or guest list), or `{ registered: false }` |
| GET | `/:id/participants` | user | first 20 accepted participants `{ displayName, avatar }` + `total`; slot events also get `slots` (line-up with members) and `waitlist` |
| POST | `/:id/checkin` | user + `checkinLimiter` (10 failed attempts / 15 min per member, also in mock mode → 429 "Zu viele Check-in-Versuche …") | body `{ code }`; requires `checkinEnabled` + matching `checkinCode` + own accepted registration; sets `checkedIn`, `checkedInAt` |
| GET | `/:id/comments` | user | comments of the event, sorted by `createdAt` ascending |
| POST | `/:id/comments` | user | body `{ text (≤1000), replyTo }` |
| DELETE | `/:id/comments/:commentId` | user (owner or admin) | deletes one comment |

## Where in code

grep `router.(get|post|put|delete)\('` in `routes/events.js`; handler order matters (see gotchas).

## Gotchas

- **Route order:** `/series/:seriesId`, `/categories` and `/form-options` are declared BEFORE `/:id`; new static paths must also go above `/:id`, otherwise `/:id` swallows them.
- Every handler builds event answers with `toPublicEvent` (`utils/eventUtils.js`), which drops `checkinCode`.
- `router.param('id')` loads the event once more before each `/:id` handler; unknown ids pass through, so handlers keep their own "not found" answers. `cancelled` events stay readable by id. The frontend's `?status=all` query is ignored by `GET /:id`.
- Comment avatars: `session.user.avatar` is already a complete URL → `POST /:id/comments` stores it as is (`avatarUrlOf`); `GET /:id/comments` unwraps URLs that older versions stored wrapped into a second one (`repairAvatarUrl`, `utils/avatar.js`). The stored documents are not rewritten.
- Participant counts include accepted guests (`1 + guests.length`) — keep that rule when adding counters.
