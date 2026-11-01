---
id: reminders-presence
title: Reminders, start notifications and bot presence
type: concept
tags: [reminders, scheduler, archive, presence, activity, bot-settings, bot-control]
sources: [bot/scheduler.js, bot/scheduledEvents.js, bot/checkin.js, utils/checkin.js, bot/settings.js, utils/reminders.js, utils/notificationPrefs.js, utils/eventListing.js, utils/eventArchive.js, utils/eventCleanup.js, routes/admin.js, server.js, public/js/admin/bot-control.js]
depends_on: [bot, data-model]
see_also: [event-lifecycle, discord-integration]
---
# Reminders, start notifications and bot presence

> TL;DR: `startReminderScheduler()` runs `checkReminders()` every 5 minutes: for each active event it DMs accepted participants when a configured reminder time (`reminderHours[].hours` before start) is reached, and once when the event starts; while an event with check-in runs it sends the „Einchecken“ invitations (B-07). Duplicates are prevented only by flags stored in the event (`reminderHours[].sent`, `eventStartNotificationSent`), written before the DMs go out. Bot presence (status + activity text with live variables) comes from `botSettings/config` and is applied on ready, on save, and every 5 minutes if `autoUpdatePresence` is on.

## Reminder scheduler (`checkReminders`)

- Interval: 5 min (`setInterval`, first run 5 min after start). Started once by `server.js` and always running (B-02): the bot center switches are checked per pass, so the deadline refresh keeps working with reminders off. Before B-02, `applyBotSettings` stopped the interval with `reminderEnabled`, which also stopped the deadline refresh and sent every overdue reminder at once after switching on again.
- For every event with `status === 'active'` and `startDate`:
  - `findDueReminders(event, now)` (`utils/reminders.js`): reminders with `sent !== true`, `now >= start - hours` and `now < start`. If any are due, they are stored as `sent: true` first (a legacy number becomes `[{ hours, sent }]` on the way), then **one** DM goes to all `accepted` registrations: "⏰ Erinnerung! ..." with the buttons „Zum Event“ (link) and „Ich kann doch nicht“ (`my_leave:<eventId>`, the confirmation of `/my-events`: asks first, then unregisters and the waitlist moves up; left out once `unregisterDeadline` has passed at send time; B-08, `buildReminderMessage` in `bot/scheduler.js`; no calendar button because W-02 was closed) — only while `reminderEnabled` is on; with the switch off the due reminders are marked `sent` without a DM (dropped, never sent late) — several reminders due at once (after a downtime) do not send several DMs. Members who switched "Erinnerungen" off in the profile are left out (`messageAcceptedParticipants` → `filterByPreference(…, 'reminders')`, W-16); the reminder still counts as sent.
  - Start notification: within 5 minutes after `startDate`, if `eventStartNotificationSent` is false → set the flag, then DM accepted participants (also without those who switched "Erinnerungen" off) — the DM only while `eventStartNotifications` is on; the flag is set either way.
  - Check-in invitations (B-07): while `isCheckinRunning(event, now)` (active, `checkinEnabled` + `checkinCode`, started, not `isEventOver`) and `canInvite()` (default `state.isReady`), `inviteToCheckin` DMs every accepted registration that is neither checked in nor has `checkinInvitedAt` (marked first) — independent of `eventStartNotifications` and of the „Erinnerungen“ choice. The start DM recipients of the same pass get one message: start text + button; the plain start DM goes only to members who were not invited. Late accepts and codes generated after the start are covered by the next pass; with the bot offline nothing is marked, so the invitations follow while the event runs. See [discord-integration](discord-integration.md).
  - Discord server event status (B-09): a synced event (`discordScheduledEventId`) is set running once its start has passed and completed once it is over (`isEventOver`); `discordScheduledEventStatus` is written **after** a successful call (unlike the DM flags), so a failed or offline call is tried again in the next pass; `'gone'` clears the link. No call once the stored status is reached.
  - Registration deadline (W-03): once `registrationDeadline` has passed (event not over yet) and `registrationClosedRefreshed` is false → set the flag, then refresh the stored announcements (`notifyRegistrationsChanged`) so the register buttons go away. Editing the deadline resets the flag.
- Duplicate protection lives only in the database: a restart, or a crash while sending, never repeats a DM (at most once; a crash mid-send can leave some participants without the DM).
- Event form: the text field `#event-reminder` takes several hours ("24, 1"; comma, semicolon or space; empty = none). `editEvent` fills it with `reminderHoursOf(event.reminderHours).join(', ')`, `saveEvent` sends the text, the server normalizes it.
- `checkReminders({ now, send, refresh, settings, canInvite, scheduledStatus })` takes the time, the DM function, the announcement refresh, the bot center settings (default `loadBotSettings()`) whether check-in invitations can go out (default: bot ready) and the status function of the Discord server events (default `setScheduledEventStatus`) for tests (`test/reminderScheduler.test.js`); the scheduler calls it without arguments.
- Saving an event (`POST`/`PUT /api/admin/events`) stores `mergeReminderHours(...)`: a reminder that was already sent stays sent while `startDate` is unchanged, a new start time makes every reminder due again. Duplicating an event resets `sent` and `eventStartNotificationSent`.
- Times are formatted with `TIMEZONE` (default `Europe/Berlin`).

## Archive scheduler (`utils/eventArchive.js`, W-01)

- `startArchiveScheduler({ waitFor: whenBotSettled() })` is started by `server.js` (independent of the bot settings) and stopped in the graceful shutdown. Its first run waits until the bot is ready (the refresh of the archived announcements needs it) or will not start (no token, failed login, 2 min without the ready event), then it runs `archiveEndedEvents()` every 5 min (`ARCHIVE_INTERVAL_MS`, timer `unref`'d).
- `isDueForArchive(event, now)`: `status === 'active'` and `now >= end + 24 h` (`ARCHIVE_DELAY_MS`; end rule of `eventEndTime`). Each due event gets `status: 'archived'`, an audit entry `AUTO_ARCHIVE_EVENT` by `system` and `notifyRegistrationsChanged` (announcement refresh); an error on one event is logged and the others go on. The log line `🗄️ Archived N ended event(s)` appears only when N > 0. Each archived event is cleaned up right away (`cleanupEvent`: channels, event role, B-10); afterwards the pass runs `retryPendingCleanups()` for archived/cancelled events whose clean-up is still `pending` (bot was not ready), logging `🧹 Caught up N event clean-up(s)`.
- Rules: [event-lifecycle](event-lifecycle.md).

## Presence (`applyBotSettings`)

| Setting | Values / effect |
|---|---|
| `statusType` | `online`, `idle`, `dnd`, `invisible` |
| `activityType` | `PLAYING`, `WATCHING`, `LISTENING`, `COMPETING` |
| `activityText` | template with `{events.count}`, `{events.next}`, `{events.next.date}`, `{events.next.time}`, `{events.next.participants}`, `{events.list}`, `{events.list.details}`, `{server.members}`, `{server.name}`, `{link.events}` (`buildActivityVariables`) |
| `dmNotifications` | off → no automatic DM (`sendAutomaticDM` in `utils/botSettings.js`); see [discord-integration](discord-integration.md) for what it covers |
| `autoUpdatePresence` | refresh every 5 min |
| `autoStatusCalendarEvents` (needs `autoUpdatePresence`) | `dnd` while an event runs (started and not `isEventOver`: end, else start + 2 h), `online` if one is upcoming, else `idle` |
| `reminderEnabled` | off → due reminder DMs are dropped (marked sent); the scheduler keeps running (B-02) |
| `eventStartNotifications` | off → no start DM; the event is marked as notified anyway (B-02) |
| `approvalChannel` | text channel for approval requests of pending registrations (B-06, `bot/approvals.js`); empty (default) → approvals only on the website; validated like `announceChannel` (400 "Freigabe-Kanal nicht gefunden.") |

## Bot control center (admin `#bot-control`)

`GET /api/admin/bot/status` (`getBotStatus`: online, tag, avatar, uptime, ping, guild name/member count, DMs sent, commands processed, scheduler/presence flags), `GET/PUT /api/admin/bot/settings`, `GET /api/admin/bot/running-events` (`getRunningEvents`: active events that are not over (`isEventOver`), with accepted/pending/waitlisted counts). The cards (`admin/bot-control.js`) say "LIVE" only between start and end (`isRunning`), "Bevorstehend" before the start, "Beendet" otherwise.

## Gotchas

- `announceChannel` and `welcomeMessage` are evaluated in `routes/admin.js` (announcements) and `utils/botSettings.js` (welcome DM), see [discord-integration](discord-integration.md).
- Settings are read through `utils/botSettings.js` (defaults for missing keys, cached until the next save).
- In dev mock mode reminder DMs are not simulated (internal call to the real `sendDM`).
