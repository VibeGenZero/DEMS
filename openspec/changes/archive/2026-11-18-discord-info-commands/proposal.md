# Proposal

## Why

Ticket **B-12** (#95, milestone M4 · Discord-Funktionen, depends on B-01). A member who wants to vote on a date poll has to find its message in the announcement channel, and details of an event are only in its (maybe long scrolled away) announcement or on the website. Two small private commands bring both into reach from any channel.

## What Changes

- **`/abstimmungen`** (base name `/polls`): private answer with the open date polls (open status, before the deadline) the member may vote in, soonest deadline first: title, number of dates, deadline, own state („Du hast abgestimmt“ / „Noch nicht abgestimmt“) and the buttons „Abstimmen“ (the existing vote flow) and „Ansehen“ (poll page). At most five; with more a closing line links the poll overview. Without any: a German note with the link.
- **`/event info event:<event>`** (German `/event info`, next to the admin subcommand `erstellen` of B-13): private answer with the event details in the layout of the announcement (banner, description, facts, line-up, „Anmelden“/slot buttons while registration is open, „Zum Event“), plus the member's own status when registered („✅ Angemeldet“, „📋 Anfrage ausstehend“, „🕒 Warteliste – Platz N von M“, „❌ Abgelehnt“, with slot). The option autocompletes active events that are not over, next first. Drafts and archived events answer „❌ Event nicht gefunden.“ for non-admins, as on the website.
- Both commands are for every member; nothing is posted publicly.

Out of scope: voting directly inside the list (the existing „Abstimmen“ answer does it), polls the member may not vote in, past events in the autocomplete.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `discord-slash-commands`: adds the member commands `/abstimmungen` and `/event info` (new requirements; the existing ones stay unchanged).

## Impact

- Code: new bot area module `bot/infoCommands.js` (`buildOpenPollsMessage`, `handlePollsCommand`, `buildEventInfoMessage`, `handleEventInfoCommand`, `handleEventInfoAutocomplete`); `bot/commands.js` (definition of `/polls`, subcommand `info` of `/event`, routing; the `/event` autocomplete splits by subcommand); `bot/myEvents.js` exports `formatStatus`; `bot/messages.js` unchanged (`buildEventAnnouncement` is reused).
- No new `bot.js` export, no mock twin (the commands only answer the interaction). No new env variable, permission, data field or dependency.
- Seed: already has an open poll (`dev-poll-raid`) and active events; a seed test pins the open poll for the command.
- Tests: new `test/infoCommands.test.js` (mock mode, fake interactions); `test/slotInteractions.test.js` (command list); `test/adminCommands.test.js` (the `/event` definition now has two subcommands).
- Wiki: `docs/wiki/modules/bot.md`, `docs/wiki/concepts/discord-integration.md`, `docs/wiki/concepts/date-polls.md`, `docs/wiki/index.md`.
