# Tasks

## 1. /abstimmungen

- [x] 1.1 Tests first (RED) in the new `test/infoCommands.test.js` (mock mode, seeded, fake interactions): `buildSlashCommands` has `polls` with German name `abstimmungen`; the seed's open poll is listed with „N Termine“, deadline, „Noch nicht abgestimmt“ / „Du hast abgestimmt“ (seed voter), „Abstimmen“ = `poll_vote:<id>` and „Ansehen“ link; decided, closed, expired and role-restricted polls (member without the role) are left out; deadline order; seven polls → five + „… und 2 weitere“ under the component limit; none → „📭 Gerade läuft keine Abstimmung.“ + link. Implement `bot/infoCommands.js` part 1 and the definition/routing in `bot/commands.js` (design 2); update the command list in `test/slotInteractions.test.js`; verify green.

## 2. /event info

- [x] 2.1 Tests first (RED): `/event` has the subcommands `create` and `info` (adjust `test/adminCommands.test.js`); the info autocomplete offers active, not over events containing the typed text, next first, ≤ 25, while `create` still offers templates; an active event answers privately with the announcement layout (V2 flag, „Anmelden“, „Zum Event“); a draft answers „❌ Event nicht gefunden.“ for a member and the details for an admin; a waitlisted member sees „Dein Status: 🕒 Warteliste – Platz N von M“, a slot member the slot. Implement part 2 (design 3) and export `formatStatusWithSlot` from `bot/myEvents.js` (verify `node --test test/myEventsCommand.test.js` stays green); verify green and `test/botModules.test.js` (module size, export list) green.

## 3. Seed, wiki, verification

- [x] 3.1 Test in `test/seed.test.js` that `dev-poll-raid` is open with a deadline in the future (design 4); verify `node --test test/seed.test.js`.
- [x] 3.2 Wiki: `docs/wiki/modules/bot.md` (module `bot/infoCommands.js`, module count, slash command paragraph), `docs/wiki/concepts/discord-integration.md` (slash command row), `docs/wiki/concepts/date-polls.md` (Discord section), `docs/wiki/index.md` if a file row is needed; run `npm run wiki` and verify `node --test test/wiki.test.js`.
- [x] 3.3 Run `npm test` (no `public/` change, so no e2e) and verify it passes; start `npm run dev:mock` and verify the bot starts without errors.

## Workflow follow-up

- PR from `95-b-12-abstimmungen-und-event-info` into `feature/m4-discord-funktionen` (German: Problem / Ursache / Änderung / Verifikation); note that `/abstimmungen` and `/event info` must be clicked through on a test server.
- Archive the change with `/opsx:archive` after review.
