# Proposal

## Why

Ticket **B-09** (#92, milestone M4 · Discord-Funktionen, depends on F-13). „Mit Discord synchronisieren“ creates the Discord server event once and then forgets it: a moved start, a new title, a cancellation or a deletion in DEMS leave the Discord event wrong or orphaned, and it stays „Geplant“ forever because Discord starts server events only when somebody starts them.

## What Changes

- **Edits update the Discord event:** saving a synced event (also dates of a series edited with „Dieser und alle folgenden Termine“) updates name, description, start, end, location and, when it changed, the banner.
- **Removal:** cancelling, deleting (also a whole series) and setting the event back to draft remove the Discord event; the event can be synced again later.
- **Status follows the event:** at the start time the bot sets the Discord event to „Läuft“, at the end (end time, else start + 2 h) to „Beendet“ (scheduler, every 5 minutes). „Starten“ and „Beenden“ in the admin area do it at once.
- **Deleted in Discord:** when the Discord event no longer exists, DEMS forgets it, so „Mit Discord synchronisieren“ is offered again.
- **Location:** a voice channel (the event's own channel or a chosen voice location) makes it a voice event; otherwise it is an external event with the event's location text (instead of today's „TBD“), or „Discord“ without one.
- **Fix:** „Duplizieren“ and extending a series no longer copy the Discord event id (today the copy counts as synced and would change the original's Discord event).

Out of scope: syncing automatically without the button, importing changes made in Discord back into DEMS, interested-member lists.

## Capabilities

### New Capabilities
- `scheduled-event-sync`: how a DEMS event keeps its Discord server event in step — updates, removal, status at start and end, a Discord event deleted elsewhere, copies.

### Modified Capabilities
_None._

## Impact

- Code: new bot area module `bot/scheduledEvents.js` (field builder, `createScheduledEvent` and `getGuildScheduledEvents` moved from `bot/channels.js`, new `updateScheduledEvent`, `removeScheduledEvent`, `setScheduledEventStatus`), exported through `bot.js` with twins in `dev/mockBot.js`; `bot/scheduler.js` (status at start/end); `routes/admin.js` (save, status, cancel, start, end, delete, series delete, duplicate, sync, `extendSeries`).
- Data: events get `discordScheduledEventStatus` (`scheduled` | `active` | `completed`) next to `discordScheduledEventId`.
- Tests: new `test/scheduledEventSync.test.js`, `test/devServer.test.js` (routes call the twins, copies are not synced), `test/reminderScheduler.test.js` (status pass), `test/botModules.test.js` + `test/botRealExports.test.js` (exports).
- No new env variable, permission (F-13 added „Events verwalten/erstellen“) or dependency.
- Wiki: `docs/wiki/modules/bot.md`, `docs/wiki/concepts/discord-integration.md`, `docs/wiki/concepts/reminders-presence.md`, `docs/wiki/concepts/event-lifecycle.md`, `docs/wiki/modules/routes-admin.md`, `docs/wiki/concepts/data-model.md`, `docs/wiki/modules/dev-mock-mode.md`.
