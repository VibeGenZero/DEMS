# Proposal

## Why

Ticket **B-10** (#93, milestone M4 · Discord-Funktionen, depends on W-01). Members keep the event role (`assignRoleId`) forever: it is only taken back when somebody unregisters. The event channels go away only through „Jetzt beenden“, a status change with „Auto Channel-Erstellung“ or a cancellation; the automatic archive 24 h after the end (W-01) leaves both role and channels, so the Discord server fills up with old event channels and stale roles.

## What Changes

- **Clean-up when an event ends for good:** when an event becomes `archived` (automatic archive, „Jetzt beenden“, „Archivieren“, saving it as archived) or `cancelled` (absagen, status change), DEMS deletes its event channels and takes the event role from every accepted participant.
- **Shared roles stay where they are still needed:** a member keeps the role while they are accepted for another event that is `draft` or `active` and hands out the same role (e.g. the next date of a series).
- **Deleting an event** (single or series) also takes the role from its accepted participants before the registrations go (the channels were already deleted).
- **Offline bot:** a clean-up that could not run because the bot was not ready stays pending and the archive scheduler (every 5 minutes) catches it up.
- **Reactivating** („Wieder aktivieren“) an archived or cancelled event hands the role back to its accepted participants; the channels come back as today through „Auto Channel-Erstellung“.
- Each clean-up writes an audit entry `DISCORD_CLEANUP` by „System“ (role taken from n members, channels deleted).

Out of scope: removing a role a member already had before registering (DEMS does not know it), cleaning up events archived before this change, the Discord server event (B-09 handles it), the shared-role check on a single unregistration.

## Capabilities

### New Capabilities
- `event-discord-cleanup`: what DEMS removes in Discord when an event is over for good (archived, cancelled, deleted), which members keep a shared role, catching up after an offline bot and handing the role back on reactivation.

### Modified Capabilities
_None._

## Impact

- Code: new `utils/eventCleanup.js` (clean-up, retry of pending ones, role hand-back); new bot helper `removeRoleFromMembers` in `bot/guild.js`, exported through `bot.js`, twin in `dev/mockBot.js`; `utils/eventArchive.js` (clean-up after the auto archive, retry pass); `routes/admin.js` (status, cancel, end, save, delete, series delete).
- Data: events get `discordCleanup` (`pending` | `done` | null).
- Dev mock: a new mock role „Event-Teilnehmer“ in `dev/mockGuild.js`, used by seed events in `dev/seedData.js`.
- Tests: new `test/eventCleanup.test.js`; `test/eventArchive.test.js`; `test/devServer.test.js`; `test/botModules.test.js` + `test/botRealExports.test.js` (export lists); `test/seed.test.js` if the seed changes break it.
- No new env variable, permission („Rollen verwalten“ and „Kanäle verwalten“ are already requested) or dependency.
- Wiki: `docs/wiki/concepts/event-lifecycle.md`, `docs/wiki/concepts/discord-integration.md`, `docs/wiki/modules/bot.md`, `docs/wiki/modules/routes-admin.md`, `docs/wiki/concepts/data-model.md`, `docs/wiki/concepts/reminders-presence.md` (archive scheduler), `docs/wiki/modules/dev-mock-mode.md` (the stale gotcha "Deleting an event does not delete its channels" in `event-lifecycle.md` goes, the route deletes them first already).
