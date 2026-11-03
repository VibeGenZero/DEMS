# Tasks

## 1. Date input

- [x] 1.1 Tests first (RED) in the new `test/localDateTime.test.js`: `parseLocalDateTime` reads „24.12.2026 19:30“ (Europe/Berlin → 18:30Z), „1.7.26 9:05“ (summer time), refuses „31.02.2026 10:00“, „24.12.2026“, „morgen“; `parseEndInput` with `HH:MM` on the start day, the next day when earlier, a full date, empty → null; `parsePollLines` reads 3 lines with and without „– 22:00“, skips empty lines, names the line of an error. Export `zonedParts`/`fromZonedParts` from `utils/eventSeries.js`, implement `utils/localDateTime.js` (design 4); verify green and `node --test test/eventSeries.test.js` still green.

## 2. Shared admin actions

- [x] 2.1 Tests first (RED) in the new `test/adminActions.test.js` (mock mode, own SQLite): `buildNewEvent` defaults and slot places; `publishDraft` sets a draft active, writes `UPDATE_EVENT_STATUS` with „in Discord“, refuses a non-draft (`not_draft`), a missing event and a draft without start; `announceEvent` stores the announcement record and writes `ANNOUNCE_EVENT`, answers the German error without a channel; `createPoll` refuses one date with „Eine Abstimmung braucht 2–10 Termine.“ and writes `CREATE_POLL`; `announcePoll` stores the record. Implement `utils/adminActions.js` (design 1) and switch `POST /events` (builder only), `POST /events/:id/announce`, `POST /polls`, `POST /polls/:id/announce` to it, moving `createEventChannelsAllowed`; verify green and `node --test test/devServer.test.js` green without changing its tests.

## 3. Commands

- [x] 3.1 Tests first (RED) in the new `test/adminCommands.test.js` (mock mode, fake interactions with roles, subcommand and field values): `buildSlashCommands` contains `event`/`poll` with subcommand `create` and the German names; a member without the admin role gets the refusal for both commands, the template autocomplete and a button; an admin gets the event modal (5 inputs), with a template prefilled, with a slot template 4 inputs; an unknown template is refused; the poll modal has 3 inputs. Add the definitions, prefixes and routing (design 2) and the command/modal part of `bot/adminCommands.js` (design 3); verify green and `test/botModules.test.js` (module size, export list unchanged) green.
- [x] 3.2 Tests first (RED): a valid event modal saves a draft with template settings and typed values, writes `CREATE_EVENT` „… in Discord“ and answers with the summary and the three buttons; an invalid one saves nothing and answers the reason with „Korrigieren“, which reopens the modal with the values for the same admin, refuses another user and answers the expiry text after 15 minutes (injected clock). Implement; verify green.
- [x] 3.3 Tests first (RED): „Nur veröffentlichen“ sets the draft active and leaves only the link; „Veröffentlichen & ankündigen“ also logs the mock post and stores the announcement; a second click answers that it is already published; without announcement channel the event is active and the answer names the reason. Implement; verify green.
- [x] 3.4 Tests first (RED): a valid poll modal creates an open poll, logs the mock post and answers with the message link; one date → the 2–10 error and „Korrigieren“; no channel → created, not posted, answer says so. Implement; verify green.

## 4. Seed, wiki, verification

- [x] 4.1 Seed: check that the dummy data has at least one template without and one with slots (`buildEventTemplates`); add a test in `test/seed.test.js` that both exist so the command tests and a manual run have them. Verify `node --test test/seed.test.js`.
- [x] 4.2 Wiki: `docs/wiki/modules/bot.md` (module `bot/adminCommands.js`, custom IDs, command list), `docs/wiki/concepts/discord-integration.md` (admin commands row), `docs/wiki/modules/routes-admin.md` (routes use `utils/adminActions.js`), `docs/wiki/modules/utils.md` (`adminActions`, `localDateTime`), `docs/wiki/concepts/date-polls.md`, `docs/wiki/concepts/event-lifecycle.md` (create from Discord), `docs/wiki/index.md` (file → node rows); run `npm run wiki` and verify `node --test test/wiki.test.js`.
- [x] 4.3 Run `npm test` (no `public/` change, so no e2e) and verify it passes; start `npm run dev:mock` and verify the bot starts without errors (mock mode skips the command registration).

## Workflow follow-up

- PR from `96-b-13-admin-befehle-per-modal` into `feature/m4-discord-funktionen` (German: Problem / Ursache / Änderung / Verifikation); note that `/event erstellen` and `/abstimmung erstellen` must be clicked through on a test server (with and without template, publish, publish & announce, correction, poll).
- Archive the change with `/opsx:archive` after review.
