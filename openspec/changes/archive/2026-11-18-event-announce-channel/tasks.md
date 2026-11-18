# Tasks

## 1. Server

- [x] 1.1 Tests first (RED) in `test/devServer.test.js`: `POST` and `PUT /api/admin/events` store `announceChannelId` (and `''` when left out); „abc“ → 400 „Ankündigungskanal ist ungültig.“; „Ankündigen“ of an event with its own channel logs the mock post in that channel (not the default), and works without a default channel; „Duplizieren“ keeps it; a series save with „following“ and an extension copy it. Add the field to `buildNewEvent`, `buildEventUpdates`, `checkEventFields`, `SERIES_FIELDS` (design 1, 3); verify green.
- [x] 1.2 Tests first (RED) in `test/adminActions.test.js`: `announceEvent` posts to `event.announceChannelId`; a failing send with the own channel answers „Der Ankündigungskanal des Events ist nicht erreichbar – wähle im Assistenten einen anderen.“ and stores nothing (mock send stubbed to fail); with the default channel the old text stays. Implement design 2; verify green.
- [x] 1.3 Tests first (RED) in `test/eventTemplates.test.js` / `test/wizardTemplates.test.js`: `TEMPLATE_FIELDS` and the frontend mirror contain `announceChannelId`, `pickTemplateSettings` keeps a string and drops other types; `/event erstellen` with a template carrying a channel creates the draft with it (`test/adminCommands.test.js`). Implement design 3; verify green.

## 2. Wizard and dialog

- [x] 2.1 Tests first (RED) with the frontend harness (`loadFrontendApp`, as the existing wizard tests): step 5 has `#event-announce-channel` with „Standard aus der Bot-Zentrale (#…)“ first and the text channels; `fillWizard` selects a stored channel and adds „Gespeicherter Kanal (<id>)“ for an unknown one; saving sends `announceChannelId`; a template fills it. Implement the markup (tokens/components only, no inline styles) and `wizard.js`/`bot-control.js` changes (design 4); verify green and `npm test` CSS/CSP checks.
- [x] 2.2 Tests first (RED): the announce dialog shows „Wird in #<name> gepostet.“ for an own channel, „… (Standard) gepostet.“ for the default and the no-channel note. Implement `#announce-target` (design 5); verify green.

## 3. Seed, wiki, verification

- [x] 3.1 Seed: give one active event (the raid, `EVENT_ID.ROLE`) its own channel from the mock guild (a text channel other than the announcement channel) so the wizard and „Ankündigen“ show it in mock mode; pin it in `test/seed.test.js`. Verify `node --test test/seed.test.js`.
- [x] 3.2 Wiki: `docs/wiki/concepts/data-model.md` (`announceChannelId`), `docs/wiki/concepts/discord-integration.md` (announcement row), `docs/wiki/modules/routes-admin.md` (announce, validation), `docs/wiki/concepts/event-lifecycle.md` (series fields), `docs/wiki/modules/utils.md` (`announceEvent`, templates), `docs/wiki/modules/frontend-app.md` and `docs/wiki/modules/frontend-markup.md` (select, dialog line); run `npm run wiki` and verify `node --test test/wiki.test.js`.
- [x] 3.3 Run `npm test` and `npm run test:e2e` (UI changed) and verify both pass; in `npm run dev:mock` open the raid in the wizard as Mori, check the channel, announce it and check the mock log.

## Workflow follow-up

- PR from `94-b-11-ankündigungskanal-pro-event` into `feature/m4-discord-funktionen` (German: Problem / Ursache / Änderung / Verifikation); note the test-server check (event with own channel, deleted channel).
- Archive the change with `/opsx:archive` after review.
