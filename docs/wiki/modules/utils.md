---
id: utils
title: utils/ — domain helpers
type: module
tags: [utils, registration, form-fields, waitlist, audit-log, profile, debug]
sources: [utils/registrationService.js, utils/formFields.js, utils/eventUtils.js, utils/eventUrl.js, utils/userProfile.js, utils/avatar.js, utils/botPermissions.js, utils/sessionStore.js, utils/reminders.js, utils/debugLog.js, utils/capacity.js, utils/slotService.js, utils/eventLock.js, utils/announcementRefresh.js, utils/pollService.js, utils/pollStore.js]
part_of: [architecture]
depends_on: [data-layer, bot]
see_also: [registration-flow, form-fields, role-slots]
---
# utils/ — domain helpers

> TL;DR: Shared domain logic used by routes and the bot: `registrationService.js` (the single source of truth for creating registrations), `formFields.js` (field types and answer format), `eventUtils.js` (loading registrations/line-ups, waitlist promotion, audit log), `capacity.js` and `slotService.js` (pure place and slot rules), `eventLock.js` (per-event lock), `announcementRefresh.js` (debounced live announcements), `eventUrl.js` (links to event pages), `userProfile.js` (users upsert after login) and `debugLog.js` (`DEBUG_MODE` logger).

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
| `promoteFromWaitlist(eventId, event)` | takes the event lock; slot events: oldest waitlist entries whose main/fallback slot is free move up (`pickWaitlistPromotions`); other events: every waitlisted registration whose places (guests counted) still fit (`pickCapacityPromotions`); status `accepted` (instant) or `pending`; DMs, role, channel access, announcement refresh; never throws |
| `promoteFromWaitlistLocked(eventId, event)` / `announcePromotions(eventId, event, promotions)` | the two halves for callers that already hold the lock |
| `isEventVisibleTo(user, event)` | false for `draft`/`archived` (`ADMIN_ONLY_STATUSES`) unless `user.isAdmin`; used by `routes/events.js` |
| `toPublicEvent(eventId, event)` | `{ id, ...event }` without `PRIVATE_EVENT_FIELDS` (`checkinCode`); use for every event answer outside the admin area |
| `loadEventRegistrations(eventId)`, `findUserRegistration(eventId, userId)`, `loadEventRoster(eventId, event, { withProfiles })` | registrations with `id`; line-up via `buildRoster` |
| `saveEventWithSlots(eventId, rawSlots, buildUpdates)` | under the event lock: `normalizeSlots` + `validateSlotChange`, then writes `buildUpdates(slots, oldEvent)` → `{ ok, oldEvent, updates }` or `{ ok: false, error }` |
| `addAuditLog(action, adminId, details, targetId = null)` | writes `auditLogs` `{ action, adminId, details, targetId, timestamp }`; errors only logged |

## utils/capacity.js, utils/slotService.js (pure)

`capacity.js`: `OCCUPYING_STATUSES`, `placesOf`, `countOccupiedPlaces`, `byCreatedAt`, `pickCapacityPromotions`. `slotService.js`: `getSlots`, `hasSlots`, `findSlot`, `formatSlotLabel`, `normalizeSlots`, `countSlotOccupancy`, `hasFreePlace`, `sanitizeAltSlotIds`, `pickSlot`, `pickWaitlistPromotions`, `resolveAcceptanceSlot`, `buildSlotSummary`, `withSlotSummary`, `buildRoster`, `validateSlotChange`. Rules: [role-slots](../concepts/role-slots.md).

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

## utils/userProfile.js

`saveUserProfile({ id, username, displayName, avatar })` → `true` when the `users` document was created (sets `acceptInvitations: true`, `createdAt`), else refreshes name/avatar/`updatedAt` and returns `false`. Used by the OAuth callback and the dev persona login.

## utils/sessionStore.js

`PersistentSessionStore` (extends express-session `Store`, used by `server.js`): `get` / `set` / `destroy` on the collection `sessions` (`SESSION_COLLECTION`) through `firebaseAdmin.js`, document id = SHA-256 of the session id. Write-through cache in memory, database read only on a miss; expiry = cookie expiry (default 24 h), expired sessions are deleted on read; `pruneExpired()` runs every 6 h (`pruneIntervalMs`, 0 = off) and returns the number of deleted documents. No `touch` on purpose.

## utils/reminders.js

Pure rules for `event.reminderHours` (see [reminders-presence](../concepts/reminders-presence.md)): `normalizeReminderHours(value)` → `[{ hours, sent }]` from a list, a legacy number or the form text "24, 1" (comma, semicolon or space; hours > 0, each once); `mergeReminderHours(value, oldEvent, startDate)` → list to store on save, keeps `sent` for the same hours while the start is unchanged; `findDueReminders(event, now)` → indexes of unsent reminders whose time is reached before the start.

## utils/debugLog.js

`debugLog(label, data)` prints only when `DEBUG_MODE=true`; `IS_DEBUG` is exported for `server.js` and `/api/server-info`. Use it for verbose traces instead of `console.log`.

## Gotchas

- `withEventLock` is not reentrant: inside the lock call `promoteFromWaitlistLocked`, then `announcePromotions` after releasing it — calling `promoteFromWaitlist` there would wait for itself.
- `bot.js` requires `registrationService` and `eventUtils` lazily inside functions (circular dependency).
