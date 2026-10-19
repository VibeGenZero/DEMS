---
id: reminders-presence
title: Reminders, start notifications and bot presence
type: concept
tags: [reminders, scheduler, archive, presence, activity, bot-settings, bot-control]
sources: [bot.js, utils/reminders.js, utils/eventListing.js, utils/eventArchive.js, routes/admin.js, server.js, public/js/admin/bot-control.js]
depends_on: [bot, data-model]
see_also: [event-lifecycle, discord-integration]
---
# Reminders, start notifications and bot presence

> TL;DR: `startReminderScheduler()` runs `checkReminders()` every 5 minutes: for each active event it DMs accepted participants when a configured reminder time (`reminderHours[].hours` before start) is reached, and once when the event starts. Duplicates are prevented only by flags stored in the event (`reminderHours[].sent`, `eventStartNotificationSent`), written before the DMs go out. Bot presence (status + activity text with live variables) comes from `botSettings/config` and is applied on ready, on save, and every 5 minutes if `autoUpdatePresence` is on.

## Reminder scheduler (`checkReminders`)

- Interval: 5 min (`setInterval`, first run 5 min after start). Started by `server.js`; `applyBotSettings` stops/starts it according to `reminderEnabled`.
- For every event with `status === 'active'` and `startDate`:
  - `findDueReminders(event, now)` (`utils/reminders.js`): reminders with `sent !== true`, `now >= start - hours` and `now < start`. If any are due, they are stored as `sent: true` first (a legacy number becomes `[{ hours, sent }]` on the way), then **one** DM goes to all `accepted` registrations: "⏰ Erinnerung! ..." — several reminders due at once (after a downtime) do not send several DMs.
  - Start notification: within 5 minutes after `startDate`, if `eventStartNotificationSent` is false → set the flag, then DM accepted participants.
  - Registration deadline (W-03): once `registrationDeadline` has passed (event not over yet) and `registrationClosedRefreshed` is false → set the flag, then refresh the stored announcements (`notifyRegistrationsChanged`) so the register buttons go away. Editing the deadline resets the flag.
- Duplicate protection lives only in the database: a restart, or a crash while sending, never repeats a DM (at most once; a crash mid-send can leave some participants without the DM).
- Event form: the text field `#event-reminder` takes several hours ("24, 1"; comma, semicolon or space; empty = none). `editEvent` fills it with `reminderHoursOf(event.reminderHours).join(', ')`, `saveEvent` sends the text, the server normalizes it.
- `checkReminders({ now, send })` takes the time and the DM function for tests (`test/reminderScheduler.test.js`); the scheduler calls it without arguments.
- Saving an event (`POST`/`PUT /api/admin/events`) stores `mergeReminderHours(...)`: a reminder that was already sent stays sent while `startDate` is unchanged, a new start time makes every reminder due again. Duplicating an event resets `sent` and `eventStartNotificationSent`.
- Times are formatted with `TIMEZONE` (default `Europe/Berlin`).

## Archive scheduler (`utils/eventArchive.js`, W-01)

- `startArchiveScheduler({ waitFor: whenBotSettled() })` is started by `server.js` (independent of the bot settings) and stopped in the graceful shutdown. Its first run waits until the bot is ready (the refresh of the archived announcements needs it) or will not start (no token, failed login, 2 min without the ready event), then it runs `archiveEndedEvents()` every 5 min (`ARCHIVE_INTERVAL_MS`, timer `unref`'d).
- `isDueForArchive(event, now)`: `status === 'active'` and `now >= end + 24 h` (`ARCHIVE_DELAY_MS`; end rule of `eventEndTime`). Each due event gets `status: 'archived'`, an audit entry `AUTO_ARCHIVE_EVENT` by `system` and `notifyRegistrationsChanged` (announcement refresh); an error on one event is logged and the others go on. The log line `🗄️ Archived N ended event(s)` appears only when N > 0.
- Rules: [event-lifecycle](event-lifecycle.md).

## Presence (`applyBotSettings`)

| Setting | Values / effect |
|---|---|
| `statusType` | `online`, `idle`, `dnd`, `invisible` |
| `activityType` | `PLAYING`, `WATCHING`, `LISTENING`, `COMPETING` |
| `activityText` | template with `{events.count}`, `{events.next}`, `{events.next.date}`, `{events.next.time}`, `{events.next.participants}`, `{events.list}`, `{events.list.details}`, `{server.members}`, `{server.name}`, `{link.events}` (`buildActivityVariables`) |
| `autoUpdatePresence` | refresh every 5 min |
| `autoStatusCalendarEvents` (needs `autoUpdatePresence`) | `dnd` while an event runs (started and not `isEventOver`: end, else start + 2 h), `online` if one is upcoming, else `idle` |
| `reminderEnabled` | starts/stops the reminder scheduler |

## Bot control center (admin `#bot-control`)

`GET /api/admin/bot/status` (`getBotStatus`: online, tag, avatar, uptime, ping, guild name/member count, DMs sent, commands processed, scheduler/presence flags), `GET/PUT /api/admin/bot/settings`, `GET /api/admin/bot/running-events` (`getRunningEvents`: active events that are not over (`isEventOver`), with accepted/pending/waitlisted counts). The cards (`admin/bot-control.js`) say "LIVE" only between start and end (`isRunning`), "Bevorstehend" before the start, "Beendet" otherwise.

## Gotchas

- `dmNotifications`, `eventStartNotifications`, `autoChannelCreation`, `welcomeMessage`, `announceChannel` are saved but not evaluated anywhere.
- In dev mock mode reminder DMs are not simulated (internal call to the real `sendDM`).
