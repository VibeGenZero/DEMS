---
id: routes-events
title: routes/events.js — event endpoints for logged-in members
type: module
tags: [api, events, registration, checkin, comments, series, participants]
sources: [routes/events.js, utils/checkin.js, utils/threadSync.js, utils/registrationService.js, utils/eventUtils.js, utils/eventListing.js, utils/waitlistOffers.js, utils/tentativeRegistration.js]
part_of: [architecture]
depends_on: [middleware, utils, data-layer, bot]
see_also: [registration-flow, event-lifecycle, api-index]
---
# routes/events.js — event endpoints for logged-in members

> TL;DR: Mounted at `/api/events`. Every route needs a login (`router.use(requireAuth)`, no public preview); `router.param('id')` answers 404 to non-admins for `draft`/`archived` events on every `/:id` route. Lists and reads events, and lets members register/unregister, check in with a code, see participants and write comments. Registration logic itself lives in `utils/registrationService.js`.

## Endpoints

| Method | Path | Auth | Behaviour |
|---|---|---|---|
| GET | `/` | user | active events (`?status=` other than `active` needs admin → 403), `?upcoming=1` (overview: drops events whose end — `endDate`, else start + 2 h, `isEventOver` — has passed, before series are grouped), `?category=`, `?search=` (title/description), `?page`/`?limit` (default 20); adds `currentParticipants` (= `places.taken`: accepted and pending registrations with their guests and open guest invitations), `places` (built by `describePlaces`: `taken`, `capacity`, `guests`, `pending`, `waitlist`, the sentence `text` e.g. "5 von 20 Plätzen belegt (inkl. 1 Gast, 1 Anfrage offen)" and `waitlistText`), `myStatus` (`myRegistrationStatus`: own `accepted`/`pending`/`waitlisted`, `guest` in an accepted or pending registration of someone else, else `null`) and `slotSummary` for slot events; series collapsed to one representative (`pickSeriesRepresentative`: first date not over, a running one included) with `seriesDates[]`; sorted by `startDate` |
| GET | `/series/:seriesId` | user | all events of a series visible to the user (no `draft`/`archived` for non-admins) with `currentParticipants`, `places` (+ `slotSummary`), sorted by start |
| GET | `/form-options` | user | `{ roles (non-managed), channels (public only) }` for form pickers; cached 60 s in memory |
| GET | `/:id` | user | event via `toPublicEvent` (no `checkinCode`), plus `checkinEnabled`, `currentParticipants`, `places` (as in the list), `waitlistCount` (= `places.waitlist`), `createdByName`, `slotSummary` (slot events) |
| POST | `/:id/register` | user + `checkRegistrationAllowed` | body `{ formAnswers, guests, slotId, altSlotIds, tentative }` (`tentative: true` = „Vielleicht“, B-17) → `registerUserForEvent` → `{ id, status, message, slotId, isAlt }` or `{ error }` with mapped HTTP status |
| PUT | `/:id/register/slot` | user + `checkRegistrationAllowed` | body `{ slotId }` → `switchOwnSlot` (free slots only, 409 when full; 400 after the end or the registration deadline) → `{ status, slotId, message }` |
| POST | `/:id/register/confirm` | user + `checkRegistrationAllowed` | „Fest zusagen“ (B-17): `confirmTentativeRegistration` (`utils/tentativeRegistration.js`) → `{ id, status, message, slotId }`; 400 „Du stehst nicht auf der Ersatzbank.“ (`not_tentative`), `event_ended` / `registration_closed` / `event_inactive` with their messages |
| POST | `/:id/offer/confirm`, `/:id/offer/decline` | user + `checkRegistrationAllowed` | own registration (`findUserRegistration`) → `confirmOffer` / `declineOffer` (B-15); `{ success: true, status }` / `{ success: true }`; 404 „Keine Anmeldung gefunden.“, 409 „Das Angebot ist nicht mehr gültig.“ (expired, not offered) |
| DELETE | `/:id/register` | user | `unregisterUserFromEvent`: 400 "Abmelden ist nicht mehr möglich. Wende dich an einen Admin." once the `unregisterDeadline` has passed (W-03); otherwise deletes the own registration, removes role/channel access if it was accepted, promotes the waitlist, refreshes announcements |
| GET | `/:id/my-registration` | user | own registration (a waitlisted one also `waitlistPosition: { position, total }`, W-05; only the own place, never other members' times), or only `{ registered: true, asGuest: true, id, status, checkedIn, checkedInAt }` of the inviting registration when the user is a guest — status and id of that registration (an accepted one first when they are the guest of two), check-in of the guest (#110); never its `formAnswers` or guest list, or `{ registered: false }` |
| GET | `/:id/participants` | user | first 20 accepted participants `{ displayName, avatar }` + `total`; `bench` = tentative registrations (B-17), oldest „Vielleicht“ first, `{ displayName, avatar }` plus `preferredSlotId` on slot events (`loadBench`, no ids, times or answers); slot events also get `slots` (line-up with members) and `waitlist` |
| POST | `/:id/checkin` | user + `checkinLimiter` (10 failed attempts / 15 min per member, also in mock mode → 429 "Zu viele Check-in-Versuche …") | body `{ code }`; requires `checkinEnabled` + matching `checkinCode` + own accepted registration; sets `checkedIn`, `checkedInAt` through `checkInMember` (`utils/checkin.js`, shared with the Discord button of B-07; no time window here); a repeat answers `alreadyCheckedIn: true` |
| GET | `/:id/comments` | user | comments of the event, sorted by `createdAt` ascending, incl. `source`, `discordMessageId`, `editedAt` (B-16) |
| POST | `/:id/comments` | user | body `{ text (≤1000), replyTo }`; stores `source: 'web'` and mirrors the comment into the event's Discord thread (`mirrorCommentToThread`, fire and forget, B-16) |
| DELETE | `/:id/comments/:commentId` | user (owner or admin) | deletes one comment and, when it has a `discordMessageId`, its Discord message (`deleteMirroredMessage`, fire and forget, B-16) |

## Where in code

grep `router.(get|post|put|delete)\('` in `routes/events.js`; handler order matters (see gotchas).

## Gotchas

- **Route order:** `/series/:seriesId` and `/form-options` are declared BEFORE `/:id`; new static paths must also go above `/:id`, otherwise `/:id` swallows them.
- Every handler builds event answers with `toPublicEvent` (`utils/eventUtils.js`), which drops `checkinCode`.
- `router.param('id')` loads the event once more before each `/:id` handler; unknown ids pass through, so handlers keep their own "not found" answers. `cancelled` events stay readable by id. The frontend's `?status=all` query is ignored by `GET /:id`.
- Comment avatars: `session.user.avatar` is already a complete URL → `POST /:id/comments` stores it as is (`avatarUrlOf`); `GET /:id/comments` unwraps URLs that older versions stored wrapped into a second one (`repairAvatarUrl`, `utils/avatar.js`). The stored documents are not rewritten.
- Participant counts include accepted guests (`1 + guests.length`) — keep that rule when adding counters.
