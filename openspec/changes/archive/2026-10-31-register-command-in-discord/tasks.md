# Tasks

## 1. Test double

- [x] 1.1 Extend `createFakeInteraction` in `test/helpers.js` with `showModal(modal)` that records `['showModal', modal]` and resolves `answered`; update its JSDoc. Verify the existing interaction tests (`node --test test/slotInteractions.test.js test/pollInteractions.test.js test/botRealExports.test.js`) stay green.

## 2. /register in Discord

- [x] 2.1 Write tests first (RED) in `test/slotInteractions.test.js`, replacing the pinned test "/register answers with the website link of the event": event without slots and form → `deferReply` then `editReply` with the registration result and a `registrations` document with `source: 'discord'`; event without slots with a 2-field form → `showModal` with custom ID `event_register_modal:<id>`; already registered → private "❌ Du bist bereits für dieses Event registriert."; registration deadline passed → the registration-closed message and no document; slot event with Tank (1/1 taken) and Heiler (free) → private `reply` whose buttons are "Tank (voll)" (`event_slot:<id>:tank`) and "Heiler" (`event_slot:<id>:heal`); event whose form exceeds the modal limit → private reply containing `buildEventUrl(id)`; the existing "unknown event" test keeps passing. Verify the new tests fail.
- [x] 2.2 Export `buildSlotButton` from `bot/messages.js` and `checkRegistrationConditions` from `bot/registration.js`; add `handleRegisterCommand(interaction, eventId)` to `bot/commands.js` per design decisions 1–2 (no slots → `handleEventRegisterButton`; slots → checks, modal-size check, slot-button rows of ≤5 with the roster from `buildRoster` + `loadEventRegistrations`); export it from the module (not from `bot.js`). Verify `test/botModules.test.js` (500-line limit) passes.
- [x] 2.3 Replace the `register` branch of `handleChatCommand` in `bot/commands.js` with a call to `handleRegisterCommand`, catch errors with `replyWithFailure`; drop the website-link embed. Verify 2.1 is green and `test/botModules.test.js` (pinned `bot.js` exports unchanged) passes.
- [x] 2.4 Add a test that a click on a slot button from the `/register` answer (`kind: 'button'`, `customId: 'event_slot:<id>:heal'`) registers like the announcement button (registration document with `slotId: 'heal'`, or the slot modal when needed). Verify green.

## 3. German command names

- [x] 3.1 Write a test first (RED): build the command definitions without Discord (extract them into an exported `buildSlashCommands()` in `bot/commands.js`, used by `registerSlashCommands`) and assert `register` has `name_localizations.de === 'anmelden'`, `unregister` has `'abmelden'`, both have a German `description_localizations.de`, and `events` stays unchanged. Verify it fails.
- [x] 3.2 Implement design decision 3 (`setNameLocalizations`, `setDescriptionLocalizations`); verify 3.1 is green.

## 4. Wiki

- [x] 4.1 Update `docs/wiki/modules/bot.md` (commands row: `handleRegisterCommand`, `buildSlashCommands`; slash-command paragraph: `/register` = `/anmelden` registers in Discord, slot choice, form-too-big link; `/unregister` = `/abmelden`), `docs/wiki/concepts/discord-integration.md` (TL;DR and slash-command row) and the "Abmeldung"/"Anmeldung" rows of `docs/wiki/reference/glossary.md`; run `npm run wiki` and verify `node --test test/wiki.test.js` passes.

## 5. Verification

- [x] 5.1 Run `npm test` and verify all suites pass (no UI change, so no `npm run test:e2e`).
- [x] 5.2 Check in `npm run dev:mock` that the bot starts without errors (mock mode skips the Discord command registration); note in the PR that `/anmelden` must be clicked through on a test server (slot event, form event, event without form) per the M4 "Fertig, wenn".

## Workflow follow-up

- Archive the change with `/opsx:archive` after review and the test-server check.
