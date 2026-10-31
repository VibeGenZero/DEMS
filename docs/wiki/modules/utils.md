---
id: utils
title: utils/ — domain helpers
type: module
tags: [utils, registration, form-fields, waitlist, audit-log, profile, debug, change-notice, banner]
sources: [utils/registrationService.js, utils/registrationStatus.js, utils/approvalRequests.js, utils/checkin.js, utils/formFields.js, utils/eventUtils.js, utils/eventListing.js, utils/profileEvents.js, utils/eventUrl.js, utils/userProfile.js, utils/avatar.js, utils/botPermissions.js, utils/csv.js, utils/template.js, utils/sessionStore.js, utils/reminders.js, utils/debugLog.js, utils/capacity.js, utils/slotService.js, utils/eventLock.js, utils/announcementRefresh.js, utils/pollService.js, utils/pollStore.js, utils/eventPreview.js, utils/eventArchive.js, utils/eventChangeNotice.js, utils/notificationPrefs.js, utils/memberOverview.js, utils/insights.js, utils/participantMessage.js, utils/bannerStore.js, utils/bulkRegistrations.js, utils/eventSeries.js, utils/eventTemplates.js, utils/botSettings.js]
part_of: [architecture]
depends_on: [data-layer, bot]
see_also: [registration-flow, form-fields, role-slots]
---
# utils/ — domain helpers

> TL;DR: Shared domain logic used by routes and the bot: `registrationService.js` (the single source of truth for creating registrations), `formFields.js` (field types and answer format), `eventUtils.js` (loading registrations/line-ups, waitlist promotion, audit log), `capacity.js` and `slotService.js` (pure place and slot rules), `eventLock.js` (per-event lock), `announcementRefresh.js` (debounced live announcements), `eventUrl.js` (links to event pages), `eventChangeNotice.js` (change DMs after an edit, W-04), `notificationPrefs.js` (which DMs a member wants, W-16), `profileEvents.js` (upcoming and history lists of the profile), `memberOverview.js` (numbers and history of the admin member overview, W-15), `insights.js` (evaluations for admins, W-14), `participantMessage.js` (message of the team to the participants, W-09), `bannerStore.js` (uploaded banners, W-12), `bulkRegistrations.js` (bulk actions on registrations, W-08), `eventSeries.js` (editing and extending series, W-11), `eventTemplates.js` (which settings an event template keeps, W-10), `botSettings.js` (bot center settings with defaults, cached; gate for automatic DMs, B-02), `userProfile.js` (users upsert after login) and `debugLog.js` (`DEBUG_MODE` logger).

## utils/registrationService.js

| Export | Contract |
|---|---|
| `registerUserForEvent({ eventId, user: { id, displayName, roles }, formAnswers, guests, source, slotId, altSlotIds })` | returns `{ ok: true, id, status, message, event, slotId, isAlt }` or `{ ok: false, code, httpStatus, error }`; validation + write under `withEventLock` |
| `switchOwnSlot({ eventId, userId, slotId })` | member moves into a free slot (becomes the main role; waitlisted members get the place) → `{ ok, status, slotId, message }` |
| `moveRegistrationToSlot({ registrationId, slotId })` | admin move, may overbook → `{ ok, slotId, slotName, userName, warning }` |
| `unregisterUserFromEvent({ eventId, userId })` | deletes the registration, removes role + channel access (accepted), promotes the waitlist → `{ ok, registration, event }` |
| `notifyStatusChange({ registration, eventId, event, status, slotId })` | DM after an admin status change (single `PUT /registrations/:id/status` and the bulk route, W-08): accepted (event or global template, else default text with the slot line; then `assignRole` for `assignRoleId`), rejected (template or default text), waitlisted (`waitlistDmText`, only if `wantsDm(userId, 'waitlist')`); never throws |
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

## utils/eventChangeNotice.js (W-04)

| Export | Behaviour |
|---|---|
| `describeEventChanges(oldEvent, newEvent)` | `[{ field, label, before, after }]` for `startDate` ("Beginn"), `endDate` ("Ende"), `location` ("Ort") in this order; dates compare as points in time (empty or invalid = no value), the location by trimmed `text` + `channelId`; display strings in German format (`TIMEZONE`), a missing value is "nicht festgelegt"; every other field is ignored |
| `buildEventChangeMessage(title, changes, url)` | German DM: title, one line per change `~~before~~ → **after**` ("nicht festgelegt" not struck through), then "Alle Infos: <url>" |
| `changeRecipients(registrations)` | user ids of `accepted` registrations plus their `guests`, each once; pending, waitlisted, rejected and `pendingGuests` left out |
| `notifyEventChange({ eventId, title, changes, send = sendDM })` | loads the registrations of the event (one `where`, status filtered in memory), sends one DM per recipient one after another → `{ recipients, notified }` (only delivered DMs counted); nothing without changes. Used by `PUT /api/admin/events/:id` — see [event-lifecycle](../concepts/event-lifecycle.md) |

## utils/notificationPrefs.js (W-16)

| Export | Behaviour |
|---|---|
| `NOTIFICATION_KINDS` | `reminders` (reminders + start DM), `changes` (change DM of W-04 + cancellation DM), `waitlist` ("put on the waitlist" DM; the move-up DM is always sent) |
| `normalizeNotificationPrefs(raw)` | all three kinds; only an explicit `false` turns one off (missing field, `null`, text → on) |
| `filterByPreference(userIds, kind)` | `{ userIds, optedOut }`: unique ids in order that want `kind`, and how many switched it off; one `getDoc(users/{id})` per user, a missing document = on |
| `wantsDm(userId, kind)` | bool for one user. A read error is logged and counts as on (the DM goes out) |

## utils/profileEvents.js (pure)

| Export | Behaviour |
|---|---|
| `buildProfileEvents(registrations, eventsById, now, waitlistPositionsById)` | `{ upcoming, history }` for `GET /api/user/profile`; rules in [routes-user](routes-user.md) |
| `toProfileEntry(registration, event, waitlistPosition)` | one entry: registration status, check-in, slot (`getSlots`/`findSlot`), waitlist place (or `null`) and eight event fields; never the check-in code |
| `byDateDescending(a, b)` | sort rule of the history: latest event start first, the registration time stands in without event or start; reused by `memberOverview.js` |

## utils/memberOverview.js (pure, W-15)

Rules of the admin member overview. **Over** = event exists, not `cancelled`, and `archived` or `isEventOver`. **Teilnahme** (`attended`) = accepted registration of an over event. **Tracked** event = `checkinEnabled` or at least one checked-in registration. **No-Show** = accepted, over, tracked, not checked in — an event nobody checked in for has no no-shows.

| Export | Behaviour |
|---|---|
| `isOver(event, now)` | the "over" rule above; also used by `insights.js` |
| `trackedEventIds(eventsById, registrations)` | `Set` of tracked event ids |
| `memberStats(registrations, eventsById, tracked, now)` | `{ registrations, attended, checkedIn, noShows }` of one member; `checkedIn` counts code and admin check-ins |
| `lastActivity(user, registrations)` | ISO time of the latest of `updatedAt` and the registration times, `null` without a readable date |
| `memberBase(user, registrations)` | `{ id, username, displayName, avatar, createdAt, lastActiveAt }`; name falls back to username, then id |
| `buildMemberList(users, registrations, eventsById, now)` | one entry per user with `stats`, ordered by name (`localeCompare` de); registrations of unknown user ids are ignored |
| `buildMemberHistory(registrations, eventsById, tracked, now)` | `toProfileEntry` + `source` (`web`/`discord`/`admin`, missing = `web`) + `noShow`, sorted by `byDateDescending` |

## utils/participantMessage.js (pure, W-09)

Recipients, text and sending loop of the participant message. `send` is injected (`bot.js#sendDM` in the route), so the module needs neither bot nor database.

| Export | Behaviour |
|---|---|
| `MESSAGE_GROUPS`, `MAX_MESSAGE_LENGTH` | `accepted` → `[accepted]`, `all` → `[accepted, pending, waitlisted]`; rejected never; 1500 |
| `messageRecipients(registrations, group)` | unique user ids: registrants of the group plus their `guests`; never `pendingGuests`; unknown group → `[]` |
| `recipientCounts(registrations)` | `{ accepted, all }` |
| `validateMessageText(text)` | `{ text }` trimmed, or `{ error }` "Bitte gib eine Nachricht ein." / "Die Nachricht darf höchstens 1500 Zeichen lang sein." |
| `buildParticipantMessage({ title, text, sender, url })` | plain-text DM: heading line with the title, the text as typed, "— sender · Alle Infos: url"; twin `buildParticipantMessagePreview` in `admin/participant-message.js`, both checked against `test/fixtures/participantMessageCases.js` |
| `sendParticipantMessage({ registrations, group, title, text, sender, url, send })` | sequential DMs, a throw counts as not delivered → `{ recipients, delivered }`; no preference filter |

## utils/insights.js (pure, W-14)

Evaluations over a time range, built on the rules of `memberOverview.js`. **Evaluated** event = `isOver` (so never cancelled) and start within `now - days … now`; range `all` takes every over event, also undated archived ones. Rates are whole percent (`Math.round`) or `null` without a base; totals are weighted (summed counts, not averages of rates).

| Export | Behaviour |
|---|---|
| `RANGES`, `DEFAULT_RANGE`, `isValidRange(range)` | `30`, `90` (default), `365`, `all` |
| `evaluatedEvents(eventsById, range, now)` | `[id, event]` pairs, newest start first, undated last |
| `buildInsights({ users, registrations, eventsById, range, now })` | `totals`: `events`, `trackedEvents`, `accepted`, `checkedIn`, `attendanceRate` (checked in ÷ accepted over tracked events), `noShowRate` (100 − attendance), `placesTaken`/`placesOffered`/`occupancyRate` (`placesOf` of accepted registrations ÷ `maxParticipants`, events with a limit only); `members`: top 10 `{ id, name, attended, checkedIn, hasProfile }` (ties by check-ins, then name; name from the profile, else `userName`); `categories`: `{ label, events, registrations, averageAccepted, attendanceRate, share }` grouped by trimmed lower-case category (first spelling, empty = "Ohne Kategorie"), `share` relative to the largest; `events`: one row per evaluated event, `noShows`/`attendanceRate` `null` when untracked, `occupancyRate` `null` without limit |

## utils/bulkRegistrations.js (pure, W-08)

`BULK_ACTIONS` (statuses each action applies to: `accept` pending/waitlisted, `waitlist` pending/accepted, `reject` all three; the frontend copy in `public/js/admin/registration-bulk.js` is pinned by a test), `MAX_BULK_IDS` = 200, `planBulkAction({ action, ids, registrations, event })` → `{ changes: [{ id, from, to, slotId, clearCheckin }], skipped, full }`. Duplicates count once; unknown ids and unfitting statuses are skipped. Accept goes oldest first and never overbooks: without slots it fills `maxParticipants` next to the places of the unselected pending/accepted registrations (`placesOf`, guests and open invitations count); with slots it picks the main or a fallback role with `pickSlot` on the occupancy of the unselected ones. What does not fit goes on the waitlist (a waitlisted one stays and only counts in `full`). Waitlist/reject clear the slot on slot events (`slotId: null`) and the check-in.

## utils/eventSeries.js (pure, W-11)

Days and clock times count in `TIMEZONE` (`Intl.DateTimeFormat`, no library). `followingDates(seriesEvents, edited, now)` → the other dates of the series that start later than the edited one did, are not over and are `draft`/`active`, sorted by start. `transferTime(targetStart, source, timeZone)` → `{ startDate, endDate, registrationDeadline, unregisterDeadline }`: the target's day with the source's local start time, duration and deadline offsets (empty stays empty; `null` without both starts). `nextSeriesStart(start, interval)` → next date at the same local time (`weekly` +7 days, `biweekly` +14, else +1 month with `setMonth`-style overflow). `planExtension({ seriesEvents, interval, oldUntil, newUntil })` → `{ starts }` after the last date up to and including `newUntil` (`YYYY-MM-DD`, `localDay`), or `{ error: SHORTEN_SERIES_MESSAGE }` for an earlier end. `seriesUpdateFields(updates)` picks `SERIES_FIELDS` (settings shared by the series; never status, dates, check-in, `seriesId`, origin). `slotsForDate(rawSlots, targetSlots)` gives a slot the id of the other date's slot with the same name, so its registrations stay.

## utils/eventTemplates.js (pure, W-10)

`TEMPLATE_FIELDS` = the event settings a template stores (title, description, banner, accent colour, category, location, places, access, roles, approval, guests, slots, assigned role, form fields, reminders, check-in message, channels, custom messages — never dates, deadlines, status, series, Discord ids, announcements, check-in code or sent flags); the frontend copy in `public/js/admin/wizard-templates.js` is pinned by `test/wizardTemplates.test.js`. `pickTemplateSettings(input)` → `{ settings }` with the defaults of `baseEvent` (slots via `normalizeSlots`, then `maxParticipants` = capacity sum and no guests; `reminderHours` as `[{ hours }]` without `sent`) or `{ error }` (slot sentence). `normalizeTemplateName(name)` → `{ name }` trimmed, 1–`TEMPLATE_NAME_MAX` (80) chars, or `{ error }`. `nameTaken(templates, name, exceptId)` compares case-insensitively. `MAX_TEMPLATES` = 50.

## utils/capacity.js, utils/slotService.js (pure)

`capacity.js`: `OCCUPYING_STATUSES`, `placesOf`, `countOccupiedPlaces`, `byCreatedAt`, `waitlistPositions(registrations)` (W-05: `Map` id → `{ position, total }` over the waitlisted registrations, oldest first, ties by id; slot events use the same single list), `pickCapacityPromotions`; for the display `summarizePlaces(registrations, maxParticipants)` → `{ taken, capacity, guests, pending, waitlist }` (guests include open invitations), `formatPlaces(places)` → the one places sentence for website and Discord ("5 von 20 Plätzen belegt (inkl. 1 Gast, 1 Anfrage offen)", without a limit "5 Plätze belegt") and `formatWaitlist(n)` ("3 auf der Warteliste"). `describePlaces(registrations, maxParticipants)` returns the numbers together with `text` and `waitlistText`; `GET /api/events` and `GET /api/admin/all-events` put exactly this object into `places`. `slotService.js`: `getSlots`, `hasSlots`, `findSlot`, `formatSlotLabel`, `normalizeSlots`, `countSlotOccupancy`, `hasFreePlace`, `sanitizeAltSlotIds`, `pickSlot`, `pickWaitlistPromotions`, `resolveAcceptanceSlot`, `buildSlotSummary`, `withSlotSummary`, `buildRoster`, `validateSlotChange`. Rules: [role-slots](../concepts/role-slots.md).

## utils/eventLock.js

`withEventLock(eventId, fn)` runs `fn` after all earlier work for the same event (in-memory promise chain; DEMS is a single process). Not reentrant.

## utils/announcementRefresh.js

`notifyRegistrationsChanged(eventId)` bundles calls per event (2 s trailing debounce, timers `unref`'d) and then calls `bot.refreshEventAnnouncements(eventId)`; errors are only logged. `flushAnnouncementRefreshes()` runs pending refreshes at once; `createAnnouncementRefresher({ refresh, delayMs })` for tests. A second instance, `notifyPollChanged(pollId)` / `flushPollRefreshes()`, refreshes posted date polls via `bot.refreshPollMessages`.

## utils/pollService.js, utils/pollStore.js

`pollService.js` (pure): `normalizePollInput`, `normalizeVote`, `isPollOpen`, `effectivePollStatus`, `canVote`, `tallyPoll`, `rankOptions`, `getFavoriteOptionId`, `formatPollOption`. `pollStore.js`: `loadPoll`, `loadPollVotes`, `loadUserVote`, `savePollVote`, `updatePoll`, `closePoll`, `validateDecision`, `decidePoll`, `closeExpiredPolls`, `deletePoll`, `deleteUserPollVotes`, `startPollScheduler`/`stopPollScheduler`; writes run under `withEventLock('poll:<id>')`. Rules: [date-polls](../concepts/date-polls.md).

## utils/registrationStatus.js

`changeRegistrationStatus({ registrationId, status, actor, expectStatus })` — the admin status change (accept, reject, waitlist), shared by `PUT /api/admin/registrations/:id/status` and the Discord approval buttons (B-06). Under `withEventLock`: slot cleared on waitlist/reject, check-in cleared unless accepted, acceptance of a slot-less registration picks a slot (`resolveAcceptanceSlot`, overbooking `warning`). Then `notifyStatusChange` (accepted/rejected), `promoteFromWaitlist` after a rejection, `notifyRegistrationsChanged`, `addAuditLog('UPDATE_REGISTRATION_STATUS', actor.id, …)`. `expectStatus` (Discord: `'pending'`) is checked inside the lock; a different current status returns `{ ok: false, code: 'already_decided', registration }` without changes. Unknown id → `{ ok: false, code: 'not_found' }`.

## utils/checkin.js

Check-in rules shared by `POST /api/events/:id/checkin` and the Discord button (B-07), without discord.js: `isCheckinActive(event)` (active + `checkinEnabled` + `checkinCode`), `isCheckinRunning(event, now)` (active, started, not `isEventOver`), `findAcceptedRegistration(eventId, userId)`, `checkInMember({ eventId, userId, now, requireRunning })` → `{ ok: true, alreadyCheckedIn, checkedInAt, event }` or `{ ok: false, code }` (`not_found`, `not_active`, `disabled`, `not_started`, `over`, `no_registration`; status and time window only with `requireRunning`, so the code route keeps its old rules; a repeat keeps the first time), `listCheckinInvitees(eventId)` (accepted, not checked in, no `checkinInvitedAt`), `markInvited(registrationId, now)`.

## utils/approvalRequests.js

Data side of the Discord approval requests (B-06), without discord.js (so `dev/mockBot.js` can use it): `loadApprovalRequest(registrationId)` (null without `approvalChannel` or unless the registration is pending), `storeApprovalMessage`, `storedApprovalMessage`, `eventForClosing`, `formatOutcome({ status, actorName })` (result lines "✅ Angenommen von …", "↩️ Vom Mitglied zurückgezogen", "🚫 Event abgesagt", "🗑️ Event gelöscht" …), `closePendingRequests(registrations, outcome, event)` (closes every pending one with a stored message; used by cancel, delete, bulk and unregister), `actorName(user)`.

## utils/eventUrl.js

`buildEventUrl(eventId)` → `<BASE_URL>/#event/<id>` (fallback `http://localhost:3000`). Every event link that leaves the server is built with it: announcement and its "Zum Event" button, `/events` command, event channel embed, DMs, guest invitation, `{event.url}`. `test/eventUrl.test.js` fails when server code builds `#events/<id>` links again. `buildPollUrl(pollId)` → `<BASE_URL>/#poll/<id>` for poll messages and DMs. `buildSiteUrl(page)` → `<BASE_URL>/#<page>` for pages without an ID (`profile`, `events`; used by `/my-events`).

## utils/avatar.js

Pure, no database: `avatarUrlOf(user)` → `session.user.avatar` (already a complete URL), else Discord's first default avatar; `repairAvatarUrl(url)` → unwraps `https://cdn.discordapp.com/avatars/<id>/<complete URL>.png?size=64` (old comments), everything else unchanged.

## utils/botPermissions.js

`BOT_PERMISSIONS` (`{ flag, reason }` per Discord permission the bot needs, incl. everything it grants in channel overwrites) and `buildBotInviteUrl(clientId)` → OAuth2 URL with scopes `bot applications.commands`; used by `logBotInviteUrl` in `bot/lifecycle.js`. Pure, no database.

## utils/csv.js and utils/template.js

Pure, no database. `csvCell(value)` → one quoted CSV cell; values starting with `= + - @`, tab or CR get a leading apostrophe (CSV injection). `parseTemplate(template, vars)` → `{name}` placeholders replaced via split/join, so values stay literal (`$&` in a name) and `.` in a name is no wildcard; `bot.js` re-exports it.

## utils/userProfile.js

`saveUserProfile({ id, username, displayName, avatar })` → `true` when the `users` document was created (sets `acceptInvitations: true`, `createdAt`), else refreshes name/avatar/`updatedAt` and returns `false`. Used by the OAuth callback and the dev persona login.

## utils/botSettings.js (B-02)

Settings of the bot control center (`botSettings/config`). `DEFAULT_BOT_SETTINGS`; `normalizeBotSettings(raw)` merges the defaults with the stored keys (switches `dmNotifications`, `reminderEnabled`, `eventStartNotifications`, `autoChannelCreation`, `announcementThreads` count as on unless stored as `false`; `autoUpdatePresence`, `autoStatusCalendarEvents` as off unless `true`), so settings saved before a key existed still work. `loadBotSettings({ read })` reads the document once and then answers from memory; a read error logs and returns the defaults (fail open). `rememberBotSettings(settings)` replaces the cache after `bot.js#saveBotSettings` wrote the document — exact because DEMS runs as one process; a second process writing the settings would not be seen. `forgetBotSettings()` for tests. `sendAutomaticDM(userId, message)` sends through `bot.sendDM` (required late, so mock mode reaches `dev/mockBot.js`) only while `dmNotifications` is on → `false` otherwise. `announceChannelId(settings)` → bot center channel, else `DISCORD_ANNOUNCE_CHANNEL_ID`, else `''`. `sendWelcomeOnce(user, registrationId)` → the welcome text once per member (see [discord-integration](../concepts/discord-integration.md)); callers pass the id of the registration that was just accepted so it does not count as an earlier one. `bot.js#getBotSettings` returns `loadBotSettings()`.

## utils/sessionStore.js

`PersistentSessionStore` (extends express-session `Store`, used by `server.js`): `get` / `set` / `destroy` on the collection `sessions` (`SESSION_COLLECTION`) through `firebaseAdmin.js`, document id = SHA-256 of the session id. Write-through cache in memory, database read only on a miss; expiry = cookie expiry (default 24 h), expired sessions are deleted on read; `pruneExpired()` runs every 6 h (`pruneIntervalMs`, 0 = off) and returns the number of deleted documents. No `touch` on purpose. `sharedSessionStore()` returns the one instance of the process (server and panic mode share its cache). `destroyAll({ keepAdmins })` deletes every session in cache and database, with `keepAdmins` all but those whose `user.isAdmin` is true; an unreadable record counts as non-admin and is deleted too, so one broken document cannot stop the panic lockdown.

## utils/reminders.js

Pure rules for `event.reminderHours` (see [reminders-presence](../concepts/reminders-presence.md)): `normalizeReminderHours(value)` → `[{ hours, sent }]` from a list, a legacy number or the form text "24, 1" (comma, semicolon or space; hours > 0, each once); `mergeReminderHours(value, oldEvent, startDate)` → list to store on save, keeps `sent` for the same hours while the start is unchanged; `findDueReminders(event, now)` → indexes of unsent reminders whose time is reached before the start.

## utils/eventPreview.js (pure)

`buildPreviewEvent(body)` → the fields the overview card and the Discord announcement need, from the wizard draft: `title` (≤ 200), `description` (≤ 5000), dates, `bannerUrl` only as an http(s) URL (discord.js refuses anything else in `setImage`), `category`, `status`/`accessMode` with the defaults of `POST /events`, `formFields` with a label, `accentColor` only as hex, slots via `normalizeSlots` (none when they are broken), `maxParticipants` = slot sum or the number, guests off with slots. Used by `POST /api/admin/events/preview`.

## utils/bannerStore.js (W-12)

Uploaded event banners as files in `<UPLOAD_DIR>/banners/` (default `data/uploads`); the event stores only the path `/uploads/banners/<uuid>.<ext>`.

| Export | Behaviour |
|---|---|
| `BANNER_PATH`, `BANNER_FILE` | regex of an upload path / of a file name; the frontend copy of `BANNER_PATH` in `public/js/core/ui.js` is pinned by `test/bannerStore.test.js` |
| `MAX_BANNER_BYTES`, `ALLOWED_TYPES` | 5 MB; `png`, `jpg`, `gif`, `webp` (never SVG) |
| `bannerDir()` | folder of the files, read from `UPLOAD_DIR` on every call |
| `detectImageType(buffer)` | type from the magic bytes, else `null` — the declared content type is never trusted |
| `isBannerPath(value)` / `isStoredBanner(value)` | pattern only / pattern and the file exists (used by `validateEvent`) |
| `saveBanner(buffer, type)` | writes `<uuid>.<ext>` via a temp name + rename → upload path |
| `bannerForDiscord(bannerUrl)` | `{}`, `{ url }` (external) or `{ url: BASE_URL + path, file }` (upload whose file exists) |
| `releaseBanners(values)` | deletes each upload path no stored event and no event template (`settings.bannerUrl`, W-10) uses anymore (`usedBanners` reads all events and templates once; the startup sweep uses the same set); ignores external URLs; never throws |
| `sweepOrphanBanners({ maxAgeMs, now })` | startup clean-up: deletes unused files older than `maxAgeMs` (24 h) → count |

## utils/debugLog.js

`debugLog(label, data)` prints only when `DEBUG_MODE=true`; `IS_DEBUG` is exported for `server.js` and `/api/server-info`. Use it for verbose traces instead of `console.log`.

## Gotchas

- `withEventLock` is not reentrant: inside the lock call `promoteFromWaitlistLocked`, then `announcePromotions` after releasing it — calling `promoteFromWaitlist` there would wait for itself.
- The `bot/` modules require `registrationService`, `eventUtils`, `pollStore` and `announcementRefresh` lazily inside functions (circular dependency: those utils require `bot.js` at load time).
