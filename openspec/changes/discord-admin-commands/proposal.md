# Proposal

## Why

Ticket **B-13** (#96, milestone M4 · Discord-Funktionen, depends on B-01). Admins plan in Discord, but creating an event or a date poll means switching to the website and walking through the wizard. A quick way from Discord — title, date, places, description; draft or announce right away — lowers the step for the everyday case; the wizard stays for the details.

## What Changes

- **`/event erstellen`** (base name `/event create`, German client `/event erstellen`): opens a Discord modal with Titel, Beginn, Ende (optional), Plätze and Beschreibung. The optional option `vorlage` (autocomplete over the event templates of W-10) prefills the modal and supplies every setting the modal does not ask for (access, approval, slots, form, reminders, role, banner, channels…).
- Submitting saves the event as **draft** and answers privately with a summary and the buttons „Veröffentlichen & ankündigen“, „Nur veröffentlichen“ and „Im Web öffnen“ (link). „Veröffentlichen & ankündigen“ sets the event active and posts it to the announcement channel like „Ankündigen“ on the website; „Nur veröffentlichen“ only sets it active.
- **`/abstimmung erstellen`** (base name `/poll create`): a modal with Titel, Termine (one per line, 2–10) and Beschreibung. Submitting creates the date poll and posts it to the announcement channel at once; the answer links the message.
- **Only admins:** everybody sees the commands; members without the DEMS admin role (`DISCORD_ADMIN_ROLE_ID`) get „⛔ Nur Admins können Events und Abstimmungen erstellen.“. The buttons check again.
- **Wrong input** (date not readable, end before start, too few dates…) answers privately with the German reason and „Korrigieren“, which reopens the modal with the typed values (kept 15 minutes).
- Dates are typed as `TT.MM.JJJJ HH:MM` in the server's time zone (`TIMEZONE`); the end may also be just `HH:MM` (same day, or the next day when earlier than the start).
- Audit log as on the website: `CREATE_EVENT`, `UPDATE_EVENT_STATUS`, `ANNOUNCE_EVENT`, `CREATE_POLL`, `ANNOUNCE_POLL`, with the admin's Discord id and "in Discord" in the detail.
- Refactor so web and Discord share one path: building a new event, announcing an event, creating and announcing a poll move out of `routes/admin.js` into `utils/`.

Out of scope: series (recurring events), editing existing events from Discord, ping options (roles, `@everyone`, text) for the Discord announcement, hiding the commands through Discord permissions.

## Capabilities

### New Capabilities
- `discord-admin-commands`: the admin slash commands `/event erstellen` and `/abstimmung erstellen` — who may use them, the modals, input rules, draft/publish/announce and the corrections loop.

### Modified Capabilities
_None._ (`discord-slash-commands` covers the member commands; its requirements do not change.)

## Impact

- Code: new bot area module `bot/adminCommands.js` (handlers, modals, admin check, corrections store); `bot/commands.js` (two command definitions, autocomplete and routing); `bot/interactions.js` (modal and button routing); `bot/constants.js` (custom ID prefixes); new `utils/localDateTime.js` (date input parsing on top of the zone helpers of `utils/eventSeries.js`); new `utils/adminActions.js` (`buildNewEvent`, `publishDraft`, `announceEvent`, `createPoll`, `announcePoll`, shared with `routes/admin.js`); `utils/eventSeries.js` (export the zone helpers).
- No new bot.js export, so no new mock twin: the handlers use the interaction itself and existing helpers (`sendChannelMessage`, `ensureAnnouncementThread`, `createEventChannels`), reached through `require('../bot')` inside `utils/adminActions.js`, so mock mode logs them.
- Data: no new field. Events created in Discord carry `createdBy` = the admin's Discord id like web events.
- No new env variable, permission or dependency.
- Tests: new `test/adminCommands.test.js` (mock mode, fake interactions), new `test/localDateTime.test.js`; `test/devServer.test.js` (routes still answer the same after the refactor); command list tests if they pin the definitions.
- Wiki: `docs/wiki/modules/bot.md` (module, custom IDs), `docs/wiki/concepts/discord-integration.md` (commands), `docs/wiki/modules/routes-admin.md` (shared helpers), `docs/wiki/modules/utils.md`, `docs/wiki/concepts/date-polls.md`, `docs/wiki/concepts/event-lifecycle.md` (create from Discord), `docs/wiki/index.md` (file → node rows).
