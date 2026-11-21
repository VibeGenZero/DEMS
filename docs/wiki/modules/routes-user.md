---
id: routes-user
title: routes/user.js — profile, badges, settings, account
type: module
tags: [api, user, profile, badges, settings, guests, gdpr]
sources: [routes/user.js, plugin-sdk/host.js, utils/profileEvents.js, utils/notificationPrefs.js, utils/userProfile.js, utils/calendarFeed.js, utils/calendarFeedStore.js, routes/calendar.js]
part_of: [architecture]
depends_on: [middleware, data-layer]
see_also: [api-index, data-model]
---
# routes/user.js — profile, badges, settings, account

> TL;DR: Mounted at `/api/user`, every route needs a logged-in user. Provides the user's registrations, a profile with stats, computed badges and the member's events split into upcoming and history, a user search for guest invitations, the settings (`acceptInvitations` and the DM choices of W-16), the member's calendar subscription and full account deletion.

## Endpoints

| Method | Path | Behaviour |
|---|---|---|
| POST | `/privacy/accept` | #138: `{ version }` — the current privacy policy version only (409 with a German error and `version` otherwise, also without a policy); stores `privacyAcceptedVersion` + `privacyAcceptedAt` (`savePrivacyAcceptance` of `utils/userProfile.js`) and the version in the session → `{ success, version, acceptedAt }`; reachable while the consent gate is closed |
| GET | `/registrations` | own registrations with embedded `event` (via `toPublicEvent`, no `checkinCode`), newest first |
| GET | `/profile` | `{ user, upcoming, history, stats, badges, unlockedBadges, totalBadges }`; see "Profile lists" |
| GET | `/search?q=` | ≥2 chars; users matching `displayName`/`username`, excluding self and users with `acceptInvitations === false`; max 10 |
| GET | `/settings` | `{ acceptInvitations, notifications: { reminders, changes, waitlist } }`; every value defaults to true (`normalizeNotificationPrefs`) |
| PUT | `/settings` | body `{ acceptInvitations?, notifications?: { reminders?, changes?, waitlist? } }`; changes only boolean values it receives (text, numbers and unknown kinds are ignored, a missing `acceptInvitations` no longer resets it), answers the new settings like `GET`; 404 without a users document |
| GET | `/calendar` | own calendar subscription: `{ enabled: false }` or `{ enabled: true, url, webcalUrl, googleUrl, createdAt }` (links from `buildCalendarFeedUrls` in `utils/eventUrl.js`); see "Calendar subscription" |
| POST | `/calendar` | sets the subscription up or renews it: a new token every time, the old link answers 404 at once; answers like `GET` |
| DELETE | `/calendar` | ends the subscription → `{ enabled: false }` |
| DELETE | `/account` | batch-deletes own registrations + `users/{id}` + `calendarFeeds/{id}`, promotes waitlists, deletes own date poll votes (`deleteUserPollVotes`), deletes the member's plugin documents (`pluginHost().purgeUser(userId)`: every document with `userId` = the member in every plugin collection, plugin on, off or orphaned), emits the plugin hook `member.deleted` `{ userId }` (`safeEmit`), destroys session; poll and plugin failures are logged and never fail the deletion |

## Profile lists (`utils/profileEvents.js`)

`buildProfileEvents(registrations, eventsById, now)` splits the member's own registrations (every status, also `rejected`) and their guest places on other members' registrations (`loadUserParticipations` in `utils/eventUtils.js`; entries carry `asGuest`, the page shows a chip „Gast“, #110). Stats: `total`, Newcomer, Early Bird and Multitasker count own registrations only; `accepted` (Teilnahmen), `checkedIn` and the other badges count guest places too:

| List | Contains | Order |
|---|---|---|
| `history` | event deleted, `cancelled`, `archived` or over (`isEventOver`) | latest event start first; without an event or a start the registration's `createdAt` |
| `upcoming` | everything else: running events, events without a date, drafts | next start first; without a start last; equal starts by `createdAt` |

An entry is `{ id, status, checkedIn, createdAt, slot, waitlistPosition, event }`; `waitlistPosition` is `{ position, total }` for an upcoming waitlisted registration of an active event (one `loadEventRegistrations` per such event, W-05), else `null`. `event` is `{ id, title, startDate, endDate, status, category, location, checkinEnabled }` or `null` for a deleted event: `location` is the text only, `checkinEnabled` is true when the switch is on and a code exists. `slot` is `{ name, emoji, wish }`: the slot taken (`wish: false`), for a pending or waitlisted registration without a slot its main role (`wish: true`), else `null`.

## Calendar subscription

A member's personal iCalendar feed for Google, Apple and Outlook Calendar (OpenSpec `calendar-subscription`). The stored feed is `calendarFeeds/<userId>` = `{ userId, token, createdAt }` (`utils/calendarFeedStore.js`, see [data-model](../concepts/data-model.md)); the feed itself is `GET /calendar/<token>.ics` in `routes/calendar.js`, outside `/api` and without a session (see [server](server.md)).

| Link | Value |
|---|---|
| `url` | `<BASE_URL>/calendar/<token>.ics` |
| `webcalUrl` | the same with `webcal://` (Apple Calendar, Outlook) |
| `googleUrl` | `https://calendar.google.com/calendar/r?cid=<webcalUrl, encoded>` — Google fetches the feed itself, so it only works for an installation on public HTTPS |

Content (`buildFeedEntries` in `utils/calendarFeed.js`, pure): one entry per participation (`loadUserParticipations`: own registrations and guest places, one per event), earliest start first. Left out: `rejected`, deleted events, drafts, events without a readable start, events that started more than 30 days ago. Entry: `UID` `<eventId>@<host of BASE_URL>` (a moved date updates the same calendar entry), start, end (`eventEndTime`: end, else start + 2 h), location text, event link (`buildEventUrl`), `LAST-MODIFIED` from `updatedAt`. Status and title mark:

| Registration | `STATUS` | Title |
|---|---|---|
| `accepted` | `CONFIRMED` | plain title |
| `pending` / `waitlisted` / `offered` / `tentative` | `TENTATIVE` | „[Ausstehend]“ / „[Warteliste]“ / „[Nachrücken bestätigen]“ / „[Vielleicht]“ + title |
| any, event `cancelled` | `CANCELLED` | „[Abgesagt]“ + title |

The description says „Status: …“, for a guest place „Du bist Gast von <Name>.“ (`hostUserName` of the participation), then the event link; the event description is not included. The iCalendar text comes from `utils/icalendar.js` (escaping, folding at 75 octets without splitting a character, CRLF; no dependency).

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

After the built-in badges come the badges of switched-on plugins (SDK 1.1, `ctx.profile.badges`): `pluginBadgesFor(userId)` asks every provider in parallel through `collectPluginBadges` (`plugin-sdk/profile.js`, 2 s each, invalid entries dropped, ids `p:<plugin>:<id>`); `unlockedBadges`/`totalBadges` count them. No plugin host (tests, a start that failed) or safe mode → none. See [plugin-sdk](../concepts/plugin-sdk.md).

## Gotchas

- Comments and guest references to a deleted user are not removed by `DELETE /account`.
- `/search` exposes every user who accepts invitations to any logged-in member (audit M-07).
- Events are loaded one by one per registration (no batching) — fine for small data.
