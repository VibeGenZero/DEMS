---
id: reminders-presence
title: Reminders, start notifications and bot presence
type: concept
tags: [reminders, scheduler, presence, activity, bot-settings, bot-control]
sources: [bot.js, routes/admin.js, server.js]
depends_on: [bot, data-model]
see_also: [event-lifecycle, discord-integration]
---
# Reminders, start notifications and bot presence

> TL;DR: `startReminderScheduler()` runs `checkReminders()` every 5 minutes: for each active event it DMs accepted participants when a configured reminder time (`reminderHours[].hours` before start) is reached, and once when the event starts. Bot presence (status + activity text with live variables) comes from `botSettings/config` and is applied on ready, on save, and every 5 minutes if `autoUpdatePresence` is on.

## Reminder scheduler (`checkReminders`)

- Interval: 5 min (`setInterval`, first run 5 min after start). Started by `server.js`; `applyBotSettings` stops/starts it according to `reminderEnabled`.
- For every event with `status === 'active'` and `startDate`:
  - `reminderHours` (array of `{ hours, sent }`; a legacy number is converted) → when `now >= start - hours` and `now < start`, DM all `accepted` registrations: "⏰ Erinnerung! ...". Marks `sent: true` in the event.
  - Start notification: within 5 minutes after `startDate`, if `eventStartNotificationSent` is false → DM accepted participants, then set the flag.
- Duplicate protection is an in-memory `sentReminders` map (cleared when the event has started).
- Times are formatted with `TIMEZONE` (default `Europe/Berlin`).

## Presence (`applyBotSettings`)

| Setting | Values / effect |
|---|---|
| `statusType` | `online`, `idle`, `dnd`, `invisible` |
| `activityType` | `PLAYING`, `WATCHING`, `LISTENING`, `COMPETING` |
| `activityText` | template with `{events.count}`, `{events.next}`, `{events.next.date}`, `{events.next.time}`, `{events.next.participants}`, `{events.list}`, `{events.list.details}`, `{server.members}`, `{server.name}`, `{link.events}` (`buildActivityVariables`) |
| `autoUpdatePresence` | refresh every 5 min |
| `autoStatusCalendarEvents` (needs `autoUpdatePresence`) | `dnd` while an event runs, `online` if one is upcoming, else `idle` |
| `reminderEnabled` | starts/stops the reminder scheduler |

## Bot control center (admin `#bot-control`)

`GET /api/admin/bot/status` (`getBotStatus`: online, tag, avatar, uptime, ping, guild name/member count, DMs sent, commands processed, scheduler/presence flags), `GET/PUT /api/admin/bot/settings`, `GET /api/admin/bot/running-events` (`getRunningEvents`: active events with accepted/pending/waitlisted counts).

## Gotchas

- `checkReminders` does not read the stored `reminder.sent` flag; after a restart inside a reminder window the reminder is sent again.
- `dmNotifications`, `eventStartNotifications`, `autoChannelCreation`, `welcomeMessage`, `announceChannel` are saved but not evaluated anywhere.
- In dev mock mode reminder DMs are not simulated (internal call to the real `sendDM`).
