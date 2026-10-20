---
id: utils
title: utils/ — domain helpers
type: module
tags: [utils, registration, form-fields, waitlist, audit-log, profile, debug]
sources: [utils/registrationService.js, utils/formFields.js, utils/eventUtils.js, utils/eventListing.js, utils/profileEvents.js, utils/eventUrl.js, utils/userProfile.js, utils/avatar.js, utils/botPermissions.js, utils/csv.js, utils/template.js, utils/sessionStore.js, utils/reminders.js, utils/debugLog.js, utils/capacity.js, utils/slotService.js, utils/eventLock.js, utils/announcementRefresh.js, utils/pollService.js, utils/pollStore.js, utils/eventPreview.js, utils/eventArchive.js]
part_of: [architecture]
depends_on: [data-layer, bot]
see_also: [registration-flow, form-fields, role-slots]
---
# utils/ — domain helpers

> TL;DR: Shared domain logic used by routes and the bot: `registrationService.js` (the single source of truth for creating registrations), `formFields.js` (field types and answer format), `eventUtils.js` (loading registrations/line-ups, waitlist promotion, audit log), `capacity.js` and `slotService.js` (pure place and slot rules), `eventLock.js` (per-event lock), `announcementRefresh.js` (debounced live announcements), `eventUrl.js` (links to event pages), `profileEvents.js` (upcoming and history lists of the profile), `userProfile.js` (users upsert after login) and `debugLog.js` (`DEBUG_MODE` logger).

## utils/registrationService.js

| Export | Contract |
|---|---|
| `registerUserForEvent({ eventId, user: { id, displayName, roles }, formAnswers, guests, source, slotId, altSlotIds })` | returns `{ ok: true, id, status, message, event, slotId, isAlt }` or `{ ok: false, code, httpStatus, error }`; validation + write under `withEventLock` |
| `switchOwnSlot({ eventId, userId, slotId })` | member moves into a free slot (becomes the main role; waitlisted members get the place) → `{ ok, status, slotId, message }` |
| `moveRegistrationToSlot({ registrationId, slotId })` | admin move, may overbook → `{ ok, slotId, slotName, userName, warning }` |
| `unregisterUserFromEvent({ eventId, userId })` | deletes the registration, removes role + channel access (accepted), promotes the waitlist → `{ ok, registration, event }` |
| `buildTemplateVars({ user, eventId, event, slot })` | variables for `parseTemplate` incl. `slot.name`, `slot.emoji` |
| `REGISTRATION_SOURCE` | `WEB: 'web'`, `DISCORD: 'discord'` |
| `REGISTRATION_STATUS` | `PENDING`, `ACCEPTED`, `WAITLISTED` |
| `REGISTRATION_ERROR` | `event_not_found` 404, `event_inactive` 400, `already_registered` 400, `missing_role` 403, `guests_not_allowed` 400, `missing_fields` 400, `invalid_slot` 400, `slot_full` 409, `not_registered` 404, `not_movable` 400, `registration_failed` 500 |

Used by `POST /api/events/:id/register` and by the Discord button/modal. Rules: [registration-flow](../concepts/registration-flow.md).

## utils/formFields.js

Exports `FORM_FIELD_TYPE` (`text, textarea, dropdown, checkbox, user, role, channel, mentionable`), `FORM_FIELD_TYPES`, `ENTITY_FIELD_TYPES`, `MODAL_MAX_FIELDS = 5`, `getModalFieldLimit` (4 for slot events with more than one slot), `getFormFields`, `getFieldType`, `isEntityFieldType`, `formatEntityAnswer`, `fitsIntoDiscordModal`, `findMissingRequiredFields`. Details: [form-fields](../concepts/form-fields.md).

## utils/eventUtils.js

| Export | Behaviour |
|---|---|
| `promoteFromWaitlist(eventId, event)` | takes the event lock; slot events: oldest waitlist entries whose main/fallback slot is free move up (`pickWaitlistPromotions`); other events: every waitlisted registration whose places (guests counted) still fit (`pickCapacityPromotions`); status `accepted` (instant) or `pending`; DMs, role, channel access, announcement refresh; nobody moves up once the event is over (`isEventOver`, W-01); never throws |
| `promoteFromWaitlistLocked(eventId, event)` / `announcePromotions(eventId, event, promotions)` | the two halves for callers that already hold the lock |
| `isEventVisibleTo(user, event)` | false for `draft`/`archived` (`ADMIN_ONLY_STATUSES`) unless `user.isAdmin`; used by `routes/events.js` |
| `toPublicEvent(eventId, event)` | `{ id, ...event }` without `PRIVATE_EVENT_FIELDS` (`checkinCode`); use for every event answer outside the admin area |
| `loadEventRegistrations(eventId)`, `findUserRegistration(eventId, userId)`, `loadEventRoster(eventId, event, { withProfiles })` | registrations with `id`; line-up via `buildRoster` |
| `saveEventWithSlots(eventId, rawSlots, buildUpdates)` | under the event lock: `normalizeSlots` + `validateSlotChange`, then writes `buildUpdates(slots, oldEvent)` → `{ ok, oldEvent, updates }` or `{ ok: false, error }` |
| `addAuditLog(action, adminId, details, targetId = null)` | writes `auditLogs` `{ action, adminId, details, targetId, timestamp }`; errors only logged |

## utils/eventListing.js (pure)

| Export | Behaviour |
|---|---|
| `parseDate(value)` | `Date` or `null`; accepts the older format with a space instead of `T` |
| `eventEndTime(event)` | `endDate`, else start + 2 h (`DEFAULT_DURATION_MS`); an `endDate` before the start counts as missing; `null` without a valid `startDate` (a space instead of `T` is accepted) |
| `isEventOver(event, now)` | end before `now`; an event without a date counts as upcoming. Used by `GET /api/events?upcoming=1`, the registration (`event_ended`), the Discord buttons and modals, `getRunningEvents` and the bot's auto status; `public/js/events/cards.js` applies the same rule in the browser |
| `pickSeriesRepresentative(seriesEvents, now)` | the date that stands for a series in `GET /api/events`: the first one that is not over (a running date included, so the overview shows "Läuft gerade"), else the last |
| `myRegistrationStatus(registrations, userId)` | `myStatus` of the event list: own `accepted`/`pending`/`waitlisted`, else `guest` in an accepted or pending registration of someone else, else `null` |

## utils/eventArchive.js (scheduler)

| Export | Behaviour |
|---|---|
| `ARCHIVE_DELAY_MS`, `ARCHIVE_INTERVAL_MS` | 24 h after the end; a run every 5 min |
| `isDueForArchive(event, now)` | `status === 'active'` and `now` at least 24 h after `eventEndTime`; false without a start |
| `archiveEndedEvents({ now })` | archives every due event (`status`, `updatedAt`), audit `AUTO_ARCHIVE_EVENT` by `system`, `notifyRegistrationsChanged`; one failing event does not stop the others; returns the count |
| `startArchiveScheduler({ waitFor })`, `stopArchiveScheduler()` | first run once `waitFor` settles (`server.js` passes `whenBotSettled()`, so the announcement refresh of the catch-up run finds a ready bot), then the interval (`unref`'d); a stop before that cancels the first run. Rules: [event-lifecycle](../concepts/event-lifecycle.md) |

## utils/profileEvents.js (pure)

| Export | Behaviour |
|---|---|
| `buildProfileEvents(registrations, eventsById, now, waitlistPositionsById)` | `{ upcoming, history }` for `GET /api/user/profile`; rules in [routes-user](routes-user.md) |
| `toProfileEntry(registration, event, waitlistPosition)` | one entry: registration status, check-in, slot (`getSlots`/`findSlot`), waitlist place (or `null`) and eight event fields; never the check-in code |

## utils/capacity.js, utils/slotService.js (pure)

`capacity.js`: `OCCUPYING_STATUSES`, `placesOf`, `countOccupiedPlaces`, `byCreatedAt`, `waitlistPositions(registrations)` (W-05: `Map` id → `{ position, total }` over the waitlisted registrations, oldest first, ties by id; slot events use the same single list), `pickCapacityPromotions`; for the display `summarizePlaces(registrations, maxParticipants)` → `{ taken, capacity, guests, pending, waitlist }` (guests include open invitations), `formatPlaces(places)` → the one places sentence for website and Discord ("5 von 20 Plätzen belegt (inkl. 1 Gast, 1 Anfrage offen)", without a limit "5 Plätze belegt") and `formatWaitlist(n)` ("3 auf der Warteliste"). `describePlaces(registrations, maxParticipants)` returns the numbers together with `text` and `waitlistText`; `GET /api/events` and `GET /api/admin/all-events` put exactly this object into `places`. `slotService.js`: `getSlots`, `hasSlots`, `findSlot`, `formatSlotLabel`, `normalizeSlots`, `countSlotOccupancy`, `hasFreePlace`, `sanitizeAltSlotIds`, `pickSlot`, `pickWaitlistPromotions`, `resolveAcceptanceSlot`, `buildSlotSummary`, `withSlotSummary`, `buildRoster`, `validateSlotChange`. Rules: [role-slots](../concepts/role-slots.md).

## utils/eventLock.js

`withEventLock(eventId, fn)` runs `fn` after all earlier work for the same event (in-memory promise chain; DEMS is a single process). Not reentrant.

## utils/announcementRefresh.js

`notifyRegistrationsChanged(eventId)` bundles calls per event (2 s trailing debounce, timers `unref`'d) and then calls `bot.refreshEventAnnouncements(eventId)`; errors are only logged. `flushAnnouncementRefreshes()` runs pending refreshes at once; `createAnnouncementRefresher({ refresh, delayMs })` for tests. A second instance, `notifyPollChanged(pollId)` / `flushPollRefreshes()`, refreshes posted date polls via `bot.refreshPollMessages`.

## utils/pollService.js, utils/pollStore.js

`pollService.js` (pure): `normalizePollInput`, `normalizeVote`, `isPollOpen`, `effectivePollStatus`, `canVote`, `tallyPoll`, `rankOptions`, `getFavoriteOptionId`, `formatPollOption`. `pollStore.js`: `loadPoll`, `loadPollVotes`, `loadUserVote`, `savePollVote`, `updatePoll`, `closePoll`, `validateDecision`, `decidePoll`, `closeExpiredPolls`, `deletePoll`, `deleteUserPollVotes`, `startPollScheduler`/`stopPollScheduler`; writes run under `withEventLock('poll:<id>')`. Rules: [date-polls](../concepts/date-polls.md).

## utils/eventUrl.js

`buildEventUrl(eventId)` → `<BASE_URL>/#event/<id>` (fallback `http://localhost:3000`). Every event link that leaves the server is built with it: announcement embed and "Zum Event" button, `/events` command, event channel embed, DMs, guest invitation, `{event.url}`. `test/eventUrl.test.js` fails when server code builds `#events/<id>` links again. `buildPollUrl(pollId)` → `<BASE_URL>/#poll/<id>` for poll messages and DMs.

## utils/avatar.js

Pure, no database: `avatarUrlOf(user)` → `session.user.avatar` (already a complete URL), else Discord's first default avatar; `repairAvatarUrl(url)` → unwraps `https://cdn.discordapp.com/avatars/<id>/<complete URL>.png?size=64` (old comments), everything else unchanged.

## utils/botPermissions.js

`BOT_PERMISSIONS` (`{ flag, reason }` per Discord permission the bot needs, incl. everything it grants in channel overwrites) and `buildBotInviteUrl(clientId)` → OAuth2 URL with scopes `bot applications.commands`; used by `logBotInviteUrl` in `bot.js`. Pure, no database.

## utils/csv.js and utils/template.js

Pure, no database. `csvCell(value)` → one quoted CSV cell; values starting with `= + - @`, tab or CR get a leading apostrophe (CSV injection). `parseTemplate(template, vars)` → `{name}` placeholders replaced via split/join, so values stay literal (`$&` in a name) and `.` in a name is no wildcard; `bot.js` re-exports it.

## utils/userProfile.js

`saveUserProfile({ id, username, displayName, avatar })` → `true` when the `users` document was created (sets `acceptInvitations: true`, `createdAt`), else refreshes name/avatar/`updatedAt` and returns `false`. Used by the OAuth callback and the dev persona login.

## utils/sessionStore.js

`PersistentSessionStore` (extends express-session `Store`, used by `server.js`): `get` / `set` / `destroy` on the collection `sessions` (`SESSION_COLLECTION`) through `firebaseAdmin.js`, document id = SHA-256 of the session id. Write-through cache in memory, database read only on a miss; expiry = cookie expiry (default 24 h), expired sessions are deleted on read; `pruneExpired()` runs every 6 h (`pruneIntervalMs`, 0 = off) and returns the number of deleted documents. No `touch` on purpose.

## utils/reminders.js

Pure rules for `event.reminderHours` (see [reminders-presence](../concepts/reminders-presence.md)): `normalizeReminderHours(value)` → `[{ hours, sent }]` from a list, a legacy number or the form text "24, 1" (comma, semicolon or space; hours > 0, each once); `mergeReminderHours(value, oldEvent, startDate)` → list to store on save, keeps `sent` for the same hours while the start is unchanged; `findDueReminders(event, now)` → indexes of unsent reminders whose time is reached before the start.

## utils/eventPreview.js (pure)

`buildPreviewEvent(body)` → the fields the overview card and the Discord announcement need, from the wizard draft: `title` (≤ 200), `description` (≤ 5000), dates, `bannerUrl` only as an http(s) URL (discord.js refuses anything else in `setImage`), `category`, `status`/`accessMode` with the defaults of `POST /events`, `formFields` with a label, `accentColor` only as hex, slots via `normalizeSlots` (none when they are broken), `maxParticipants` = slot sum or the number, guests off with slots. Used by `POST /api/admin/events/preview`.

## utils/debugLog.js

`debugLog(label, data)` prints only when `DEBUG_MODE=true`; `IS_DEBUG` is exported for `server.js` and `/api/server-info`. Use it for verbose traces instead of `console.log`.

## Gotchas

- `withEventLock` is not reentrant: inside the lock call `promoteFromWaitlistLocked`, then `announcePromotions` after releasing it — calling `promoteFromWaitlist` there would wait for itself.
- `bot.js` requires `registrationService` and `eventUtils` lazily inside functions (circular dependency).
