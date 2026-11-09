---
id: routes-user
title: routes/user.js — profile, badges, settings, account
type: module
tags: [api, user, profile, badges, settings, guests, gdpr]
sources: [routes/user.js, utils/profileEvents.js, utils/notificationPrefs.js, utils/userProfile.js]
part_of: [architecture]
depends_on: [middleware, data-layer]
see_also: [api-index, data-model]
---
# routes/user.js — profile, badges, settings, account

> TL;DR: Mounted at `/api/user`, every route needs a logged-in user. Provides the user's registrations, a profile with stats, computed badges and the member's events split into upcoming and history, a user search for guest invitations, the settings (`acceptInvitations` and the DM choices of W-16) and full account deletion.

## Endpoints

| Method | Path | Behaviour |
|---|---|---|
| POST | `/privacy/accept` | #138: `{ version }` — the current privacy policy version only (409 with a German error and `version` otherwise, also without a policy); stores `privacyAcceptedVersion` + `privacyAcceptedAt` (`savePrivacyAcceptance` of `utils/userProfile.js`) and the version in the session → `{ success, version, acceptedAt }`; reachable while the consent gate is closed |
| GET | `/registrations` | own registrations with embedded `event` (via `toPublicEvent`, no `checkinCode`), newest first |
| GET | `/profile` | `{ user, upcoming, history, stats, badges, unlockedBadges, totalBadges }`; see "Profile lists" |
| GET | `/search?q=` | ≥2 chars; users matching `displayName`/`username`, excluding self and users with `acceptInvitations === false`; max 10 |
| GET | `/settings` | `{ acceptInvitations, notifications: { reminders, changes, waitlist } }`; every value defaults to true (`normalizeNotificationPrefs`) |
| PUT | `/settings` | body `{ acceptInvitations?, notifications?: { reminders?, changes?, waitlist? } }`; changes only boolean values it receives (text, numbers and unknown kinds are ignored, a missing `acceptInvitations` no longer resets it), answers the new settings like `GET`; 404 without a users document |
| DELETE | `/account` | batch-deletes own registrations + `users/{id}`, promotes waitlists, deletes own date poll votes (`deleteUserPollVotes`), destroys session |

## Profile lists (`utils/profileEvents.js`)

`buildProfileEvents(registrations, eventsById, now)` splits the member's own registrations (every status, also `rejected`):

| List | Contains | Order |
|---|---|---|
| `history` | event deleted, `cancelled`, `archived` or over (`isEventOver`) | latest event start first; without an event or a start the registration's `createdAt` |
| `upcoming` | everything else: running events, events without a date, drafts | next start first; without a start last; equal starts by `createdAt` |

An entry is `{ id, status, checkedIn, createdAt, slot, waitlistPosition, event }`; `waitlistPosition` is `{ position, total }` for an upcoming waitlisted registration of an active event (one `loadEventRegistrations` per such event, W-05), else `null`. `event` is `{ id, title, startDate, endDate, status, category, location, checkinEnabled }` or `null` for a deleted event: `location` is the text only, `checkinEnabled` is true when the switch is on and a code exists. `slot` is `{ name, emoji, wish }`: the slot taken (`wish: false`), for a pending or waitlisted registration without a slot its main role (`wish: true`), else `null`.

## Badges (computed on every `/profile` call, never stored)

| id | Rule |
|---|---|
| `newcomer` | ≥1 registration |
| `early-bird` | registered within 1 h after the event's `createdAt` |
| `regular` / `veteran` / `legend` | ≥5 / ≥10 / ≥20 accepted registrations (with `progress` 0–1) |
| `perfect-attendance` | ≥3 check-ins |
| `streak-master` | ≥3 accepted events in a row, each ≤30 days apart |
| `multitasker` | ≥3 upcoming accepted/pending registrations |

Badge texts are German; icons are Bootstrap Icons class names (`bi-*`); `test/vendorAssets.test.js` checks that each one exists in the vendored font.

## Gotchas

- Comments and guest references to a deleted user are not removed by `DELETE /account`.
- `/search` exposes every user who accepts invitations to any logged-in member (audit M-07).
- Events are loaded one by one per registration (no batching) — fine for small data.
